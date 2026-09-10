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
> Sincronizado con: rama `main`, 2026-09-10, Etapas 7 a 11.2 confirmadas (`5d746e7`, `496d98e`,
> `6e45c4e`, `58852e2`, sobre `cc5af85`) mas la **Etapa 2.2** (impersonacion de identidad en
> desarrollo, decision **D-10**), la **Etapa 10.1** (armazon y navegacion por permiso, decision
> **D-11**), la **Etapa 11** (auditoria: verificacion de integridad recalculada desde el evento
> crudo, decision **D-12**), la **Etapa 12 parcial** (observabilidad y alarmas, decision **D-13**;
> sus puntos `[OPERADOR]` —navegador, despliegue, runbooks ejecutados— siguen abiertos y no son
> codigo), la **Etapa 11.1** (la bitacora se vuelve consultable, decision **D-15**) y la
> **Etapa 11.2** completa: bitacora consultable por clave (**D-14** reescrito, con la
> **correccion de D-2**), identificador interno de 12 caracteres (**D-16**) e identificador de
> negocio renombrable con centinela (**D-17**).
>
> **2026-09-10, dentro de la Etapa 12:** siguiendo la alarma `barrido-con-errores` contra un
> sandbox real se encontro que el barrido fallaba en el 100% de sus invocaciones desde la Etapa 10
> — `server-only` resolviendo a su rama de `throw` bajo el empaquetado `esbuild` de
> `defineFunction` — y se corrigio quitando esa guarda de los 17 archivos que el handler alcanza.
> Corrige tambien una afirmacion de este ADR (seccion Etapa 10, mas abajo) que daba por cerrado el
> problema con solo instalar el paquete. Ver `desafios-implementacion.md` 53.
>
> **Etapa 13 — los cuatro hallazgos de la auditoria externa que bloqueaban produccion.** Los seis
> hallazgos del informe eran ciertos en su mecanismo; lo que cambio fue la severidad, aplicada la
> escala real (decenas de solicitudes por lote). Toca **D-6** (adquisicion con plazo antes de llamar
> a CES) y tres filas de las decisiones de modelo de datos: la excepcion de una sola pagina queda
> acotada a PA-10 y PA-14, todo lo demas pagina por `src/lib/data/paginacion.ts`, y `avalarPago`
> separa el desenlace del cierre de fila del de la venta. **D-13** gana `cerrarFilaDelLote` en su
> catalogo de operaciones. Los hallazgos 5 y 6 quedan fuera de alcance por decision, con su razon en
> `plan-ejecucion.md`. Ver `desafios-implementacion.md` 54 a 57.
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
Descartado: una tabla por entidad; y en la Etapa 11.2, una tabla dedicada para la bitacora.
Razon: las lecturas son jerarquicas (convocatoria → lotes → fila) y una sola `Query` resuelve
cada pantalla.
**Correccion de la Etapa 11.2:** este ADR afirmaba tambien que la tabla unica "permite escribir la
mutacion y su evento en la misma `TransactWriteItems`". **Es falso como argumento a favor**:
`TransactWriteItems` puede abarcar tablas distintas (`TransactWriteItemsCommand.d.ts:29`), asi que
la regla 4 se cumple igual con dos tablas. La razon buena es la de arriba, y la que decidio no
partir la bitacora es que el diseno de datos, el rendimiento y el costo salen identicos —los
indices de bitacora son dispersos, asi que sus claves solo existen en los items de evento— mientras
la unica ventaja real de separarla, que el `Deny` de inmutabilidad dejara de depender del prefijo
`AUDIT#`, se cubre haciendo que la politica IAM y la clave salgan de **la misma constante**.
Anclas: `src/lib/data/claves.ts`, `src/lib/data/transacciones.ts::ejecutarTransaccion`,
`src/lib/data/claves.ts::PREFIJO_PARTICION_AUDITORIA`.

### D-3 — El lote como entidad de la fila
Descartado: la fila sobre el vehiculo.
Razon: un vehiculo se reoferta en varias convocatorias. Con la fila sobre el lote, cada
reoferta empieza limpia sin arrastrar historia, y el auditor conserva las dos por separado.
Anclas: `src/lib/data/claves.ts::lote`, `src/lib/fila/solicitarCompra.ts`,
`src/lib/fila/adjudicarLote.ts`.

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
Anclas: `src/lib/data/claves.ts::solicitud`, `::turnoDesdeClave`,
`src/lib/fila/solicitarCompra.ts::pedirTurno`.

### D-6 — Correo por outbox
Descartado: enviar el correo dentro del flujo de adjudicacion.
Razon: el proveedor de correo no participa en la transaccion de DynamoDB. En linea significaria
o adjudicar sin notificar, o fallar la adjudicacion por un problema de correo. El outbox
desacopla: la adjudicacion es atomica y el envio se reintenta aparte.
El argumento no dependia del proveedor y sobrevivio al cambio de SES a **CES** (REST
corporativo, `arquitectura-tecnica-aws.md` 2.5): con un tercero remoto por HTTP se refuerza.
**Ampliacion de la Etapa 13 — el despacho adquiere el mensaje antes de llamar a CES.** El estatus
recorre `PENDIENTE -> ENVIANDO (con plazo) -> ENVIADO | FALLIDO`, y la vuelta a `PENDIENTE` para el
fallo reintentable. Razon: el barrido corre cada 5 min con un limite de ejecucion de 300 s, asi que
dos corridas se solapan y leian la misma lista; llamar a CES **antes** del `Update` condicional
hacia que las dos enviaran y solo una lo anotara — la bitacora quedaba correcta, porque la condicion
impedia el segundo `CORREO_ENVIADO`, y el participante recibia dos correos. El plazo (`LEASE_MS`,
15 min) tiene que ser **mayor que el limite de ejecucion**: mas corto, una corrida lenta veria vencer
su propia adquisicion mientras todavia envia. `ENVIANDO` se queda en GSI4 para que un plazo vencido
sea recuperable.
Descartado: acotar la corrida por **cantidad** de mensajes en vez de por tiempo. No garantiza la
propiedad que se busca —no pasarse del limite de ejecucion—, porque con CES lento cien se pasan y con
CES rapido mil no llegan a la mitad. Se acota con `performance.now()`, por lo mismo que `conTraza`.
Ventana **aceptada y documentada**: si el proceso muere entre que CES acepta y que se escribe
`ENVIADO`, el mensaje se reenvia. CES no ofrece clave de idempotencia —responde una confirmacion de
envio, o la causa del error—, y el `id` que devuelve se guarda como `idExterno` pero solo sirve para
rastrear. Es aceptable porque el correo es un aviso informativo (monto, plazo y enlace a la pagina del
lote), sin token ni enlace de pago (`desafios-implementacion.md` 57).
Anclas: `src/lib/correo/outbox.ts::itemsDeEncoladoAdjudicacion`,
`src/lib/correo/procesarOutbox.ts::procesarOutbox`, `src/types/correo.ts::EstatusMensaje`.

### D-7 — Barrido mas verificacion perezosa
Descartado: solo el barrido programado.
Razon: si el barrido se cae, toda fila con adjudicacion vencida queda bloqueada (R6). Con
verificacion perezosa, cualquier lectura de una fila vencida la resuelve en el momento. El
barrido pasa a ser red de seguridad, no unico mecanismo.
Costo aceptado: una lectura puede provocar una escritura. Acotado e idempotente.
Implementado en la Etapa 10: los dos caminos aplican la misma transaccion condicional de T5, asi
que competir entre si no produce doble efecto — quien llega segundo recibe `no_vigente`.
Anclas: `amplify/barrido/handler.ts`, `src/lib/fila/barridoDeVencimientos.ts`,
`src/lib/fila/vencerYReasignar.ts`, `src/lib/fila/consultarMiLugar.ts::resolverSiVencida`.

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

