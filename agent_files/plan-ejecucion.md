# Plan de Ejecucion — icsmx-autob-webapp

Fuente de verdad del avance del proyecto. Cada etapa se marca `[x]` solo cuando **todos** sus
entregables estan hechos y su compuerta de calidad pasa en verde.

> Ultima actualizacion: 2026-09-05 — **Etapas 0 a 4 completadas**, incluida la Etapa 2.1 de
> correcciones (autorizacion por permisos, guardas cerradas por omision, CSP y bitacora), mas el
> **prototipo concurrente de la fila**, que cierra el riesgo **R18** y corrige T1, T2 y T8 del
> modelo de datos, y la **Etapa 5 (administracion de vehiculos)**. Siguiente: **Etapa 6 —
> Convocatorias**.

---

## Como se usa este documento

1. Se trabaja **una etapa a la vez**, en orden. Las etapas 5 a 7 pueden solaparse entre si;
   las demas tienen dependencia dura de la anterior.
2. Cada entregable es un `- [ ]`. Se marca `[x]` al terminarlo, en la misma conversacion.
3. Ninguna etapa se cierra sin pasar la **compuerta de calidad** de abajo.
4. Si aparece un problema no obvio, se documenta en `desafios-implementacion.md` antes de
   seguir. Si cambia una regla de negocio, se actualiza `proyecto.md`.

### Compuerta de calidad (identica para toda etapa)

```bash
npm run format     # solo si hubo cambios de codigo
npm run typecheck  # tsc --noEmit, sin errores
npm run verify:rapido  # lint + test + format check, limpio (~50 s)
npm run build      # build de produccion exitoso
```

Ademas, de la Definition of Done de `CLAUDE.md`:

- [ ] Pruebas unitarias de las validaciones y reglas de negocio puras de la etapa
- [ ] Casos **allow** y **deny** de autorizacion cubiertos por permiso
- [ ] Eventos de auditoria persistidos y verificados en prueba
- [ ] Ninguna proyeccion al cliente filtra identidad de terceros
- [ ] UI validada mobile-first con CardView de respaldo
- [ ] Componentes Eden usados tal cual, sin reemplazos custom innecesarios
- [ ] No se exponen ENUMs crudos en UI

---

## Etapa 0 — Documentacion y contexto ✅

**Objetivo:** dejar escrito todo el contexto que necesita cualquier persona o agente para
implementar sin adivinar. Sin codigo todavia.

**Dependencias:** ninguna.

- [x] `CLAUDE.md` — instrucciones de trabajo, reglas criticas, capas, DoD
- [x] `README.md` — que hace la aplicacion, perfiles, stack, comandos
- [x] `agent_files/plan-ejecucion.md` — este documento
- [x] `agent_files/proyecto.md` — reglas de negocio y maquinas de estado
- [x] `agent_files/identidad-autorizacion.md` — Okta OIDC, EAS, tipos de participante
- [x] `agent_files/permission-matrix.md` — matriz permiso x accion (era rol x accion; se
      reestructuro en la Etapa 2.1)
- [x] `agent_files/modelo-datos-dynamodb.md` — single-table, claves, GSIs, transacciones
- [x] `agent_files/trazabilidad-auditoria.md` — eventos auditables e inmutabilidad
- [x] `agent_files/estrategia-aplicacion.md` — principios y decisiones arquitectonicas
- [x] `agent_files/arquitectura-tecnica-aws.md` — topologia AWS y flujos
- [x] `agent_files/api-contracts.md` — contratos de Server Actions y Route Handlers
- [x] `agent_files/ui-ux-requerimientos.md` — requerimientos por pantalla
- [x] `agent_files/runbooks.md` — operacion e incidentes
- [x] `agent_files/desafios-implementacion.md` — bitacora de problemas resueltos
- [x] `AGENTS.md` — convenciones del repositorio
- [x] `.mcp.json` — servidor MCP de Eden
- [x] `.env.local.example` — variables de entorno documentadas
- [x] `.gitignore` y `.npmrc`
- [x] Primer commit del repositorio

**Verificacion:**

- [x] Ningun enlace de `CLAUDE.md` ni de `README.md` apunta a un archivo inexistente
- [x] El vocabulario de autorizacion y los nombres de estado son identicos en `proyecto.md`,
      `permission-matrix.md`, `modelo-datos-dynamodb.md` y `api-contracts.md`
- [x] `.mcp.json` es JSON valido

**Salida esperada:** repositorio con documentacion completa y coherente, sin codigo.

---

## Etapa 1 — Scaffold y toolchain ✅

**Objetivo:** proyecto Next.js que compila, pasa lint y ejecuta un test, con TypeScript strict.

**Dependencias:** Etapa 0.

**Primero que nada** — antes de escribir una linea de codigo, verificar acceso a paquetes:

- [x] `.npmrc` presente y `NODE_AUTH_TOKEN` exportado
- [x] `npm view @churchofjesuschrist/festack-scripts version` responde (valida Artifactory)
- [x] `echo $env:NODE_EXTRA_CA_CERTS` no vacio (ver riesgo R11)

Luego:

- [x] `package.json` con Node 24 en `engines`
- [x] `next` y `react`/`react-dom` en **version exacta**, sin `^` (ver riesgo R15)
- [x] `@churchofjesuschrist/festack-scripts` como devDependency
- [x] `vitest` fijado por `overrides` al igual que en el proyecto hermano
- [x] Scripts: `dev`, `build`, `start`, `test`, `lint`, `verify`, `format`, **`typecheck`**
      (`tsc --noEmit` — el proyecto hermano no lo tiene, aqui es obligatorio)
- [x] `tsconfig.json` con `strict: true` y `paths` → `@/* : ./src/*`
- [x] `eslint.config.mjs`, `prettier.config.mjs`, `stylelint.config.mjs` delegando en festack
- [x] `vitest.config.mts` con `mergeConfig(festackVitestConfig, ...)` y alias `@` duplicado
- [x] `next.config.ts` con `turbopack.root: __dirname` (ver riesgo R13), `poweredByHeader: false`
      y cabeceras de seguridad
- [x] Estructura base: `src/app/`, `src/components/`, `src/lib/`, `src/dictionaries/`, `src/types/`
- [x] `src/app/layout.tsx` con `Normalize` y `Fonts` de Eden
- [x] `src/app/page.tsx` minima
- [x] Un componente de prueba con su `.test.tsx` usando el patron `getTestContext` + axe
- [x] `src/app/api/health/route.ts`

**Verificacion:**

- [x] Compuerta de calidad completa en verde
- [x] `npm run typecheck` sin errores sobre archivos `.ts`/`.tsx` reales
- [x] `npm run lint` reconoce TypeScript (ver riesgo R9)
- [x] `npm run dev` levanta y la pagina raiz responde 200

**Salida esperada:** `npm run build` exitoso sobre un esqueleto vacio pero valido.

---

## Etapa 2 — Identidad y autorizacion

**Objetivo:** saber quien entra, que permisos trae y que puede hacer sobre cada recurso. Sin
datos de negocio aun.

**Dependencias:** Etapa 1.

- [x] `src/lib/auth/auth0.ts` — cliente `Auth0Client` apuntando a Okta, con helper que devuelve
      valor de relleno durante `next build` para no exigir secretos en build
- [x] `src/proxy.ts` — middleware del SDK, resolucion de idioma y `Cache-Control: no-store` en
      rutas autenticadas (Next.js 16 usa `proxy`, no `middleware`) — incluye ademas CSP con nonce
      por peticion (ver `arquitectura-tecnica-aws.md` seccion 5)
- [x] `src/lib/auth/session.ts` — `getSession()` con `import "server-only"`, devuelve
      `{ participanteId, oktaSub, correo, nombre, permisos, tiposDeConvocatoriaPermitidos }` o
      `null` (`participanteId` = `oktaSub` hasta el *upsert* real de la Etapa 4 — ver
      `desafios-implementacion.md` seccion 8)
- [x] `src/lib/auth/eas.ts` — adaptador conmutable (real / simulado) segun `ENABLE_DEV_TOOLS`
- [x] `src/lib/auth/easAdapter.ts` — consulta real con timeout; **sin fallback silencioso**:
      si EAS falla, error explicito (regla 15)
- [x] `src/lib/auth/devMode.ts` — `ENABLE_DEV_TOOLS`, lanza error si no es `OFF` en produccion
- [x] `src/lib/auth/permisos.ts` — `puedeEjecutar({ accion, permisos, contexto })` puro, sin I/O,
      derivado linea por linea de `permission-matrix.md`
