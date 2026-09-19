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
> Sincronizado con: rama `main`, 2026-09-15 — **Etapas 14 y 15** confirmadas en `7ca60f4`
> (cupos de participacion por convocatoria y modalidad manual de adjudicacion; sus decisiones
> viven en el Registro de decisiones, no como `D-N`). Antes de eso: 2026-09-10, Etapas 7 a 11.2
> confirmadas (`5d746e7`, `496d98e`,
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
> **2026-09-14 — decisiones registradas por delante del codigo.** La tabla de decisiones de
> negocio incorporo las **Etapas 14, 15 y 16** (cupos de participacion por convocatoria en
> sustitucion de R-09, modalidad manual de adjudicacion, y equidad del instante de apertura),
> antes de existir su codigo. Se registraron asi porque son decisiones tomadas, no progreso, y
> porque dejar R-09 sin marcar haria que este espejo afirmara como vigente una regla ya
> sustituida. Desglose en `agent_files/plan-ejecucion.md`, "Ampliacion de alcance — 2026-09-14".
>
> **2026-09-15 — las Etapas 14 y 15 ya son codigo.** El centinela
> `PART#<id>/ADJUDICACION_ACTIVA` **ya no existe**: lo sustituye el item de cupo
> `PART#<id>/CUPO#<convId>` con sus dos contadores (`src/lib/fila/cupo.ts`), y `congelar()` y
> `descongelarSolicitudes` se retiraron conservando su vocabulario en los catalogos, porque la
> bitacora es append-only. La modalidad manual entrega `adjudicarManualmente.ts`, la pantalla del
> adjudicador y el permiso `Autob_Adjudicar_Convocatorias` (**por confirmar con EAS**, R19). Las
> dos quedan **parciales**: lo que falta no es codigo sino ejecutarlo —las cinco pruebas de
> concurrencia del cupo exigen sandbox, y el recorrido de punta a punta de la modalidad manual
> exige sandbox y navegador—.
>
> Un hallazgo que el plan no preveia y que si es decision nueva: **la verificacion de integridad
> comprueba la firma de la decision manual.** Deduce la modalidad del propio evento y no del
> registro del lote —el auditor verifica contra la bitacora, no contra un atributo que alguien
> pudo cambiar—, y reporta aparte `decisionesManualesSinFirma`. Sin eso, declarar "es manual"
> habria bastado para que cualquier salto de turno quedara exento de revision.
> **La Etapa 16 sigue sin implementar.**
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
> **2026-09-10, preparando el despliegue.** Un ambiente de pruebas en Amplify Hosting obligo a
> separar "compilado en modo produccion" de "es el entorno de produccion": Amplify sirve **toda**
> rama con `NODE_ENV=production`, asi que la compuerta de las herramientas de desarrollo pasa a
> depender de un `APP_ENV` declarado — decision **D-18**, con su matriz de verdad verificada por
> enumeracion.
>
> **2026-09-18 — Etapa 17, fotografias.** Ocho decisiones nuevas, **D-22** a **D-29**, todas
> nacidas de reportes del operador sobre el entorno desplegado: normalizar al subir y descartar
> el original, WebP y no AVIF con la medicion que lo decide, el vencimiento de la firma en cubetas
> de una hora, el trazado explicito de los binarios de `sharp` con su compuerta de build, el pie
> editable sobre una imagen que no se reemplaza, un modulo unico que decide que variantes ofrece
> cada pantalla, la confirmacion en modal de lo destructivo, y la vista previa antes de subir.
> **D-22** y **D-26** son las dos caras de un mismo invariante —los bytes son inmutables, el pie
> no—, **D-24** depende de eso para que `Cache-Control: immutable` sea correcto, y **D-29** existe
> porque **D-28** volvio caro deshacer una subida equivocada.
>
> **D-28 registra una perdida, no solo una mejora:** el retiro de un vehiculo deja de funcionar sin
> JavaScript, porque un modal de confirmacion no se puede exigir por `<form>` puro. Queda dicho
> aqui para que quien lo note dentro de un ano sepa que fue una decision y no un descuido.
>
> **2026-09-18, tercera vuelta sobre la misma pantalla — D-30.** La galeria de edicion se rehizo
> por tercera vez, y las tres veces el reporte del operador fue el mismo sintoma con distinta cara:
> la pantalla pedia demasiado para mostrar poco. La version final separa mirar de editar, y trae
> una consecuencia de modelo que no es cosmetica: **la posicion 1 es la principal**, asi que
> `marcarFotografiaPrincipal` se elimino del contrato. Corrige tambien una linea de **D-26** que
> proponia el campo de solo lectura que la tercera vuelta descarto.
>
> **D-31** cierra la misma pantalla con la subida de varias fotografias de un tiro, y trae consigo
> el unico cambio de capas de todo este trabajo: `bytesDeFotografia` y `fotografiasPorVehiculo`
> pasan a `LIMITES` del dominio, porque son topes que ahora aplica tambien el navegador y vivian en
> un modulo `server-only`.
>
> **D-32 y D-33 salieron de un mismo reporte de campo, y conviene leerlas juntas.** El operador
> reporto que subir varias fotografias fallaba; el diagnostico inicial fue la lectura eventual de
> `obtenerVehiculo` (**D-32**) y **estaba equivocado** — la causa era un `.avif` fuera de la lista
> blanca (**D-33**). D-32 se mantiene porque el defecto que corrige es real y estaba latente desde
> la Etapa 5, pero no era el que se estaba sufriendo.
>
> Queda anotado aqui porque la leccion es de metodo y no de codigo: **una hipotesis que explica
> todos los sintomas no es por eso la causa.** Lo que encontro la causa de verdad fue mostrar en
> pantalla el `detalles` del rechazo, que el servidor llevaba todo el tiempo mandando y la interfaz
> descartaba.
>
> Las anclas de estas seis **no estan todavia en el grafo**: el codigo esta sin confirmar, y el
> reindexado se ancla al `head_sha`. Hasta que exista el commit, describen archivos que hay que
> leer directamente — que es en todo caso lo que manda la cadena de autoridad del encabezado.
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
**Ampliacion de la preparacion del despliegue — sin configuracion de CES, el mensaje se cancela y
la notificacion queda en el registro.** Con `APP_ENV=pruebas` (D-18) y alguna de las cuatro
variables de CES ausente, el despacho marca el mensaje `CANCELADO` —fuera de GSI4, con
`CORREO_FALLIDO` y el motivo nombrando lo que falta— y escribe una linea `warn` con lo que el correo
habria dicho: asunto, lote, solicitud, vehiculo, precio y plazo.
Razon: es la unica forma de verificar el flujo de notificacion mientras CES siga sin aprobar (R17),
porque no hay bandeja donde mirar. Y arregla un defecto latente: `enviarCorreo` **lanzaba** al
faltar una variable, el throw subia hasta el `handler` del barrido y la corrida entera moria en el
primer mensaje — que quedaba `ENVIANDO` con su plazo de 15 minutos, invisible para las siguientes
tres corridas. Ahora la configuracion se comprueba **una vez por corrida y antes de adquirir nada**.
En produccion se conserva el fallo explicito, pero lanzado antes de tocar ningun mensaje.
Descartado:
- Un tipo de evento `CORREO_CANCELADO`. El hecho de negocio es el mismo que `CORREO_FALLIDO` —nadie
  va a recibir ese correo, y el adjudicado no se entera de que gano mientras su plazo corre (R-13)—
  y el `motivo` ya distingue la causa. Un tipo nuevo obligaria a tocar el catalogo de
  `trazabilidad-auditoria.md`, los filtros y las etiquetas de la pantalla de auditoria sin responder
  nada mas.
- Sumar los cancelados a `fallidosPermanentes`. La alarma `correos-fallidos` filtra por ese campo
  (`amplify/alarmas.ts`), asi que en un ambiente sin CES sonaria en cada corrida: ruido que nadie
  cree. Contador propio, mismo criterio que `filasCerradas` frente a los `errores` del barrido.
- Cancelar tambien en produccion. Descartaria notificaciones reales sin que ninguna alarma lo
  delatara; ahi faltar la configuracion es un defecto de despliegue que tiene que verse.
- Dejarlos acumulandose `PENDIENTE`, que es lo que este ADR describia antes. Con CES sin aprobar la
  mora crece sin techo y la alarma `outbox-retrasado` queda disparada de forma permanente, ademas de
  no dejar ninguna evidencia de que la notificacion se genero bien.
- Escribir el destinatario en la linea del registro. Es identidad de una persona y el registro
  operativo no la acumula (D-13); `destinatario` ya esta en `CAMPOS_REDACTADOS`. Quien la necesite la
  tiene en la bitacora, anclada al mismo lote.
Anclas: `src/lib/correo/outbox.ts::itemsDeEncoladoAdjudicacion`,
`src/lib/correo/procesarOutbox.ts::procesarOutbox`, `src/types/correo.ts::EstatusMensaje`,
`src/lib/correo/clienteCes.ts::configuracionDeCesFaltante`.

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

### D-18 — El entorno se declara con `APP_ENV`, no se deduce de `NODE_ENV`
La compuerta de D-10 exige modo, entorno y sesion. El **entorno** dejo de ser
`NODE_ENV !== "production"` y pasa a ser `APP_ENV`, con dos valores: `produccion` | `pruebas`.
**Ausente o desconocido se asume `produccion`.**
Razon: `NODE_ENV` no distingue produccion de un ambiente de pruebas. Amplify Hosting compila y
sirve **toda** rama en modo produccion, asi que la condicion anterior hacia imposible desplegar un
ambiente de prueba con el conmutador de identidades — y es ahi donde hace falta, porque el flujo
completo exige dos identidades distintas (R-05 y el orden de la fila) y con `OFF` eso obliga a dos
personas reales.
La asimetria del valor por omision es la propiedad que sostiene la decision: **olvidar la variable
deja las herramientas bloqueadas, no abiertas** (regla 18). Y un `APP_ENV` invalido —`production`
en ingles es el error probable— tambien cierra, mientras que un `ENABLE_DEV_TOOLS` invalido cae a
`OFF`: los dos errores de escritura caen del lado seguro, por caminos distintos.
Consecuencia aceptada y escrita: con cualquier modo distinto de `OFF`, `eas.ts` **no consulta
EAS**. La autenticacion de Okta sigue siendo obligatoria, pero deja de implicar autorizacion —
cualquier cuenta del tenant que alcance la URL recibe los permisos simulados. Admisible con datos
desechables, no con datos reales.
**La matriz de las dos variables es la especificacion, y esta verificada por enumeracion**:
`identidad-autorizacion.md` 4.1.2 la escribe y `src/lib/auth/modoYEntorno.test.ts` recorre las 40
combinaciones —ausentes e invalidas incluidas— mas las propiedades que la tabla existe para
garantizar. Las propiedades vigilan la **tabla**, no solo el codigo: editarla hacia un valor
inseguro rompe la compuerta.
Descartado:
- Seguir con `NODE_ENV`. Impide el ambiente de pruebas desplegado, que es el requisito.
- Atar la habilitacion a `APP_BASE_URL` (una variable cuyo valor es la URL exacta del despliegue,
  en vez de un nombre de entorno). Da una propiedad mas fuerte —no sobrevive al clonarse la
  configuracion de una app de Amplify a otra, porque la URL cambia obligatoriamente— pero es un
  mecanismo inusual, obliga a duplicar un valor y no sirve para nada mas. Se eligio el nombre de
  entorno por convencional y reutilizable; queda disponible si se quiere la propiedad fuerte.
- Un `NEXT_PUBLIC_*`. Quedaria en el paquete del cliente, y esto es una decision de servidor.
- Tomar la rama de Amplify (`AWS_BRANCH`). Es una variable de **construccion**; no esta garantizada
  en el computo SSR, asi que la guarda dependeria de algo que puede faltar en tiempo de ejecucion —
  y faltar tiene que cerrar, no abrir.
- Exigir `APP_ENV` en todo despliegue y no arrancar sin ella. Mas explicito, pero agrega un modo de
  fallo a un despliegue de produccion que hoy funciona con `OFF` y sin la variable.
Anclas: `src/lib/auth/devMode.ts::exigirModoSeguro`, `::obtenerEntornoApp`,
`src/lib/auth/eas.ts::obtenerPermisos`.

### D-19 — La equidad del instante de apertura se mide, se acota y se registra; no se restaura
La apertura de una convocatoria la gana quien automatiza, y esta **medido**, no supuesto
(`npm run equidad:apertura`): un cliente que dispara en el milisegundo exacto de `inicioVenta`
encabezo los cinco lotes en las tres corridas, y ningun participante que reacciona en los 200-400
ms de una reaccion humana quedo nunca por delante — de 100 pares comparados, cero o una inversion,
y siempre contra el bucle secuencial, jamas contra el reloj exacto. La medicion corre desde una
maquina con inspeccion TLS contra otra region, asi que **subestima**: cuanto mas estable la red,
mas decisivo el reloj.
De ahi la decision, que es tanto lo que se hace como lo que se renuncia a hacer: **ningun mecanismo
tecnico devuelve la equidad del instante**, porque el que necesita un solo disparo no tiene tasa que
limitar. Lo que se construye es una limitacion de tasa por participante y convocatoria —10 intentos
por ventana de 10 s— y evidencia consultable. Donde llegar primero no deba importar, la respuesta ya
existe y es la modalidad manual de adjudicacion (R-23).
**Lo que la limitacion si compra, medido con el mismo binario antes y despues:** el perfil que
llegaba igual de cerca **sin saber la hora** —una rafaga de intentos en paralelo que cubre el
instante— pasa de obtener el turno 3 a no obtener ninguno; los intentos que alcanzan el motor caen
de 187 a 95; los huecos de fila, de 41 a 0; y el turno mediano de una persona mejora de 12 a 5. El
p50 sube 27 ms y el p95 **mejora** 97 ms, asi que R26 —"la limitacion encarece la apertura"— no se
materializo.
**El contador va en la Server Action, antes de leer nada.** Es la parte que solo la medicion podia
decidir: el perfil que hay que acotar hace casi todos sus disparos **antes** de `inicioVenta`, y
esos los rechaza la guarda de `solicitud:crear` sin que `solicitarCompra` llegue a ejecutarse. Un
contador dentro del servicio no habria contado ni uno.
Descartado:
- **Montarlo sobre el item `CUPO#`**, que ya se escribe en cada solicitud y no costaria viajes
  extra. Dos razones independientes: no veria los intentos anticipados, y ese item participa en la
  transaccion de T2 — escribirlo suelto cancelaria adjudicaciones legitimas del mismo participante
  con `TransactionConflict`.
- **Ventana deslizante.** Exige leer el historial antes de decidir, un viaje mas en el camino mas
  caro, para quitarle un factor de dos a un adversario que ya ganaba con un disparo.
- **Token de participacion emitido al abrir.** Verifica autorizacion, que la sesion de Okta ya
  resuelve, y no hace a nadie mas lento; ademas todo paso previo lo paga mejor el script que la
  persona.
- **Prueba de trabajo.** Grava tambien al usuario honesto y hace ganar a quien tenga mejor telefono:
  cambia una injusticia por otra menos visible.
- **Cancelar la participacion por sospecha.** Un script y una persona con buena conexion se ven casi
  igual, como un doble clic o un reintento de red; todo umbral tendria falsos positivos y el castigo
  seria una acusacion invisible. Lo prohibe ademas D-9: a quien se sanciona lo decide la
  organizacion, no un umbral en un archivo.
- **Alarma sobre los intentos anticipados.** Las lineas las escribe el SSR, cuyo grupo de logs no
  esta en esta pila: el filtro compilaria y no coincidiria con nada, que segun D-13 no da error,
  da silencio.
Anclas: `src/lib/fila/limiteDeTasa.ts::registrarIntento`, `::ventanaDe`,
`src/app/actions/fila.ts::solicitarCompra`.

### D-20 — Lo que sobrevive a una conclusion se libera solo, y lo anota un indice disperso
Al concluir una convocatoria, lo no vendido vuelve a `DISPONIBLE` y un administrador puede
reofertarlo (R-11). Lo que faltaba era el lote `ADJUDICADO`, que **sobrevive** al cierre con su
plazo intacto porque quien gano antes tiene derecho a terminar de pagar (R-18). Si ese compromiso se
cae —vencimiento, rechazo de tesoreria o cancelacion—, los tres caminos hacen lo correcto para una
convocatoria abierta: devuelven el lote a `EN_OFERTA` y el vehiculo a `EN_CONVOCATORIA`, para el
siguiente de la fila. Ya no hay fila ni convocatoria donde tomarlo, y nada lo recogia: `CONCLUIDA`
es terminal, la reconciliacion del barrido solo recorre `PUBLICADA` y retirar el vehiculo a mano
exige `BORRADOR`. El vehiculo quedaba invendible **e** inofertable —el centinela de R-10 lo
declaraba activo en una convocatoria terminada—, en silencio y para siempre; el sintoma aparecia
semanas despues como un rechazo inexplicable al incluirlo en otra convocatoria.
La decision: **lo cierra el barrido, sin que nadie lo pida**. No es politica organizacional y D-9 no
pide que decida una persona — la decision ya la tomo quien concluyo la convocatoria, y esto solo
termina de aplicarla sobre el lote que entonces seguia comprometido. Lo que R-11 si reserva a un
administrador, la **inclusion** en otra convocatoria, no cambia.
**Como se encuentra el trabajo:** al concluir, cada lote que sobrevive recibe un `Update` que le
pone `estatusConvocatoria = CONCLUIDA` —cerrando de paso la copia desnormalizada que se quedaba en
`PUBLICADA` para siempre— y las claves de la particion `CIERRE_PENDIENTE` de GSI4. Esa particion
contiene **exactamente** los lotes que pueden llegar a ese estado, asi que el barrido no filtra
nada, y el `REMOVE` de las claves viaja dentro de la transaccion que cierra el lote: resolverlo y
sacarlo del indice son el mismo acto.
Descartado:
- **Un boton "liberar vehiculos no vendidos"** en la convocatoria concluida, que fue la propuesta
  original. Nada le avisa a nadie de que el compromiso se cayo: un boton que hay que descubrir no
  repara un estado que nadie sabe que existe.
- **Listar las convocatorias `CONCLUIDA` en cada corrida** y mirar sus lotes. Ademas de crecer sin
  limite con el historico, `listarConvocatorias` corta en `MAXIMO_POR_ESTATUS` y `GSI2SK` ordena por
  `creadoEn` ascendente: al pasar el tope devolveria las mas viejas y dejaria fuera justo las
  recientes. Habria fallado en silencio, años despues, en el unico caso que importa.
- **Que `avalarPago` limpie la marca** del caso feliz. Obligaria al camino de la venta a conocer un
  indice que solo existe para convocatorias ya concluidas; el precio de limpiarla tarde es una
  lectura de mas hasta la corrida siguiente, el del acoplamiento es permanente.
- **Reusar el criterio de eventos de la conclusion.** Alli el resumen de `CONVOCATORIA_CONCLUIDA`
  responde por todos los lotes a la vez y un evento por lote repetiria N veces el mismo hecho; el
  cierre tardio ocurre dias despues y ninguno lo cubre, asi que **si** escribe
  `LOTE_CERRADO_TRAS_CONCLUSION`.
Anclas: `src/lib/convocatorias/cierreDeLote.ts::itemsParaCerrar`,
`::itemParaMarcarComprometido`, `src/lib/convocatorias/cerrarLoteTrasConclusion.ts`,
`src/lib/data/claves.ts::gsi4`.

### D-21 — Descartar un item ilegible es correcto; hacerlo en silencio, no
Los mapeadores de `mapeo.ts` devuelven `undefined` ante un item mal formado y quien llama lo filtra,
para que un registro corrupto no tumbe la pantalla entera. La decision se mantiene. Lo que cambia es
que el descarte **deja rastro**: `listarConvocatorias` y `obtenerConvocatoria` escriben una linea de
traza operativa con el identificador y **los campos que faltaron**, y `obtenerConvocatoria` distingue
sus dos `not_found` — "no existe" y "existe y no se puede leer" eran indistinguibles para quien
depura.
**Lo forzo un caso real, no una revision.** Las Etapas 14 y 15 agregaron `limiteAdjudicaciones`,
`limiteSolicitudes` y `modalidadAdjudicacion` como obligatorios; las convocatorias creadas antes no
los tenian, y tres de cinco se volvieron invisibles en la pantalla de administracion. Con ellas
desaparecio la unica via para concluirlas, asi que sus vehiculos quedaron `EN_CONVOCATORIA` con el
centinela de R-10 puesto: fuera del catalogo y fuera de alcance. El sintoma que llego fue "los
vehiculos quedaron anclados a convocatorias borradas", y no habia ninguna borrada — la aplicacion ni
siquiera puede borrar una. Diagnosticarlo costo una tarde; con la linea de traza habria costado un
renglon (`desafios-implementacion.md` 78).
El razonamiento que fallo esta escrito en el propio mapeador —"un item corrupto entre mil debe
desaparecer del listado"— y es correcto **para corrupcion**. Una migracion de esquema no aplicada no
es corrupcion: no es uno entre mil, y su modo de fallo silencioso convierte un dato incompleto en un
activo inalcanzable.
Descartado:
- **Hacer opcionales los tres atributos en el mapeador**, con un valor por omision. Es lo que
  `Lote.limiteAdjudicaciones` ya prohibe por escrito: la unica lectura sensata de su ausencia seria
  "sin tope", que es la direccion **mas** permisiva, y una propagacion a medias repartiria vehiculos
  sin limite en silencio. Un item ilegible es ruidoso y detectable; uno con topes inventados, no.
- **Lanzar en vez de descartar.** Un item malo entre mil tumbaria la pantalla de administracion
  entera, que es peor que perder una fila y ahora saberlo.
- **Unificar el diagnostico con el `if` del mapeador.** Costaria el estrechamiento de tipos que da
  ese `if`, o un `as` que le mentiria al compilador sobre datos de origen desconocido. Se acepta la
  duplicacion y la sostiene una prueba que recorre campo por campo exigiendo que ambos coincidan.
Regla que queda: **un campo nuevo obligatorio es una migracion**, aunque el compilador no lo note —
obliga a escribirlo en el codigo nuevo y no sabe nada de las filas ya guardadas.
Anclas: `src/lib/convocatorias/mapeo.ts::camposFaltantesDeConvocatoria`,
`::camposFaltantesDeLote`, `src/lib/convocatorias/listarConvocatorias.ts`,
`src/lib/convocatorias/obtenerConvocatoria.ts`.

### D-22 — Las imagenes se normalizan al subirlas, y el original se descarta
`agregarFotografia` decodifica lo que llega, hornea la orientacion EXIF y guarda **tres variantes
WebP** de 480 / 1280 / 2048 px de ancho. El byte que subio el operador no se conserva en ninguna
parte, y `variantes` es **obligatorio** en el item `FOTO#`.
Lo forzo un reporte del operador sobre el entorno desplegado: paginas pesadas, fotos que no se ven
y lentitud. No existia resize, recompresion, miniatura ni strip de EXIF en ninguna parte del
sistema; el escalado era puramente CSS, asi que una foto de celular de 8 MB se descargaba entera
para pintarse en una tira de miniaturas de 100x100 px, y con veinte fotografias por vehiculo el
detalle de un lote pasaba de 100 MB. Dos beneficios que nadie pidio y pesan igual: el EXIF
publicaba las coordenadas GPS del patio donde se tomo cada foto, y decodificar es lo unico que
permite **comparar** el `contentType` declarado —que viene de `File.type`, o sea del navegador— con
el formato real.
La consecuencia que sostiene toda la politica de cache: **los bytes de una fotografia son
inmutables**. Se borra, nunca se reemplaza, asi que las claves de S3 son estables y
`Cache-Control: immutable` es correcto. La descripcion no es parte de los bytes.
Descartado:
- **Lambda de transformacion disparada por `s3:ObjectCreated`.** Es la arquitectura correcta a
  largo plazo y hoy no encaja: `agregarFotografia` es sincronica y la galeria se repinta con la
  foto ya puesta. Asincrono exige un estado `PROCESANDO`, UI de espera y un camino de fallo sin
  usuario a quien reportarlo. Plan B de segundo nivel.
- **Conservar el original.** El operador confirmo que no hace falta; cuesta almacenamiento y un
  camino de borrado mas. El bucket ademas esta versionado y sin reglas de ciclo de vida.
- **`variantes` opcional, con rama de compatibilidad.** Habria que mantener y probar dos caminos
  para siempre. Es viable porque no hay nada en produccion: las fotografias del entorno desplegado
  son de prueba, asi que no hay relleno ni migracion.
- **Un array de variantes en vez de un mapa completo.** El array permite representar "tengo `min`
  y `max` pero no `med`", un estado que no queremos poder escribir.
- **Derivar los anchos de las constantes.** Con `withoutEnlargement`, un original de 600 px
  produce tres variantes de 600: un `srcSet` con los anchos nominales le mentiria al navegador. Los
  anchos reales se guardan por variante, y el sufijo de la clave es el **nombre** de la variante y
  no su ancho, para que la clave siga siendo predecible.
- **Rellenar un ancho ausente con `?? 0`**, como ya hacia el habito de `bytes ?? 0`. Daria
  `width="0"` y romperia la maquetacion en silencio: el fallback que la regla 15 prohibe. Se
  descarta la fotografia entera, por D-21.
Anclas: `src/lib/media/normalizarImagen.ts::normalizarImagen`,
`src/lib/vehiculos/agregarFotografia.ts`, `src/lib/vehiculos/mapeo.ts::aFotografia`,
`src/types/vehiculo.ts`.

### D-23 — WebP y no AVIF, decidido con el numero en la mano
Las tres variantes salen en WebP con calidad 78.
Medido sobre la misma foto de 12 MP: **WebP 385 ms por variante, AVIF 8 647 ms** — catorce veces el
CPU por alrededor de un 10 % menos de bytes, dentro de una Server Action sincronica que el operador
espera. WebP tiene soporte universal desde 2020, ya estaba en la lista blanca de entrada y no
necesita `<picture>`.
Las variantes se generan **en serie y desde el origen**, no en paralelo ni en cascada: en paralelo
se triplica el pico de memoria y los hilos se pelean, por 300 ms; en cascada no se gana nada (598
contra 611 ms) porque se pierde el `shrink-on-load` del decodificador JPEG y se apilan perdidas de
recompresion.
Descartado:
- **AVIF**, por el numero de arriba. No se descarta por falta de sitio en el marcado: Eden acepta
  `srcSet`.
- **HEIC como formato de entrada.** libvips trae libheif pero sin `de265` ni `dav1d`, asi que
  `sharp.format.heif.input.fileSuffix` es solo `.avif`. Verificado de tres formas independientes.
  Aceptarlo exigiria compilar libvips a mano con libde265, con las implicaciones de patentes HEVC
  que los propios typings de sharp senalan. En su lugar, un mensaje con la accion concreta. En la
  practica puede que no llegue nunca: iOS Safari convierte HEIC a JPEG cuando el `accept` lista
  `image/jpeg`.
- **Recortar a 4:3 en el servidor.** Rompe el visor ampliado. La relacion de aspecto se conserva y
  el recorte lo hace el navegador con `object-fit: cover`.
Anclas: `src/lib/media/normalizarImagen.ts::CALIDAD_WEBP`, `::ANCHOS_DE_VARIANTE`.

### D-24 — El vencimiento de la firma se redondea a una cubeta de una hora
`vencimientoDeFirma(ahora)` = `floor(ahora / 1h) * 1h + 1h + 1h de gracia`, en lugar de una
vigencia contada desde el instante de la peticion.
Dos defectos con una sola causa. La vigencia era de **diez minutos** y el visor ampliado de Eden
**se monta al hacer clic, no al renderizar**: leer una ficha y abrir las fotos once minutos despues
daba 403 garantizado, y eso era el "fotos que no se ven" del reporte. Y como la firma se
recalculaba en cada render, la URL cambiaba siempre y el cache del navegador **nunca acertaba**:
volver al catalogo re-descargaba todo. Con la cubeta la URL es byte-identica durante toda la hora
en curso **para todos los usuarios**.
El redondeo es sobre el epoch, **no** sobre la hora local: una cubeta de una hora es agnostica de
zona y la regla 9 no interviene. Sin esa nota alguien lo "arregla" con `Intl`.
**Que el resultado se determine no relaja la regla 13.** La URL sigue firmandose en SSR en cada
peticion y sigue sin poder persistirse ni entrar en un bloque `"use cache"`: que dos peticiones de
la misma hora coincidan es una propiedad del calculo, no un permiso para guardarla. El dia que
cambie la cubeta, lo persistido queda firmado con una regla que ya no existe.
Lo que se paga, explicito: una URL filtrada vale hasta dos horas en vez de diez minutos. Lo que
protege el acceso es el gating triple del servidor (regla 8), no el vencimiento, y el objeto es la
foto de un vehiculo en venta, sin PII; los comprobantes de pago no salen por CloudFront. Residuo
honesto: una pestana abierta tres horas sigue rompiendose — se eleva el piso, no se elimina el modo
de fallo.
Lo que lo completa del lado de la infraestructura: `CachePolicy.CACHING_OPTIMIZED` se declara
**explicita** aunque sea el valor por omision, porque todo el esquema depende de una propiedad de
esa politica —los query strings no entran en la clave de cache— y la firma viaja en el query
string. Es una linea que convierte una suerte en una decision.
Descartado:
- **Cookies firmadas.** Es el destino correcto de este camino: URLs estables para siempre y nada
  que firmar por peticion. Hoy imposible — `cloudfront.net` y `amplifyapp.com` estan en la Public
  Suffix List, asi que ningun navegador acepta una cookie para ese dominio. Lo volveria viable
  servir la distribucion desde un subdominio del mismo dominio registrable que la aplicacion.
- **Subir la vigencia sin cubeta.** Arregla los 403 y nada mas: la URL sigue cambiando en cada
  render. Mismo costo de seguridad, la mitad del beneficio.
- **Re-firmar desde el cliente con `onError`.** Volveria cliente a `RejillaDeLotes` y crearia un
  **oraculo de firma**: una action que firme lo que le pidan tendria que re-verificar el gating en
  cada llamada, o se convierte en la forma de firmar cualquier foto.
Anclas: `src/lib/media/cloudfrontSigner.ts::vencimientoDeFirma`, `::CUBETA_DE_FIRMA_MS`,
`src/lib/media/almacenamiento.ts::CACHE_DE_FOTOGRAFIA`, `amplify/almacenamiento.ts`.

### D-25 — Los binarios nativos de `sharp` se declaran en el trazado, y una compuerta de build lo comprueba
`outputFileTracingIncludes` en `next.config.ts` lista los paquetes `@img/*` de Linux, `sharp` se
fija en version exacta sin `^`, y `scripts/verificar-sharp.mjs` corre en `amplify.yml` despues del
build.
**Sin esto, la normalizacion funciona en local y da 500 en cada subida del entorno desplegado.** El
caso especial de `sharp` en `@vercel/nft` se activa con `id.endsWith("sharp/lib/index.js")`, archivo
que dejo de existir en sharp 0.34; el camino generico si traza el `.node`, pero busca bibliotecas
compartidas solo dentro del paquete del `.node` y excluyendo `node_modules`, y
`libvips-cpp.so.42` vive en el paquete **hermano** `@img/sharp-libvips-linux-x64`, cargado por
`dlopen` a traves del `DT_RPATH`. **En Windows el defecto no se manifiesta**, porque ahi el DLL esta
junto al `.node`: probar en local no prueba nada sobre el artefacto de Linux. Version exacta porque
el par `sharp` <-> `@img/sharp-libvips-*` esta acoplado a nivel de ABI.
La compuerta es lo que convierte esto en una decision sostenible: exige el `.so` en los
`.nft.json` y hace un round-trip real en el contenedor Linux, asi que un despliegue roto **falla en
el build** en vez de fallar en la primera subida de un usuario. Detalle completo en
`agent_files/desafios-implementacion.md` seccion 84.
Descartado:
- **Confiar en el trazado automatico.** Es el estado del que se partio y el que produce el fallo.
- **Incluir win32 y darwin.** Inflan el artefacto unos 20 MB por plataforma sin que el runtime los
  use.
- **`@img/sharp-wasm32`.** Ya esta en el lock, sin `os`/`cpu`, y es un `.node` autocontenido sin
  `.so` hermano, asi que el defecto de trazado no le aplica. Cuesta 3-5x mas lento —2-3 s por
  subida, aceptable para una accion administrativa— con el mismo codigo de aplicacion. Queda como
  plan B; no se necesito.
- **Un test de Vitest en vez de una compuerta de build.** Vitest corre en Windows, donde el defecto
  es invisible por construccion. Lo que hay que ejercitar es el artefacto del contenedor.
Anclas: `next.config.ts::NATIVOS_DE_SHARP`, `scripts/verificar-sharp.mjs`, `amplify.yml`.

### D-26 — El pie de una fotografia se edita; la fotografia no se reemplaza
La descripcion se acota a **120 caracteres** —en `LIMITES` de `src/lib/domain/vehiculos.ts`, no en
el servicio que la valida— y se edita en linea desde la pantalla de edicion del vehiculo, con
`editarDescripcionFotografia`. La imagen en si no tiene camino de reemplazo: se borra y se sube
otra, con `fotoId` nuevo.

**El pie se muestra siempre**, debajo de su fotografia, como **parrafo completo**. Dos versiones
fallaron antes por lo mismo: la primera lo mostraba solo dentro del formulario de edicion —en una
galeria de veinte, saber que decia cada una obligaba a abrirlas de una en una— y la segunda lo saco
a un campo de una linea, donde quedaba recortado justo en lo que se venia a leer. La tercera es un
`<p>` que se ajusta y nunca se corta. Ver **D-30**.

**El tope se aplica en tres lugares y los tres hacen falta.** `maxLength` en el campo frena el
teclado; una comprobacion antes de enviar deshabilita guardar y conserva lo escrito; el servidor es
la frontera que cuenta. El segundo existe porque `maxLength` **no recorta un valor que ya venia
largo** —un pie capturado antes de que el tope bajara a 120—, y sin el se mandaba al servidor,
volvia rechazado y se perdia lo escrito. El contador mide el texto **recortado**, igual que el
servidor, para no marcar como excedido un pie que cabe.
La asimetria es deliberada y es la contraparte de D-22: los bytes son inmutables porque de eso
depende que las claves de S3 sean estables y que `immutable` sea correcto. El pie vive en el item de
DynamoDB, asi que editarlo **no toca S3**. El tope es un requisito de presentacion —un pie largo
desborda la tarjeta— y hasta ahora solo se podia fijar al subir: corregir una errata obligaba a
borrar la foto entera.
Tres comportamientos heredados de `marcarFotografiaPrincipal`, que es el analogo exacto: `not_found`
se decide contra la galeria leida antes de escribir; **no se escribe evento si el pie no cambio**
—una bitacora que registra actos sin efecto entrena a quien la lee a ignorarla—; y no se toca el
item `META` del vehiculo, porque `actualizadoEn` describe el registro y un pie de foto no lo cambia.
Descartado:
- **Un tipo de evento nuevo.** `VEHICULO_EDITADO` con `campos: ["fotografia.descripcion"]` y el
  `fotoId` en `datos` ya dice todo, con el precedente puesto. Un tipo nuevo obligaria a ampliar el
  catalogo de auditoria y sus etiquetas de diccionario sin ganar informacion.
- **Un permiso nuevo.** Editar el pie es gestion de galeria, igual que reordenar o marcar la
  principal: va con `vehiculo:subir-fotografia`. Un permiso para "cambiar un pie de foto"
  fragmentaria una capacidad que en la practica se concede junta (regla 17).
- **`SET` a cadena vacia al vaciar el pie.** `descripcion` es opcional en el tipo, y `""` deja un
  dato que se comporta como ausente sin serlo. Vaciar hace `REMOVE`; son dos `UpdateExpression`
  distintas segun el valor nuevo, no una con truco. En el evento, el valor nuevo queda en `null`:
  `null` dice "se quito", un campo ausente diria "no se sabe".
- **Hacer la descripcion obligatoria.** Decision del operador: sigue siendo opcional. Cuando falta,
  la galeria publica usa marca/version/modelo como texto alternativo.
- **Un `Input` para el campo de edicion.** Su `maxLength` es inusable —lo declara `string` y React
  `number`, y la interseccion no admite ningun valor (seccion 19 de `desafios-implementacion.md`)—,
  asi que el campo editable es un `TextArea`, que lo declara `number`. Poner el tope en un `Input`
  exigiria un cast sobre un componente de Eden, que es lo que la regla 10 evita.
- **Mostrar el pie en un campo de solo lectura.** Se probo y se descarto: el `Input` de Eden lo
  recorta a una linea, y el `TextArea` mide 8rem fijos, asi que bajo veinte fotografias serian
  veinte cajas mas altas que sus propias miniaturas. Un parrafo no tiene ninguno de los dos
  problemas y ademas se selecciona igual.
Anclas: `src/lib/vehiculos/editarDescripcionFotografia.ts`,
`src/lib/domain/vehiculos.ts::LIMITES`, `src/app/actions/vehiculos.ts`,
`src/components/GaleriaVehiculo.tsx`.

### D-30 — La galeria muestra y los modales editan; la posicion 1 es la principal
La rejilla de `/admin/vehiculos/[id]/editar` no lleva controles: fotografias del mismo tamano, el
distintivo de principal **dentro** de la imagen, la descripcion completa debajo y un solo boton
("Editar"). Agregar vive en un boton junto al titulo. Editar, mover de posicion y eliminar viven en
un modal. Y **la posicion 1 es la principal**: designar es mover al frente.
Lo forzaron dos iteraciones fallidas sobre la misma pantalla, las dos reportadas por el operador.
La version de la Etapa 5 repartia cinco controles bajo cada fotografia —subir, bajar, marcar
principal, editar, eliminar— y solo mostraba el pie al entrar a editar. La siguiente saco el pie a
un campo de una linea y quedaba recortado. Con veinte fotografias, la rejilla era un tablero de
cien controles alrededor de lo unico que importa. **La leccion es de reparto, no de estilo: la
rejilla es para mirar, y toda edicion cabe detras de un clic.**
Que la principal sea la primera convierte dos controles que podian contradecirse en una sola idea.
El invariante lo mantiene el **servidor**, dentro de la transaccion del reordenamiento, no la
interfaz: `reordenarFotografias` apunta `fotografiaPrincipalId` a la que queda primera y solo
escribe el item del vehiculo si la cabeza cambia. `eliminarFotografia` ya hacia lo analogo al
promover la de menor orden.
Descartado:
- **Conservar `marcarFotografiaPrincipal`.** Se **elimino**, servicio y action. Con "la 1 es la
  principal", es la unica forma de romper el invariante: dejaria el listado mostrando una
  fotografia que no esta primero, hasta que el siguiente reordenamiento la devolviera a su sitio
  sin que nadie entienda por que. Dos fuentes de verdad para el mismo dato es el defecto de D-21 y
  de la seccion 78, otra vez.
- **Flechas de mover arriba/abajo y arrastre**, que es lo que habia. Salieron al vaciar la rejilla,
  y el campo de posicion las mejora en el caso real: mover la ultima al frente costaba diecinueve
  clics. Lo que se pierde es el gesto de arrastrar, que solo servia con raton; el `Select` si es
  alcanzable con teclado y con lector.
- **Un campo numerico para la posicion.** Con un `Select` la cota es imposible de violar por
  construccion, en vez de ser una validacion que hay que escribir y probar, y es donde cabe decir
  que la 1 es la principal sin un texto de ayuda aparte.
- **Insertar en una posicion dentro de `agregarFotografia`.** Seguiria siendo una sola transaccion,
  pero duplicaria la logica de reubicacion que `reordenarFotografias` ya tiene probada. La pantalla
  sube al final y reordena: dos mutaciones, cada una con su evento, y el fallo intermedio deja la
  fotografia visible al final en vez de perdida.
- **Anidar la confirmacion de borrado dentro del modal de edicion.** Dos `<dialog>` abiertos a la
  vez dejan la pila del top layer a merced del orden de cierre. La confirmacion **sustituye** al
  modal de edicion.
Anclas: `src/components/GaleriaVehiculo.tsx`,
`src/lib/vehiculos/reordenarFotografias.ts`, `src/lib/vehiculos/eliminarFotografia.ts`.

### D-31 — Varias fotografias de un tiro: una peticion por archivo y un tope de tanda
El modal de agregar admite seleccion multiple (`FileInput` con `multiple` e `isDroppable`) y sube
las fotografias en **una peticion por archivo, en serie**. La descripcion capturada se guarda igual
en todas; la posicion elegida es la de la **primera** y las demas la siguen, aplicada al final con
un solo reordenamiento que inserta el bloque entero.
**No hay action de lote, y esa es la decision.** El tope de `bodySizeLimit` son 11 MB y una
fotografia admite 10, asi que dos archivos en una peticion ya no caben: la unica forma de que el
limite siga siendo el que se dimensiono es que cada fotografia viaje sola. De paso cada alta
conserva su transaccion y su evento (regla 4) en vez de un evento de lote que habria que inventar,
y un fallo a la mitad deja las anteriores subidas y visibles — el proceso se detiene ahi y no
reordena, porque el orden calculado ya no corresponde al estado real.
**El tope de 10 MB pasa a leerse como volumen de la tanda**, y por eso `bytesDeFotografia` y
`fotografiasPorVehiculo` se movieron a `LIMITES` del dominio: `src/lib/media/almacenamiento.ts` es
`server-only` y los mismos numeros los necesita ahora el navegador. Las constantes de alla se
**derivan** de las del dominio, para que no puedan separarse. En el servidor el tope sigue siendo
por archivo, que es la frontera real; el total es una guarda de pantalla que evita empezar un
trabajo que fallaria a la mitad.
Descartado:
- **Una sola peticion con las N fotografias.** No cabe en el cuerpo, y obligaria a un servicio y un
  evento de lote nuevos, con compensacion sobre hasta sesenta objetos de S3 si falla a la mitad.
- **Recortar la tanda sola** al pasarse del volumen. Cual dejar fuera es decision de quien sube. Se
  cancela entera con el aviso, como pidio el operador.
- **Subirlas en paralelo.** Ganaria tiempo de reloj y perderia el orden de la tanda, que es lo que
  da sentido a "las demas siguen a la primera"; ademas pondria N normalizaciones de `sharp`
  compitiendo en un computo de 1-2 vCPU.
- **Una descripcion por fotografia en el mismo modal.** Siete cajas de texto antes de haber visto
  las fotografias es lo contrario de D-30. Se captura una para toda la tanda y se corrige despues
  una por una.
- **Aplicar la posicion con varios `moverEnLista`.** Mover una por una desplaza el destino de las
  siguientes; `insertarBloque` lo hace de un tiro y es donde vive la unica cuenta.
- **Confiar en que `multiple` se comporte como dice su tipo.** Sondeado: entrega la seleccion
  **acumulada** y **deduplica por nombre de archivo**, asi que dos fotografias distintas llamadas
  `IMG_0001.jpg` colapsan a una en silencio. No se puede evitar desde fuera, asi que la galeria
  **pinta todas las elegidas con su nombre** para que la que falta se vea antes de guardar
  (seccion 86).
Anclas: `src/components/GaleriaVehiculo.tsx::insertarBloque`,
`src/lib/domain/vehiculos.ts::LIMITES`, `src/lib/media/almacenamiento.ts::MAXIMO_BYTES_FOTOGRAFIA`,
`src/lib/vehiculos/agregarFotografia.ts::MAXIMO_FOTOGRAFIAS`.

### D-32 — Toda lectura que decide una escritura es consistente, y se pide por llamada
`obtenerVehiculo` acepta `{ consistente: true }` y lo enciende `conVehiculo`, el cuello unico por
donde pasan las mutaciones del vehiculo, mas las dos lecturas de `actions/convocatorias.ts` que
deciden una transicion. Por omision sigue siendo eventual.
Amplia una regla que existia desde la Etapa 8 pero se leia como algo del motor de fila: *"las
lecturas que alimentan un bucle de escrituras condicionales llevan `ConsistentRead`"*. En realidad
aplica a **cualquier** lectura que decida una escritura. `obtenerVehiculo` alimenta tres calculos
de leer-y-decidir —el `orden` de una fotografia nueva, si es la primera y por tanto la principal, y
la permutacion al reordenar— y se leia eventual.
**Se encontro leyendo, no por un fallo observado**, mientras se investigaba el defecto de la
seccion 89 — que resulto tener otra causa. Sigue siendo real y latente: en cuanto dos peticiones
caen lo bastante juntas, la segunda puede no ver lo que escribio la primera, y salen fotografias
con el mismo `orden`, dos reclamando ser la principal, o un reordenamiento rechazado con
`no_es_permutacion`. Lo habilito D-31, que es la primera pantalla que encadena dos mutaciones
sobre el mismo agregado.
Descartado:
- **`ConsistentRead` siempre, dentro de `obtenerVehiculo`.** Lo llaman once lugares y casi todos
  son de presentacion; el catalogo lo invoca **una vez por lote**, la lectura mas caliente de la
  aplicacion. Cuesta el doble de RCU y no se sirve desde replica: seria duplicar el consumo donde
  mas duele para arreglar un problema que solo tiene el camino de escritura.
- **Que cada action lo pida por su cuenta.** Se enciende en `conVehiculo`, que ya es el cuello
  unico de las mutaciones: una action nueva lo hereda sin que nadie tenga que acordarse.
- **Reintentar el reordenamiento al fallar.** Enmascara la causa y deja el sistema dependiendo de
  cuantas veces reintente.
Corolario documentado, porque es lo que hace caro este defecto: **la consistencia eventual no se
manifiesta hasta que dos escrituras se acercan en el tiempo**, asi que llega tarde y se ve como "a
veces falla". Y la mitad barata: **cuando un servicio devuelve un motivo por campo, la pantalla lo
muestra** — la galeria descartaba `detalles` y convertia el rechazo en una adivinanza.
Anclas: `src/lib/vehiculos/obtenerVehiculo.ts::obtenerVehiculo`,
`src/app/actions/vehiculos.ts`, `src/lib/fila/adjudicarLote.ts::leerFila`.

### D-33 — La lista de formatos la aplica tambien la pantalla, y AVIF entra
`TIPOS_DE_IMAGEN` se movio a `src/lib/domain/vehiculos.ts`, gano `image/avif`, y el modal de
subida la aplica **antes de empezar**: el archivo no admitido se marca en su miniatura con el
motivo y el boton de guardar se deshabilita. El `accept` del control se deriva de la misma lista.
Lo forzo un reporte de campo: una tanda se rechazo entera por un `.avif`, dejando subidas las
anteriores, sin aplicar la posicion y con un mensaje que no decia cual archivo era. Tres huecos a
la vez — `accept` no filtra lo que se arrastra, `FileInput` solo marca lo invalido cuando corre su
maquinaria de validacion (que en un modal con botones en el pie nunca se dispara), y la pantalla
no comprobaba el tipo.
**Que AVIF estuviera fuera no era una limitacion.** sharp lo decodifica aqui y sale por el mismo
camino hacia WebP; estaba fuera porque nadie lo habia pedido. HEIC sigue fuera y eso si es una
limitacion: libheif sin decodificador HEVC.
Descartado:
- **Dejar AVIF fuera y solo avisar mejor.** Era la opcion barata, y se descarto porque el formato
  funciona: rechazarlo obliga al operador a convertir archivos por una lista que nadie reviso.
- **Saltar el archivo no admitido y subir el resto.** Termina en un estado a medias que hay que ir
  a revisar. Se prefiere no empezar: quitar un archivo cuesta un clic.
- **Confiar en el `accept`.** No es una validacion, es una sugerencia al dialogo del explorador, y
  con arrastrar y soltar no filtra nada.
- **Duplicar la lista en cliente y servidor.** Una sola, en el dominio; el modulo de almacenamiento
  es `server-only` y por eso la lista no podia quedarse ahi.
- **`"avif"` en `FORMATO_ESPERADO`.** Parece lo obvio y rechaza **todos** los AVIF: se detectan
  como `"heif"`, porque AVIF es un contenedor HEIF con carga AV1.
Anclas: `src/lib/domain/vehiculos.ts::TIPOS_DE_IMAGEN`, `::ACEPTA_IMAGENES`,
`src/lib/media/normalizarImagen.ts::FORMATO_ESPERADO`, `src/components/GaleriaVehiculo.tsx`.

### D-34 — Dos variantes de igual ancho comparten el objeto de S3, no se omiten
Los anchos de variante son topes, no objetivos: con `withoutEnlargement` el ancho de salida es
`min(tope, ancho original)`. Un original de 1280 px o menos —lo normal en una foto que paso por
mensajeria— produce `med` y `max` **identicas byte a byte**. `agregarFotografia` sube entonces un
solo objeto y apunta las dos entradas del mapa a la misma clave.
Lo autoriza una implicacion, no una coincidencia: como los topes son distintos entre si, dos
variantes solo pueden empatar en ancho si **ninguna redimensiono**, o sea si las dos son el
original intacto codificado con la misma calidad. Empatar en ancho es ser el mismo archivo. Esta
fijado en una prueba que compara los **bytes**, no las dimensiones: si la codificacion dejara de
ser determinista, el arreglo deja de ser correcto y tiene que caerse ahi.
Lo detecto el operador revisando el bucket: "`med` y `max` tienen el mismo tamano, no veo
eficiencia entre un archivo y otro" (seccion 90).
Descartado:
- **Omitir la variante repetida.** Rompe el `Record` completo, que existe para que no se pueda
  representar "tengo `min` y `max` pero no `med`", y obligaria a las tres vistas a tratar el hueco.
- **Dejarlo como estaba.** En ancho de banda no costaba nada —`fuentesDeImagen` ya deduplica por
  ancho— pero si el doble de almacenamiento en un bucket versionado y sin reglas de ciclo de vida.
- **Deducir las claves desde el `fotoId` al borrar.** Ya estaba descartado por D-22 y este cambio
  lo agrava: las claves escritas dejaron de ser derivables del nombre de variante.
Consecuencias que van juntas o el arreglo introduce algo peor: el `claveS3` del nivel superior
apunta al objeto de `med` cuando coinciden —dejarlo en `-max.webp` seria una referencia colgante—,
`clavesDeLaFotografia` deduplica con un `Set`, y el evento registra las claves realmente escritas.
Anclas: `src/lib/vehiculos/agregarFotografia.ts::agregarFotografia`,
`src/lib/domain/vehiculos.ts::clavesDeLaFotografia`,
`src/lib/media/normalizarImagen.ts::normalizarImagen`.

### D-35 — La lista de mis solicitudes reporta el vencimiento; no lo resuelve
`consultarMiLugar` aplica la verificacion perezosa de D-7 —si la adjudicacion propia vencio, corre
T5 antes de responder— y ahi es correcto: mira **un** lote. `listarMisSolicitudes` no la aplica.
Serian N escrituras condicionales disparadas por una lectura de lista, que es la forma del gasto
que R26 midio en el camino caliente, y un **tercer** camino de escritura del vencimiento donde D-7
define dos.
Lo que si hace es comparar `venceEn` contra el reloj del **servidor** y publicarlo en
`plazoVencido`, de modo que la pantalla pueda decir "el plazo vencio" sin afirmar que la solicitud
ya esta cancelada. La transicion la escribe el barrido, o el detalle del lote al abrirse.
De ahi sale la regla de agrupacion: una `ADJUDICADA` vencida **no** encabeza la pantalla —ya no se
puede subir el comprobante, T3 condiciona a `venceEn > :ahora`— y **tampoco** es historica, porque
su transicion no se ha escrito. Sale entre las activas con su aviso y sin cuenta regresiva; un
contador en cero seria cruel y falso.
Descartado:
- **Aplicar T5 por fila**, que daria una lista siempre exacta: convierte una lectura en N
  transacciones y duplica el camino que D-7 ya cubre por dos vias.
- **Ocultar las vencidas**, que simplificaria la pantalla: le esconderia a alguien el desenlace de
  algo suyo, que es lo contrario de para lo que existe.
Anclas: `src/lib/fila/listarMisSolicitudes.ts::listarMisSolicitudes`,
`src/lib/domain/misSolicitudes.ts::agruparMiSolicitud`.

### D-36 — La lista lleva el turno, no la posicion
`miTurno` esta en el item y es gratis. `miPosicion` cuesta dos `Query` con `Select: COUNT` **por
fila**, y la seccion 3.5 pide agrupacion y cuenta regresiva, no posicion. Quien quiere saber que
tan cerca esta abre el lote, que es donde esa pregunta vale una lectura.
Es la misma division que ya hacia `MiLugarDTO` al exponer las dos: responden preguntas distintas
—"que lugar me toco" y "que tan cerca estoy"— y solo la primera tiene sentido en una lista que
cruza lotes que no se comparan entre si.
Descartado: **traer la posicion igual**, aceptando el costo. En una pantalla que un participante
abre para revisar, multiplicar las lecturas por el numero de filas para un dato que no decide nada
es pagar por ornamento.
Anclas: `src/types/fila.ts::MiSolicitudDTO`.

### D-37 — El orden de PA-09 es de correccion, no de presentacion
`GSI3SK` es `SOL#<solicitadoEn>#<loteId>`. Una `Query` ascendente con `Limit` devuelve las
solicitudes **mas viejas** del participante y deja fuera justo las que pueden tener un plazo
corriendo: una lista incompleta que se ve completa. Por eso `ScanIndexForward: false`, mas
`truncada` cuando se alcanza el tope.
Es exactamente el modo de fallo que D-20 encontro en `listarConvocatorias` con `MAXIMO_POR_ESTATUS`
—cortar por el extremo equivocado de un indice ordenado—, y se registra aparte porque ahi el
sintoma tardaba años en aparecer y aqui aparece el primer dia que alguien participe mucho.
Descartado: **paginar**. El tope no es de correccion una vez que el recorte es por el extremo
correcto, y una pantalla de consulta personal con cien filas no necesita paginacion; si hiciera
falta, `LastEvaluatedKey` ya esta en la mano.
Anclas: `src/lib/fila/listarMisSolicitudes.ts::listarMisSolicitudes`.

### D-38 — La desnormalizacion de la fotografia principal lleva la clave, no solo el identificador
`fotografiaPrincipalId` existe desde el principio con un proposito declarado: que el listado no
tenga que leer la galeria de cada vehiculo. Pero **con un identificador no se construye una URL**,
asi que cumplia la mitad: el listado sabia cual era la principal y no podia mostrarla. La columna
de fotografia de la pantalla 4.1 costaba entonces una `Query` por fila sobre un catalogo de hasta
500 items por estatus. El item del vehiculo gana `fotografiaPrincipalClave`, la clave S3 de la
variante `min`.
Las dos se escriben **siempre en la misma `UpdateExpression`**, en las tres transacciones que las
mantienen, y hay una prueba por servicio que lo exige. Si divergieran, el listado pediria la
miniatura de una fotografia que ya no es la principal — o, tras un borrado, la de un objeto que ya
no existe en S3: un 403 de CloudFront sin nada que lo explique.
`min` y no `max` porque la unica superficie que la consume es una miniatura de tabla. Nunca una URL
firmada: esas se generan por peticion (D-24).
Descartado:
- **Leer la galeria por fila**, que no toca el modelo: 6 lecturas pasan a 6 + N, con N hasta 2500,
  en la pantalla de trabajo que mas se abre al dia.
- **Guardar el objeto `Fotografia` completo** en el item del vehiculo: duplica un dato que ya tiene
  dueno y multiplica los sitios que hay que mantener en paso.
- **Dejar la columna fuera**, que era la alternativa barata: la pedia la seccion 4.1 y el arreglo
  resulto ser terminar algo que ya estaba a medias, no construir algo nuevo.
Sin migracion ni rama de compatibilidad, con el criterio de D-22: no hay nada en produccion.
Anclas: `src/lib/vehiculos/agregarFotografia.ts::agregarFotografia`,
`src/lib/vehiculos/reordenarFotografias.ts::reordenarFotografias`,
`src/lib/vehiculos/eliminarFotografia.ts::eliminarFotografia`.

### D-39 — La omision de una prueba de integracion puede volverse un fallo ruidoso
Las cinco suites que son regresion de una invariante —la fila (regla 16), el vencimiento,
tesoreria, los identificadores unicos y la inmutabilidad de la bitacora— se **omiten** cuando no
hay backend, y eso se conserva: la compuerta tiene que poder correr en una maquina sin AWS.
El defecto no era la omision sino el **silencio**. No hay CI, y el build de Amplify no puede
correrlas porque su rol no puede asumir el rol de computo SSR —y que no pueda es correcto, poder
asumirlo seria una escalada de privilegios—. Asi que el unico verde que existia era el de
`verify:rapido`, que omitia sin distinguirse de un verde que si habia ejercitado la concurrencia.
`backendParaRegresion` lanza cuando `EXIGIR_INTEGRACION=1` y el backend no esta disponible, y
`npm run verify:despliegue` lo activa. Es el paso 0 de R-14. El mensaje explica que la variable
**no va en `amplify.yml`**, porque ese es el atajo previsible y el que rompería el despliegue.
Es la misma forma que la alarma del barrido: tratar la ausencia de datos como fallo, contra el
valor por omision, porque no publicar nada es indistinguible de que todo este bien.
Descartado:
- **Correr las suites en el build de Amplify**, que es la respuesta obvia: exige justamente la
  escalada de privilegios que el diseno rechaza.
- **Endurecer `puedeUsarBackendReal`**, que se queda igual porque su logica es correcta: lo que
  cambia no es *si* puede correr, sino *si callar es aceptable*.
- **Aplicarlo a los cuatro arneses bajo demanda** (`PROTOTIPO_R18`, `CARGA_APERTURA`,
  `EQUIDAD_APERTURA`, `BARRIDO_LOCAL`): se omiten a proposito y por decisiones ya registradas.
Anclas: `src/utils/backendUtilizable.ts::backendParaRegresion`.

### D-28 — Lo destructivo se confirma en un modal, y el retiro pierde su camino sin JavaScript
Eliminar una fotografia y retirar un vehiculo del catalogo pasan por un modal de confirmacion:
`DialogModal` para el borrado —solo hay que confirmar— y `ToolModal` para el retiro, que captura el
motivo dentro. Mismo reparto que `AccionesDeConvocatoria` ya usaba.
Las dos son irreversibles y estaban a un clic. El borrado destruye los tres objetos de S3 y por
D-22 no hay original del que rehacerlos. El retiro es terminal en la maquina de estados, y su campo
de motivo estaba **suelto sobre la pantalla de edicion**: un campo obligatorio a la vista, sin nada
que dijera a que pertenecia, con la transicion terminal debajo. Las convocatorias ya lo tenian
corregido; la pantalla de vehiculos se habia quedado atras.
**Los modales se montan solo cuando hay algo que confirmar**, no siempre con un `open` variable. Un
`<dialog>` cerrado conserva sus hijos en el DOM —lo que los oculta es
`dialog:not([open]) { display: none }`, que es estilo—, asi que dejarlo montado mantendria el boton
de borrar y el campo de motivo en el arbol de la pantalla. De paso, veinte fotografias dejan de
poner veinte `<dialog>`, y desaparece un temporizador de `eden-has-overflow` que se colaba entre
pruebas (seccion 87).
**Lo que se paga, explicito: el retiro deja de funcionar sin JavaScript**, y la envoltura
`retirarVehiculoDesdeFormulario` se retiro. Un modal es un control del cliente: no hay forma de
exigir la confirmacion y a la vez conservar el envio por `<form>` puro. El servidor sigue
comprobando permiso, estado y motivo, asi que lo perdido es el camino degradado, no una garantia.
Descartado:
- **`window.confirm()`.** El navegador puede suprimirlo despues del primero, asi que la
  confirmacion desapareceria justo para quien borra muchas fotografias. Un `<dialog>` nativo no se
  puede suprimir y bloquea el resto de la pagina.
- **Un modal por fotografia.** Serian veinte `<dialog>` montados para que a lo sumo uno se abra. El
  `fotoId` pendiente vive en estado y el modal es uno.
- **Confirmar tambien al reordenar o al designar la principal.** Las dos se deshacen repitiendo la
  accion; pedir confirmacion donde no hace falta entrena a confirmar sin leer, que es lo que vuelve
  inutil la confirmacion del borrado.
- **Dejar el aviso junto al boton** en vez de dentro del modal. Dentro es lo ultimo que se lee
  antes de confirmar, que es cuando importa.
Anclas: `src/components/GaleriaVehiculo.tsx`, `src/components/RetirarVehiculo.tsx`,
`src/app/actions/vehiculos.ts::retirarVehiculo`.

### D-29 — La fotografia elegida se ve antes de subirla, y su URL local se revoca
`GaleriaVehiculo` pinta el archivo recien elegido con `URL.createObjectURL`, sin pasar por el
servidor, con el aviso de que todavia no se guardo.
Lo pidio el operador y encaja con D-28: desde que el borrado exige confirmacion y es definitivo,
subir la fotografia equivocada salio mas caro de deshacer. **No valida nada** a proposito — el tipo
y el tamano los decide el servidor (D-22), y adelantarlo aqui duplicaria las reglas en dos sitios
que se desincronizarian.
La mitad que no se ve: `createObjectURL` **retiene el archivo hasta que se revoca**, y el documento
vive lo que dure la pantalla. La revocacion va atada al valor en un `useEffect` con limpieza, no a
un manejador, porque asi un solo mecanismo cubre los tres caminos: elegir otro archivo, subir, y
salir sin subir nada.
Descartado:
- **Leer el archivo de `event.target.files`**, que es lo que el tipo de `FileInput` promete. No
  funciona: el componente entrega el `File` en `target.value` de un objeto fabricado, asi que
  `target.files` es `undefined` y la vista previa nunca aparecia, sin ningun error (seccion 86).
  Se lee con `instanceof File` y no con un cast, porque un `as File` habria compilado igual.
- **Un `FileReader` con data URL.** Copia el archivo entero a una cadena base64 en memoria, un 33 %
  mas grande, para mostrar lo mismo.
Anclas: `src/components/GaleriaVehiculo.tsx::archivoElegido`.

### D-27 — Que variantes se ofrecen lo decide un modulo compartido, no cada pantalla
`fuentesDeImagen(foto, { anchoMaximo, firmar })` devuelve `{ src, srcSet?, ancho, alto }` ya
firmados. Cada pantalla declara su tope —catalogo y galeria de administracion {480, 1280}, detalle
del lote las tres— y el `sizes`, que depende de su maquetacion, se queda en el componente.
Centralizarlo es lo que evita que las tres pantallas se desincronicen: si cada una armara su
`srcSet`, el dia que se agregue una variante dos seguirian pidiendo la vieja y **nada lo
delataria** — las tres seguirian compilando y mostrando imagenes.
Dos invariantes que el modulo garantiza y que ningun componente podria:
- **Nunca un `srcSet` de una sola candidata.** En esa rama, `getThumbnailImage` de Eden devuelve
  `{src, size}` **sin `alt`**, `eden-image` pone `role="presentation"` y el boton que envuelve la
  miniatura se queda sin nombre accesible. El caso ocurre de verdad: con `withoutEnlargement`, un
  original de 600 px produce tres variantes del mismo ancho, asi que hay que deduplicar y, si queda
  una, pasar `src` a secas.
- **Una firma por variante, reutilizada.** Firmar la menor dos veces —para `src` y dentro del
  `srcSet`— daba dos cadenas para el mismo objeto, o sea dos entradas de cache del navegador. La
  cubeta de D-24 hace que hoy coincidan, pero nada lo garantiza.
Y una limitacion que hay que asumir por escrito: **`eden-grid` reparte con container queries y
`sizes` no las sabe expresar**, asi que traducir a viewport exige asumir todo el cromo de la
pagina. La derivacion va escrita junto a los numeros, porque si alguien cambia un padding el
`sizes` queda mintiendo y **ninguna prueba lo detecta**: el unico sintoma es que las imagenes pesan
un poco mas o se ven un poco blandas.
Descartado:
- **Un ancho de compromiso unico.** Es el estado del que se partio, en su forma extrema: el
  original a todas las superficies.
- **`next/image` con un `loader` propio.** El optimizador tendria que alcanzar una URL firmada que
  caduca, y con variantes pre-generadas no aporta nada.
- **Pasar `srcset` a la tira de miniaturas.** No hace falta y seria peor: `MediaThumbnailGallery`
  resuelve el conjunto por su cuenta y le entrega a la miniatura solo la candidata que le sirve,
  mientras el conjunto completo llega al visor ampliado. Ese reparto es el mayor ahorro de la
  aplicacion.
Anclas: `src/lib/media/fuentesDeImagen.ts::fuentesDeImagen`,
`src/components/RejillaDeLotes.tsx::TAMANOS_DE_TARJETA`, `src/components/GaleriaPublica.tsx`,
`src/components/GaleriaVehiculo.tsx::TAMANOS_DE_CELDA`.

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
| GSI4 gana una tercera particion, `CIERRE_PENDIENTE`, con los lotes que **sobrevivieron** a la conclusion de su convocatoria | Es la unica clase de trabajo pendiente que la conclusion no puede resolver en el acto: depende de como termine una adjudicacion que en ese momento sigue viva. Fija como `OUTBOX_PENDIENTE` y no repartida por dia como `VENCE#` — el reparto existe contra R12 y aqui son unos pocos lotes por conclusion, escritos una vez (D-20) |
| El `REMOVE` de esas claves viaja **dentro** de la transaccion que cierra el lote | Resolver el lote y sacarlo del indice de trabajo pendiente tienen que ser el mismo acto: separarlos abre una ventana en la que el lote esta cerrado y el barrido lo sigue viendo pendiente. Misma propiedad que hace idempotente al resto del barrido (D-20) |
| `solicitudId` se resuelve en reversa con `loteYTurnoDesdeIdentificador`, sin un indice nuevo | Es derivado (`<loteId>-<turno>`), no generado: dividir por el ultimo `-` basta, porque un `loteId` real (ULID) nunca contiene guion (desafios-implementacion.md 32) |
| T6 (rechazar pago) sigue la estrategia de T5b (liberar y volver a llamar a T2), no la de T5 | El documento decia "identica a T5"; rechazar lo dispara una persona mirando la pantalla, no un barrido sobre un plazo vencido, asi que aplica el mismo argumento que ya justificaba T5b |
| El contador de tasa lleva la **ventana en la `SK`** (`TASA#<convId>#<ventana:014d>`), no en un atributo | Con la ventana dentro del item haria falta distinguir "incrementar" de "reiniciar porque cambio la ventana", dos ramas que ninguna `UpdateExpression` expresa: costaria un viaje mas en el camino mas caro. Con la ventana en la clave, una ventana nueva **es** un item nuevo y el `ADD` arranca en uno sin condicion (D-19) |
| Los items `TASA#` **no caducan**, y la tabla sigue sin TTL | Son la evidencia de tasa por participante que la limitacion existe para registrar; expirarla la dejaria sin valor cuando alguien pregunte. Habilitar TTL en la tabla debilitaria ademas la garantia de R-20, que descansa en que **ningun** item caduca solo |
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
| El item `FOTO#` lleva `variantes` como **mapa completo y obligatorio**, y `claveS3`/`bytes` del nivel superior son los de la variante mayor | Un array permitiria escribir "tengo `min` y `max` pero no `med`", un estado que no queremos poder representar; obligatorio en vez de opcional porque no hay nada en produccion, asi que no hay dos caminos que mantener para siempre. Que el nivel superior siga apuntando a la mayor es lo que deja intactos a `eliminarFotografia`, `firmarFotografia` y el evento de auditoria (D-22) |
| Los anchos se guardan **reales por variante**, no se derivan de las constantes | `withoutEnlargement` hace que un original de 600 px produzca tres variantes de 600: un `srcSet` con los anchos nominales le mentiria al navegador. Y el sufijo de la clave es el **nombre** de la variante, no su ancho, para que la clave siga siendo predecible desde el nombre (D-22) |
| `descripcion` es el unico atributo editable del item `FOTO#`, y vaciarla hace `REMOVE` | Los bytes son inmutables por decision (D-22), asi que el pie es lo unico que cambia. El `Update` va sobre la clave de la fotografia con `attribute_exists(SK)` y **no toca el item `META`**: `actualizadoEn` describe el registro del vehiculo y un pie de foto no lo cambia — meterlo en la transaccion la haria competir con otras escrituras del mismo vehiculo sin ganar nada (D-26) |

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
| ~~Varias filas simultaneas, una sola adjudicacion activa (R-09)~~ — **sustituida y retirada del codigo en la Etapa 14 (2026-09-15)**: el centinela `PART#<id>/ADJUDICACION_ACTIVA` ya no existe | Sin limite; una sola solicitud por convocatoria | Equilibra participacion amplia con evitar acaparamiento |
| **Cupo por convocatoria** en sustitucion de R-09: un item `PART#<pid>/CUPO#<convId>` con dos contadores, uno de solicitudes que solo crece y otro de adjudicaciones que sube y baja | Conservar R-09 ademas del cupo; un cupo global entre convocatorias | R-09 limita la *simultaneidad*, no el *total*, y no distingue una convocatoria de otra, que es lo que el negocio necesita topar. Superponerlas dejaria dos reglas de acaparamiento que hay que explicar juntas y mantendria viva la maquinaria de `CONGELADA` para una invariante que el cupo ya cubre |
| El tope de adjudicaciones se evalua **dentro** de la transaccion que adjudica; el de solicitudes, **despues** de crear | Diferir los dos, que es como se enuncio el requerimiento | Cancelar una solicitud no deshace nada irreversible; adjudicar deja el lote `ADJUDICADO`, el vehiculo `RESERVADO`, el plazo corriendo y el correo encolado. Revisarlo despues obligaria a compensar contra alguien que ya recibio el aviso de que gano |
| Quien es saltado por cupo agotado sigue `EN_FILA` con su turno intacto | Un estado terminal `LIMITE_ALCANZADO` | El cupo se libera al vencer o al ser rechazado; un estado terminal castigaria de forma permanente por una situacion temporal |
| Una venta consumada gasta el cupo para siempre | Liberarlo al vender, que es lo que hace hoy el centinela de R-09 al borrarse | Daria una segunda oportunidad de acaparar a quien ya se llevo un vehiculo, que es justo lo que el tope existe para evitar |
| **Modalidad de adjudicacion** por convocatoria: `AUTOMATICA` o `MANUAL`, esta ultima decidida por un adjudicador con permiso propio | Solo la fila automatica | El negocio necesita poder decidir por criterio humano; y de paso vuelve irrelevante la ventaja de automatizar la apertura donde se use |
| En modalidad manual, perder la adjudicacion devuelve el lote al adjudicador | Reasignar automaticamente al siguiente turno | La segunda adjudicacion la decidiria un proceso, no la persona: la modalidad dejaria de serlo a la primera falta de pago |
| **La compuerta de la modalidad manual vive en `adjudicarLote`**, no en cada disparador | Comprobar la modalidad en `solicitarCompra`, `rechazarPago` y `cancelarSolicitud` | Tres sitios son tres oportunidades de olvidarla, y olvidarla significa que el lote se adjudica solo pasando por encima del adjudicador. `vencerYReasignar` es la excepcion inevitable —hace su propia transaccion— y el barrido se excluye aparte |
| **La verificacion de integridad exige la firma de la decision manual**, y deduce la modalidad del evento y no del lote | Confiar en `lote.modalidadAdjudicacion`; dar por buena toda adjudicacion que se declare manual | El auditor verifica contra la bitacora, que es append-only, no contra un atributo que alguien pudo cambiar despues. Y sin comprobar la firma, declararse manual bastaria para quedar exento de revision: una adjudicacion sin actor humano o sin motivo es lo contrario de lo que dice ser |
| El cupo y la modalidad son **obligatorios** en el lote desnormalizado | Opcionales, tratando su ausencia como "sin tope" y `AUTOMATICA` | El invariante de la desnormalizacion es que quedarse atras signifique siempre *menos* permisivo. Esas dos lecturas son las **mas** permisivas: una propagacion a medias repartiria vehiculos sin limite y adjudicaria sola lotes que esperaban decision humana. Exigirlos convierte ese caso en un lote ilegible, que es ruidoso |
| Contra la automatizacion de la apertura: medir, limitar la tasa y registrar la evidencia | Token de participacion; prueba de trabajo; cancelar la participacion por sospecha de trampa | El token verifica autorizacion —lo que la sesion ya hace— sin hacer a nadie mas lento, y todo paso previo lo paga mejor el script que la persona. La prueba de trabajo grava tambien al usuario honesto. La sancion automatica es indistinguible de un doble clic o un reintento de red, y la regla 17 la prohibe: a quien se sanciona lo decide la organizacion |
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
  dentro de un bloque `"use cache"`. El **vencimiento** se redondea a cubetas de una hora sobre
  el epoch (D-24), y ese redondeo es la excepcion que confirma la regla de zona horaria: una
  cubeta de una hora es agnostica de zona, asi que aqui `partesEnZonaDeNegocio` no interviene.
  Que la URL resulte identica dentro de la hora **no** relaja la prohibicion de persistirla.
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
3. `npm run adr:subir` — es `manage_adr(project, mode="update", content=<contenido de
   .claude/adr.md>)`, pero pasado desde el disco. Cerrar con `npm run adr:verificar`.
4. Actualizar la linea "Sincronizado con" del encabezado.

Despues de **cualquier** `index_repository`, aunque no haya cambiado la documentacion, repetir
el paso 3 o el ADR queda perdido en el grafo. Verificar con `manage_adr(mode="sections")`: si
devuelve `[]`, se borro.

> **El paso 3 no se hace transcribiendo el archivo.** `codebase-memory-mcp` es un servidor
> **stdio local**, asi que se le puede hablar desde la terminal por JSON-RPC pasandole el contenido
> **leido del disco**: `scripts/adr-grafo.mjs`, o sea `npm run adr:subir`. Exacto por construccion
> y sin los ~40 000 tokens que cuesta leer 76 KB y volver a escribirlos; reescribir 907 lineas a
> mano ademas puede perder una en silencio, y el espejo corrupto no se nota hasta que alguien lo
> lee. Cerrar siempre con `npm run adr:verificar`, que compara byte a byte contra `mode="get"`.
> Receta completa en `agent_files/desafios-implementacion.md` seccion 63.

> **El reindexado no ve el trabajo sin commit.** El grafo se ancla al `head_sha`, asi que
> `index_repository` sobre un arbol con cambios sin confirmar devuelve el mismo conteo de nodos
> y los simbolos nuevos no aparecen — medido en la Etapa 8: 2143 nodos antes y despues de
> agregar dieciocho archivos, y de nuevo en la Etapa 12. Reindexar **despues** de confirmar;
> hasta entonces, el grafo describe el commit anterior y hay que leer el archivo.

El hook `.claude/hooks/adr-doc-sync` avisa al editar estos documentos. El avance de
`plan-ejecucion.md` no toca el ADR: aqui van decisiones, no progreso.

Regla de contenido: este ADR captura **decisiones** — que se eligio, que se descarto y por que,
mas el ancla de codigo. No copia prosa, procedimientos ni checklists.
