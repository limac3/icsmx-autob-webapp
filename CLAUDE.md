# CLAUDE.md — Contexto del Proyecto para Claude Code

## Resumen del Proyecto

Aplicacion de **venta de vehiculos obsoletos de flotilla** mediante convocatorias de venta,
con fila de adjudicacion por orden de llegada (FIFO) y trazabilidad auditable de punta a punta.

Stack: Next.js 16 App Router + React 19 + **TypeScript strict**, Eden UI, Okta OIDC via
`@auth0/nextjs-auth0`, **EAS para permisos** (responde un booleano por permiso, no roles),
**DynamoDB single-table**, S3 + CloudFront para fotografias, **CES** para correo (REST
corporativo, no SES), **AWS Amplify Gen2** como IaC y hosting SSR, toolchain
`@churchofjesuschrist/festack-scripts`.

El cobro **no** ocurre en esta aplicacion: es un proceso externo. Aqui se registra el
comprobante de pago y se avala.

## Documentos de Contexto Obligatorios

Lee estos archivos al inicio de cada tarea. Estan en `agent_files/`:

| Archivo | Proposito |
| --- | --- |
| `agent_files/plan-ejecucion.md` | **Plan por etapas con checkboxes, riesgos y mitigaciones. Fuente de verdad del avance.** |
| `agent_files/proyecto.md` | Reglas de negocio, alcance funcional, maquinas de estado |
| `agent_files/estrategia-aplicacion.md` | Principios, capas, decisiones arquitectonicas |
| `agent_files/modelo-datos-dynamodb.md` | Patrones de acceso, claves, GSIs, transacciones |
| `agent_files/arquitectura-tecnica-aws.md` | Topologia AWS, Amplify Gen2, cache, flujos |
| `agent_files/identidad-autorizacion.md` | Okta OIDC, permisos de EAS, tipos de convocatoria accesibles, flujo de aprobacion |
| `agent_files/permission-matrix.md` | Matriz de permisos: permiso x accion = allow/deny, mas guardas contextuales |
| `agent_files/trazabilidad-auditoria.md` | Eventos auditables, formato, garantias de inmutabilidad |
| `agent_files/api-contracts.md` | Contratos de Server Actions y Route Handlers |
| `agent_files/ui-ux-requerimientos.md` | Requerimientos por pantalla: estructura, datos, interacciones |
| `agent_files/desafios-implementacion.md` | Decisiones tomadas y problemas resueltos |
| `agent_files/runbooks.md` | Operacion: barrido de vencimientos, reenvio de correo, incidentes |
| `AGENTS.md` | Convenciones del repositorio, comandos, patrones de codigo |

Los documentos se crean en la **Etapa 0**. Si un documento aun no existe, no lo inventes:
avisa y proponlo.

## Grafo de Codigo — Consulta, No Evidencia

`codebase-memory-mcp` es una **herramienta de consulta para acelerar la localizacion**:
responde donde esta algo, quien lo llama, que se rompe si cambia. No es una fuente de verdad.
El protocolo global que instala el MCP dice "usar el grafo primero"; en este proyecto eso se
lee como **primero para buscar, nunca para concluir**.

**El codigo gana siempre.** El grafo es un derivado con fecha de corte: se congela en el ultimo
`index_repository` y no ve ninguna edicion posterior. Ademas parte de sus aristas son inferidas
—`USAGE`, `SEMANTICALLY_RELATED`, `SIMILAR_TO`, los clusters— y no tienen el mismo peso que un
`CALLS` o un `IMPORTS`.

Regla de trabajo:

1. **Localizar con el grafo**: `search_graph`, `trace_path`, `query_graph`, `get_architecture`.
   Es lo que ahorra el barrido a ciegas.
2. **Verificar en el codigo antes de afirmar o de editar**: `get_code_snippet` para el simbolo
   exacto, o leer el archivo. Ninguna afirmacion sobre el comportamiento del codigo —"esta
   funcion no se usa", "la validacion ocurre aqui", "nadie llama a esto"— se sostiene solo con
   el grafo.
3. **Ante discrepancia, gana el archivo** y el grafo esta obsoleto: reindexar y decirlo.

