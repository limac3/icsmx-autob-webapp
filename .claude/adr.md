# ADR — icsmx-autob-webapp

> **Este ADR es un espejo, no la fuente de verdad.** La fuente de verdad es `agent_files/`.
> Aqui vive la capa que los documentos no tienen: cada decision enlazada al simbolo de codigo
> que la materializa, en forma consultable por el grafo. Si ADR y documento se contradicen,
> **gana el documento**; el ADR esta desactualizado y hay que regenerarlo.
>
> **Cadena de autoridad: codigo > documento > ADR.** Las anclas de abajo dicen *donde mirar*,
> no prueban que la regla se cumpla: son un indice congelado en el ultimo `index_repository`.
> Todo lo que decida seguridad o correccion —permisos, transiciones, condiciones de escritura,
> motor de fila— se verifica leyendo el archivo antes de afirmarlo o de editarlo. Ver
> `CLAUDE.md`, seccion "Grafo de Codigo — Consulta, No Evidencia".
>
> Sincronizado con: `d211ddd` (rama `main`, 2026-09-06), Etapa 5 cerrada. Los headings de
> `agent_files/*.md` ya estan indexados como nodos `Section` — consultables con
> `MATCH (s:Section) WHERE s.file_path CONTAINS 'agent_files'`. Este ADR no los duplica.
>
> Este archivo es la copia local y versionada del ADR. El ADR que vive en el grafo se pierde
> en cada `index_repository`; se recarga desde aqui. Ver "Mantenimiento de este ADR" y
> `agent_files/desafios-implementacion.md` seccion 21.

## Contexto

Venta de vehiculos obsoletos de flotilla mediante convocatorias, con fila de adjudicacion por
orden de llegada (FIFO) y trazabilidad auditable de punta a punta. El cobro **no** ocurre en
esta aplicacion: es un proceso externo; aqui se registra el comprobante y se avala.

Stack: Next.js 16 App Router + React 19 + TypeScript strict, Eden UI, Okta OIDC via
`@auth0/nextjs-auth0`, EAS para permisos, DynamoDB single-table, S3 + CloudFront para
fotografias, CES (REST corporativo) para correo, AWS Amplify Gen2 como IaC y hosting SSR.

Fuera de alcance: cobro, facturacion, logistica de entrega.

## Principios

Fuente: `agent_files/estrategia-aplicacion.md` seccion 1 (linea 8).

| ID | Principio | Consecuencia operativa |
| --- | --- | --- |
| P-1 | El servidor decide, el cliente presenta | Ocultar en UI no es validar: toda Server Action es invocable directamente |
| P-2 | Las reglas puras se separan del acceso a datos | `src/lib/domain/` no importa nada de `src/lib/data/`; si una regla necesita leer, se le pasa como argumento |
| P-3 | Las garantias se delegan a la base de datos | Escritura condicional, nunca leer-y-decidir. Aplica a R-07, R-08, R-09, R-10 |
| P-4 | Fallar fuerte y visible | Sin fallback silencioso a mock: EAS/DynamoDB/S3 caidos producen error explicito |
| P-5 | Auditable por construccion | El evento se escribe en la misma transaccion que la mutacion, no despues |
| P-6 | Mobile-first de verdad | CardView en movil, tabla en escritorio; el participante entra desde el telefono en el instante de apertura |

## Decisiones arquitectonicas

Fuente: `agent_files/estrategia-aplicacion.md` seccion 6 (linea 194).

### D-1 — Amplify Gen2 y DynamoDB
Decidido: Amplify Gen2 como IaC y hosting SSR, DynamoDB single-table.
Descartado: Terraform + ECS Fargate + Azure Pipelines con PostgreSQL y Prisma — el precedente
real de la organizacion (`icsmx-camp-webapp`).
Razon: decision explicita del proyecto. DynamoDB aporta escrituras condicionales y contadores
atomicos, que encajan directo con la fila y la auditoria append-only.
Riesgo asumido: la organizacion no tiene precedente de Amplify (R1). Mitigacion: la frontera
esta limpia — todo el acceso a datos pasa por `src/lib/data/`, migrar el IaC no toca la app.
Anclas: `amplify/backend.ts`, `amplify/tabla.ts`, `src/lib/data/cliente.ts`.

### D-2 — Single-table
Descartado: una tabla por entidad.
Razon: las lecturas son jerarquicas (convocatoria → lotes → fila) y una sola `Query` resuelve
cada pantalla. Sobre todo, permite escribir la mutacion y su evento de auditoria en la misma
`TransactWriteItems` — es lo que hace cumplible la regla 4 de `CLAUDE.md`.
Anclas: `src/lib/data/claves.ts`, `src/lib/data/transacciones.ts::ejecutarTransaccion`.