### D-10 — Impersonacion de identidad en desarrollo: roster cerrado en codigo
El modo `ENABLE_DEV_TOOLS=FULL` permite elegir con que **identidad de negocio** se recorre la
aplicacion, mediante una cookie por navegador que lleva **solo el id** de una persona de un
roster cerrado en codigo. Sustituye `participanteId`, `nombre`, `correo` y `permisos`; **nunca la
autenticacion**: `getSession()` exige la sesion real de Okta antes de mirar la cookie, y
`oktaSub` conserva el valor real.
Razon: simular permisos no alcanza para probar la aplicacion, porque hay guardas que dependen de
la **identidad** y no de ningun permiso. `convocatoria:aprobar` deniega `self_approval`, asi que
con una sola sesion de Okta el dictamen es inalcanzable; y una fila FIFO de un participante no
tiene orden. `DEV_TOOLS_MOCK_ROLES` cambia los permisos, no el `participanteId`.
Que el roster este cerrado —y no capturado desde la interfaz— es lo que impide que la cookie
inyecte identidades o permisos arbitrarios: como maximo elige entre siete filas conocidas.
Descartado:
- Solo variables de entorno (lo que habia). Exige reiniciar por cada cambio de actor y **no
  puede** dar dos `participanteId` distintos: el hueco no era de comodidad, era de alcance.
- Campos libres de identidad y permisos en la interfaz. Convierte la cookie en una inyeccion de
  identidad arbitraria y vuelve las pruebas irreproducibles.
- Sesion simulada completa, sin Okta. Desbloquearia el login local, pero contradice la decision
  ya escrita de que la impersonacion no sustituye la autenticacion.
- Pagina dedicada en vez de barra flotante. Obliga a navegar ida y vuelta por cada cambio de
  actor, que es justo lo que hace impracticable recorrer un flujo largo.
- Dar permiso propio a la action en el catalogo. Seria pedirle a EAS que configure una
  herramienta de desarrollo (regla 17). La compuerta es modo, entorno y sesion.
Anclas: `src/lib/auth/personasSimuladas.ts::PERSONAS_SIMULADAS`,
`src/lib/auth/impersonacion.ts::leerPersonaSimulada`, `::fijarPersonaSimulada`,
`src/lib/auth/session.ts::getSession`, `src/app/actions/devTools.ts::cambiarPersonaSimulada`,
`src/components/BarraDeIdentidadSimulada.tsx`, `src/components/PanelDeIdentidadSimulada.tsx`.

### D-11 — La navegacion declara la accion que abre cada seccion, y comprueba solo la capacidad
Cada entrada del menu (`src/lib/navegacion.ts`) declara la **`Accion`** de su pantalla, no una
lista de permisos, y se resuelve con `tieneCapacidad` — el primer tiempo de `puedeEjecutar`, sin
la guarda de aplicabilidad.
Razon: una lista de permisos copiada en el menu es una segunda fuente de verdad frente a
`permission-matrix.md`, y es la que se olvida de actualizar. Declarando la accion, el menu
hereda cualquier cambio de la matriz sin tocarse. Evidencia de que el riesgo era real: la tabla
de `ui-ux-requerimientos.md` seccion 2 **si** enumeraba permisos y se habia despegado — afirmaba
que `Autob_Auditar` solo abria "Auditoria", cuando concede tambien `vehiculo:ver-catalogo`,
`convocatoria:ver-administracion` y `tesoreria:ver-bandeja`.
Se comprueba la capacidad y no la aplicabilidad porque un enlace es una **puerta a una
pantalla**, no una operacion sobre un recurso: no hay contexto que evaluar. Y como las guardas
fallan cerradas (regla 18), evaluarlas sin recurso oculta el enlace para todo el mundo — ocurrio
con `convocatoria:ver-publicada` y lo detecto una prueba de invariante, no la vista
(desafios-implementacion.md 35). De ahi que toda accion del menu sea `ver-*` sin guarda.
No relaja nada: ocultar un enlace es cortesia, y la pantalla vuelve a decidir con
`puedeEjecutar` completo (P-1).
Descartado:
- Lista de permisos por entrada. Duplica la matriz; ya se demostro que deriva.
- `puedeEjecutar` con contexto vacio. Deniega siempre por la regla 18: menu vacio para todos.
- Relajar las guardas para que un contexto ausente permita. Invertiria la correccion central de
  la Etapa 2.1 en todo el sistema, para arreglar un menu.
- Filtrar en el cliente. Obligaria a enviarle los permisos de la sesion; el servidor le pasa
  enlaces ya filtrados y el cliente no tiene con que equivocarse.
Anclas: `src/lib/navegacion.ts::entradasVisibles`, `src/lib/auth/permisos.ts::tieneCapacidad`,
`src/components/EncabezadoAplicacion.tsx`, `src/components/MenuDeUsuario.tsx`.

### D-12 — La verificacion de integridad recalcula desde el evento crudo, agrupado por transaccion
`verificarIntegridadDeLote` (`src/lib/domain/verificacionDeAuditoria.ts`) no confia en ningun
estado que la aplicacion crea vigente: reproduce las seis comprobaciones de
`trazabilidad-auditoria.md` 5.1 leyendo la bitacora entera del lote (PA-12) y, para la
comprobacion 5, contrastandola contra el estado **vigente** de la tabla base (`leerFilaCompleta`,
PA-07 sin filtrar por estatus — la capacidad detras de `fila:ver-completa`, declarada desde la
Etapa 2.1 y sin consumidor hasta ahora).
Razon: un auditor que solo puede leer lo que la aplicacion ya afirma no prueba nada distinto de
confiar en la aplicacion. Verificar de verdad exige poder detectar el caso en que el codigo
mutó algo sin escribir su evento (regla 4 rota) — y eso solo se ve comparando la bitacora con la
tabla, no leyendo una de las dos.
El replay agrupa los eventos por `correlacionId` **antes** de mirar su orden en la `SK`: los de
una misma transaccion comparten `ocurridoEn` al milisegundo, y el ULID de `eventoId` no garantiza
cual ordena primero dentro de ese milisegundo. Sin el agrupamiento, una reasignacion por
vencimiento —que libera un turno y adjudica el siguiente en la misma `TransactWriteItems`— podia
leerse en el orden equivocado y marcar dos adjudicaciones vigentes que nunca coexistieron
(`desafios-implementacion.md` 37).
`BITACORA_EXPORTADA` se escribe en el Route Handler de descarga
(`src/app/api/auditoria/exportar`), no en la Server Action `exportarBitacora`: la action solo
construye la URL, y cualquiera con `Autob_Auditar` podria armarla a mano sin pasar por la action.
Registrar el evento donde el archivo realmente se entrega —mismo criterio que
`COMPROBANTE_DESCARGADO`— es lo que cierra ese camino (`desafios-implementacion.md` 36).
Descartado:
- Confiar solo en la bitacora para la comprobacion 5. No detecta una escritura sin su evento,
  que es exactamente el defecto que esa comprobacion existe para atrapar.
- Replay evento por evento en orden de `SK`. Inventa carreras que la base de datos nunca tuvo
  (seccion "Sintoma" de `desafios-implementacion.md` 37).