Aplica con mas fuerza a lo que decide seguridad o correccion: permisos, transiciones de estado,
condiciones de escritura y el motor de fila se leen del archivo, sin excepcion. Un ancla del
ADR o un resultado del grafo es una pista de donde mirar, no la prueba de que algo se cumple.

## Comandos Clave

```bash
npm run dev        # servidor de desarrollo (puerto 3000)
npm run format     # ajustar formato; si hubo cambios en codigo, ejecutar antes de verify
npm run typecheck  # tsc --noEmit
npm run test       # Vitest
npm run verify:rapido  # compuerta completa sin el chequeo de desactualizados (~50 s)
npm run prototipo:fila # prototipo concurrente de la fila contra el sandbox (R18, ~2 min)
npm run carga:apertura # prueba de carga de la apertura de una convocatoria (Etapa 12, sandbox)
npm run verify     # lo anterior + chequeo de paquetes desactualizados (~2.5 min)
npm run build      # build de produccion
npx ampx sandbox   # backend Amplify Gen2 personal
```

## Reglas de Implementacion Criticas

1. **Server Components por defecto**; `"use client"` solo para hooks, estado o eventos de browser.
2. **Server Actions para todas las mutaciones**; Route Handlers solo para: descarga de archivos,
   health check y callbacks de autenticacion.
3. **El orden de la fila lo asigna el servidor, nunca el cliente.** El turno proviene de un
   contador atomico de DynamoDB (`ADD`) sobre el lote. `solicitadoEn` es informativo;
   **`turno` es la unica fuente de verdad del orden**. Jamas ordenar la fila por timestamp.
4. **Toda mutacion de una solicitud de compra escribe su evento de auditoria en la misma
   `TransactWriteItems`.** Si el evento no se puede escribir, la mutacion no ocurre.
5. **Los eventos de auditoria son append-only.** Prohibido `UpdateItem` o `DeleteItem` sobre
   items `AUDIT#`; la politica IAM del rol de la aplicacion debe denegarlo explicitamente.
   Ademas **todo `Put` de evento lleva `attribute_not_exists(PK)`**: IAM no puede impedir la
   sobrescritura, porque `PutItem` es justo lo que la regla 4 obliga a permitir.
6. **La adjudicacion se gana con escritura condicional**, no con una lectura previa:
   `ConditionExpression: attribute_not_exists(adjudicacionActual)`. Nunca "leer y luego decidir".
7. **Un participante nunca ve la identidad de otro.** Los DTOs de fila exponen solo
   `miTurno`, `miPosicion` y `tamanoFila`. Ninguna proyeccion enviada al cliente incluye
   `participanteId`, correo ni nombre de terceros.
8. **Gating de convocatoria en el servidor, siempre triple:** por `estatus = PUBLICADA`,
   por `publicadaEn <= ahora`, y por el **permiso de venta que corresponde al tipo**
   (`EMPLEADOS` exige `Autob_Venta_a_empleados`). No confiar en filtros de UI.
9. **Zona horaria unica de negocio: `America/Mexico_City`.** Constante en
   `src/lib/domain/fechas.ts`, con `Intl.DateTimeFormat().formatToParts`. Persistir siempre
   ISO-8601 UTC. Prohibido comparar ventanas de venta con la hora local del cliente.
10. **Eden UI primero**: verificar los paquetes `@churchofjesuschrist/eden-*` (MCP de Eden
    declarado en `.mcp.json`) antes de crear componentes custom. Usar el componente
    **tal cual**; CSS propio solo para responsividad o adecuacion visual solicitada.
11. **No exponer ENUMs crudos en UI**: etiquetas traducidas por diccionario
    (`src/dictionaries/`). Idioma por defecto `es`.
12. **Mobile-first**: CardView en movil, tabla completa en desktop.
13. **URLs firmadas de CloudFront**: firmar en SSR; nunca persistirlas en base de datos ni
    generarlas dentro de un bloque `"use cache"`.
14. **Nada sin publicar puede entrar a cache estatica.** Las rutas de convocatoria dependen
    de `publicadaEn`; usar `Suspense` con lectura dinamica, o `cacheLife` corto con
    `revalidateTag` disparado por la publicacion.