- [x] `src/types/identidad.ts` — catalogo de permisos, tipos de convocatoria accesibles y sesion
- [x] Pagina protegida de prueba que muestra permisos y acceso (`src/app/sesion/page.tsx`
      + `src/app/forbidden.tsx`)
- [x] `src/lib/auth/permisos.test.ts` — cobertura cartesiana permiso x accion de las 33 acciones,
      mas las 8 invariantes de `permission-matrix.md`
- [x] `src/proxy.test.ts`

**Verificacion:**

- [x] Compuerta de calidad completa en verde
- [x] Un usuario sin sesion es redirigido a login — verificado con `curl` contra `npm run dev`
      (307 a `/auth/login`)
- [x] Un usuario con sesion pero sin permisos recibe 403, no 500 — mecanismo verificado
      (`forbidden()` + `experimental.authInterrupts`, documentado por Next.js; `build` confirma
      que compila)
- [ ] **Recorrido real contra Okta.** Exige una sesion real de un tenant de prueba, que no existe
      en este entorno. **[OPERADOR]** — pendiente desde el cierre original de la etapa
- [x] Cobertura de allow y deny para cada permiso

**Salida esperada:** login real contra Okta y decisiones de permiso probadas de forma aislada.

---

## Etapa 2.1 — Correcciones de autorizacion y endurecimiento

> **Por que existe esta etapa.** Una evaluacion externa encontro siete hallazgos; seis se
> verificaron reproducibles contra el codigo. Dos son de autorizacion y uno de ellos invalidaba el
> modelo entero: se habia asumido RBAC, pero **EAS no expone roles — responde un booleano por
> permiso**. La Etapa 2 no debio cerrarse con un control de cobertura que no controlaba nada
> (`expect(CATALOGO_ESPERADO).toHaveLength(33)` no miraba el catalogo real).

**Objetivo:** que la autorizacion decida por permisos, falle cerrada, y que sus pruebas ejerzan
los riesgos que dicen cubrir.

**Dependencias:** Etapa 3 (el sandbox desplegado, para la prueba de bitacora).

### Autorizacion por permisos

- [x] `permission-matrix.md` reestructurada de `rol x accion` a `permiso x accion`, con el
      principio "EAS decide la capacidad, la aplicacion decide la aplicabilidad"
- [x] Catalogo de siete permisos a granularidad de capacidad
- [x] `identidad-autorizacion.md` secciones 4 y 5 reescritas; `proyecto.md` seccion 3;
      `estrategia-aplicacion.md` decision **D-9**
- [x] `src/types/identidad.ts` — `Permiso`, `PERMISOS`, `tiposDeConvocatoriaPermitidos`
- [x] `src/types/convocatoria.ts` — `TipoConvocatoria`
- [x] `src/lib/auth/rolesSimulados.ts` — tabla `rol → permisos`, **unico lugar donde sobrevive el
      concepto de rol**
- [x] `easAdapter.ts` — peticion con nombres de permiso, respuesta booleana; **un permiso
      solicitado y ausente es violacion de contrato, no un `false`**
- [x] `session.ts` — consulta unica por peticion con `cache()` de React
- [x] `permisos.ts` — `puedeEjecutar({ accion, permisos, contexto })`
- [x] Diccionarios: etiquetas de permiso en `es` y `en` (regla 11)

### Guardas cerradas por omision

- [x] Toda precondicion booleana exige `=== true`; `undefined` deniega
- [x] Incluye los dos casos que el diagnostico externo no vio: `convocatoria:ocultar`
      (`existeAlgunaSolicitud`) y `solicitud:crear` (`tieneSolicitudViva`)
- [x] Y los que no eran booleanos: `estatusVehiculo` y `creadoPor` ausentes tambien deniegan

### Pruebas

- [x] Cobertura cartesiana comparada contra **las claves reales del catalogo**, no contra un
      numero
- [x] Invariante 8: quitar **un campo a la vez** del contexto minimo y exigir denegacion.
      Verificada por falsacion — revirtiendo `confirmado` al comportamiento anterior, falla
- [x] Invariante 1 recorre el catalogo completo, no cinco mutaciones a mano
- [x] `easAdapter.test.ts` (12 casos) y `eas.test.ts` (13 casos) — no existian
- [x] `session.test.ts` reescrito para permisos

### CSP y fuentes Eden

- [x] `style-src` y `font-src` autorizan `https://foundry.churchofjesuschrist.org`
- [x] Prueba de regresion en `proxy.test.ts`
- [ ] **[OPERADOR]** confirmacion en navegador: consola sin violaciones de CSP y tipografia Eden
      aplicada. Ni `build` ni jsdom aplican CSP, asi que ninguna prueba automatica lo sustituye

### Bitacora append-only

- [x] `attribute_not_exists(PK)` en los siete `Put` de evento de `modelo-datos-dynamodb.md`
- [x] Corregida en tres documentos la afirmacion falsa de que el `Deny` de IAM bastaba
- [x] Prueba de integracion: **confirma contra AWS real que sobrescribir con `Put` tiene exito**
      sin la condicion, y que con ella se rechaza

### Decisiones registradas, no implementadas aqui

- [x] Carrera FIFO documentada en T1 con causa raiz y mecanismo candidato (riesgo **R18**)
- [x] Corregida la exigencia irrealizable de la Etapa 8 ("una sola `TransactWriteItems`")
- [x] `ConditionCheck` sobre la convocatoria en T1, contra la publicacion parcial — **revertido
      en la Etapa 4.1**: cancelaba entre 5 y 7 de cada 10 solicitudes concurrentes. La garantia
      se conserva ordenando la propagacion de T8
- [x] `desafios-implementacion.md` — seccion nueva con la causa raiz del modelo de roles

**Verificacion:**

- [x] Compuerta de calidad completa en verde
- [x] La prueba de integracion de bitacora corre contra el sandbox
- [x] Ningun archivo fuera de `rolesSimulados.ts` importa `Rol` (verificado con `grep`)

**Salida esperada:** autorizacion que no codifica politica organizacional, falla cerrada y tiene
pruebas que fallan cuando el defecto vuelve.

---

## Etapa 3 — Infraestructura Amplify Gen2

**Objetivo:** backend desplegable: tabla, bucket, distribucion, correo y politicas IAM.

**Dependencias:** Etapa 1. Puede ir en paralelo a la Etapa 2.

**Primera tarea, antes de escribir infraestructura** (ver riesgo R1):

- [x] Confirmar que la cuenta AWS permite crear apps de Amplify Gen2 y que existe un camino de
      despliegue aprobado. **Confirmado por el operador y verificado por evidencia:** la cuenta
      de desarrollo (377193866391) ya tiene varias aplicaciones Amplify Gen2 desplegadas
      —`aws cloudformation list-stacks` devuelve pilas `amplify-*` de otros proyectos, con
      `defineData`/`defineAuth`—, asi que no hacia falta una prueba. Los paquetes tambien
      estan en el Artifactory corporativo (`@aws-amplify/backend` 1.24.0, `aws-cdk-lib`
      2.268.0). **Riesgo R1 cerrado:** no hay que migrar el IaC a Terraform/ECS

Luego:

- [x] `amplify/backend.ts` con `defineBackend`
- [x] Tabla DynamoDB single-table como constructo CDK: `PK`/`SK`, GSIs de
      `modelo-datos-dynamodb.md`, PITR activado
- [x] Bucket S3 para fotografias, sin acceso publico
- [x] Distribucion CloudFront con acceso restringido al bucket y llave para URLs firmadas
- [x] ~~Identidad de SES verificada y plantilla de correo de adjudicacion~~ **Sin efecto: el
      correo no sale por SES.** La aplicacion usa **CES** (Church Email Service), un servicio
      REST corporativo con autenticacion basica, que no es infraestructura de AWS y por tanto no
      se declara en `amplify/`. La plantilla pasa a ser codigo de la Etapa 10. Ver riesgo R17
- [x] Politica IAM del rol de la aplicacion con **`Deny` explicito de `UpdateItem` y
      `DeleteItem` sobre items `AUDIT#`** (regla 5). Incluye tambien `BatchWriteItem`,
      las acciones PartiQL que mutan, y el borrado de comprobantes