- Derivar el turno de `solicitudId` dentro de `src/lib/domain`. Violaria P-2 (el dominio no
  importa nada de `src/lib/data`) por una razon cosmetica; se derivó en su lugar dentro de
  `src/lib/auditoria/mapeo.ts`, que ya es capa de datos.
- Escribir `BITACORA_EXPORTADA` en la Server Action, como decia el contrato original. Deja
  exportar sin rastro a quien construye la URL de descarga directamente.
- Construir ahora el sumidero append-only independiente (DynamoDB Streams + S3 con Object Lock)
  que el riesgo **R20** propone como garantia fuerte. Es infraestructura AWS nueva fuera del
  alcance que esta etapa recibio; se evalua y se difiere con justificacion, no se cierra
  (`plan-ejecucion.md`, riesgo R20).
Anclas: `src/lib/domain/verificacionDeAuditoria.ts::verificarIntegridadDeLote`,
`src/lib/domain/reconstruccionDeFila.ts::reconstruirHistoriaDeFila`,
`src/lib/domain/turnoDeEvento.ts::turnoDelEvento`, `src/lib/auditoria/mapeo.ts::aEventoDTO`,
`src/lib/auditoria/verificarIntegridad.ts`, `src/lib/fila/leerFilaCompleta.ts`,
`src/app/api/auditoria/exportar/route.ts`.

### D-13 — Cada alarma toma su senal de donde sobreviva al fallo que vigila
`amplify/alarmas.ts` reparte las seis alarmas entre **metricas nativas** de AWS y **filtros de
metrica** sobre el registro que escribe `src/lib/observabilidad`, y el criterio no es de estilo:
lo que hay que detectar *aunque el codigo este roto* va a metrica nativa; lo que solo el dominio
sabe contar va a filtro de log.
Razon: una alarma derivada de los logs de la aplicacion depende de que la aplicacion llegue a
escribir la linea. "El barrido no se ejecuta" (riesgo **R6**) es el caso limite — si el `handler`
lanza antes de su primera linea, un filtro no ve nada y **calla**, que es precisamente el fallo
que la alarma existe para gritar. Por eso esa alarma mira `AWS/Lambda` `Invocations` y trata la
ausencia de datos como incumplimiento (`TreatMissingData.BREACHING`), contra el valor por omision
de CloudWatch: un barrido caido no publica ceros, no publica nada, e `INSUFFICIENT_DATA` es
indistinguible de "todo bien" para quien no esta mirando.
La contencion se vigila con `TransactionConflict` de DynamoDB y **no** con
`ConditionalCheckFailedRequests`: en este sistema una condicion que falla es el mecanismo normal
—la adjudicacion se gana con escritura condicional (regla 6), asi que en cada lote N-1 intentos
fallan su condicion por diseno— y esa alarma estaria disparada siempre.
Las alarmas viven en una **tercera pila** (`AutobAlarmas`). Una metrica dimensionada por
`FunctionName` es una referencia a la pila de la funcion de barrido, y esa pila ya toma
`AUTOB_TABLE_NAME` de `AutobRecursos`: ponerlas ahi cierra un ciclo entre pilas y `ampx` falla al
sintetizar (`desafios-implementacion.md` 38).
Las trazas son propias, no de X-Ray: una linea por operacion con el `correlacionId` que ya
comparte con la bitacora. Y ninguna metrica lleva `loteId` como dimension —CloudWatch cobra por
combinacion de dimensiones y `loteId` es de cardinalidad ilimitada—; esa pregunta la responde
Logs Insights sobre el registro.
El registro operativo **nunca lanza** y **nunca escribe identidad de personas**: es la
contrapartida de la regla 4, porque perder una linea de diagnostico no puede tumbar la
adjudicacion que describia, al contrario del evento de auditoria.
Los umbrales de `UMBRAL_OUTBOX_MIN` (60 min) y `UMBRAL_CONFLICTOS_POR_PERIODO` (50 por periodo de
5 min) son **valores de partida, no medidas**, y la prueba de carga de la Etapa 12 no alcanzo a
calibrar el segundo: los reintentos del SDK absorben los conflictos antes de que la aplicacion los
vea, asi que el numero real solo lo dice la metrica nativa `TransactionConflict` desde el entorno
desplegado. Queda `[OPERADOR]`.
Descartado:
- Derivar las seis de los logs de la aplicacion, que seria mas uniforme. Deja ciega justo la
  alarma que vigila que la aplicacion arranque.
- Alarmar sobre `ConditionalCheckFailedRequests`, la metrica que parece obvia para contencion.
- Ponerlas en `AutobRecursos`, que es donde parece que corresponden. Ciclo entre pilas.
- AWS X-Ray. Responde "donde se fue el tiempo entre servicios" y aqui hay un proceso hablando con
  DynamoDB; agrega SDK, permiso de IAM y costo por traza para una pregunta que el
  `correlacionId` ya contesta.
- Emitir metricas en formato EMF desde la aplicacion. Habria evitado los filtros, pero su
  interaccion con el formato JSON de log de Lambda no se pudo verificar sin AWS, y las cuatro
  senales del documento se cubren sin ella.
- `loteId` como dimension de metrica, que es lo que pedia literalmente
  `arquitectura-tecnica-aws.md` 7 ("solicitudes por lote"). Una serie nueva por cada lote que
  haya existido, para siempre.
- Una variable de entorno propia para silenciar el registro. Seria una palanca para apagar el
  diagnostico en produccion sin que nada lo delate; se comprueba `VITEST`, que no se puede
  activar por error en un despliegue.
El catalogo `OPERACIONES` es **cerrado** y crece solo con un criterio: que el fallo de esa operacion
**no lo reporte ningun usuario**, porque entonces la linea es la unica forma de enterarse. Con ese
criterio entraron las dos del barrido, `registrarPerfil` y —en la Etapa 13— `cerrarFilaDelLote`,
cuyo fallo ocurre despues de que la venta quedo firme: el tesorero la ve hecha y los participantes
solo ven una posicion que ya no significa nada.
Anclas: `amplify/alarmas.ts::AlarmasAutob`, `amplify/backend.ts::grupoDeLogsDelBarrido`,
`src/lib/observabilidad/registro.ts::registrar`, `src/lib/observabilidad/registro.ts::redactar`,
`src/lib/observabilidad/registro.ts::OPERACIONES`,
`src/lib/observabilidad/traza.ts::conTraza`, `src/lib/data/transacciones.ts::ejecutarTransaccion`,
`src/lib/data/transacciones.ts::esConflictoDeTransaccion`.