### D-3 — El lote como entidad de la fila
Descartado: la fila sobre el vehiculo.
Razon: un vehiculo se reoferta en varias convocatorias. Con la fila sobre el lote, cada
reoferta empieza limpia sin arrastrar historia, y el auditor conserva las dos por separado.
Anclas: `src/lib/data/claves.ts::lote`, `src/lib/fila/prototipoDeFila.ts`.

### D-4 — TypeScript strict
Descartado: JavaScript con JSDoc, como el proyecto hermano.
Razon: el dominio es de estados y transiciones. Las uniones discriminadas y el chequeo de
exhaustividad convierten una transicion no contemplada en un error de compilacion.
Costo: el preset `festack-scripts` no esta ejercitado sobre TypeScript en la organizacion (R9).
Anclas: `tsconfig.json`, `src/types/`.

### D-5 — El turno en la clave de ordenamiento
Descartado: guardar `turno` como atributo y ordenar al leer.
Razon: con `SOL#<turno:010d>` la fila llega **ya ordenada**. No existe punto del codigo donde
se pueda ordenar mal, porque nunca se ordena. Propiedad estructural, no convencion a recordar.
Anclas: `src/lib/data/claves.ts`, `src/lib/fila/prototipoDeFila.ts::registrarSolicitud`.

### D-6 — Correo por outbox
Descartado: enviar el correo dentro del flujo de adjudicacion.
Razon: el proveedor de correo no participa en la transaccion de DynamoDB. En linea significaria
o adjudicar sin notificar, o fallar la adjudicacion por un problema de correo. El outbox
desacopla: la adjudicacion es atomica y el envio se reintenta aparte.
El argumento no dependia del proveedor y sobrevivio al cambio de SES a **CES** (REST
corporativo, `arquitectura-tecnica-aws.md` 2.5): con un tercero remoto por HTTP se refuerza.

### D-7 — Barrido mas verificacion perezosa
Descartado: solo el barrido programado.
Razon: si el barrido se cae, toda fila con adjudicacion vencida queda bloqueada (R6). Con
verificacion perezosa, cualquier lectura de una fila vencida la resuelve en el momento. El
barrido pasa a ser red de seguridad, no unico mecanismo.
Costo aceptado: una lectura puede provocar una escritura. Acotado e idempotente.
Anclas: `amplify/barrido/handler.ts`.

### D-8 — Idioma del dominio en espanol
Entidades, estados y acciones en espanol (`solicitarCompra`, `EN_FILA`, `convocatoria:aprobar`).
Las APIs de framework y librerias siguen en ingles.
Razon: las reglas se discuten con el negocio en espanol. Traducir `convocatoria` a `campaign`
introduce una capa de interpretacion donde la precision importa.

### D-9 — Autorizacion por permisos: la aplicacion no codifica politica
`puedeEjecutar` decide con **permisos**, no con roles. EAS no expone roles: se le pregunta por
nombres de permiso y responde un booleano por cada uno. La aplicacion declara **que permiso
exige cada accion** y **bajo que condiciones del recurso aplica**; quien tiene ese permiso lo
decide la organizacion en EAS.
Razon: la politica organizacional cambia sin avisar y a distinto ritmo que el codigo. Con
permisos ese cambio es una reconfiguracion en EAS y este repositorio no se toca; con roles
seria un despliegue.
Division: EAS decide la **capacidad** ("¿puede operar tesoreria?"); la aplicacion decide la
**aplicabilidad** ("¿esta solicitud esta en `EN_VERIFICACION`?"), que es lo unico que EAS no
puede saber.
Descartado:
- RBAC con lista de roles en el codigo (lo que habia hasta la Etapa 2). EAS no puede entregar
  roles, y congelaba politica organizacional en el repositorio. Defecto concreto: unir los
  roles de una persona concedia acciones que la matriz negaba, porque `EMPLEADO` era a la vez
  permiso de compra y discriminador del tipo de participante.
- RBAC con exclusiones explicitas (`deny-override`). Misma objecion, y volveria inexpresable el
  caso legitimo de que la organizacion quiera permitirlo.
- Un permiso por accion (33 permisos). Costo de configuracion en EAS y fragmenta capacidades
  que se conceden juntas. Se eligio granularidad de capacidad: siete permisos.