- [x] Funcion programada para el barrido de vencimientos (sin logica todavia, solo el andamio)
- [x] `npx ampx sandbox` levanta el backend personal sin errores. Desplegado el 2026-09-04 en
      la cuenta 377193866391, pila `amplify-icsmxautobwebapp-CesarLima-sandbox-cbbf835390`
      (279 s la primera vez, por la distribucion de CloudFront)

**Verificacion:**

- [x] Compuerta de calidad completa en verde
- [x] Prueba de integracion que confirma que **escribir** un item `AUDIT#` funciona y que
      **modificarlo o borrarlo es rechazado por IAM**
      (`amplify/auditoriaInmutable.integracion.test.ts`, 5 pruebas en verde contra el sandbox).
      Asume el rol real de computo SSR con STS, no credenciales de desarrollador, asi que
      ejerce **la politica que correra en produccion** y no una copia. Incluye la comprobacion
      inversa —que el mismo rol si modifica y borra items que no son de la bitacora—, sin la
      cual un `Deny` demasiado amplio pasaria inadvertido. Se omite sola si no hay sandbox
      desplegado, para que la compuerta corra en una maquina sin AWS
- [x] La tabla responde a un `PutItem` y un `Query` de humo desde la aplicacion (en el mismo
      archivo de integracion)

**Salida esperada:** sandbox funcional y auditoria demostrablemente inmutable.

---

## Etapa 4 — Dominio y capa de datos

**Objetivo:** las reglas puras y el acceso a datos, probados sin UI.

**Dependencias:** Etapas 2 y 3.

Tipos de dominio (`src/types/`), que la Etapa 2 dejo declarados como pendientes de esta:

- [x] `convocatoria.ts`, `vehiculo.ts`, `lote.ts`, `solicitud.ts` — los cuatro conjuntos de
      estatus, con su lista `as const` para recorrerlos. `permisos.ts` los importa en vez de
      redeclararlos como literales sueltos
- [x] `resultado.ts` — `Resultado<T>` y los once `CodigoError` de `estrategia-aplicacion.md` 3.1
- [x] Etiquetas de los cuatro conjuntos y de los errores en `es.json` y `en.json`, con prueba de
      que ningun valor del catalogo se queda sin traducir (regla 11)

Dominio puro, sin I/O (`src/lib/domain/`):

- [x] `fechas.ts` — constante `America/Mexico_City`, formateo con
      `Intl.DateTimeFormat().formatToParts`, conversion desde y hacia ISO-8601 UTC (regla 9).
      Incluye `diaDeNegocio` para las claves `VENCE#<dia>` y `AUDIT#<dia>`, e
      `instanteDesdeHoraDeNegocio` para la direccion inversa que necesita el formulario de
      convocatoria
- [x] `ventanas.ts` — esta publicada, esta abierta la venta, esta cerrada
- [x] `plazos.ts` — calculo de vencimiento en **horas naturales** desde la adjudicacion
- [x] `transiciones.ts` — transiciones validas de las cuatro maquinas de estado
- [x] `gating.ts` — el gating triple de convocatoria (estatus, `publicadaEn`, tipo), mas
      `contextoDeConvocatoria`, que arma de una sola vez los campos que `puedeEjecutar` exige
- [x] Un `.test.ts` por cada uno, con casos limite de zona horaria y de frontera de ventana

Capa de datos (`src/lib/data/`):

- [x] `cliente.ts` — `DynamoDBDocumentClient` singleton diferido
- [x] `claves.ts` — constructores de `PK`/`SK` por entidad, con tests
- [x] `transacciones.ts` — helpers de `TransactWriteItems` y traduccion de
      `TransactionCanceledException` a errores de dominio
- [x] Convencion de inyeccion de dependencias `(input, deps = {})` en todos los servicios —
      establecida en `ejecutarTransaccion`; la aplican los servicios desde la Etapa 5

**Verificacion:**

- [x] Compuerta de calidad completa en verde — `verify:rapido`, 19 archivos y 635 pruebas;
      `typecheck` y `build` limpios
- [x] Los tests de dominio corren **sin red ni AWS**: ningun instante sale de `Date.now()` y el
      cliente de DynamoDB se construye sin resolver credenciales
- [x] Casos de frontera cubiertos: instante exacto de publicacion, de apertura, de cierre y de
      vencimiento, cada uno con su milisegundo anterior y posterior
- [x] Horario de verano cubierto con fechas **historicas** (2021). Mexico dejo de observarlo en
      octubre de 2022, asi que probar solo con fechas actuales no distinguiria una
      implementacion correcta de un `-6` cableado
- [x] Las fronteras del dominio reproducen literalmente las condiciones de DynamoDB: `ventanas`
      contra el paso 1 de T1, `plazos` contra T3 y T5. Hay prueba de la equivalencia, para que
      la UI no ofrezca un boton que la base de datos rechaza
- [x] **Falsificacion**: once mutaciones deliberadas —cierre de venta inclusivo, vencimiento
      exclusivo, `diaDeNegocio` en UTC, turno sin relleno, `#` aceptado en identificadores,
      cancelacion posicional al reves, evento sin `attribute_not_exists`, gating sin la pata del
      estatus, `CONGELADA` sin cancelar, estatus sin etiqueta— y las once fueron detectadas

**Hallazgos de esta etapa:**

- `desdeIso` aceptaba el 30 de febrero y lo convertia en 2 de marzo: el parser de V8 desborda el
  dia en silencio. Un `finVenta` mal capturado habria alargado la venta dos dias.
  Ver `desafios-implementacion.md` seccion 16
- La tabla 5.4 de `proyecto.md` no traia la fila `CONGELADA → Cancelar` que R-09 y
  `permission-matrix.md` ya exigian. Agregada
- La constante `ESTADOS_VIVOS_SOLICITUD` de `permisos.ts` tenia tres estados y no cuatro: eran
  en realidad los **cancelables**. Renombrada `ESTADOS_CANCELABLES` antes de que el tipo
  compartido la volviera una trampa

**Salida esperada:** reglas de negocio probadas de forma aislada y determinista. **Cumplida.**

---

## Etapa 4.1 — Prototipo concurrente de la fila (riesgo R18) ✅

**Objetivo:** decidir con evidencia, y no con argumentos, si T1 puede implementarse; el propio
`modelo-datos-dynamodb.md` declaraba que **no debia implementarse tal cual**.

**Dependencias:** Etapa 4 (claves, transacciones, plazos) y Etapa 3 (sandbox desplegado).

- [x] `src/lib/fila/prototipoDeFila.ts` con **tres variantes** contrastables: `ingenuo`,
      `reservas_en_lote` (la candidata del documento) y `reservas_por_item`
- [x] `src/lib/fila/prototipoDeFila.integracion.test.ts` — 20 pruebas contra el sandbox, con el
      rol de computo SSR real
- [x] Carrera controlada: pausa deliberada entre las escrituras, determinista
- [x] Rafaga de 10 participantes concurrentes, cada uno adjudicando al terminar, repetida
- [x] `clave.reservaDeTurno` en `claves.ts` mas sus pruebas de orden de clave
- [x] `npm run prototipo:fila` y bandera `PROTOTIPO_R18`, para no cargar `verify:rapido` con
      dos minutos de AWS

**Resultados:**

- **R18 es real y se reproduce siempre.** Con el diseno original, el turno 2 gana el vehiculo del
  turno 1 en todas las corridas
- **El mecanismo que este plan proponia no es viable.** La reserva como atributo del item del
  lote cierra la carrera pero mete ese item en la transaccion de **toda** solicitud: de 10
  simultaneas se perdian entre 5 y 9 por `TransactionConflict`
- **El mecanismo adoptado si lo es.** Reserva como item propio: 10 de 10 entran, turnos unicos,
  orden estricto, un solo ganador, en rondas repetidas
- **Hallazgo aparte:** el `ConditionCheck` sobre la convocatoria que agrego la Etapa 2.1
  cancelaba entre 5 y 7 de cada 10 solicitudes por la misma causa. Sustituido por el orden de
  propagacion de T8
- **Hallazgo aparte:** la condicion `estatus = EN_OFERTA` del paso 1 cerraba la fila en la
  primera adjudicacion, contra R-17, R-15, `miPosicion` y `tamanoFila`
- **Confirmada la senal de alerta del plan:** en once rondas de rafaga sin pausa deliberada, el
  defecto **nunca** se manifesto. Una prueba con esa forma habria pasado en verde