15. **Sin fallback silencioso a mock.** Si falla DynamoDB, S3 o EAS en runtime, error explicito.
16. **Toda escritura condicional debe tener prueba de concurrencia.** Un cambio en el motor de
    fila no se considera terminado sin un test que lance N solicitudes en paralelo y verifique
    una sola adjudicacion y turnos unicos y estrictamente crecientes. Los huecos de turno son
    legitimos —`ADD` es atomico y no se puede deshacer—; lo que jamas puede haber es turnos
    repetidos o desordenados.
17. **La aplicacion no codifica politica organizacional.** `puedeEjecutar` decide con
    **permisos**, nunca con roles: EAS responde un booleano por permiso y quien tiene cada uno
    lo decide la organizacion. El codigo declara *que permiso* exige cada accion y *bajo que
    condiciones del recurso* aplica (estado, propiedad, auto-aprobacion, plazo) — eso ultimo es
    lo unico que EAS no puede saber. Si una regla se expresa como "quien tiene tal permiso puede
    tal cosa", **no lleva codigo**. Prohibidas las listas de roles permitidos y las exclusiones
    por rol.
18. **Las guardas de permiso fallan cerradas.** Toda precondicion booleana del contexto exige
    `=== true`; un `undefined` deniega. Como los campos de `Contexto` son opcionales, rechazar
    solo `=== false` convierte un dato que quien invoca olvido pasar en un permiso concedido.

## Arquitectura en Capas

```
src/app/<ruta>/page.tsx        Server Component: sesion -> permiso -> lectura -> serializar
src/app/actions/<area>.ts      Server Action delgada: sesion + puedeEjecutar + delega
src/lib/<feature>/<verbo>.ts   Servicio: acceso a datos, devuelve { ok, data } | { ok, error }
src/lib/domain/*.ts            Reglas puras, sin I/O: transiciones, ventanas, plazos
src/lib/data/*.ts              Cliente DynamoDB, constructores de claves, helpers de transaccion
src/components/*.tsx           Componentes planos, con .css y .test.tsx colocados
```

Regla: **las paginas y las actions no hablan con DynamoDB directamente**; pasan por
`src/lib/<feature>`. La logica decidible sin I/O vive en `src/lib/domain` y se prueba aislada.

## Alias de Importacion

```ts
import Componente from "@/components/Componente"; // src/
```

Configurado en `tsconfig.json` (`paths`) y resuelto en tests por `vite-tsconfig-paths`.

## Convenciones de Archivos

- Componentes React: `PascalCase.tsx`
- Utilidades y servicios: `camelCase.ts`
- Tipos compartidos: `src/types/<dominio>.ts`
- Tests: `NombreComponente.test.tsx` / `nombreUtil.test.ts` (colocados junto al archivo)
- Estilos: `NombreComponente.css` (colocado junto al componente)
- Middleware: `src/proxy.ts` (Next.js 16 renombro `middleware` a `proxy`)

## Definition of Done

- [ ] `npm run typecheck` sin errores
- [ ] `npm run verify:rapido` limpio (lint + test + format + dependencias)
- [ ] `npm run build` exitoso
- [ ] Pruebas unitarias de validaciones y reglas de negocio puras
- [ ] Casos allow y deny de autorizacion cubiertos por **permiso**, y guardas verificadas
      cerradas por omision (quitar un campo del contexto minimo debe denegar)
- [ ] Si toca el motor de fila: prueba de concurrencia con N solicitudes simultaneas
- [ ] Eventos de auditoria persistidos y verificados en prueba
- [ ] Ninguna proyeccion al cliente filtra identidad de terceros
- [ ] UI validada mobile-first con CardView de respaldo
- [ ] Componentes Eden usados tal cual; sin reemplazos custom innecesarios
- [ ] No se exponen ENUMs crudos en UI
- [ ] `agent_files/plan-ejecucion.md` actualizado (checkbox movido a hecho)

## Mantenimiento Automatico de Documentacion