Anclas: `src/lib/auth/permisos.ts::puedeEjecutar`, `::guardaGatingTriple`,
`src/lib/auth/exigirPermiso.ts`, `src/lib/auth/easAdapter.ts::consultarPermisosEas`.
Estas anclas se leen del archivo antes de tocar cualquier guarda: es codigo de seguridad.

## Decisiones de modelo de datos

Fuente: `agent_files/modelo-datos-dynamodb.md` seccion 1 (linea 11).

| Decision | Razon |
| --- | --- |
| Tabla unica | Lecturas jerarquicas; una `Query` por pantalla |
| `turno` en la clave de ordenamiento con relleno de ceros | DynamoDB devuelve la fila ya ordenada; imposible reordenar por error |
| Contador atomico **en el item del lote** | `ADD` es atomico sin transaccion ni lectura previa. Uno por lote, nunca global — evita particion caliente |
| Ventana de venta **desnormalizada** en el lote | Permite condicionar la escritura a "la venta esta abierta" sin leer la convocatoria; sin la copia habria que leer-y-decidir, que es justo lo prohibido |
| Items **centinela** para unicidad | `attribute_not_exists` sobre un item dedicado convierte reglas de negocio en garantias de la base de datos |
| Eventos de auditoria en la **misma tabla** | Unico modo de escribirlos en la misma `TransactWriteItems` que la mutacion |

Centinelas: vehiculo activo (R-10), fila (R-07), adjudicacion activa (R-09), reserva de turno
(R18). Transacciones criticas T1–T8 en `modelo-datos-dynamodb.md` seccion 6 (linea 258).

**R18 — la carrera entre el turno y su visibilidad** quedo cerrada con evidencia
(`modelo-datos-dynamodb.md` linea 351; commit `c1dabfc`). El motor de fila vive hoy en
`src/lib/fila/prototipoDeFila.ts` — es prototipo verificado contra el sandbox, **no** el
servicio de produccion. Prueba de concurrencia en
`src/lib/fila/prototipoDeFila.integracion.test.ts::carreraControlada`.

## Decisiones de negocio registradas

Fuente: `agent_files/proyecto.md` seccion 8 (linea 373).

| Decision | Descartado | Razon |
| --- | --- | --- |
| Varias filas simultaneas, una sola adjudicacion activa (R-09) | Sin limite; una sola solicitud por convocatoria | Equilibra participacion amplia con evitar acaparamiento |
| Plazo en horas naturales (R-13) | Horas habiles con calendario de festivos | Auditabilidad y simplicidad de dominio |
| `EN_APROBACION` como estatus adicional | Reusar `BORRADOR` para lo enviado a dictamen | Sin el no hay bandeja de aprobacion ni bloqueo de edicion |
| Rechazo devuelve a `BORRADOR` con motivo en bitacora | Estatus `RECHAZADA` | Menos estados; el motivo ya queda trazado |
| Sin estado `COMPROBANTE_CARGADO` | Separarlo de `EN_VERIFICACION` | El enunciado los define como el mismo evento |
| El lote es la entidad de la fila | Fila a nivel de vehiculo | Reofertar sin arrastrar historia previa |
| 404 en lugar de 403 para lo no visible (R-01) | 403 explicito | No revelar la existencia de convocatorias no publicadas |
| La vista de dictamen es la pantalla de detalle; `/aprobaciones` es solo la bandeja | Una ruta `/aprobaciones/[id]` con su propia vista | Las acciones se derivan de la maquina de estados y del permiso de quien mira, asi que la pantalla de detalle ya **es** la de dictamen. Dos vistas del mismo dictamen se separarian al primer cambio |

## Catalogo de permisos

Fuente: `agent_files/permission-matrix.md` seccion 1 (linea 40).
**Pendiente de confirmacion con el equipo de EAS** (R19): los nombres son propuesta a
granularidad de capacidad. Hasta que el operador confirme nombres y contrato del endpoint, el
adaptador real no se cierra y se trabaja con `ENABLE_DEV_TOOLS`.

`Autob_Administrar_Vehiculos`, `Autob_Administrar_Convocatorias`, `Autob_Aprobar_Convocatorias`,
`Autob_Venta_a_empleados`, `Autob_Venta_en_general`, `Autob_Operar_Tesoreria`, `Autob_Auditar`.

Un empleado recibe los dos permisos de venta. Eso reemplaza la antigua regla "`EMPLEADO` es
superconjunto de `OTRO_USUARIO`" sin ningun caso especial en el codigo: la relacion de
superconjunto pasa a ser configuracion de EAS.

La lista de arriba es un resumen: la matriz vigente esta en `permission-matrix.md` y la
aplicacion real, en `src/lib/auth/permisos.ts`. No decidir una guarda leyendo solo este ADR.