**Documentacion actualizada:** `modelo-datos-dynamodb.md` (seccion 4.4 nueva, T1, T2 y T8
reescritos, invariantes 11 y 12), `proyecto.md` (5.3), `desafios-implementacion.md` (seccion 17).

**Salida esperada:** un diseno de fila validado contra DynamoDB real antes de escribirlo.
**Cumplida.**

---

## Etapa 5 — Administracion de vehiculos ✅

**Objetivo:** que un administrador registre vehiculos con sus fotografias.

**Dependencias:** Etapa 4.

**Cimientos que faltaban y se construyeron aqui**, porque los necesita toda etapa posterior:

- [x] `src/lib/data/identificadores.ts` — ULID propio, ordenable por tiempo. Sin dependencia
      externa: son treinta lineas de una especificacion estable, y el alfabeto de Crockford
      resuelve de paso la prohibicion de `#` de `claves.ts`
- [x] `src/types/auditoria.ts` — catalogo completo de eventos y tipos de actor
- [x] `src/lib/data/eventos.ts` — constructor del evento de bitacora, con las claves de GSI2 y
      la condicion append-only ya puestas. El campo `actorRoles` del documento se renombro
      `actorPermisos`: desde la Etapa 2.1 EAS entrega permisos y no roles
- [x] `src/lib/auth/exigirPermiso.ts` — sesion, permiso y actor de bitacora en un solo paso
- [x] `src/lib/cache.ts` — etiquetas de invalidacion en un solo lugar
- [x] `gsi2.particionDeEstatus` en `claves.ts`, para consultar un estatus entero sin inventar
      una fecha de relleno

**Etapa 5 propiamente:**

- [x] `src/lib/vehiculos/` — crear, editar, listar, obtener, retirar
- [x] `src/app/actions/vehiculos.ts` — Server Actions con guarda de sesion y permiso, mas dos
      adaptadores `(estadoPrevio, formData)` para que los formularios funcionen sin JavaScript
- [x] Validacion de los atributos en `src/lib/domain/vehiculos.ts`, pura y devolviendo **todos**
      los errores de una vez
- [x] `src/lib/media/almacenamiento.ts` — subida a S3 con la clave construida **en el servidor**;
      el nombre del archivo que manda el cliente no se usa para nada
- [x] `src/lib/media/cloudfrontSigner.ts` — firma en SSR; **nunca** persistida ni dentro de un
      bloque `"use cache"` (regla 13)
- [x] Galeria: agregar, eliminar, reordenar y **marcar principal**. Esta ultima no estaba en
      `api-contracts.md` y la pantalla 4.2 la exige; se agrego al contrato
- [x] Pantallas `/admin/vehiculos`, `/admin/vehiculos/nuevo` y `/admin/vehiculos/[id]/editar`
- [x] Tests de validacion, de autorizacion, de la capa de media y de accesibilidad con axe
- [x] `llavePublicaCloudFront` expuesto en los outputs de Amplify: firmar exige el identificador
      de la **llave publica**, y solo se publicaba el del grupo de llaves

**Verificacion:**

- [x] Compuerta de calidad completa en verde — 940 pruebas, `npm run build` exitoso
- [x] Un usuario sin `Autob_Administrar_Vehiculos` recibe `forbidden` en **cada** una de las
      siete actions, sin llegar a delegar en el servicio ni a invalidar cache
- [x] Ninguna URL firmada se persiste: el item guarda `claveS3` y la firma ocurre por peticion
- [ ] **[OPERADOR]** alta de vehiculo con fotografias de punta a punta contra el sandbox. Exige
      `AUTOB_MEDIA_BUCKET`, `CLOUDFRONT_DOMAIN`, `CLOUDFRONT_KEY_PAIR_ID` y la llave privada en
      `.env.local`; la privada es un secreto que el agente no tiene

**Pendiente declarado, ya cerrado:**

- [x] Reordenamiento de galeria **por arrastre**, encima de los botones de mover arriba y abajo,
      que siguen siendo el camino principal porque funcionan con teclado, con lector de pantalla
      y con el dedo. Los dos caminos comparten `moverEnLista`, asi que soltar en una posicion da
      el mismo resultado que llegar a ella con los botones — y hay prueba de esa igualdad
- [x] Etiquetas de diccionario para los tipos de evento y de actor, con la invariante que ata el
      catalogo a los dos idiomas. Ninguna pantalla de esta etapa los muestra; se agregan aqui
      porque el catalogo ya esta completo, y esperar a la Etapa 11 dejaria sin traduccion cada
      evento escrito entre tanto

**Cerrado despues, con el MCP de Eden ya disponible:**

- [x] **Los errores del servidor marcan el campo como invalido.** Viajaban por el `description`
      de `FormField`, que Eden documenta como texto de ayuda: se leian, pero el control quedaba
      valido —sin marco rojo, sin icono y sin `aria-invalid`—, porque el estado de validez de
      Eden solo lo mueve `validationMessage`. Ahora van por `onValidate` + `setCustomValidity`,
      que es el camino del paquete, con un evento `validate` al volver del servidor para que el
      mensaje no espere a que el usuario teclee, y con olvido del error en cuanto lo corrige
- [x] **Los tres formularios usan el `<Form>` de Eden**, que pone `noValidate` y conduce la
      validacion el mismo. Con el `<form>` crudo salian las dos cosas a la vez: el globo nativo
      del navegador y el hint de Eden. Con esto queda completa la receta oficial del paquete,
      `Form` > `Stack` > `FormField`

**Sigue abierto:**

- [ ] El reordenamiento con teclado es de un paso a la vez: cada pulsacion es una transaccion.
      Con `MAXIMO_FOTOGRAFIAS = 20`, el peor caso —llevar la ultima al primer lugar— son 19.
      Quien usa raton ya tiene el arrastre; a quien no, le falta un campo de posicion o un
      "mover al principio". No bloquea la etapa, pero es la brecha real entre los dos caminos
- [ ] **El filtro de `/admin/vehiculos` usa `Input type="search"`**; Eden recomienda
      `SecondarySearch` de `eden-search-box` para filtros de lista —"trae semantica y
      comportamiento de busqueda preconfigurado"— y reserva `Input` para campos genericos. La
      contrapartida no es menor: `SecondarySearch` es componente cliente y arrastra
      `styled-components` como peer dependency, asi que convertiria en cliente una pantalla
      que hoy es Server Component entera. Decidir con la pantalla delante

**Salida esperada:** catalogo de vehiculos administrable. **Cumplida**, salvo la comprobacion de
punta a punta, que depende de credenciales del operador.

---

## Etapa 6 — Convocatorias

**Objetivo:** crear, aprobar y publicar convocatorias con sus vehiculos.

**Dependencias:** Etapa 5.

- [ ] `src/lib/convocatorias/` — crear, editar, incluir vehiculo, retirar vehiculo, enviar a
      aprobacion, aprobar, rechazar, publicar, ocultar, concluir
- [ ] `src/app/actions/convocatorias.ts`
- [ ] Creacion del **lote** (vehiculo dentro de convocatoria) con su contador de turnos en cero
- [ ] Maquina de estados aplicada en servidor: toda transicion valida contra `transiciones.ts`
- [ ] Un aprobador no puede aprobar una convocatoria que el mismo creo
- [ ] Publicacion programada: `publicadaEn` en el futuro no hace visible la convocatoria
- [ ] `revalidateTag` al publicar (ver riesgo R4)
- [ ] Un vehiculo puede incluirse en mas de una convocatoria, pero **no en dos activas a la vez**
- [ ] Pantallas de administracion y de aprobacion
- [ ] Tests de transiciones validas e invalidas y de autorizacion por permiso

**Verificacion:**

- [ ] Compuerta de calidad completa en verde
- [ ] Toda transicion invalida es rechazada por el servidor, no solo oculta en la UI
- [ ] Cada transicion escribe su evento de auditoria

**Salida esperada:** ciclo completo de convocatoria de borrador a publicada.

---

## Etapa 7 — Catalogo para participantes

**Objetivo:** que un participante vea exactamente lo que le corresponde ver, y nada mas.

**Dependencias:** Etapa 6.

- [ ] Listado de convocatorias visibles con **gating triple en servidor** (regla 8):
      `estatus = PUBLICADA`, `publicadaEn <= ahora`, y tipo `EMPLEADOS` solo para `EMPLEADO`