Al terminar cualquier tarea, clasifica lo ocurrido y actualiza el documento correspondiente
**en la misma conversacion**, sin esperar que el usuario lo pida.

| Tipo de cambio | Senales en la conversacion | Archivo a actualizar |
| --- | --- | --- |
| Requerimiento UI/UX nuevo o modificado | "quiero que se vea asi", "agrega esta pantalla" | `ui-ux-requerimientos.md` |
| Regla de negocio nueva o ajustada | "el plazo cuenta en horas habiles", "los empleados tambien pueden X" | `proyecto.md` |
| Cambio arquitectonico o de estrategia | "usemos Route Handler aqui", "cambia la politica de cache" | `estrategia-aplicacion.md` |
| Patron de acceso o clave nueva en DynamoDB | nuevo GSI, nueva entidad, nueva query | `modelo-datos-dynamodb.md` |
| Cambio de contrato de action o endpoint | nuevos parametros, nueva respuesta | `api-contracts.md` |
| Cambio de autorizacion | nueva accion, nuevo permiso, regla allow/deny | `permission-matrix.md` |
| Nuevo evento auditable | nueva transicion de estado que debe quedar registrada | `trazabilidad-auditoria.md` |
| Problema resuelto o workaround | error inesperado, comportamiento raro de libreria, fix no obvio | `desafios-implementacion.md` (seccion numerada) |
| Tarea completada sin incidentes | implementacion directa de algo ya especificado | `plan-ejecucion.md` (marcar `[x]`) |

Reglas: actualizar **solo** el archivo que corresponde, sin duplicar entre documentos; editar
la seccion existente en vez de crear secciones paralelas; no documentar lo que ya es deducible
leyendo el codigo o el historial de git — capturar solo la causa raiz, la restriccion de
negocio no obvia y la decision de diseno con alternativas descartadas. Si hay duda sobre la
clasificacion, preguntar antes de escribir.

### ADR espejo en el grafo de codigo

`agent_files/` es la **fuente de verdad**; el ADR de `codebase-memory-mcp` es un espejo
consultable que enlaza cada decision con el simbolo de codigo que la materializa. Su copia
versionada es `.claude/adr.md`. Si una edicion cambia una decision, una alternativa descartada
o su razon, regenerar el ADR en la misma conversacion, **en este orden**:

1. Editar `.claude/adr.md`.
2. `index_repository(repo_path, mode="full")` — refresca los nodos `Section` de los documentos.
3. `manage_adr(project, mode="update", content=<contenido de .claude/adr.md>)`.

El orden importa: **`index_repository` borra el ADR del grafo**, asi que despues de cualquier
reindexado hay que repetir el paso 3 aunque no haya cambiado la documentacion. Verificar con
`manage_adr(mode="sections")`; si devuelve `[]`, se perdio. Los cambios de redaccion no tocan
el ADR, y el avance de `plan-ejecucion.md` tampoco: el ADR registra decisiones, no progreso. El
hook `.claude/hooks/adr-doc-sync` avisa automaticamente al editar estos documentos.

### Formato para nueva seccion en `desafios-implementacion.md`

```markdown
## N) Titulo breve del problema

### Problema
Que se esperaba que funcionara.

### Sintoma
Que error o comportamiento incorrecto se observo.

### Causa raiz
Por que ocurrio realmente.

### Solucion aplicada
Codigo o configuracion que lo resolvio.

### Regla para futuro
Que verificar o evitar para no repetirlo.
```

## Protocolo de Cierre de Iteracion

Al terminar cada iteracion, emitir una recomendacion breve (3 lineas maximo):

```
Cierre de iteracion:
- Compact: si | no — <razon en 1 frase>
- Modelo siguiente: opus | sonnet | haiku — <razon en 1 frase>
- Nueva conversacion: si | no — <solo si aplica>
```

Subir a **Opus** para: motor de fila y concurrencia, permisos y seguridad, modelado DynamoDB,
infraestructura Amplify/CDK, depuracion con causa desconocida.
Usar **Sonnet** para implementacion vertical normal de pantallas y servicios.
Bajar a **Haiku** para: refactor mecanico, tests por plantilla, documentacion, traducciones.