### D-14 — Cada criterio de la bitacora tiene su indice, y el rango es condicion de clave
La pantalla de auditoria tiene **dos modos** y la diferencia no es de interfaz sino de patron de
acceso. Con un identificador concreto se lee la particion de ese agregado (PA-12), que trae su
historia entera: el rango es un filtro en memoria y **no se acota**. Sin identificador, el criterio
elige el indice y el rango va como **condicion de clave de ordenamiento**: el tipo de evento en
GSI6 (`TIPO#<tipo>#<mes>`), la persona que firmo en GSI9 (`ACTOR#<id>#<mes>`), el tipo de registro
en GSI7 (`DIA#<dia>` con `begins_with`). El rango no puede estar vacio, se acota a 90 dias y se
valida en la pantalla **y otra vez en el servicio**.
Razon: la version anterior leia una particion por dia sobre GSI2 `AUDIT#<dia>` y filtraba todo lo
demas en memoria contra un tope de 2 000 eventos. Ese tope produjo **tres** defectos seguidos, los
tres de la misma clase —una cota que cambia la respuesta en silencio— y ninguno visible con pruebas
que solo cuenten cuantos eventos sobreviven: el truncamiento descartaba lo mas reciente; reusar una
lectura truncada devolvia 483 filas donde habia 841; y un tipo de registro con mucho volumen
consumia el cupo dejando a los demas como "sin actividad en este rango" siendo falso.
**El criterio es obligatorio en el tipo**, no solo en la validacion de la pantalla:
`BusquedaGlobal` es una union de tres ramas, cada una exigiendo uno de los tres, asi que un rango
sin criterio no se puede construir.
**La cota vive en un solo lugar** y es `cronoSK BETWEEN <medianoche del primer dia> AND <medianoche
del dia siguiente al ultimo>`. Dos propiedades que hay que leer juntas: la frontera es la
medianoche de **Mexico** —la misma con la que se calculan el `dia` y el `mes` del evento— y el
limite superior queda **exclusivo del instante sin ningun centinela**, porque `cronoSK` es
`<ocurridoEn>#<eventoId>` y toda cadena ordena despues que su propio prefijo. Es `BETWEEN` y no dos
comparaciones porque DynamoDB admite **una sola condicion por clave**.
Rastrear a un participante son **dos preguntas**: lo que firmo (GSI9) y lo que le ocurrio. La
segunda se responde con GSI3 mas las particiones de **lote** de sus solicitudes, agrupadas por lote
y filtrando por `solicitudId`. Buscar solo por `actorId` daria una respuesta que parece completa y
no lo es: el vencimiento que explica por que alguien perdio su adjudicacion lo firma `SISTEMA`.
Las opciones de los dos selects salen de la **bitacora del rango** —no del catalogo de entidades,
de modo que toda opcion ofrecida devuelve resultados— y con **dos lecturas independientes**
(PA-15): un sondeo por valor distinto con salto de grupo sobre GSI7 y GSI8, que lee una pagina, se
queda con los valores que trae y salta al siguiente grupo con un `ExclusiveStartKey` sintetizado.
**Un solo lugar decide que indice sirve a que criterio** (`consultasDe`), y solo queda un filtro:
tipo de evento **combinado con** tipo de registro, el unico que no cabe en ninguna clave. Si esa
funcion crece, es la senal de que alguien agrego un criterio sin darle clave.
Descartado:
- **Una tabla dedicada para la bitacora.** Ver la correccion de D-2.
- **Un GSI5 cronologico** (`mesPK`/`cronoSK`) para "todo el rango". Quedo sin lector —la pantalla
  exige un criterio y los tres tienen indice— y un indice con proyeccion `ALL` sin lector cobra una
  escritura por evento a cambio de nada. **Los atributos se siguen escribiendo**, porque lo
  irreversible son los atributos y no los indices: a un evento append-only no se le pueden agregar
  despues, asi que un atributo que hoy no se escribe es una pregunta que nunca se podra responder
  sobre los eventos de hoy.
- Particionar los indices de opciones **por mes** en vez de por dia. Una opcion "activa en el mes
  pero no en el rango" devolveria una tabla vacia, que es justo lo que esas listas existen para
  evitar. No es rendimiento: es correccion.
- Un **item marcador** por (dia, agregado) para enumerar valores distintos. Con
  `attribute_not_exists` el segundo evento del dia cancelaria la transaccion de negocio completa;
  sin condicion, N solicitantes del mismo lote escribirian el mismo item dentro de sus
  transacciones y reabririan R18.
- Un atributo `sujetoId` en el evento para responder "que le ocurrio a esta persona" por clave.
  Solo respondera sobre los eventos futuros, y esa consulta es retrospectiva por definicion.
- Sondear los valores distintos de a **un** item (`Limit: 1`), que es optimo cuando cada grupo es
  enorme. Con muchos grupos chicos son N viajes de red **encadenados**: 200 valores distintos
  dejaban la pantalla en 20 segundos. Contar consultas no es medir latencia.
- Poblar los selects desde el catalogo de entidades, que es mas barato. Ofreceria convocatorias sin
  un solo evento en el rango.
- Mostrar microsegundos, que es lo que se pidio. `ocurridoEn` viene de un `Date`: milisegundos y no
  hay mas. El desempate real de dos eventos del mismo milisegundo es el `eventoId` de la `SK`, y
  por eso la tabla lo muestra en columna propia en vez de fingir precision.
- Extender la exportacion CSV al modo global. `BITACORA_EXPORTADA` es un evento y todo evento se
  ancla a un agregado: no tendria a que anclarse y saldria sin registrarse.
- Leer las particiones de resultados en paralelo, que es mas rapido. Obligaria a traer hasta el cupo
  de **cada** una para quedarse con el cupo total, y no permite dejar de leer lo que ya no cabe. Los
  sondeos de las opciones **si** van en tandas concurrentes: ahi no hay cupo por dia que respetar.
- Ordenar en memoria con `localeCompare` donde se afirma reproducir el orden de una `SK`. Usa la
  colacion del idioma y puede invertir dos claves respecto del byte a byte que hace la tabla.
Anclas: `src/lib/auditoria/consultarBitacoraGlobal.ts::consultarBitacoraGlobal`,
`src/lib/auditoria/rangoDeBitacora.ts::cotaDeRango`,
`src/lib/auditoria/valoresConActividad.ts::identificadoresConActividad`,
`src/lib/auditoria/etiquetasDeBitacora.ts::construirEtiquetador`,
`src/lib/auditoria/consultarActividadDeParticipante.ts::consultarActividadDeParticipante`,
`src/lib/auditoria/filtrosDeBitacora.ts::validarBusqueda`,
`src/lib/auditoria/opcionesDeBusqueda.ts::construirOpciones`,
`src/lib/data/claves.ts::bitacora`,
`src/lib/data/claves.ts::comparandoClaves`,
`src/lib/domain/fechas.ts::inicioDelDiaDeNegocio`,
`src/lib/domain/fechas.ts::mesesDeNegocioEntre`.

### D-15 — Del upsert de participante se implemento el perfil, nunca la identidad
`PART#<id> / PERFIL` guarda `nombre` y `correo`, escrito por `registrarPerfil` desde
`getSession()` una vez por proceso y por persona, de mejor esfuerzo. **`participanteId` sigue
siendo el `sub` de Okta.**
Razon: el diseno de la Etapa 0 preveia que el *upsert* acunara tambien un ULID propio, y eso ya no
se puede hacer. `actorId` guarda el identificador vigente cuando se escribio cada evento y la
bitacora es **append-only**, asi que cambiar la identidad ahora partiria en dos la historia de cada
persona —lo anterior con su `sub`, lo nuevo con su ULID— sin forma de unirlas. El perfil existe
solo para que la bitacora se pueda **leer**: sin el, el auditor ve `sub` opacos y no puede buscar
la actividad de una persona.
Nada de negocio depende de este item: los permisos los responde EAS en cada peticion (regla 17),
nunca el perfil. De ahi que su escritura sea de mejor esfuerzo — que no se pueda escribir una
etiqueta de auditoria no es razon para negarle la aplicacion a quien inicio sesion — y que no lleve
evento de auditoria: un evento por acceso ahogaria la bitacora en ruido, que es lo contrario de lo
que el perfil viene a resolver.
Descartado:
- Escribirlo en cada peticion. Seria una escritura por pantalla para reponer el mismo dato.
- Escribirlo desde el `onCallback` o el `beforeSessionSaved` del SDK de Auth0. Los ejecuta
  `auth.middleware` dentro de `src/proxy.ts`, y meter el cliente de DynamoDB en el middleware es
  peso y superficie donde no corresponde; `beforeSessionSaved` ademas desactiva el filtrado por
  omision de los `claims` del `id_token`.