- [ ] Detalle de convocatoria con la hora de inicio de venta en zona horaria de negocio
- [ ] Detalle de vehiculo con galeria de fotografias (`eden-media-thumbnail-gallery`)
- [ ] Cuenta regresiva a la apertura de venta, calculada contra hora de servidor
- [ ] Mobile-first: CardView en movil, tabla en desktop (regla 12)
- [ ] Etiquetas por diccionario, sin ENUMs crudos (regla 11)
- [ ] Sin cache estatica en rutas que dependen de `publicadaEn` (regla 14)
- [ ] Tests de gating: sin `Autob_Venta_a_empleados` **no** se ve una convocatoria de empleados aunque se conozca
      la URL directa

**Verificacion:**

- [ ] Compuerta de calidad completa en verde
- [ ] Acceso directo por URL a una convocatoria no publicada devuelve 404, no el contenido
- [ ] Ninguna respuesta incluye datos de convocatorias que el usuario no deberia ver
- [ ] Revision de accesibilidad con axe sin violaciones

**Salida esperada:** catalogo navegable y correctamente restringido.

---

## Etapa 8 — Motor de fila y adjudicacion

> **Etapa de mayor riesgo tecnico del proyecto.** Aqui vive la equidad del sistema.
> Se recomienda trabajarla con el modelo mas capaz disponible.

**Objetivo:** que el orden de la fila sea justo, verificable e imposible de manipular.

**Dependencias:** Etapa 7.

- [x] **Prototipo concurrente primero** (riesgo R18) — hecho antes de esta etapa.
      `src/lib/fila/prototipoDeFila.ts` mas su prueba de integracion contra el sandbox
      (`npm run prototipo:fila`, 20 pruebas). Reprodujo el defecto de forma determinista,
      descarto el mecanismo que este plan proponia y valido el que lo sustituye. **T1 quedo
      reescrito**; los tres hallazgos estan en `desafios-implementacion.md` seccion 17
- [ ] `src/lib/fila/solicitarCompra.ts` — en **tres escrituras**, segun T1 de
      `modelo-datos-dynamodb.md` ya corregido por el prototipo:
  - [ ] `Put` de la reserva de turno `LOTE#<id>/RESERVA#<reservaId>` **antes** del contador.
        El orden es la garantia: al reves queda abierta la ventana de R18
  - [ ] `ADD` atomico al contador de turnos **del lote** para obtener `turno` (regla 3).
        No puede ir en la transaccion: `TransactWriteItems` **no devuelve valores**, asi que el
        turno que produce un `ADD` no se puede usar como clave de un `Put` de la misma
        transaccion
  - [ ] Condicion del `ADD`: `(estatus = EN_OFERTA OR estatus = ADJUDICADO)` mas la ventana de
        venta. **No exigir `EN_OFERTA` a secas**: cerraria la fila en la primera adjudicacion y
        haria inalcanzable R-17
  - [ ] Item de solicitud con `turno`, `solicitadoEn` informativo y estado `EN_FILA`
  - [ ] Condicion de unicidad: el participante no puede tener dos solicitudes en el mismo lote
  - [ ] `Delete` de la reserva dentro de la transaccion, con `attribute_exists(SK)`
  - [ ] **Sin `ConditionCheck` sobre la convocatoria**: cancelaba entre 5 y 7 de cada 10
        solicitudes concurrentes. La publicacion parcial se cierra en T8, por orden de
        propagacion
  - [ ] Evento de auditoria en la misma transaccion, con `attribute_not_exists(PK)` (regla 4)
  - [ ] Compensacion de mejor esfuerzo: si el paso 1 o el paso 2 fallan, borrar la reserva
- [ ] `src/lib/fila/adjudicar.ts` — adjudicacion por **escritura condicional**
      `attribute_not_exists(adjudicacionActual)`, jamas leer-y-decidir (regla 6)
  - [ ] Abstencion previa por reservas vigentes (R18), leyendo **las reservas antes que la
        fila**. Esa lectura solo puede detener, nunca conceder
  - [ ] Depuracion de reservas mas viejas que el umbral
  - [ ] Reintento con jitter ante `TransactionConflict` sobre el item del lote: no dice quien
        gano, asi que decidir seria adivinar
- [ ] Regla de una sola adjudicacion activa por participante: item de control y condicion
      adicional en la transaccion; las demas solicitudes del ganador pasan a `CONGELADA`
- [ ] `src/lib/fila/consultarMiLugar.ts` — DTO que expone **unicamente** `miTurno`,
      `miPosicion` y `tamanoFila` (regla 7)
- [ ] Cancelacion voluntaria del participante y su efecto sobre la fila
- [ ] Pantalla de fila con el lugar propio y el tamano de la fila
- [ ] `src/app/actions/fila.ts`

**Pruebas obligatorias de esta etapa** (regla 16):

- [ ] **Concurrencia:** N solicitudes simultaneas sobre el mismo lote producen turnos
      **unicos y estrictamente crecientes**. Los huecos son legitimos: un turno consumido por
      una transaccion que despues falla no se reutiliza (ver seccion 6 de
      `modelo-datos-dynamodb.md`). La equidad depende del orden relativo, no de la contiguidad
- [ ] **Adjudicacion unica:** N intentos simultaneos de adjudicacion producen exactamente
      **un** ganador
- [ ] **Orden:** el ganador es siempre el de `turno` menor, nunca el de `solicitadoEn` menor
      (probar con timestamps deliberadamente desordenados)
- [ ] **Intercalacion (R18):** la prueba debe entrelazar solicitud y adjudicacion, no adjudicar
      despues de que todas las solicitudes terminaron. Con esa segunda forma la carrera no se
      ejerce y el defecto pasa. **Confirmado por medicion:** en once rondas de rafaga contra el
      diseno defectuoso, la adjudicacion la gano el turno 1 todas las veces. La prueba de esta
      etapa debe incluir una pausa deliberada entre las escrituras, como hace el prototipo
- [ ] **Sin rechazos por contencion:** N solicitudes simultaneas entran **las N**. Un
      participante rechazado con `conflicto_concurrencia` en `inicioVenta` es un defecto de
      diseno, no una carrera aceptable (desafios-implementacion.md seccion 17)
- [ ] **Fila abierta con el lote adjudicado (R-17):** quien solicita despues de la primera
      adjudicacion obtiene turno y entra a la fila
- [ ] **Privacidad:** test que **falla** si el DTO de fila contiene `participanteId`, correo o
      nombre de un tercero
- [ ] **Auditoria:** cada solicitud y cada adjudicacion tiene su evento correspondiente
- [ ] **Atomicidad:** si el evento de auditoria no se puede escribir, la mutacion no ocurre

**Verificacion:**

- [ ] Compuerta de calidad completa en verde
- [ ] Las pruebas de concurrencia corren repetidamente sin resultados intermitentes

**Salida esperada:** motor de fila demostrablemente justo bajo concurrencia.

---

## Etapa 9 — Comprobante de pago y tesoreria

**Objetivo:** cerrar la venta con el aval de tesoreria.

**Dependencias:** Etapa 8.

- [ ] Subida del comprobante por el adjudicado → estado `COMPROBANTE_CARGADO`
- [ ] Paso a `EN_VERIFICACION`
- [ ] Bandeja de tesoreria con las solicitudes pendientes de verificar
- [ ] Aval del pago → solicitud `VENDIDA` y vehiculo marcado como vendido
- [ ] Rechazo del pago → solicitud `RECHAZADA_POR_TESORERIA` y liberacion del lote hacia el
      siguiente de la fila
- [ ] Descarga del comprobante como Route Handler, con permiso verificado
- [ ] Cada transicion escribe su evento de auditoria con actor y motivo
- [ ] Tests de autorizacion: solo `OPERADOR_TESORERIA` avala o rechaza; solo el adjudicado sube
      su propio comprobante

**Verificacion:**

- [ ] Compuerta de calidad completa en verde
- [ ] Un participante no puede descargar el comprobante de otro
- [ ] El rechazo libera correctamente el lote y reasigna al siguiente

**Salida esperada:** venta cerrable de punta a punta.

---

## Etapa 10 — Vencimientos y reasignacion automatica

**Objetivo:** que la fila avance sola cuando alguien no paga a tiempo.

**Dependencias:** Etapa 9.

- [ ] `src/lib/fila/vencerYReasignar.ts` — cancela por vencimiento y adjudica al siguiente en
      **una sola** transaccion, con sus dos eventos de auditoria