## Inmutabilidad de la bitacora

Fuente: `agent_files/trazabilidad-auditoria.md` seccion 4 (linea 166).

- **Atomicidad** (regla 4): el evento va en la misma `TransactWriteItems` que la mutacion. Si
  el evento no se puede escribir, la mutacion no ocurre.
- **Append-only** (regla 5): prohibido `UpdateItem`/`DeleteItem` sobre items `AUDIT#`; la
  politica IAM lo deniega explicitamente. Ademas todo `Put` de evento lleva
  `attribute_not_exists(PK)` — IAM no puede impedir la sobrescritura, porque `PutItem` es justo
  lo que la regla 4 obliga a permitir.
- **Correccion por compensacion** (R-20): nunca se edita un evento; se agrega uno que corrige.
- Las identidades **si** se registran en la bitacora, aunque nunca se expongan entre
  participantes (regla 7).
Anclas: `src/lib/data/eventos.ts::atributosDeEvento`, `amplify/auditoriaInmutable.ts`,
`src/lib/data/identificadores.ts::nuevoUlid`.

## Capas y frontera de dependencia

```
src/app/<ruta>/page.tsx      Server Component: sesion -> permiso -> lectura -> serializar
src/app/actions/<area>.ts    Server Action delgada: sesion + puedeEjecutar + delega
src/lib/<feature>/<verbo>.ts Servicio: acceso a datos, { ok, data } | { ok, error }
src/lib/domain/*.ts          Reglas puras, sin I/O
src/lib/data/*.ts            Cliente DynamoDB, claves, helpers de transaccion
src/components/*.tsx         Componentes planos, con .css y .test.tsx colocados
```

Cada capa conoce solo la de abajo. Paginas y actions **no hablan con DynamoDB**. El grafo
confirma la frontera —`app → lib` 22 llamadas, `lib → types` 20, `lib → utils` 10, sin arista
`app → data` directa—, pero esa cuenta es del ultimo indexado: una violacion introducida
despues no aparece hasta reindexar. Servicios reciben el cliente por `deps` — inyeccion que
permite el cliente falso `src/utils/clienteDynamoFalso.ts` en pruebas.

## Zona horaria y cache

- Zona horaria unica de negocio `America/Mexico_City`, en `src/lib/domain/fechas.ts` con
  `Intl.DateTimeFormat().formatToParts`. Persistir siempre ISO-8601 UTC. Prohibido comparar
  ventanas de venta con la hora local del cliente. Ancla: `::partesEnZonaDeNegocio`.
- Nada sin publicar entra a cache estatica: las rutas dependen de `publicadaEn`; `Suspense` con
  lectura dinamica o `cacheLife` corto con `revalidateTag` disparado por la publicacion.
- URLs firmadas de CloudFront: firmar en SSR, nunca persistir en base de datos ni generar
  dentro de un bloque `"use cache"`.
Anclas de gating: `src/lib/domain/gating.ts::evaluarVisibilidad`,
`src/lib/domain/ventanas.ts::faseDeVenta`.

## Mantenimiento de este ADR

**`index_repository` borra el ADR del grafo.** Reconstruye la base y `manage_adr` queda vacio,
aunque el reindexado haya sido por un cambio de codigo sin relacion con la documentacion. Por
eso este archivo, `.claude/adr.md`, es la copia versionada: el grafo es el indice consultable,
no el almacen. Detalle completo en `agent_files/desafios-implementacion.md` seccion 21.

Procedimiento cuando cambia `agent_files/`, `CLAUDE.md` o `AGENTS.md`:

1. Editar **este archivo** con la decision nueva o corregida.
2. `index_repository(repo_path, mode="full")` — refresca los nodos `Section` de los documentos.
   Usar `full`: `fast` excluye `scripts/` y `src/lib/media/` y omite las aristas de similitud.
3. `manage_adr(project, mode="update", content=<contenido de .claude/adr.md>)`.
4. Actualizar la linea "Sincronizado con" del encabezado.

Despues de **cualquier** `index_repository`, aunque no haya cambiado la documentacion, repetir
el paso 3 o el ADR queda perdido en el grafo. Verificar con `manage_adr(mode="sections")`: si
devuelve `[]`, se borro.

El hook `.claude/hooks/adr-doc-sync` avisa al editar estos documentos. El avance de
`plan-ejecucion.md` no toca el ADR: aqui van decisiones, no progreso.

Regla de contenido: este ADR captura **decisiones** — que se eligio, que se descarto y por que,
mas el ancla de codigo. No copia prosa, procedimientos ni checklists.