- Desnormalizar nombre y correo en cada evento. Los eventos son append-only: congelaria nombres
  para siempre y metaria identidad legible en la particion mas sensible del sistema, sin arreglar
  los eventos ya escritos.
Anclas: `src/lib/participantes/registrarPerfil.ts::registrarPerfil`,
`src/lib/participantes/leerPerfiles.ts::leerPerfiles`,
`src/lib/auth/session.ts::getSession`, `src/lib/data/lecturaPorLotes.ts::leerPorClaves`.

### D-16 — El identificador interno son 12 caracteres, no un ULID
7 caracteres de segundos desde epoch en base32 de Crockford (~1 090 anos) mas 5 de azar
criptografico (33,5 millones de valores). Sigue ordenando lexicograficamente igual que
cronologicamente, ahora al segundo.
Razon: un ULID son 26 caracteres y aparece 8-10 veces por evento de bitacora, en pantallas donde no
dice nada. Lo que vuelve seguro acortarlo es que **las tres creaciones llevan
`attribute_not_exists`**: una colision falla de forma visible y nunca sobrescribe. La probabilidad
es 1,5 × 10⁻⁶ con 10 identificadores en el mismo segundo y 1,5 × 10⁻⁴ con 100.
Descartado:
- Conservar el ULID. Es la opcion segura y su costo es de legibilidad, que es justo el problema que
  la Etapa 11.2 existe para resolver.
- Dejar el `Put` de la reserva de turno **sin** condicion, como estaba. Con 80 bits de azar era
  irrelevante; con 25 una reserva sobrescrita en silencio borraria una reserva en vuelo y R18
  dejaria de sostenerse. La condicion convierte eso en un rechazo reintentable, y por eso no es
  opcional.
Anclas: `src/lib/data/identificadores.ts::nuevoId`,
`src/lib/fila/reservas.ts::anotarReserva`.

### D-17 — El identificador que teclea el operador es un atributo unico y renombrable
El folio de la convocatoria, y el numero economico y el de serie del vehiculo, los captura una
persona y son unicos. La unicidad la impone **la base de datos** con un centinela por valor
(`<ambito>#<valor> / CENTINELA`, con `attribute_not_exists`) dentro de la **misma transaccion** que
la entidad.
Razon: comprobarlo leyendo antes de escribir es el "leer y luego decidir" que prohibe la regla 6 —
dos altas simultaneas pasarian las dos. El centinela da gratis dos propiedades mas: es tambien el
indice de busqueda (un `GetItem`) y hace el renombrado atomico.
**No son la clave de la entidad ni el ancla de su bitacora.** Eso sigue siendo el identificador
interno, y es lo que permite corregir un typo sin partir la historia en dos. Misma division que
D-15 hizo para `participanteId`.
Los centinelas van **primero** en la transaccion: `ejecutarTransaccion` devuelve el indice del item
que cancelo, y es la unica forma de saber cual de los dos numeros de un vehiculo estaba duplicado.
Descartado:
- Un ambito de unicidad compartido. Un folio `A-1` impediria registrar el vehiculo `A-1`: son
  universos separados porque nombran cosas separadas.
- Usar el identificador de negocio como clave de la entidad. Volveria el renombrado imposible sin
  reescribir la historia, que es exactamente lo que D-15 descarto.
- Exigir unicidad tambien al **nombre corto** de la convocatoria. Dos ventas recurrentes pueden
  llamarse igual y el folio las distingue.
- Devolver `conflicto_concurrencia` cuando el centinela cancela. Un valor repetido **es** un dato
  mal capturado: hay que corregirlo, no reintentar con el mismo valor. Se devuelve
  `validation_failed` con el motivo en el campo concreto.
Anclas: `src/lib/data/claves.ts::clave`,
`src/lib/data/centinelasDeIdentificador.ts::putDeCentinelaDeIdentificador`,
`src/lib/domain/identificadorDeNegocio.ts::prepararIdentificadorDeNegocio`,
`src/lib/vehiculos/editarVehiculo.ts::editarVehiculo`,
`src/lib/convocatorias/editarConvocatoria.ts::editarConvocatoria`.

## Decisiones de modelo de datos

Fuente: `agent_files/modelo-datos-dynamodb.md` seccion 1 (linea 11).