- [ ] Barrido programado **idempotente**: ejecutarlo dos veces no produce doble efecto
- [ ] **Verificacion perezosa**: al leer una fila, si la adjudicacion vigente ya vencio, se
      resuelve en ese momento; el barrido es red de seguridad, no unica defensa (riesgo R6)
- [ ] Descongelamiento de las solicitudes `CONGELADA` del participante que perdio su adjudicacion
- [ ] `src/lib/correo/` — patron **outbox**: el correo se encola, nunca participa en la
      transaccion critica (riesgo R8)
- [ ] Correo de adjudicacion con los datos de pago y el plazo
- [ ] Reintentos con retroceso y registro de fallos permanentes
- [ ] Tests: vencimiento exacto en la frontera, reasignacion en cadena por varios lugares de la
      fila, fila agotada sin siguiente candidato

**Verificacion:**

- [ ] Compuerta de calidad completa en verde
- [ ] Ejecutar el barrido dos veces seguidas no altera el resultado
- [ ] Una caida del envio de correo no revierte ni bloquea la adjudicacion

**Salida esperada:** el ciclo de la fila avanza sin intervencion manual.

---

## Etapa 11 — Auditoria y cumplimiento

**Objetivo:** que un auditor pueda demostrar que todo ocurrio con justicia y en orden.

**Dependencias:** Etapa 10.

- [ ] Vista de auditor: bitacora completa por convocatoria, por lote y por solicitud
- [ ] Reconstruccion de la fila de un lote: turnos, adjudicaciones y motivo de cada cambio
- [ ] Verificacion de integridad: turnos contiguos, una sola adjudicacion vigente por lote,
      toda transicion con evento correspondiente
- [ ] Exportacion de la bitacora
- [ ] Acceso de **solo lectura** con `Autob_Auditar`, sin ninguna action de mutacion
- [ ] Tests de que el auditor no puede mutar nada

**Verificacion:**

- [ ] Compuerta de calidad completa en verde
- [ ] Dado un lote con reasignaciones, la vista reconstruye la secuencia completa y correcta
- [ ] El auditor recibe `forbidden` en toda action de mutacion

**Salida esperada:** trazabilidad demostrable de punta a punta.

---

## Etapa 12 — Endurecimiento y despliegue

**Objetivo:** listo para produccion.

**Dependencias:** Etapa 11.

- [ ] Accesibilidad: axe sin violaciones en todas las pantallas
- [ ] Responsividad verificada en movil, tableta y escritorio
- [ ] Cabeceras de seguridad y CSP
- [ ] Observabilidad: registro estructurado, metricas y trazas de las operaciones criticas
- [ ] Alarmas: barrido de vencimientos fallido, correos no entregados, errores de transaccion
- [ ] Revision de costos y capacidad de DynamoDB
- [ ] `runbooks.md` verificado ejecutando cada procedimiento al menos una vez
- [ ] Diccionarios completos, sin claves faltantes
- [ ] Despliegue a produccion y prueba de humo

**Verificacion:**

- [ ] Compuerta de calidad completa en verde
- [ ] Prueba de carga sobre la apertura de una convocatoria con fila concurrente
- [ ] Cada runbook ejecutado y corregido si su procedimiento no coincide con la realidad

**Salida esperada:** aplicacion en produccion, operable y auditable.

---

## Riesgos y mitigaciones

Ordenados por severidad. La **senal de alerta temprana** es lo que hay que vigilar para
detectarlo antes de que cueste caro.

### R1 — Amplify Gen2 sin precedente en la organizacion

**Probabilidad:** media · **Impacto:** alto

La organizacion despliega con Terraform + ECS Fargate + Azure Pipelines. No existe ningun
proyecto interno con Amplify, por lo que pueden faltar permisos en la cuenta AWS, proceso de
aprobacion o soporte operativo.

**Mitigacion:** riesgo aceptado por decision explicita. Validar el acceso a Amplify como
**primera tarea de la Etapa 3**, antes de escribir infraestructura. El codigo Next.js es
portable: si Amplify se bloquea, solo cambia el IaC y se reutiliza el camino ECS ya probado
internamente (Dockerfile, healthcheck, politicas IAM, plantillas de pipeline).

**Senal de alerta:** `npx ampx sandbox` falla por permisos, o no hay a quien pedir la
aprobacion del despliegue.

> **CERRADO (2026-09-04, Etapa 3).** La premisa era falsa: la cuenta de desarrollo
> (377193866391) ya tiene varias aplicaciones Amplify Gen2 desplegadas, de otros equipos. Hay
> precedente organizacional y no hacen falta permisos nuevos. La ruta de escape a Terraform/ECS
> queda documentada por si cambia el criterio, pero **no hay que ejercerla**.

### R2 — Dos participantes adjudicados sobre el mismo lote

**Probabilidad:** alta si se implementa mal · **Impacto:** critico

Es el fallo que destruye la confianza en el sistema.

**Mitigacion:** adjudicacion **solo** por escritura condicional
`attribute_not_exists(adjudicacionActual)`. Prohibido leer y luego decidir. Prueba obligatoria
de N solicitudes en paralelo antes de considerar terminada la Etapa 8.

**Senal de alerta:** cualquier codigo que consulte el estado del lote y despues escriba en dos
operaciones separadas.

### R3 — Filtracion de la identidad de otros participantes

**Probabilidad:** media · **Impacto:** critico

Basta con que una proyeccion devuelva el item completo de la fila para exponer a terceros.

**Mitigacion:** DTO con lista blanca de campos, nunca difundir el item de DynamoDB. Test que
falla si la proyeccion contiene `participanteId`, correo o nombre.

**Senal de alerta:** un `Query` de fila sin `ProjectionExpression`, o un componente que recibe
el item crudo.

### R4 — Contenido no publicado servido desde cache

**Probabilidad:** media · **Impacto:** alto

Una convocatoria en borrador o programada que se filtra antes de tiempo rompe la equidad.

**Mitigacion:** prohibida la cache estatica en rutas que dependen de `publicadaEn`. `Suspense`
con lectura dinamica, o `cacheLife` corto con `revalidateTag` disparado por la publicacion.

**Senal de alerta:** una ruta de convocatoria que aparece como estatica en la salida de
`npm run build`.

### R5 — Bitacora de auditoria alterable

**Probabilidad:** baja · **Impacto:** critico

Si los eventos se pueden modificar, la trazabilidad no vale nada.

**Mitigacion:** `Deny` explicito de `UpdateItem` y `DeleteItem` sobre items `AUDIT#` en la
politica IAM del rol de la aplicacion, mas prueba de integracion que confirma el rechazo.

**Senal de alerta:** cualquier `UpdateCommand` cuya clave empiece con `AUDIT#`.

### R6 — Barrido de vencimientos caido

**Probabilidad:** media · **Impacto:** alto

Si el barrido no corre, la fila se congela y nadie avanza.

**Mitigacion:** barrido idempotente, mas **verificacion perezosa** al leer la fila para que el
sistema se autocorrija sin depender del barrido. Alarma si no se ejecuta y runbook de
ejecucion manual.

**Senal de alerta:** adjudicaciones con vencimiento pasado que siguen vigentes.

### R7 — Desfase de zona horaria en las ventanas de venta

**Probabilidad:** alta · **Impacto:** alto

Abrir la venta una hora antes o despues arruina la convocatoria.

**Mitigacion:** persistir siempre ISO-8601 UTC; formatear a `America/Mexico_City` solo en
servidor; prohibido comparar ventanas contra la hora del cliente. Tests de frontera y de
horario de verano.

**Senal de alerta:** un `new Date()` sin zona explicita en codigo de cliente que decida
visibilidad.

### R8 — El correo bloquea o revierte la adjudicacion

**Probabilidad:** media · **Impacto:** medio

**Mitigacion:** patron outbox. El envio se encola y se procesa aparte, con reintentos; nunca
participa en la transaccion critica.

**Senal de alerta:** un `await ses.send(...)` dentro del flujo de adjudicacion.

### R9 — `festack-scripts` sin soporte verificado de TypeScript

**Probabilidad:** media · **Impacto:** medio

El proyecto hermano es JavaScript y desactiva los errores de tipos en el build, asi que el
preset puede no estar ejercitado sobre `.ts`/`.tsx`.

**Mitigacion:** verificar lint y test sobre TypeScript como tarea temprana de la Etapa 1.
Anadir `tsconfig.json` y script `typecheck` propios. Si el lint no soporta TS, extender la
flat config sin romper el preset.