| Decision | Razon |
| --- | --- |
| Tabla unica | Lecturas jerarquicas; una `Query` por pantalla |
| `turno` en la clave de ordenamiento con relleno de ceros | DynamoDB devuelve la fila ya ordenada; imposible reordenar por error |
| Contador atomico **en el item del lote** | `ADD` es atomico sin transaccion ni lectura previa. Uno por lote, nunca global — evita particion caliente |
| Ventana de venta **desnormalizada** en el lote | Permite condicionar la escritura a "la venta esta abierta" sin leer la convocatoria; sin la copia habria que leer-y-decidir, que es justo lo prohibido |
| Items **centinela** para unicidad | `attribute_not_exists` sobre un item dedicado convierte reglas de negocio en garantias de la base de datos |
| Los cuatro indices de la bitacora llevan **nombre semantico** (`diaPK`, `tipoPK`…) y los cuatro de negocio la convencion generica `GSInPK` | La generica se justifica donde el indice esta **sobrecargado** —GSI2 sirve cinco entidades y un nombre semantico mentiria sobre cuatro—; los de bitacora responden una pregunta cada uno, y el nombre hace evidente que un item de negocio, al no tener `diaPK`, no entra en ese indice |
| Seis atributos sirven a los cuatro indices de bitacora, no ocho | `cronoSK` es la clave de ordenamiento de GSI6 y GSI9, y `diaPK` la particion de GSI7 y GSI8. Es lo que mantiene el evento bajo el minimo facturable de 1 KB, o sea a 1 WCU |
| `mesPK` se escribe **sin indice** | Su GSI5 quedo sin lector y se borro. El atributo se conserva porque a un evento append-only no se le pueden agregar despues: lo irreversible son los atributos, no los indices (D-14) |
| Eventos de auditoria en la **misma tabla** | Unico modo de escribirlos en la misma `TransactWriteItems` que la mutacion |
| T2 condiciona ademas `estatus = EN_OFERTA` | Un lote `NO_VENDIDO` cierra **sin** `adjudicacionActual`: con la condicion original, una adjudicacion en vuelo podia entregarlo despues de concluida la convocatoria |
| T2 lleva el vehiculo a `RESERVADO` en la misma transaccion | Sin ese item `RESERVADO` es inalcanzable y T4 no tiene transicion valida al vender. No reintroduce la contencion de R18: el vehiculo se toca una vez por adjudicacion, no una por solicitud |
| La cancelacion libera y **vuelve a llamar a T2**, sin intercambio atomico | T5 debe ser atomico porque lo dispara un barrido sobre un plazo vencido; la cancelacion reutiliza el camino ya probado de la adjudicacion. La ventana que abre ya existe: T1 tampoco puede adjudicar dentro de su transaccion |
| Los nueve eventos de la fila se anclan a `AUDIT#LOTE#<loteId>` | "Reconstruir la fila" es una `Query` por lote; anclar `SOLICITUD_CREADA` a la solicitud obligaria a una consulta por participante |
| `correoTitular` se copia de la sesion a la solicitud en T1, no se resuelve por *join* a un perfil | No existe ningun item de perfil de participante con correo (la Etapa 4 nunca hizo el *upsert* real); y aunque existiera, copiarlo conserva el correo con el que se pago aunque la cuenta cambie despues — lo que el auditor necesita ver (desafios-implementacion.md 31) |
| GSI2 de la solicitud es disperso: T3 escribe `SOL_ESTATUS#EN_VERIFICACION`, T4 y T6 lo retiran | Misma logica que GSI4 con los vencimientos: el indice de "trabajo pendiente de tesoreria" (PA-11) solo debe contener lo que de verdad esta pendiente (desafios-implementacion.md 32) |
| `solicitudId` se resuelve en reversa con `loteYTurnoDesdeIdentificador`, sin un indice nuevo | Es derivado (`<loteId>-<turno>`), no generado: dividir por el ultimo `-` basta, porque un `loteId` real (ULID) nunca contiene guion (desafios-implementacion.md 32) |
| T6 (rechazar pago) sigue la estrategia de T5b (liberar y volver a llamar a T2), no la de T5 | El documento decia "identica a T5"; rechazar lo dispara una persona mirando la pantalla, no un barrido sobre un plazo vencido, asi que aplica el mismo argumento que ya justificaba T5b |
| `rechazarPago` no retira el centinela de fila, a diferencia de la cancelacion voluntaria | `RECHAZADA_POR_TESORERIA` tiene que seguir visible en `MiLugarDTO` con su motivo (R-16); retirarlo borraria la unica forma en que el titular se entera |
| La variante reducida de T5 (fila agotada) tambien libera el vehiculo a `EN_CONVOCATORIA` | El documento solo mencionaba `REMOVE adjudicacionActual` y `estatus = EN_OFERTA`; sin liberar el vehiculo, el siguiente que se forme nunca podria adjudicarse (el item 4 de T2 exige `EN_CONVOCATORIA`) — el mismo defecto de "lote huerfano" que la Etapa 10 corrige en el barrido, pero permanente |
| `vencerYReasignar` reusa `leerFila` y `congelar` de `adjudicarLote.ts` en vez de duplicarlos | T5 es T2 con dos escrituras del vencido intercaladas delante; la abstencion por reservas y el congelamiento por R-09 son identicos |
| El outbox se encola en la **misma** transaccion que T2/T5, no despues | Es lo unico que le da al correo la misma garantia que a su propio evento (regla 4); `itemsDeEncoladoAdjudicacion` devuelve lista vacia sin `correoTitular`, sin bloquear la adjudicacion (D-6) |
| "Recoger lotes libres" se acota a convocatorias `PUBLICADA` y exige una `Query COUNT` de fila viva antes de llamar a `adjudicarLote` | Sin el filtro, cada lote `EN_OFERTA` sin candidatos (la mayoria del inventario) escribiria `FILA_AGOTADA` en cada corrida del barrido, para siempre; no existe GSI para "lotes con fila viva" y no se creo uno solo para esto |
| Nuevo motivo de adjudicacion `RECUPERACION_POR_BARRIDO` | Un lote huerfano recuperado por el barrido no es "primera adjudicacion" ni ninguna reasignacion con causa conocida — forzarlo a uno de los cuatro existentes falsearia la bitacora |
| Los GSIs se quedan en `ALL`: **revisado en la Etapa 12 y confirmado**, no estrechado a `INCLUDE` | DynamoDB cobra la escritura en bloques de 1 KB redondeando hacia arriba, asi que el ahorro es **cero** justo donde esta el volumen —solicitudes (~600 B) y eventos (~400 B), ya bajo el minimo facturable— y solo aparece en vehiculos y convocatorias, que se escriben unas pocas veces al mes: menos de un centavo mensual. Contra eso, la proyeccion de un GSI **no se puede modificar**: estrechar exige recrear el indice, y en esa ventana PA-05 y PA-11 dejan de responder (modelo-datos-dynamodb.md 8.1) |
| Las tres escrituras sueltas sobre items transaccionales contemplan `TransactionConflictException` | Son el `ADD contadorTurnos` del paso 1 de T1, `liberarReserva` y `incrementarIntento` del outbox: las tres tocan items que si participan en transacciones (el lote en T2, la reserva en el paso 2 de T1, el mensaje en `marcarEnviado`/`marcarFallido`). El SDK la reintenta —`maxAttempts` 3— asi que nunca se habia visto; con contencion sostenida los tres intentos se agotan. En T1 el participante recibia un 500 en lugar de "relee y reintenta"; en los otros dos, un helper documentado como "de mejor esfuerzo" tumbaba una adjudicacion o abortaba el outbox de la corrida. Lo encontro la prueba de carga de la Etapa 12 corriendo sin reintentos (desafios-implementacion.md 41) |
| `leerVencidasDelDia` y `leerPendientes` leen **una sola pagina**, sin recorrer `LastEvaluatedKey` — **y son las dos unicas** | GSI4 es disperso, las dos leen de lo mas viejo a lo mas nuevo y el barrido es idempotente cada 5 minutos: una pagina truncada es un retraso, no trabajo perdido, porque la corrida siguiente empieza donde la anterior dejo de ver. La cota son ~1 700 solicitudes por corrida. Paginar dentro de una corrida la acercaria a su limite de 300 s sin resolver mas de lo que la siguiente ya resuelve (modelo-datos-dynamodb.md 8.2). **La Etapa 13 acoto la excepcion en el documento** porque leerla como permiso general costo cinco lecturas de fila sin paginar: ninguna de las tres propiedades aplica a la particion `LOTE#<id>`, que conserva sus solicitudes terminales para siempre y por tanto no se autocura (desafios 55) |
| Todo el resto de las lecturas pagina por **un solo camino**: `src/lib/data/paginacion.ts` | El patron estaba resuelto cuatro veces a mano en `src/lib/auditoria/` y `src/lib/fila/` no lo usaba en ninguna de sus cinco lecturas. El helper **no lleva tope de paginas** a proposito: cortar en silencio es exactamente el defecto que viene a arreglar —`adjudicarLote` escribiendo `FILA_AGOTADA` con candidatos vivos detras—, y quien necesite acotar trabajo acota **resultados**, que es lo unico que quien llama sabe medir. Tampoco lleva `import "server-only"`, porque el Lambda del barrido lo alcanza (desafios 53) |
| `avalarPago` devuelve el desenlace del cierre de fila **separado** del de la venta | El cierre ocurre fuera de la transaccion (cantidad no acotada, T4) y puede fallar con la venta ya firme. Antes el error se volvia `cerradas: 0` y salia como exito, indistinguible del `0` legitimo de "no habia fila que cerrar" — y sin ninguna linea de registro, asi que nadie podia enterarse. La venta **no se revierte**: lo que se agrega es que el resultado lo delate, que quede registrado y que el barrido lo repare en la corrida siguiente. La cuenta nueva (`filasCerradas`) no entra en `errores`, para no cambiar lo que significa la alarma `vencimientos-sin-resolver` (desafios 56) |

Centinelas: vehiculo activo (R-10), fila (R-07), adjudicacion activa (R-09), reserva de turno
(R18). Transacciones criticas T1–T8 en `modelo-datos-dynamodb.md` seccion 6 (linea 258).

**R18 — la carrera entre el turno y su visibilidad** quedo cerrada con evidencia
(`modelo-datos-dynamodb.md` linea 351; commit `c1dabfc`). El prototipo que la decidio sigue en
`src/lib/fila/prototipoDeFila.ts`, detras de `PROTOTIPO_R18=1`: es el registro reproducible de
la decision, no codigo de produccion.

**El motor de fila de produccion es la Etapa 8**, en `src/lib/fila/`: `solicitarCompra.ts` (T1,
tres escrituras con la reserva antes del contador), `adjudicarLote.ts` (T2, escritura
condicional con abstencion por reservas y congelamiento por R-09), `cancelarSolicitud.ts`,
`descongelarSolicitudes.ts`, `cerrarFilaDelLote.ts` (R-18) y `consultarMiLugar.ts` (DTO sin
identidades, R-12). La regresion permanente de la regla 16 es
`src/lib/fila/fila.integracion.test.ts`, que **si vive en la compuerta** y corre contra DynamoDB
real asumiendo el rol de computo SSR. La Etapa 12 agrega `carga.integracion.test.ts`, que abre
diez lotes a la vez y mide capacidad: 100 solicitudes concurrentes, 0 rechazos, una adjudicacion
por lote y siempre al turno menor de su fila; p95 de 1,3 s en caliente contra 15,5 s en frio, y
esa diferencia de diez veces son apretones de manos TLS, no DynamoDB
(`modelo-datos-dynamodb.md` 8.3).

**El pago y el dictamen de tesoreria son la Etapa 9**, en `src/lib/tesoreria/`:
`subirComprobante.ts` (T3, S3 antes que DynamoDB, sin compensacion — `NegarBorradoDeComprobantes`
lo impide), `avalarPago.ts` (T4, cierra la fila restante del lote llamando a
`cerrarFilaDelLote`) y `rechazarPago.ts` (T6, mismo patron de liberar-y-llamar-a-`adjudicarLote`
que `cancelarSolicitud`, no la forma atomica de T5). `rechazarPago` **no** retira el centinela de
fila — a diferencia de la cancelacion voluntaria —, para que `RECHAZADA_POR_TESORERIA` siga
visible en `MiLugarDTO` con su motivo. La regresion contra infraestructura real es
`src/lib/tesoreria/tesoreria.integracion.test.ts`.

**Los vencimientos y el correo son la Etapa 10**, en `src/lib/fila/vencerYReasignar.ts` (T5,
estructuralmente T2 con dos escrituras del vencido por delante), `barridoDeVencimientos.ts`
(camino A de D-7, mas la recuperacion de lotes huerfanos) y `consultarMiLugar.ts` (camino B).
El correo vive en `src/lib/correo/`: `outbox.ts` encola dentro de la transaccion de T2/T5,
`procesarOutbox.ts` despacha aparte con reintentos acotados por `MAXIMO_INTENTOS_CORREO`, y
`clienteCes.ts` aisla el contrato aun no confirmado de CES (R17) detras de una interfaz propia.
El barrido programado (`amplify/barrido/resource.ts`, cada 5 min) pasa de andamio a logica real;
reusar `src/lib` desde su Lambda exigio instalar el paquete real `server-only` (`esbuild` no
conoce el caso especial de Next) y agregar el alias `@/` a `amplify/tsconfig.json`
(desafios-implementacion.md 33-34). **Instalar el paquete solo resolvia que `esbuild` encontrara
el nombre, no que lo empaquetara sin efecto**: sin la condicion de exportacion `"react-server"`
que activa el build de Next, `server-only` siempre resolvia a su rama de `throw`, y el barrido
fallo en el 100% de sus invocaciones desde que Etapa 10 empezo a llamarlo — descubierto en
Etapa 12 siguiendo la alarma `barrido-con-errores` contra un sandbox real, no por ninguna prueba.
`defineFunction` no expone forma de pasarle `--conditions` a su esbuild, asi que la guarda se
quito de los 17 archivos que el handler alcanza (motor de fila, capa de datos, observabilidad) y
se dejo en los otros 63 de `src/lib` (desafios-implementacion.md 53). La regresion permanente de
la regla 16 para T5 es `src/lib/fila/vencimiento.integracion.test.ts`, contra DynamoDB real —
ninguna prueba, sin embargo, invoca el Lambda empaquetado de verdad.

**La impersonacion de desarrollo es la Etapa 2.2** (decision **D-10**), y no estaba en el plan:
`src/lib/auth/personasSimuladas.ts` (roster cerrado), `impersonacion.ts` (cookie por navegador,
validada contra el roster), el enganche en `session.ts`, la action
`src/app/actions/devTools.ts` y el conmutador
`src/components/BarraDeIdentidadSimulada.tsx` montado en el layout raiz dentro de un
`<Suspense>`. Pertenece a identidad aunque se implemento despues de la Etapa 10: hasta entonces
no habia pantallas suficientes para que el hueco se notara.

**El armazon es la Etapa 10.1** (decision **D-11**), y tampoco estaba en el plan: estaba
especificado en `ui-ux-requerimientos.md` seccion 2 desde la Etapa 0, pero ninguna etapa lo
reclamo como entregable — la Etapa 1 dejo `layout.tsx` con solo `Normalize` y `Fonts`, y las
Etapas 5 a 10 construyeron once pantallas sobre un armazon sin encabezado, sin pie y sin forma
de llegar a ninguna. `EncabezadoAplicacion.tsx` y `MenuDeUsuario.tsx` (menu por permiso),
`PieAplicacion.tsx`, `src/lib/navegacion.ts` y `layout.css`, con los paquetes
`eden-workforce-header`/`-footer` y `eden-contextual-menu` en las mismas versiones que
`icsmx-camp-webapp`.

**La auditoria es la Etapa 11** (decision **D-12**): `src/lib/auditoria/` (`consultarBitacora.ts`
con PA-12 paginada, `reconstruirFila.ts`, `verificarIntegridad.ts`, `mapeo.ts`, `csvDeBitacora.ts`,
`filtrosDeBitacora.ts`), la replica pura en `src/lib/domain/` (`verificacionDeAuditoria.ts`,
`reconstruccionDeFila.ts`, `turnoDeEvento.ts`), `src/lib/fila/leerFilaCompleta.ts` (PA-07 sin
filtrar por estatus, la capacidad de `fila:ver-completa`), las pantallas `/auditoria` y
`/auditoria/lotes/[loteId]`, y el Route Handler `src/app/api/auditoria/exportar`. Riesgo **R20**
evaluado y **diferido** con justificacion: el sumidero append-only independiente que propone como
garantia fuerte (DynamoDB Streams + S3 Object Lock) es infraestructura AWS nueva fuera del alcance
que esta etapa recibio.

**La observabilidad es la Etapa 12** (decision **D-13**): `src/lib/observabilidad/`
(`registro.ts` con redaccion de identidad, `traza.ts` con `conTraza` sobre las tres operaciones
criticas mas el barrido y el outbox), el diagnostico de cancelacion dentro de
`ejecutarTransaccion`, y `amplify/alarmas.ts` con seis alarmas en su pila propia
`AutobAlarmas`. **Cierra R6**: la alarma de infraestructura que la Etapa 10 dejo pendiente
existe, mira una metrica nativa de Lambda y trata la ausencia de datos como fallo. La etapa
queda **parcial**: lo que exige mirar la aplicacion corriendo —axe en navegador,
responsividad, cada runbook ejecutado una vez, despliegue y prueba de humo, y confirmar la
suscripcion de SNS— sigue `[OPERADOR]`, por las mismas credenciales que bloquean la
verificacion visual desde la Etapa 5.