**Senal de alerta:** `npm run lint` no reporta nada sobre un error de tipos deliberado.

### R10 — Paquetes privados inaccesibles

**Probabilidad:** media · **Impacto:** alto

Sin Artifactory no hay Eden ni festack-scripts, y nada arranca.

**Mitigacion:** validar `.npmrc` y `NODE_AUTH_TOKEN` como **primer paso** de la Etapa 1, antes
de escribir codigo.

**Senal de alerta:** `npm view @churchofjesuschrist/festack-scripts version` responde 401 o 404.

### R11 — Inspeccion TLS corporativa rompe `npm` y `ampx`

**Probabilidad:** alta en esta maquina · **Impacto:** medio

CrowdStrike Falcon reescribe los certificados TLS. Node no usa el almacen de Windows, asi que
falla con `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. El sintoma parece error de credenciales o de red.

**Mitigacion:** `NODE_EXTRA_CA_CERTS` apuntando al PEM del CA corporativo. Verificarlo antes de
investigar red o permisos. **Nunca** usar `NODE_TLS_REJECT_UNAUTHORIZED=0`.

**Senal de alerta:** cualquier fallo de certificado desde Node, npm, `ampx` o los SDK de AWS.

### R12 — Particion caliente en el contador de turnos

**Probabilidad:** baja · **Impacto:** medio

Un contador unico por convocatoria concentraria toda la escritura de la apertura en una sola
particion.

**Mitigacion:** un contador **por lote**, nunca uno global por convocatoria.

**Senal de alerta:** throttling de escritura al abrir una convocatoria con muchos participantes.

### R13 — Turbopack infiere mal la raiz del proyecto

**Probabilidad:** alta · **Impacto:** bajo

Existe un lockfile en el directorio padre `c:/Apps/node/` que ya causo este problema en el
proyecto hermano.

**Mitigacion:** fijar `turbopack.root: __dirname` en `next.config.ts` desde la Etapa 1.

**Senal de alerta:** advertencias de raiz inferida al ejecutar `npm run dev`.

### R14 — Requerimiento de UI sin componente Eden equivalente

**Probabilidad:** media · **Impacto:** bajo

**Mitigacion:** consultar el MCP de Eden antes de construir cualquier componente custom. Usar
el componente tal cual; CSS propio solo para responsividad o adecuacion visual solicitada.

**Senal de alerta:** un componente nuevo que reimplementa algo que Eden ya ofrece.

### R15 — Ruptura por versiones menores de Next.js o React

**Probabilidad:** media · **Impacto:** medio

Next.js 16 y React 19 son recientes y APIs como `proxy`, `cacheComponents` y `"use cache"`
siguen moviendose.

**Mitigacion:** fijar `next` y `react` en version **exacta**, igual que el proyecto hermano.
No adoptar APIs experimentales sin necesidad real. Actualizar de forma deliberada, nunca
automatica.

**Senal de alerta:** un build que falla sin que haya cambiado el codigo de la aplicacion.

### R16 — `@churchofjesuschrist/festack-scripts` esta deprecado

**Probabilidad:** alta (ya ocurrio) · **Impacto:** medio

Sus propios mantenedores lo deprecaron en la version 27.1.0 (2026-09-02, dos dias antes de
iniciar la Etapa 1): "ya no aporta delta real sobre las herramientas estandar". Sigue
funcionando sin degradacion — `npm install` y todo el toolchain operan con normalidad — pero
no recibira mas actualizaciones ni parches de seguridad nunca.

**Mitigacion:** decision explicita de mantenerlo por ahora (ver Registro de decisiones). El
changelog de 27.1.0 trae un prompt de migracion oficial, validado por el equipo de la
herramienta contra repos reales, para retirarlo sin cambiar de comportamiento (vendorizar los
`.mjs` de configuracion desde `node_modules/@churchofjesuschrist/festack-scripts/lib/config/`,
promover sus dependencias a directas, reescribir los scripts npm). Cuanto antes se ejecute esa
migracion, mas barata sale: hoy solo la tocan 5 archivos de configuracion; cada etapa que pasa
sin migrar aumenta ligeramente el costo de la migracion futura, aunque el radio de impacto se
mantiene acotado a esos mismos archivos.

**Senal de alerta:** una vulnerabilidad de seguridad reportada en una dependencia que
festack-scripts ya no pueda actualizar, o un cambio de mayor en Next.js/Vitest/ESLint que
festack-scripts no vaya a soportar por estar congelado.

---

### R17 — CES aun no esta aprobado para este proyecto

**Probabilidad:** media · **Impacto:** alto si se materializa tarde

El correo transaccional sale por **CES** (Church Email Service), un servicio REST corporativo
—`POST` de un JSON con autenticacion basica— y no por SES. La decision lo saca por completo de
la infraestructura: no hay identidad que verificar ni permiso de IAM que otorgar, solo una URL y
credenciales. Pero **la aprobacion de uso todavia no existe**.

**Por que importa:** sin correo, un adjudicado no se entera de que gano, y su plazo de
liquidacion corre igual (R-13). Es el unico camino por el que el sistema le habla al
participante.

**Mitigacion:** el patron outbox (D-6) ya aisla el envio de la transaccion critica, asi que un
CES ausente **no bloquea adjudicar**: los mensajes se acumulan en la tabla y se despachan cuando
el servicio exista. Eso convierte un bloqueo en una demora. El adaptador de CES se construye en
la Etapa 10 detras de una interfaz propia, de modo que sustituirlo por SES —o por cualquier
otro proveedor— sea cambiar un archivo. Gestionar la aprobacion es tarea del operador y conviene
iniciarla mucho antes de la Etapa 10.

**Senal de alerta:** llegar a la Etapa 10 sin aprobacion, o sin la URL y las credenciales de un
entorno de prueba.

---

### R18 — Carrera FIFO: un turno mayor puede ganar la adjudicacion — **cerrado**

**Probabilidad:** alta · **Impacto:** critico · **Estado:** cerrado por el prototipo concurrente

T1 asignaba el turno con un `ADD` (paso 1) y hacia visible la solicitud con un `Put` en otra
operacion (paso 2). Entre ambos habia una ventana en la que el turno existe pero **la fila no lo
ve**. Con adjudicacion inmediata, el turno 2 completa su paso 2, dispara la adjudicacion y gana
el vehiculo mientras el turno 1 sigue en vuelo.

Rompe R-08 —"el orden manda sobre el tiempo"— que es la regla en la que descansa la equidad de
todo el sistema. La ventana es de un viaje de red, pero el momento de maxima concurrencia es
exactamente `inicioVenta`.

No confundir con la no-idempotencia de los contadores atomicos: eso produce **huecos**, que el
diseno ya acepta y que no rompen ninguna invariante.

**Resuelto asi:** el prototipo (`npm run prototipo:fila`) reprodujo el defecto de forma
determinista, **descarto** el mecanismo que este plan proponia —anotar la reserva en el item del
lote, que cancelaba entre 5 y 9 de cada 10 solicitudes concurrentes con `TransactionConflict`— y
valido el que lo sustituye: la reserva como **item propio**, escrita antes de pedir el turno y
borrada dentro de la transaccion del paso 2. T1 y T2 quedaron reescritos en
`modelo-datos-dynamodb.md`.

**Lo que queda por hacer:** implementarlo en la Etapa 8 sobre el `solicitarCompra.ts` real, con
la prueba de concurrencia permanente en la compuerta. El prototipo no la sustituye.

**Senal de alerta, confirmada:** una prueba de concurrencia que crea las N solicitudes y solo
despues llama a adjudicar pasa en verde con el defecto presente — ocurrio en las once rondas
medidas. La prueba de la Etapa 8 tiene que intercalar y pausar deliberadamente.

### R19 — El contrato de EAS no esta confirmado

**Probabilidad:** alta · **Impacto:** medio

Esta confirmada la **semantica** —se pregunta por permisos, EAS responde un booleano por cada
uno— pero no los nombres de permiso, la ruta ni la forma del sobre HTTP. El catalogo de siete
permisos de `permission-matrix.md` seccion 1 es una propuesta.

**Mitigacion:** el parseo vive aislado en `src/lib/auth/easAdapter.ts`; nada mas deberia cambiar.
El modo `ENABLE_DEV_TOOLS` desbloquea todo el desarrollo mientras tanto. **[OPERADOR]** confirmar
nombres y contrato con el equipo de EAS antes de la Etapa 12.

**Senal de alerta:** `ErrorConsultaEas` con causa `respuesta_invalida` al primer intento contra el
EAS real — es exactamente el sintoma que la regla "un permiso ausente es error, no `false`" existe
para hacer visible.

### R20 — La bitacora es sobrescribible por codigo de la propia aplicacion

**Probabilidad:** baja · **Impacto:** alto

El `Deny` de IAM cierra `UpdateItem`, `DeleteItem` y `BatchWriteItem` sobre `AUDIT#`, pero **no
puede cerrar `PutItem`**: la regla 4 obliga a escribir el evento en la misma transaccion que la
mutacion, asi que el permiso tiene que existir. Un `Put` con la misma clave reemplaza el item
completo. Comprobado contra AWS real en `amplify/auditoriaInmutable.integracion.test.ts`.

`attribute_not_exists(PK)` en cada `Put` de evento lo contiene frente a un **error de codigo**. No
lo contiene frente a codigo que omita la condicion a proposito.

**Mitigacion:** la condicion, ya documentada en las siete transacciones. La garantia fuerte exige
sacar la bitacora del alcance de la aplicacion — DynamoDB Streams hacia un sumidero append-only
(S3 con Object Lock o equivalente) — y se evalua en la **Etapa 11**.

**Senal de alerta:** un `PutCommand` sobre una clave `AUDIT#` sin `ConditionExpression`.

---

## Registro de decisiones

| Fecha | Decision | Alternativa descartada |
| --- | --- | --- |
| 2026-09-04 | Amplify Gen2 + DynamoDB | Terraform + ECS + PostgreSQL, que es el precedente de la organizacion. Se asume el riesgo R1 |
| 2026-09-04 | TypeScript `strict` con `tsconfig` y `typecheck` propios | JavaScript con JSDoc, como el proyecto hermano |
| 2026-09-04 | Varias filas simultaneas, **una sola adjudicacion activa** por participante | Sin limite (riesgo de acaparamiento); una sola solicitud por convocatoria (demasiado restrictivo) |
| 2026-09-04 | Plazo de liquidacion en **horas naturales** | Horas habiles con calendario de festivos de Mexico |
| 2026-09-04 | Mantener `@churchofjesuschrist/festack-scripts` pese a su deprecacion reciente | Migrar de inmediato a eslint/prettier/stylelint/vitest directos, pese a que el costo hoy es minimo (riesgo R16) |
| 2026-09-04 | `typescript` fijado a `6.0.3` exacto | Ultima version publicada (`7.0.2`): rompe `typescript-eslint@8.69` (`peerDependency typescript: >=4.8.4 <6.1.0`), confirmado ademas por el propio changelog de festack-scripts 27.0.7 |
| 2026-09-04 | `participanteId` = `oktaSub` hasta la Etapa 4 | Construir el *upsert* en DynamoDB ahora, adelantando parte de la Etapa 4 dentro de la Etapa 2 (rompe la separacion de capas de `CLAUDE.md`) |
| 2026-09-04 | CSP con nonce por peticion en `script-src`; `style-src` con `unsafe-inline` | `style-src` con nonce tambien: mas estricto, pero arriesga romper visualmente componentes Eden cuyo uso de estilos en linea no se pudo verificar (sin acceso al MCP de Eden en este entorno) |
| 2026-09-04 | GSIs 2, 3 y 4 con proyeccion `ALL` | `INCLUDE` con lista de atributos: mas barato, pero la proyeccion de un GSI **no se puede modificar** despues de creado y las pantallas que la consumen aun no existen. Estrechar es una optimizacion para la Etapa 12 |
| 2026-09-04 | Rol de computo SSR creado en la pila, adjuntado a mano en la consola | Crearlo tambien a mano: dejaria el `Deny` de la bitacora fuera del repositorio, en un procedimiento que se puede omitir |
| 2026-09-04 | `esbuild` como dependencia directa de desarrollo | Depender de Docker Desktop para empaquetar el Lambda del barrido, que en una maquina corporativa puede no existir |
| 2026-09-04 | Llave **publica** de CloudFront versionada en el repositorio | Inyectarla por variable de entorno: los PEM multilinea en variables son fragiles, y rotar la llave invalidaria todas las URLs firmadas vigentes |
| 2026-09-04 | Correo por **CES** (REST corporativo), no por SES | Amazon SES: era lo planeado en la Etapa 0, pero no hay configuracion ni aprobacion para usarlo. Saca el correo de la infraestructura por completo (riesgo R17) |
| 2026-09-04 | Importaciones relativas con extension **`.ts`** literal en `amplify/backend.ts`, mas `allowImportingTsExtensions` | Sin extension (como documenta Amplify) y con `.js` (la convencion ESM de TypeScript): **ninguna de las dos funciona**, porque `ampx` ejecuta el archivo con el type stripping de Node 24, que no completa extensiones ni mapea `.js` a `.ts` |
| 2026-09-04 | **Autorizacion por permisos, no por roles** (D-9). EAS responde un booleano por permiso | RBAC con la lista de roles en el codigo, que era el modelo de la Etapa 2: EAS no puede entregar roles, y congelaba politica organizacional en el repositorio. Tambien se descarto el `deny-override` ("quien administra nunca compra"): mismo defecto, y volveria inexpresable el caso legitimo de que la organizacion decida permitirlo |
| 2026-09-04 | Siete permisos a granularidad de **capacidad** | Un permiso por accion (33): mas fino, pero fragmenta capacidades que en la practica se conceden juntas y multiplica el costo de configuracion en EAS |
| 2026-09-04 | Guardas cerradas por omision: toda precondicion exige `=== true` | Contexto tipado por accion (33 tipos), que el diagnostico externo proponia: mas seguro en compilacion, pero mucho mas costoso. La invariante 8 —quitar un campo a la vez y exigir denegacion— cubre la misma clase de defecto y ademas atrapa los futuros |
| 2026-09-04 | `attribute_not_exists(PK)` en cada `Put` de evento, mas sumidero append-only en la Etapa 11 | Confiar solo en el `Deny` de IAM, que es lo que afirmaban tres documentos: **es falso**, `PutItem` sobrescribe y no se puede denegar sin romper la regla 4 |
| 2026-09-04 | ~~`ConditionCheck` sobre la convocatoria dentro de la transaccion de T1~~ — **revertida el 2026-09-05**, ver abajo | Confiar en los atributos desnormalizados del lote: una publicacion por tandas interrumpida deja lotes comprables bajo una convocatoria sin publicar |
| 2026-09-04 | `style-src` y `font-src` autorizan el origen del Font Foundry | Mantener `self`: bloquea la hoja de estilo remota de `<Fonts>` de Eden y sus woff2, y ni `build` ni jsdom lo detectan porque no aplican CSP |
| 2026-09-05 | Reserva de turno como **item propio** `LOTE#<id>/RESERVA#<id>`, escrita antes del contador | Anotarla como atributo mapa del item del lote, que era el mecanismo que este plan proponia: cierra la carrera igual, pero mete el item del lote en la transaccion de toda solicitud y DynamoDB las cancela con `TransactionConflict` — medido, entre 5 y 9 de cada 10 |
| 2026-09-05 | Publicacion parcial cerrada por **orden de propagacion** en T8: convocatoria primero al publicar, lotes primero al ocultar | El `ConditionCheck` sobre la convocatoria en T1 (decidido el 2026-09-04): correcto, pero el item lo comparten todas las solicitudes de la convocatoria y un `ConditionCheck` lo retiene igual que una escritura — cancelaba entre 5 y 7 de cada 10 |
| 2026-09-05 | El paso 1 admite fila con el lote `EN_OFERTA` **o** `ADJUDICADO` | Exigir `EN_OFERTA`, como decia el modelo de datos: cierra la fila en la primera adjudicacion, que ocurre a los segundos de `inicioVenta`, y vuelve inalcanzables R-17, R-15, `miPosicion` y `tamanoFila` |
| 2026-09-05 | El prototipo se **omite** en la compuerta, tras la bandera `PROTOTIPO_R18` | Dejarlo en `verify:rapido`: son dos minutos contra AWS en cada iteracion, que deshace la decision que creo `verify:rapido`. No es prueba de regresion sino registro reproducible de una decision; la regresion permanente la aporta la Etapa 8 |