## Cabeceras de seguridad y CSP

La CSP se calcula por peticion en `src/proxy.ts` porque lleva un **nonce nuevo cada vez** en
`script-src`, con `'strict-dynamic'` y sin `'unsafe-inline'`. Las cabeceras que no dependen de
la peticion viven en `next.config.ts`, y no es una separacion estetica: el `matcher` del proxy
excluye `_next/static`, `favicon.ico`, `robots.txt` y `sitemap.xml`, y esos recursos tambien
tienen que llegar con `nosniff` y con HSTS.

**`style-src 'unsafe-inline'` no se puede quitar, y en la Etapa 12 se comprobo por que.** Son dos
hechos independientes, cada uno suficiente: Eden no publica **ningun** archivo `.css` —cada
componente lleva su hoja como cadena y la monta con `<style href precedence>`, el izado de hojas
de estilo de React 19, sin nonce que podamos inyectar— y ademas usa atributos `style={{...}}` en
componentes presentes en casi toda pantalla (`TD`, `TH`, `TR` de `eden-table`; `Hint`, `Select`,
`FieldSet` de `eden-form-parts`; `Item` de `eden-grid`). Lo primero exige el permiso en
`style-src-elem`, lo segundo en `style-src-attr`: partir la directiva no gana nada. Queda como
riesgo aceptado y documentado, no como pendiente.

Ni `next build` ni jsdom aplican CSP, asi que un endurecimiento equivocado pasaria la compuerta
entera en verde y romperia la aplicacion en produccion. De ahi que las pruebas afirmen el
**limite** y no solo la capacidad: `src/proxy.test.ts` comprueba a la vez que `style-src` lleva
`'unsafe-inline'` y que `script-src` no.
Anclas: `src/proxy.ts::proxy`, `next.config.ts`, `desafios-implementacion.md` 40.

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
| El descongelamiento de R-09 se implementa con la cancelacion (Etapa 8), no con el barrido (Etapa 10) | Dejarlo para la Etapa 10, como decia el plan | La cancelacion tambien hace perder una adjudicacion: enviar la mitad congeladora de la regla sin la que la deshace dejaria a esos participantes fuera de sus otras filas para siempre |
| `cancelarSolicitud` no recibe `solicitudId` | Aceptarlo del cliente, como decia el contrato | Se parte del centinela de fila, indexado por el participante de la sesion: cancelar la de otro deja de ser una guarda que se pueda olvidar y pasa a ser una clave que no se puede construir |

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

**El rol no cruza al negocio.** Solo tres archivos lo conocen: `rolesSimulados.ts` (tabla rol →
permisos), `personasSimuladas.ts` (roster de identidades de prueba) y `eas.ts` (que lee
`DEV_TOOLS_MOCK_ROLES`). La Etapa 2.1 enunciaba la invariante como "ningun archivo fuera de
`rolesSimulados.ts`", y **nunca fue cierto**: `eas.ts` lo importa desde el primer dia y el `grep`
a mano no lo delato. Lo que se protege es la frontera entre `src/lib/auth` y el negocio, y desde
la Etapa 2.2 lo verifica `src/lib/auth/rolesSimulados.test.ts` recorriendo el arbol de fuentes.

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
  participantes (regla 7). El **registro operativo** es lo contrario y a proposito: no lleva
  correo, nombre ni destinatario (D-13). Aquel prueba y no caduca; este depura y caduca.
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

`src/lib/observabilidad/` es transversal, no una capa: lo importan `src/lib/data` y
`src/lib/<feature>`, nunca `src/lib/domain` — el dominio sigue puro y sin efectos (P-2). Tampoco
recibe el reloj por `deps`: `conTraza` mide con `performance.now()`, porque el `ahora` inyectable
esta congelado por invocacion a proposito y daria siempre cero
(`estrategia-aplicacion.md` 2.3).

`src/types/auditoria.ts` importa `TipoDeAgregado` de `src/lib/data/claves.ts`, que es la unica
arista `types → lib` del repositorio. Es `import type`, o sea que **no existe en ejecucion**: se
borra al compilar y no arrastra la capa de datos a ningun bundle de cliente. La union vive en
`claves.ts` porque es la forma de una clave de particion; duplicarla en `types/` para respetar la
direccion de la flecha crearia dos catalogos que se separan al agregar un agregado, que es peor
que la arista.

Dos excepciones registradas, las dos por la misma razon: el layout raiz no puede leer datos de
la peticion sin volverse el punto donde todas las pantallas esperan, asi que la lectura ocurre
dentro de un `<Suspense>` — y para estar dentro de un `<Suspense>` hay que ser un componente.
`PanelDeIdentidadSimulada.tsx` (conmutador de D-10) lee sesion y cookie;
`EncabezadoAplicacion.tsx` (menu de D-11) lee sesion e idioma, y `PieAplicacion.tsx` el idioma.
En los dos casos la presentacion vive aparte y si es props pura:
`BarraDeIdentidadSimulada.tsx` y `MenuDeUsuario.tsx`.

## Zona horaria y cache

- Zona horaria unica de negocio `America/Mexico_City`, en `src/lib/domain/fechas.ts` con
  `Intl.DateTimeFormat().formatToParts`. Persistir siempre ISO-8601 UTC. Prohibido comparar
  ventanas de venta con la hora local del cliente. Ancla: `::partesEnZonaDeNegocio`.
- Misma logica para el dinero: la moneda y la **region de formato** son fijas (`MXN`, `MX`),
  aunque el idioma de la interfaz cambie. Con `es` a secas `Intl` aplica convenciones de Espana
  y escribe `185.000 MXN`, donde el punto es lo que un lector mexicano toma por decimales.
  Ancla: `src/lib/domain/dinero.ts::formatearPrecio`.
- Nada sin publicar entra a cache estatica: las rutas dependen de `publicadaEn`; `Suspense` con
  lectura dinamica o `cacheLife` corto con `revalidateTag` disparado por la publicacion. Las
  rutas de participante de las Etapas 7 y 8 son `dynamic = "force-dynamic"`. En la Etapa 12 el
  `build` confirma que **ninguna** ruta sale estatica: las veintiuna son `ƒ (Dynamic)`, que es
  la senal de alerta de R4 leida en positivo.
- La cuenta regresiva la calcula el servidor y el cliente solo decrementa; al llegar a cero
  revalida contra el servidor y nunca habilita nada con el reloj del navegador (R-04).
  Ancla: `src/components/CuentaRegresiva.tsx`.
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

> **El reindexado no ve el trabajo sin commit.** El grafo se ancla al `head_sha`, asi que
> `index_repository` sobre un arbol con cambios sin confirmar devuelve el mismo conteo de nodos
> y los simbolos nuevos no aparecen — medido en la Etapa 8: 2143 nodos antes y despues de
> agregar dieciocho archivos, y de nuevo en la Etapa 12. Reindexar **despues** de confirmar;
> hasta entonces, el grafo describe el commit anterior y hay que leer el archivo.

El hook `.claude/hooks/adr-doc-sync` avisa al editar estos documentos. El avance de
`plan-ejecucion.md` no toca el ADR: aqui van decisiones, no progreso.

Regla de contenido: este ADR captura **decisiones** — que se eligio, que se descarto y por que,
mas el ancla de codigo. No copia prosa, procedimientos ni checklists.
