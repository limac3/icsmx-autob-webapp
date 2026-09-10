# Plan de Ejecucion — icsmx-autob-webapp

Fuente de verdad del avance del proyecto. Cada etapa se marca `[x]` solo cuando **todos** sus
entregables estan hechos y su compuerta de calidad pasa en verde.

> Ultima actualizacion: 2026-09-08 — **Etapas 0 a 10 completadas**, incluida la Etapa 2.1 de
> correcciones (autorizacion por permisos, guardas cerradas por omision, CSP y bitacora), el
> **prototipo concurrente de la fila**, que cierra el riesgo **R18** y corrige T1, T2 y T8 del
> modelo de datos, la **Etapa 5 (administracion de vehiculos)**, la **Etapa 6 (convocatorias:
> ciclo completo de borrador a publicada, con lotes y aprobacion)**, la **Etapa 7 (catalogo de
> participante, gating triple siempre 404, sin cache estatica)**, la **Etapa 8 (motor de fila:
> turno por contador atomico, adjudicacion por escritura condicional, R-07, R-09, R-17 y R-18,
> con prueba de concurrencia permanente contra DynamoDB real)**, la **Etapa 9 (comprobante y
> tesoreria: T3/T4/T6 con GSI2 disperso para la bandeja, descarga por Route Handler nunca por
> CloudFront, T6 corregido a la estrategia de T5b, probada contra DynamoDB y S3 reales)** y la
> **Etapa 10 (vencimientos: T5 atomico con la variante reducida corregida para liberar tambien
> el vehiculo, barrido programado con recuperacion de lotes huerfanos, verificacion perezosa en
> `consultarMiLugar`, outbox de correo encolado en la misma transaccion que la adjudicacion,
> cerrando los riesgos **R6** y **R8**, probada contra DynamoDB real con la prueba de
> concurrencia permanente de la regla 16)**. Se agrego tambien la **Etapa 2.2 (impersonacion de
> identidad en desarrollo: roster cerrado de personas, cookie por navegador y conmutador en el
> layout — lo que hace recorrible el dictamen de convocatorias y la fila con varios
> participantes)**, la **Etapa 10.1 (armazon: `WorkforceHeader`, `WorkforceFooter` y menu de
> navegacion que declara la accion que abre cada seccion en vez de copiar la lista de permisos)**
> — dos etapas que no estaban en el plan original — y la **Etapa 11 (auditoria: bitacora
> filtrable por agregado, reconstruccion de fila con identidades, verificacion de integridad
> recalculada desde el evento crudo y contrastada contra el estado vigente de la tabla, y
> exportacion a CSV auditada en el momento de la descarga; riesgo **R20** evaluado y diferido con
> justificacion, no cerrado)**.
>
> La **Etapa 12 queda parcial, y su division es limpia**: lo que es codigo, configuracion o
> analisis esta hecho y probado —observabilidad con trazas por `correlacionId`, seis alarmas de
> CloudWatch verificadas por sintesis (que **cierran R6**), cabeceras de seguridad con la CSP ya
> revisada en lugar de diferida, inventario de accesibilidad, revision de costos y capacidad de
> DynamoDB, y el arnes de la prueba de carga—; lo que consiste en *mirar la aplicacion corriendo*
> —navegador, AWS desplegado, correo entregado, cada runbook ejecutado una vez— sigue
> **`[OPERADOR]`**, bloqueado por las mismas credenciales que bloquean la verificacion visual de
> las Etapas 5 a 11.
> Siguiente: **cerrar los puntos `[OPERADOR]` de la Etapa 12** — ninguno es codigo.

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
- [x] Ningun archivo del negocio importa `Rol` — **el `grep` a mano de esta etapa afirmaba
      "ningun archivo fuera de `rolesSimulados.ts`", y eso nunca fue cierto: `eas.ts` lo importa
      desde el primer dia para leer `DEV_TOOLS_MOCK_ROLES`.** La invariante que si se sostiene es
      que el rol no cruza de `src/lib/auth` hacia el negocio. Automatizada en la Etapa 2.2
      (`rolesSimulados.test.ts`), que es lo que la vuelve una compuerta permanente en vez de una
      revision manual

**Salida esperada:** autorizacion que no codifica politica organizacional, falla cerrada y tiene
pruebas que fallan cuando el defecto vuelve.

---

## Etapa 2.2 — Impersonacion de identidad en desarrollo ✅

> **Por que existe esta etapa.** No estaba en el plan. `identidad-autorizacion.md` 4.1 dejaba el
> modo `FULL` descrito pero sin implementar —"la UI para elegir el rol simulado no existe todavia
> y se construye cuando exista una pantalla que la necesite"—, y con las Etapas 6 a 10 cerradas
> esa pantalla ya son ocho. Al intentar recorrer el flujo completo en local aparecio que el hueco
> no era de comodidad sino de **alcance**: hay dos guardas que no dependen de ningun permiso,
> sino de la identidad, y con una sola sesion de Okta son **inalcanzables**.
>
> 1. `convocatoria:aprobar` deniega `self_approval` cuando `creadoPor === participanteId`. Quien
>    crea una convocatoria no puede aprobarla, asi que **el dictamen no se puede probar** por
>    muchos permisos que se simulen.
> 2. La fila FIFO no tiene orden con un solo participante: sin turno 2 no hay congelamiento, ni
>    cancelacion con reasignacion, ni vencimiento que reasigne a nadie.
>
> Cambiar `DEV_TOOLS_MOCK_ROLES` y reiniciar no resuelve ninguna de las dos: cambia los permisos,
> no el `participanteId`.

**Objetivo:** poder recorrer el flujo completo en local —alta, dictamen, publicacion, fila,
comprobante, tesoreria— cambiando de actor sin reiniciar y con varios participantes a la vez.

**Dependencias:** Etapa 2.1. Implementada despues de la Etapa 10, pero pertenece a identidad.

- [x] `src/lib/auth/personasSimuladas.ts` — roster **cerrado en codigo** de siete personas, cada
      una con `id`, `participanteId`, `nombre`, `correo` y roles. `participanteId` con prefijo
      `dev-` para que la bitacora del sandbox delate al actor simulado; correos en un dominio
      `.invalid` (RFC 2606) para que un despacho accidental del outbox no alcance a nadie real
- [x] `src/lib/auth/impersonacion.ts` — cookie `autob_persona_simulada`, que **solo lleva el
      `id`** y se valida contra el roster; un id desconocido se ignora y se cae al
      comportamiento por variables de entorno
- [x] `session.ts` — la persona sustituye `participanteId`, `nombre`, `correo` y `permisos`;
      **`oktaSub` conserva el valor real** y la sesion de Okta se sigue exigiendo primero
- [x] `src/app/actions/devTools.ts` — `cambiarPersonaSimulada`. No pasa por `puedeEjecutar`: no
      hay permiso que la cubra ni debe haberlo (regla 17). Su compuerta son tres condiciones
      simultaneas: modo `FULL`, `NODE_ENV` distinto de `production` y sesion real de Okta
- [x] `src/components/BarraDeIdentidadSimulada.tsx` — conmutador en el layout raiz, colapsado,
      con `Drawer`/`Summary` de Eden. **Un solo `<form>` con un boton de envio por persona**, asi
      que funciona sin una linea de JavaScript de cliente y no necesita `"use client"`
- [x] `src/components/PanelDeIdentidadSimulada.tsx` — lectura de sesion y roster, dentro de un
      `<Suspense>` del layout; devuelve `null` si el modo no es `FULL`, si no hay sesion o si la
      lectura falla
- [x] Diccionarios: seccion `desarrollo` en `es` y `en`. Las personas se describen por sus
      **permisos traducidos**, nunca por su rol ni por ENUMs crudos (regla 11)
- [x] `rolesSimulados.test.ts` — automatiza la invariante del rol que la Etapa 2.1 verificaba a
      mano, y corrige su enunciado
- [x] `.env.local.example` — `FULL` documentado con la razon por la que hace falta

**Verificacion:**

- [x] Compuerta de calidad completa en verde
- [x] `axe` sin violaciones sobre la barra (via `genericTests`)
- [x] La cookie no puede conceder nada fuera del roster: id desconocido, vacio e inventado
      cubiertos por prueba
- [x] `FULL` en produccion **lanza** antes de conceder una sola identidad simulada
- [x] En `MOCK_USERS` y en `OFF` la cookie **no se lee siquiera**, asi que no puede volver
      dinamica una pantalla que no lo era
- [x] Sin sesion de Okta no hay impersonacion: se comprueba que la cookie no se consulta
- [x] El roster alcanza el catalogo completo de permisos, y separa en identidades distintas a
      quien administra convocatorias de quien las aprueba — sin eso el dictamen seguiria sin
      poder probarse
- [ ] **[OPERADOR]** recorrido manual del flujo completo con el conmutador. Exige el login real
      contra Okta, que sigue siendo el pendiente de la Etapa 2

**Salida esperada:** el flujo completo recorrible en local, y la impersonacion imposible de
activar en produccion.

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

- [x] `src/lib/convocatorias/` — crear, editar, incluir vehiculo, retirar vehiculo, enviar a
      aprobacion, aprobar, rechazar, publicar, ocultar, reactivar, concluir
- [x] `src/app/actions/convocatorias.ts` — once actions tipadas y tres adaptadores de formulario
- [x] Creacion del **lote** (vehiculo dentro de convocatoria) con su contador de turnos en cero
- [x] Maquina de estados aplicada en servidor: toda transicion valida contra `transiciones.ts`
- [x] Un aprobador no puede aprobar una convocatoria que el mismo creo — guarda en `permisos.ts`,
      exigida de nuevo en el servicio, y la interfaz **explica** por que no ofrece los botones
- [x] Publicacion programada: la segunda pata del gating (`yaPublicada`) esta implementada y
      probada al milisegundo. **La pantalla que la consume es de la Etapa 7**, donde esta la
      prueba de que no se ve por URL directa
- [x] `revalidateTag` al publicar (ver riesgo R4) — `updateTag` en Next 16, con prueba de que
      publicar tira `convocatorias:visibles` y de que editar un borrador **no** lo hace
- [x] Un vehiculo puede incluirse en mas de una convocatoria, pero **no en dos activas a la vez**
- [x] Pantallas de administracion y de aprobacion
- [x] Tests de transiciones validas e invalidas y de autorizacion por permiso

**Verificacion:**

- [x] Compuerta de calidad completa en verde
- [x] Toda transicion invalida es rechazada por el servidor, no solo oculta en la UI
- [x] Cada transicion escribe su evento de auditoria

**Salida esperada:** ciclo completo de convocatoria de borrador a publicada. **Cumplida.**

**Decisiones que se tomaron aqui y no estaban en el plan:**

- La **vista de dictamen no tiene ruta propia**. `/aprobaciones` es la bandeja; el dictamen
  ocurre en `/admin/convocatorias/[id]`, cuyas acciones ya salen de la maquina de estados y del
  permiso de quien mira. Duplicar la pantalla daria dos vistas del mismo dictamen que se
  separarian al primer cambio (`ui-ux-requerimientos.md` 5).
- Accion nueva `convocatoria:ver-aprobaciones` (`Autob_Aprobar_Convocatorias`), para que la
  bandeja tenga puerta propia. No revela nada que `ver-administracion` no muestre ya.
- El selector de vehiculos usa `<option>` nativo dentro del `Select` de Eden: su `Option` deduce
  el valor con `value || children` y la opcion vacia enviaria su etiqueta como identificador
  (`desafios-implementacion.md` 28).
- La descripcion es HTML desde que se captura con editor enriquecido, asi que los listados
  muestran un **resumen en texto plano** (`textoPlanoDeDescripcion`). El render con formato llega
  en la Etapa 7, con `eden-html-fragment`.

**Fuera de esta etapa a proposito:** la vista administrativa del lote
(`ui-ux-requerimientos.md` 4.5) muestra adjudicacion vigente, `venceEn` y `tamanoFila`, que los
escribe el motor de fila. Aqui habria sido una pantalla de campos vacios sin nada que probar;
esta anotada en la **Etapa 8**.

**Pendiente heredado por el operador:** comprobacion de punta a punta del ciclo completo contra
el sandbox, que depende de credenciales.

---

> **Pendiente heredado de la Etapa 6, cerrado en la Etapa 7.** La descripcion de participacion se
> guarda como HTML del editor enriquecido, validado contra lista de permitidos en el servidor.
> `eden-html-fragment` la renderiza sin `dangerouslySetInnerHTML` en `/convocatorias/[id]`. **No
> filtra** —se midio, ver `desafios-implementacion.md` 27—, pero con la lista de permitidos
> aplicada al guardar, lo almacenado ya es seguro.

## Etapa 7 — Catalogo para participantes ✅

**Objetivo:** que un participante vea exactamente lo que le corresponde ver, y nada mas.

**Dependencias:** Etapa 6.

- [x] Listado de convocatorias visibles con **gating triple en servidor** (regla 8):
      `estatus = PUBLICADA`, `publicadaEn <= ahora`, y tipo `EMPLEADOS` solo para `EMPLEADO`.
      `listarConvocatoriasVisibles` (PA-05): `Query` GSI2 con `gsi2.cotaSuperiorPorFecha` como
      cota superior inclusiva (`desafios-implementacion.md` 29) y tipo filtrado en memoria
- [x] Detalle de convocatoria con la hora de inicio de venta en zona horaria de negocio
      (`/convocatorias/[id]`), descripcion completa con `eden-html-fragment` (pendiente
      heredado de la Etapa 6)
- [x] Detalle de vehiculo con galeria de fotografias (`eden-media-thumbnail-gallery`) —
      `/convocatorias/[id]/lotes/[loteId]`, con `GaleriaPublica` y URLs firmadas en SSR
- [x] Cuenta regresiva a la apertura de venta, calculada contra hora de servidor —
      `CuentaRegresiva`: el servidor calcula los segundos iniciales, el cliente solo decrementa,
      y al llegar a cero revalida con `router.refresh()` (nunca habilita nada localmente)
- [x] Mobile-first: `CardView` en movil, tabla en desktop (regla 12) en el listado; la rejilla
      de lotes usa `eden-grid` (1/2/3 columnas por breakpoint), que ya es mobile-first por diseno
- [x] Etiquetas por diccionario, sin ENUMs crudos (regla 11) — seccion `catalogo` nueva en
      `es.json`/`en.json`
- [x] Sin cache estatica en rutas que dependen de `publicadaEn` (regla 14) — las tres rutas
      nuevas usan `dynamic = "force-dynamic"`, igual que las pantallas administrativas
- [x] Tests de gating: sin `Autob_Venta_a_empleados` **no** se ve una convocatoria de empleados
      aunque se conozca la URL directa — cubierto por la invariante 4 de
      `permission-matrix.md` (ya probada desde la Etapa 2.1) mas los tests nuevos de
      `listarConvocatoriasVisibles`. Las paginas nuevas no discriminan por codigo de error:
      **cualquier** fallo de `exigirPermiso` termina en `notFound()`, nunca en `forbidden()`

**Verificacion:**

- [x] Compuerta de calidad completa en verde — 1308 pruebas, `typecheck` y `build` limpios
- [x] Acceso directo por URL a una convocatoria no publicada devuelve 404, no el contenido —
      por construccion: las paginas de detalle solo comprueban `permiso.ok`, nunca la razon
- [x] Ninguna respuesta incluye datos de convocatorias que el usuario no deberia ver — el
      gating ocurre **dentro** de la consulta (PA-05), nunca como filtro posterior
- [x] Revision de accesibilidad con axe sin violaciones — `genericTests` en los cinco
      componentes nuevos (`CatalogoConvocatorias`, `RejillaDeLotes`, `GaleriaPublica`,
      `FichaTecnicaVehiculo`, `CuentaRegresiva`)

**Salida esperada:** catalogo navegable y correctamente restringido. **Cumplida.**

**Decisiones que se tomaron aqui y no estaban en el plan:**

- **El bloque de accion de la pantalla 3.3 no se construye en esta etapa.** "Solicitar
  compra", el lugar en la fila y el plazo de pago (`ui-ux-requerimientos.md` 3.4) dependen de
  `MiLugarDTO` y de `solicitarCompra`, que la Etapa 8 no ha escrito todavia. Antes de esa etapa
  no existe ninguna solicitud, asi que ese bloque habria sido botones que siempre responden
  `invalid_state` o un estado vacio sin nada que probar — el mismo argumento que dejo fuera la
  vista administrativa del lote en la Etapa 6. Lo que si se construyo —galeria, identificacion,
  ficha tecnica y el aviso de fase de venta— no depende de la fila y ya es util hoy
- **`tamanoFila` se lee con la misma `Query` `Select: COUNT` que usara la Etapa 8**
  (`consultarTamanoFila`, PA-07), no con un `0` fijo. Antes de la Etapa 8 no existe ningun item
  `SOL#`, asi que hoy siempre cuenta cero — pero es la lectura real, no un valor de relleno que
  habria que recordar reemplazar despues
- **El conteo de lotes del listado (`cantidadDeLotes`) se resuelve con una lectura por
  convocatoria** (`obtenerConvocatoria`, PA-04), igual que el detalle administrativo hace con los
  vehiculos de sus lotes. No hay un contador desnormalizado en la convocatoria: el volumen es el
  mismo "decenas" que ya acepta `modelo-datos-dynamodb.md` para el listado administrativo
- **`gsi2.cotaSuperiorPorFecha`** se agrego a `claves.ts` porque `GSI2SK <= ahora` a secas
  excluye por error un item publicado en el mismo instante (`desafios-implementacion.md` 29):
  `GSI2SK` es `<fecha>#<id>` y la cadena con sufijo ordena despues que su propio prefijo
- **`eden-accordion`, `eden-media-thumbnail-gallery` y `eden-html-fragment`** se instalaron en
  esta etapa: son los tres paquetes que la pantalla 3.3 exigia y que no tenian consumidor hasta
  ahora. `eden-html-fragment` cierra ademas el pendiente heredado de la Etapa 6 (mostrar la
  descripcion enriquecida sin `dangerouslySetInnerHTML`)

**Pendiente heredado por el operador:** ninguno nuevo. El recorrido de punta a punta contra el
sandbox sigue las mismas credenciales que ya bloquean las Etapas 5 y 6.

---

## Etapa 8 — Motor de fila y adjudicacion ✅

> **Etapa de mayor riesgo tecnico del proyecto.** Aqui vive la equidad del sistema.
> Se recomienda trabajarla con el modelo mas capaz disponible.

**Objetivo:** que el orden de la fila sea justo, verificable e imposible de manipular.

**Dependencias:** Etapa 7.

- [x] **Prototipo concurrente primero** (riesgo R18) — hecho antes de esta etapa.
      `src/lib/fila/prototipoDeFila.ts` mas su prueba de integracion contra el sandbox
      (`npm run prototipo:fila`, 20 pruebas). Reprodujo el defecto de forma determinista,
      descarto el mecanismo que este plan proponia y valido el que lo sustituye. **T1 quedo
      reescrito**; los tres hallazgos estan en `desafios-implementacion.md` seccion 17
- [x] **Cerrar las filas al concluir (R-18)** — lo que la Etapa 6 dejo declarado.
      `concluirConvocatoria` ya cierra los lotes, libera los centinelas y devuelve los vehiculos
      a `DISPONIBLE`, pero **no toca las solicitudes**: en la Etapa 6 no existen todavia, asi que
      ese codigo no habria tenido ninguna prueba que lo ejercitara. Falta que las `EN_FILA` y
      `CONGELADA` pasen a `NO_ADJUDICADA`, y que una adjudicacion `ADJUDICADA` o
      `EN_VERIFICACION` **sobreviva con su plazo intacto** — quien gano antes del cierre tiene
      derecho a terminar de pagar. Sin esto, concluir deja participantes en una fila que ya no
      va a avanzar
- [x] `src/lib/fila/solicitarCompra.ts` — en **tres escrituras**, segun T1 de
      `modelo-datos-dynamodb.md` ya corregido por el prototipo:
  - [x] `Put` de la reserva de turno `LOTE#<id>/RESERVA#<reservaId>` **antes** del contador.
        El orden es la garantia: al reves queda abierta la ventana de R18
  - [x] `ADD` atomico al contador de turnos **del lote** para obtener `turno` (regla 3).
        No puede ir en la transaccion: `TransactWriteItems` **no devuelve valores**, asi que el
        turno que produce un `ADD` no se puede usar como clave de un `Put` de la misma
        transaccion
  - [x] Condicion del `ADD`: `(estatus = EN_OFERTA OR estatus = ADJUDICADO)` mas la ventana de
        venta. **No exigir `EN_OFERTA` a secas**: cerraria la fila en la primera adjudicacion y
        haria inalcanzable R-17
  - [x] Item de solicitud con `turno`, `solicitadoEn` informativo y estado `EN_FILA`
  - [x] Condicion de unicidad: el participante no puede tener dos solicitudes en el mismo lote
  - [x] `Delete` de la reserva dentro de la transaccion, con `attribute_exists(SK)`
  - [x] **Sin `ConditionCheck` sobre la convocatoria**: cancelaba entre 5 y 7 de cada 10
        solicitudes concurrentes. La publicacion parcial se cierra en T8, por orden de
        propagacion
  - [x] Evento de auditoria en la misma transaccion, con `attribute_not_exists(PK)` (regla 4)
  - [x] Compensacion de mejor esfuerzo: si el paso 1 o el paso 2 fallan, borrar la reserva
- [x] `src/lib/fila/adjudicar.ts` — adjudicacion por **escritura condicional**
      `attribute_not_exists(adjudicacionActual)`, jamas leer-y-decidir (regla 6)
  - [x] Abstencion previa por reservas vigentes (R18), leyendo **las reservas antes que la
        fila**. Esa lectura solo puede detener, nunca conceder
  - [x] Depuracion de reservas mas viejas que el umbral
  - [x] Reintento con jitter ante `TransactionConflict` sobre el item del lote: no dice quien
        gano, asi que decidir seria adivinar
- [x] Regla de una sola adjudicacion activa por participante: item de control y condicion
      adicional en la transaccion; las demas solicitudes del ganador pasan a `CONGELADA`
- [x] `src/lib/fila/consultarMiLugar.ts` — DTO que expone **unicamente** `miTurno`,
      `miPosicion` y `tamanoFila` (regla 7)
- [x] Cancelacion voluntaria del participante y su efecto sobre la fila
- [x] Pantalla de fila con el lugar propio y el tamano de la fila
- [x] **Vista administrativa del lote** `/admin/convocatorias/[id]/lotes/[loteId]/fila`
      (`ui-ux-requerimientos.md` 4.5), que la Etapa 6 dejo fuera a proposito: todo lo que muestra
      —adjudicacion vigente, `venceEn`, `tamanoFila`— lo escribe el motor de fila, y antes de
      esta etapa habria sido una pantalla de campos vacios sin nada que probar. Muestra
      **agregados, nunca identidades**: la fila completa es exclusiva del auditor
      (`permission-matrix.md` seccion 4)
- [x] `src/app/actions/fila.ts`

**Pruebas obligatorias de esta etapa** (regla 16):

- [x] **Concurrencia:** N solicitudes simultaneas sobre el mismo lote producen turnos
      **unicos y estrictamente crecientes**. Los huecos son legitimos: un turno consumido por
      una transaccion que despues falla no se reutiliza (ver seccion 6 de
      `modelo-datos-dynamodb.md`). La equidad depende del orden relativo, no de la contiguidad
- [x] **Adjudicacion unica:** N intentos simultaneos de adjudicacion producen exactamente
      **un** ganador
- [x] **Orden:** el ganador es siempre el de `turno` menor, nunca el de `solicitadoEn` menor
      (probar con timestamps deliberadamente desordenados)
- [x] **Intercalacion (R18):** la prueba debe entrelazar solicitud y adjudicacion, no adjudicar
      despues de que todas las solicitudes terminaron. Con esa segunda forma la carrera no se
      ejerce y el defecto pasa. **Confirmado por medicion:** en once rondas de rafaga contra el
      diseno defectuoso, la adjudicacion la gano el turno 1 todas las veces. La prueba de esta
      etapa debe incluir una pausa deliberada entre las escrituras, como hace el prototipo
- [x] **Sin rechazos por contencion:** N solicitudes simultaneas entran **las N**. Un
      participante rechazado con `conflicto_concurrencia` en `inicioVenta` es un defecto de
      diseno, no una carrera aceptable (desafios-implementacion.md seccion 17)
- [x] **Fila abierta con el lote adjudicado (R-17):** quien solicita despues de la primera
      adjudicacion obtiene turno y entra a la fila
- [x] **Privacidad:** test que **falla** si el DTO de fila contiene `participanteId`, correo o
      nombre de un tercero
- [x] **Auditoria:** cada solicitud y cada adjudicacion tiene su evento correspondiente
- [x] **Atomicidad:** si el evento de auditoria no se puede escribir, la mutacion no ocurre

Las diez viven en `src/lib/fila/fila.integracion.test.ts`, **contra DynamoDB real y sobre el
codigo de produccion**, y corren en la compuerta —no detras de una bandera como el prototipo—.
Un doble del cliente no puede decidir ninguna de ellas: solo comprobaria que el doble coincide
consigo mismo.

**Verificacion:**

- [x] Compuerta de calidad completa en verde — 1441 pruebas, `typecheck` y `build` limpios
- [x] Las pruebas de concurrencia corren repetidamente sin resultados intermitentes — cinco
      corridas completas del archivo de integracion, 20 de 20 cada vez. La duracion si varia
      (45 s a 143 s) porque la tabla bajo demanda estrangula la primera rafaga cuando lleva rato
      fria; el limite de la prueba se puso holgado para que esa lentitud no se lea como un fallo
- [x] Las dos rondas de rafaga usan participantes distintos, y eso importa: reusarlos hacia que
      R-09 congelara al ganador de la ronda anterior — el sistema acertaba y la prueba mentia
      (`desafios-implementacion.md` 30)

**Salida esperada:** motor de fila demostrablemente justo bajo concurrencia. **Cumplida.**

**Decisiones que se tomaron aqui y no estaban en el plan:**

- **T2 gano dos items.** La condicion del lote incluye `estatus = EN_OFERTA`, porque un lote
  `NO_VENDIDO` cierra sin `adjudicacionActual` y la condicion original lo habria dejado adjudicar
  despues de concluida la convocatoria. Y la transaccion lleva el vehiculo a `RESERVADO`: sin ese
  item ese estatus era inalcanzable y T4 no tendria transicion valida al vender
  (`modelo-datos-dynamodb.md` T2).
- **El congelamiento por R-09 escribe dos eventos**, no uno: `SOLICITUD_CONGELADA` explica el
  cambio de estado y `SOLICITUD_OMITIDA` explica, en la historia del lote, por que la
  adjudicacion siguio con un turno mayor. Sin el segundo, la comprobacion 2 de integridad veria
  un salto injustificado.
- **La cancelacion no usa la forma atomica de T5.** Libera en una transaccion y despues llama a
  T2, el mismo camino de cualquier solicitud nueva. T5 tiene que ser atomico porque lo dispara un
  barrido sobre un plazo vencido; aqui reutilizar T2 —con su abstencion, su congelamiento y sus
  reintentos— vale mas que replicar esa logica. La ventana que abre ya existe en el diseno
  (`modelo-datos-dynamodb.md` T5b).
- **El descongelamiento de R-09 se implemento aqui y no en la Etapa 10.** El plan lo situaba
  alla, pero la cancelacion —que es de esta etapa— tambien hace perder una adjudicacion: dejarlo
  para despues habria significado enviar la mitad congeladora de la regla sin la mitad que la
  deshace. `descongelarSolicitudes` lo reusaran T5 y T6.
- **`cancelarSolicitud` no recibe `solicitudId`.** Parte del centinela de fila, indexado por el
  participante de la sesion: cancelar la de otro deja de ser una guarda que alguien pueda olvidar
  y pasa a ser una clave que no se puede construir (`api-contracts.md` 4).
- **Las lecturas de la fila no son Server Actions.** `consultarMiLugar` y `consultarTamanoFila`
  los llaman los Server Components directamente, como el resto de las lecturas del sistema.
- **`identificadorDeSolicitud` vive en `claves.ts`.** No es una clave, pero es el `agregadoId` de
  la bitacora: si dos sitios lo derivaran distinto, la historia de una solicitud quedaria partida
  en dos, y como la bitacora es append-only, partida para siempre.

**Fuera de esta etapa a proposito:** `/mis-solicitudes` (`ui-ux-requerimientos.md` 3.5) y la
subida de comprobante. La pantalla del participante muestra `EN_VERIFICACION`, `VENDIDA` y el
plazo porque el DTO ya los distingue, pero **el boton de subir comprobante es de la Etapa 9**,
con tesoreria.

---

## Etapa 9 — Comprobante de pago y tesoreria ✅

**Objetivo:** cerrar la venta con el aval de tesoreria.

**Dependencias:** Etapa 8.

- [x] Subida del comprobante por el adjudicado → estado `COMPROBANTE_CARGADO`. No hay un boton
      "subir comprobante" separado: es la misma transicion que entra en verificacion (proyecto.md
      5.4), servida desde el bloque de accion de la pantalla 3.3/3.4 con un `ToolModal`
- [x] Paso a `EN_VERIFICACION`
- [x] Bandeja de tesoreria con las solicitudes pendientes de verificar — `/tesoreria/verificacion`
      (PA-11) mas su detalle `/tesoreria/verificacion/[solicitudId]`
- [x] Aval del pago → solicitud `VENDIDA` y vehiculo marcado como vendido
- [x] Rechazo del pago → solicitud `RECHAZADA_POR_TESORERIA` y liberacion del lote hacia el
      siguiente de la fila
- [x] Descarga del comprobante como Route Handler, con permiso verificado —
      `GET /api/comprobantes/[solicitudId]`, nunca por CloudFront
- [x] Cada transicion escribe su evento de auditoria con actor y motivo
- [x] Tests de autorizacion: solo `OPERADOR_TESORERIA` avala o rechaza; solo el adjudicado sube
      su propio comprobante — ya cubierto por la cobertura cartesiana de `permisos.test.ts`
      (Etapa 2.1, seccion 5 de `permission-matrix.md`), mas casos explicitos en
      `src/app/actions/tesoreria.test.ts`

**Verificacion:**

- [x] Compuerta de calidad completa en verde
- [x] Un participante no puede descargar el comprobante de otro —
      `src/app/api/comprobantes/[solicitudId]/route.test.ts`: 404, nunca 403
- [x] El rechazo libera correctamente el lote y reasigna al siguiente — probado contra
      DynamoDB y S3 reales en `src/lib/tesoreria/tesoreria.integracion.test.ts`

**Salida esperada:** venta cerrable de punta a punta. **Cumplida.**

**Decisiones que se tomaron aqui y no estaban en el plan:**

- **`correoTitular` se desnormaliza en la solicitud desde la sesion (T1).** No existe ningun
  perfil de participante persistido con correo — la Etapa 4 nunca implemento el *upsert* real
  (desafios-implementacion.md 8) —, asi que sin esta copia `PendienteDTO` no podria decirle a
  tesoreria a quien le pertenece un comprobante. Es una excepcion deliberada a R-12: el dato es
  del titular sobre su propia solicitud, no de un tercero (desafios-implementacion.md 31).
- **`loteYTurnoDesdeIdentificador` (`claves.ts`), el inverso de `identificadorDeSolicitud`.**
  Las tres actions de tesoreria reciben solo `solicitudId`, y ningun patron de acceso lee una
  solicitud sin conocer antes su `loteId`. En vez de un indice nuevo, se recupera del propio
  identificador — es derivado, no generado (desafios-implementacion.md 32).
- **GSI2 de la solicitud es disperso, como GSI4.** `subirComprobante` escribe
  `SOL_ESTATUS#EN_VERIFICACION`; `avalarPago` y `rechazarPago` la retiran. Sin eso, PA-11
  seguiria mostrando trabajo ya resuelto. El documento original de T4 no lo mencionaba —misma
  clase de correccion que T2 tuvo con `RESERVADO` (desafios-implementacion.md 32).
- **T6 no es "identica a T5".** Sigue la estrategia de T5b (liberar y volver a llamar a
  `adjudicarLote`), no la de T5 (un solo acto atomico): quien rechaza es una persona mirando la
  pantalla, no un barrido sobre un plazo vencido.
- **`rechazarPago` no retira el centinela de fila.** A diferencia de la cancelacion voluntaria,
  `RECHAZADA_POR_TESORERIA` tiene que seguir visible en `MiLugarDTO` con su motivo (R-16); por
  eso `MiLugarDTO` gana el campo opcional `motivoRechazo`, que **no** es una fuga de R-12 —es el
  motivo del **propio** rechazo del titular, no de un tercero.
- **Sin pantalla `/mis-solicitudes` nueva.** `ui-ux-requerimientos.md` 3.6 dice "`ToolModal`
  **desde el bloque de accion**"; la Etapa 8 ya deja `BloqueDeAccionDeLote` leyendo
  `EN_VERIFICACION`, `VENDIDA` y el plazo. Construir la pantalla 3.5 aparte habria sido una
  segunda vista de lo mismo sin nada nuevo que probar — el mismo argumento que ya evito una
  vista de dictamen separada para convocatorias (Etapa 6).
- **`avalarPago` reusa `cerrarFilaDelLote` (Etapa 8) para las solicitudes restantes.** El
  documento dice que pasan a `NO_ADJUDICADA` "fuera de la transaccion" sin detallar como; esa
  funcion ya lo hacia para R-18 y no necesita saber por que se esta cerrando la fila.

**Pendiente heredado por el operador:** ninguno nuevo. El recorrido de punta a punta contra el
sandbox sigue las mismas credenciales que ya bloquean las etapas anteriores.

---

## Etapa 10 — Vencimientos y reasignacion automatica ✅

**Objetivo:** que la fila avance sola cuando alguien no paga a tiempo.

**Dependencias:** Etapa 9.

- [x] `src/lib/fila/vencerYReasignar.ts` — cancela por vencimiento y adjudica al siguiente en
      **una sola** transaccion, con sus dos eventos de auditoria
- [x] Barrido programado **idempotente**: ejecutarlo dos veces no produce doble efecto
- [x] **Verificacion perezosa**: al leer una fila, si la adjudicacion vigente ya vencio, se
      resuelve en ese momento; el barrido es red de seguridad, no unica defensa (riesgo R6)
- [x] Descongelamiento de las solicitudes `CONGELADA` del participante que perdio su adjudicacion
      — **adelantado a la Etapa 8**: la cancelacion tambien hace perder una adjudicacion, y
      enviar la mitad congeladora de R-09 sin la que la deshace habria dejado a esos
      participantes fuera de sus otras filas para siempre. `src/lib/fila/descongelarSolicitudes.ts`
      lo reusan T5 y T6 sin cambios
- [x] **Recoger los lotes libres con fila viva.** T1 y la cancelacion no pueden adjudicar dentro
      de su propia transaccion —`TransactWriteItems` no devuelve valores—, asi que un proceso
      que muera entre las dos escrituras deja un lote `EN_OFERTA` con candidatos y sin nadie que
      dispare la adjudicacion. Hoy lo resuelve la siguiente solicitud; el barrido deberia
      recogerlo junto con los vencimientos (`modelo-datos-dynamodb.md` T5b)
- [x] `src/lib/correo/` — patron **outbox**: el correo se encola, nunca participa en la
      transaccion critica (riesgo R8)
- [x] Correo de adjudicacion con los datos de pago y el plazo
- [x] Reintentos con retroceso y registro de fallos permanentes
- [x] Tests: vencimiento exacto en la frontera, reasignacion en cadena por varios lugares de la
      fila, fila agotada sin siguiente candidato

**Verificacion:**

- [x] Compuerta de calidad completa en verde
- [x] Ejecutar el barrido dos veces seguidas no altera el resultado
- [x] Una caida del envio de correo no revierte ni bloquea la adjudicacion

**Salida esperada:** el ciclo de la fila avanza sin intervencion manual.

### Decisiones que se tomaron aqui y no estaban en el plan

- **La variante reducida de T5 tambien libera el vehiculo.** `modelo-datos-dynamodb.md` la
  describia sin ese `Update`; dejar el vehiculo `RESERVADO` mientras el lote vuelve a
  `EN_OFERTA` reproducia el propio defecto que esta etapa pide corregir ("lotes libres con fila
  viva"), pero de forma permanente en vez de una ventana de crash. Corregido y validado contra
  DynamoDB real: tras la fila agotada, un participante nuevo puede formarse y adjudicarse sin
  intervencion.
- **"Recoger lotes libres" se acota a convocatorias `PUBLICADA` y exige fila viva antes de
  llamar a `adjudicarLote`.** No hay GSI para "lotes `EN_OFERTA` con fila viva" y no se creo uno:
  la mayoria de los lotes `EN_OFERTA` en cualquier instante son inventario normal sin
  candidatos, y llamar a `adjudicarLote` sobre ellos sin filtrar escribiria un `FILA_AGOTADA`
  por cada barrido, para siempre. Se reusan PA-05 (convocatorias publicadas) y PA-04 (sus
  lotes), con una `Query COUNT` barata (`estatus = EN_FILA`) antes de intentar adjudicar.
- **Nuevo motivo de adjudicacion `RECUPERACION_POR_BARRIDO`.** Los cuatro motivos existentes
  describen quien disparo la adjudicacion (primera vez, o una reasignacion con causa conocida);
  un lote huerfano recuperado por el barrido no es ninguno de los dos —no es la primera vez que
  se intenta, y no se sabe con certeza que lo dejo sin dueno—, asi que se declaro un quinto valor
  en vez de forzarlo a uno existente.
- **`vencerYReasignar` reusa `leerFila` y `congelar` de `adjudicarLote.ts`**, exportados para la
  ocasion (antes solo salian por `__test__`): la logica de abstencion por reservas, lectura de la
  fila en orden y congelamiento por R-09 es identica a T2, y T5 solo le agrega dos escrituras del
  lado del vencido por delante. Duplicarla habria sido el error que la Etapa 9 ya evito con
  `cerrarFilaDelLote`.
- **El outbox se encola dentro de la misma transaccion de T2 y T5**, no despues: es lo unico
  que hace al correo tan garantizado como el evento de auditoria (regla 4 de `CLAUDE.md`).
  `itemsDeEncoladoAdjudicacion` devuelve una lista vacia sin `correoTitular` en vez de fallar —el
  correo nunca bloquea la adjudicacion (D-6)—.
- **Los reintentos de correo son el propio horario del barrido, no una espera dentro de la
  funcion.** Un mensaje que falla no se reintenta en la misma corrida; se deja `PENDIENTE` para
  la siguiente pasada, cada 5 minutos. `MAXIMO_INTENTOS_CORREO = 5` acota el fallo permanente a
  ~25 minutos. Un fallo no reintentable (401, 4xx) se declara permanente de inmediato, sin
  esperar esos cinco intentos.
- **`server-only` tuvo que instalarse como dependencia real.** El paquete no existia en
  `node_modules` —el proyecto dependia de que el plugin de TypeScript de Next.js lo resolviera
  como caso especial—, y `esbuild` (el empaquetador del Lambda de `defineFunction`) no tiene esa
  logica: fallaba con "Could not resolve 'server-only'" al empaquetar el barrido, que ahora
  reusa `src/lib` de verdad. Ver `desafios-implementacion.md`.
- **`amplify/tsconfig.json` ganó el alias `@/*`.** El barrido importa `src/lib` por ruta
  relativa (no por el alias, que ese `tsconfig` no comparte con el raiz), pero esos archivos
  usan `@/` internamente en todo el proyecto; sin el mapeo, `tsc -p amplify/tsconfig.json`
  fallaba en cascada al seguir esos imports.

---

## Etapa 10.1 — Armazon: encabezado, pie y navegacion por permiso ✅

> **Por que existe esta etapa.** El armazon estaba **especificado desde la Etapa 0**
> (`ui-ux-requerimientos.md` seccion 2: `WorkforceHeader`, contenido, `WorkforceFooter` y
> navegacion por permiso) pero **ninguna etapa lo reclamo como entregable**. La Etapa 1 dejo
> `layout.tsx` con solo `Normalize` y `Fonts`, y las Etapas 5 a 10 construyeron once pantallas
> encima de ese armazon vacio: sin encabezado, sin pie y sin forma de llegar a ninguna pantalla
> salvo escribiendo la URL.
>
> Es deuda de plan, no un requerimiento nuevo.

**Objetivo:** el armazon estandarizado de una aplicacion de fuerza laboral, con un menu que
solo ofrece lo que cada persona puede usar.

**Dependencias:** Etapa 2.1 (permisos) y las pantallas de las Etapas 5 a 9.

- [x] Paquetes: `eden-workforce-header`, `eden-workforce-footer`, `eden-contextual-menu`, en las
      mismas versiones que `icsmx-camp-webapp`
- [x] `src/app/layout.tsx` — rejilla `auto 1fr auto`; encabezado y pie cada uno en su
      `<Suspense>`, porque los dos leen datos de la peticion y ninguno debe retrasar el
      contenido. El contenido va en un `<div>`, no en un `<main>`: cada pantalla monta el suyo
- [x] `src/app/layout.css` — armado tomado de `PageWrapper.css` y `Main.css` del proyecto hermano
- [x] `src/lib/auth/permisos.ts` — `tieneCapacidad`, el primer tiempo de `puedeEjecutar` sin la
      guarda. `puedeEjecutar` lo invoca para su paso 1, asi que un solo lugar calcula la
      capacidad
- [x] `src/lib/navegacion.ts` — catalogo del menu. **Cada entrada declara la `Accion` que abre su
      puerta, no una lista de permisos**: asi el menu hereda los cambios de
      `permission-matrix.md` sin tocarse
- [x] `src/components/EncabezadoAplicacion.tsx` — Server Component que resuelve el menu; al
      cliente le pasa enlaces ya filtrados, nunca los permisos de la sesion
- [x] `src/components/MenuDeUsuario.tsx` — desplegable en el slot `tools`, con patron de
      divulgacion (`aria-expanded` + panel `<nav>`), no `role="menu"`
- [x] `src/components/PieAplicacion.tsx` — lee el idioma de la peticion antes de renderizar,
      porque `WorkforceFooter` llama a `new Date()`
- [x] Diccionarios: seccion `navegacion` en `es` y `en` (regla 11)
- [x] `ui-ux-requerimientos.md` seccion 2 reescrita: la tabla deriva de acciones, no de permisos
      — **la version anterior se habia despegado de la matriz** y afirmaba que `Autob_Auditar`
      solo abria "Auditoria", cuando concede tambien `vehiculo:ver-catalogo`,
      `convocatoria:ver-administracion` y `tesoreria:ver-bandeja`
- [x] `desafios-implementacion.md` seccion 35 — la trampa de resolver un menu con una accion que
      tiene guarda contextual

**Verificacion:**

- [x] Compuerta de calidad completa en verde
- [x] `axe` sin violaciones sobre el menu, abierto y cerrado
- [x] Cobertura permiso x seccion: cada permiso abre exactamente las secciones esperadas, y una
      sesion sin permisos ve el menu vacio conservando sus accesos de cuenta
- [x] **Ninguna entrada del menu usa una accion con guarda contextual** — la invariante que
      hace correcto comprobar solo la capacidad. Fue esta prueba, y no la revision visual, la
      que detecto que `convocatoria:ver-publicada` dejaba el catalogo oculto para todos
- [x] `tieneCapacidad` coincide con `puedeEjecutar` en toda accion sin guarda, y nunca concede
      donde `puedeEjecutar` deniega por falta de capacidad
- [x] Todo `href` del menu corresponde a una ruta que existe en `src/app`
- [x] Los permisos de la sesion no cruzan al cliente (verificado sobre las props del menu)
- [ ] **[OPERADOR]** revision visual en navegador: encabezado y pie de Eden dibujados, menu
      colapsando en movil. Ni `build` ni jsdom lo sustituyen

**Salida esperada:** las once pantallas ya construidas, alcanzables desde un menu que respeta
los permisos.

---

## Etapa 11 — Auditoria y cumplimiento ✅

**Objetivo:** que un auditor pueda demostrar que todo ocurrio con justicia y en orden.

**Dependencias:** Etapa 10.

- [x] Vista de auditor: bitacora completa por convocatoria, por lote, por vehiculo y por
      solicitud (`/auditoria`, `consultarBitacora`, PA-12). `agregado` + `agregadoId` en la URL
      con `<form method="get">`, sin JavaScript de cliente; tipo de evento, rango de fechas y
      participante se filtran en memoria sobre la historia completa de ese agregado
      (`eventoCoincideConFiltros`) — el mismo argumento de volumen que ya usa
      `listarPendientesVerificacion`
- [x] Reconstruccion de la fila de un lote: turnos, adjudicaciones y motivo de cada cambio
      (`/auditoria/lotes/[loteId]`, `reconstruirFila`, `reconstruirHistoriaDeFila` puro).
      `participanteId` sale del `actorId` de `SOLICITUD_CREADA`, sin ninguna lectura adicional
- [x] Verificacion de integridad: las seis comprobaciones de `trazabilidad-auditoria.md` 5.1,
      recalculadas desde el evento crudo — `verificarIntegridad`, `verificarIntegridadDeLote`
      puro. Contrasta la bitacora contra el estado **vigente** de la tabla (`leerFilaCompleta`,
      PA-07 sin filtrar por estatus — la capacidad detras de `fila:ver-completa`, declarada desde
      la Etapa 2.1 y sin consumidor hasta ahora)
- [x] Exportacion de la bitacora: CSV con los mismos filtros de la pantalla, via
      `Route Handler` (`/api/auditoria/exportar`)
- [x] Acceso de **solo lectura** con `Autob_Auditar`, sin ninguna action de mutacion — las cuatro
      acciones del catalogo (`auditoria:ver-bitacora`, `auditoria:ver-fila-historica`,
      `auditoria:exportar`) no llevan guarda contextual
- [x] Tests de que el auditor no puede mutar nada — la invariante 1 de `permission-matrix.md`
      (Etapa 2.1) ya cubre el catalogo completo y automaticamente cualquier accion nueva; se
      agrega que `exportarBitacora` no delega en ningun servicio de negocio

**Decisiones que se tomaron aqui y no estaban en el plan:**

- **`BITACORA_EXPORTADA` se escribe en el Route Handler de descarga, no en la Server Action.**
  El contrato original decia que la action lo emitia; moverlo evita que cualquiera con
  `Autob_Auditar` construya la URL de descarga a mano y exporte sin dejar rastro — mismo criterio
  que `COMPROBANTE_DESCARGADO`. `api-contracts.md` seccion 6 corregida
  (`desafios-implementacion.md` 36)
- **`consultarBitacora` devuelve `{ eventos, cursor? }`, no `EventoDTO[]` a secas.** El contrato
  declaraba `cursor` como entrada sin decir de donde salia el siguiente; sin un cursor de salida
  la paginacion no se puede completar. `api-contracts.md` corregido
- **La verificacion de integridad agrupa la bitacora por `correlacionId`, no evento por evento.**
  Una reasignacion por vencimiento escribe el cierre de un turno y la adjudicacion del siguiente
  en la misma transaccion, con el mismo `ocurridoEn` al milisegundo; su orden relativo en la `SK`
  lo desempata un ULID con parte aleatoria. Replay evento-por-evento podia ver la adjudicacion
  nueva antes que el cierre de la vieja y marcar, por un instante que nunca existio, dos
  adjudicaciones vigentes. Verificado por falsificacion: quitar el agrupamiento hace fallar la
  prueba correspondiente (`desafios-implementacion.md` 37)
- **Riesgo R20 evaluado y diferido**, no cerrado ni ignorado: el sumidero append-only
  independiente (DynamoDB Streams + S3 con Object Lock) es infraestructura AWS nueva que esta
  etapa no tenia en su alcance. Lo que si se construyo es una segunda red de **lectura** —la
  comprobacion 5 de integridad— que delata una escritura sin condicion aunque no la impida. Ver
  el riesgo R20 arriba

**Verificacion:**

- [x] Compuerta de calidad completa en verde — 1782 pruebas, `typecheck` y `build` limpios
- [x] Dado un lote con reasignaciones, la vista reconstruye la secuencia completa y correcta —
      probado con eventos de congelamiento, omision y reasignacion compartiendo `correlacionId`
- [x] El auditor recibe `forbidden` en toda action de mutacion — heredado de la invariante 1
- [ ] **[OPERADOR]** revision visual en navegador de `/auditoria` y
      `/auditoria/lotes/[loteId]` con datos reales: filtros, exportacion descargable y las seis
      comprobaciones legibles. Exige sesion real de Okta con `Autob_Auditar` y un lote con
      historia, que no existen en este entorno — mismo pendiente que bloquea las Etapas 5 a 10.1

**Salida esperada:** trazabilidad demostrable de punta a punta. **Cumplida.**

---

## Etapa 11.1 — La bitacora se vuelve consultable ✅

**Objetivo:** que el auditor pueda buscar sin conocer de antemano el identificador de lo que
busca.

**Dependencias:** Etapa 11.

> **El sintoma era "es dificil encontrar los ID"; los huecos eran tres.** La pantalla solo sabia
> leer la particion de un agregado (PA-12), asi que exigia teclear un ULID — y el de una solicitud
> es derivado (`<loteId>-<turno>`) y no aparecia en ninguna pantalla. Detras habia dos cosas mas:
> **PA-13 nunca se habia leido** (su clave se escribia desde la Etapa 5 y ningun codigo la
> consultaba) y **no existia perfil de participante**, asi que no habia de donde sacar un nombre.
> Ver `desafios-implementacion.md` 45.

- [x] `src/lib/auditoria/consultarBitacoraGlobal.ts` — PA-13, una `Query` por dia del rango, en
      paralelo y sin ordenar en memoria. Filtro de `tipo` y `actorId` en DynamoDB; avisa cuando
      trunca
- [x] `src/lib/auditoria/consultarActividadDeParticipante.ts` — lo que la persona **firmo** mas lo
      que **le ocurrio** (los eventos que `SISTEMA` escribio sobre sus solicitudes), desduplicado
      por `eventoId`
- [x] `src/lib/participantes/` — `registrarPerfil` y `leerPerfiles`. Es la **mitad** del *upsert*
      pendiente desde la Etapa 2: el perfil, no la identidad. `participanteId` sigue siendo el
      `sub` de Okta porque cambiarlo partiria en dos la historia de cada persona
- [x] `src/lib/data/lecturaPorLotes.ts` — `BatchGetItem` con troceado y reintento de las claves sin
      procesar
- [x] `src/lib/auditoria/opcionesDeBusqueda.ts` — las opciones de los dos selects, con etiquetas
      legibles resueltas por lectura por lote. Salen de la **bitacora del rango** y no del catalogo
      de entidades, asi que toda opcion ofrecida devuelve resultados
- [x] `src/lib/domain/fechas.ts` — aritmetica sobre etiquetas de dia (`diasDeNegocioEntre`,
      `sumarDiasDeNegocio`, `esDiaDeNegocio`) y `formatearFechaHoraPrecisa`
- [x] `src/components/FiltrosDeBitacora.tsx` — fechas primero, obligatorias y con los ultimos 30
      dias por defecto; selects dependientes que reenvian el formulario al cambiar
- [x] Tabla con milisegundos, `eventoId`, el registro de cada evento y el nombre del actor
- [x] Atajos "ver en la bitacora" desde vehiculos, convocatoria, lote y vista de fila, solo con
      `Autob_Auditar` — `src/lib/auditoria/enlace.ts`
- [x] `EventoDTO` gana `agregado` y `agregadoId`, leidos de la clave de particion

**Verificacion:**

- [x] Compuerta de calidad completa en verde — 1982 pruebas, `typecheck` y `build` limpios
- [x] El rango es obligatorio y acotado a 31 dias **en el servicio y no solo en la pantalla**: una
      action que olvide validar no puede lanzar cien `Query`
- [x] Sin criterio no se busca; un tipo de registro sin identificador no es un criterio
- [x] Un vencimiento firmado por `SISTEMA` **si** aparece al rastrear al participante afectado
- [x] `axe` sin violaciones sobre el filtro nuevo — y en el camino se corrigio un defecto real:
      un control nativo dentro de un `FormField` de Eden queda **sin nombre accesible**
      (`desafios-implementacion.md` 43)
- [x] El mismo rango devuelve el mismo conjunto por los dos modos de consulta: las fronteras de
      dia se unificaron en dia de negocio (`desafios-implementacion.md` 44)
- [x] **Recorrido en navegador con datos reales del sandbox**, con Playwright y una sesion de Okta
      real mas la persona simulada `auditor`. Verificado: el auto-envio puebla los selects, la
      busqueda por identificador devuelve la historia del lote, la busqueda global por tipo de
      evento devuelve 483 filas **con la columna Registro**, la fecha se presenta con
      milisegundos y el aviso de truncamiento aparece con el rango por defecto. Movil a 390 px:
      `CardView` apila con la etiqueta de cada columna. Consola sin errores ni advertencias.
      Corrigio tres defectos de interfaz que solo se ven con la pantalla delante: el texto de
      ayuda permanente duplicaba el aviso de `sin_criterio`, la opcion vacia del identificador se
      dibujaba **en blanco** al elegir un tipo, y el boton `Buscar` caia en medio del formulario
- [ ] **[OPERADOR]** comprobar las **etiquetas legibles** con datos creados desde la aplicacion.
      No se pueden ver en el sandbox: los eventos que hay son de la prueba de carga, y sus lotes,
      convocatorias, vehiculos y perfiles **no existen** como items (verificado con `get-item`),
      asi que cada opcion cae al identificador crudo — que es el respaldo correcto y esta cubierto
      por prueba, pero no demuestra la etiqueta

**Lo que se decidio, y por que asi:**

1. **Microsegundos no existen y no se van a inventar.** `ocurridoEn` se serializa desde un `Date`:
   milisegundos. Pedirle mas precision a la pantalla solo podia producir ceros. Lo que si
   distingue dos eventos del mismo milisegundo es el `eventoId` de la `SK`, y por eso la tabla lo
   muestra en su propia columna en vez de fingir una resolucion mas fina.
2. **No hay registro de "fila".** La historia de una fila **es** la del lote, con el mismo
   `loteId`; una solicitud es un lugar dentro de ella. Las etiquetas del select lo dicen ahora
   ("Lote y su fila", "Solicitud (lugar en la fila)") en vez de dejar suponer que falta un
   identificador que buscar.
3. **El tope de 31 dias solo aplica al modo global.** Con un identificador se lee una sola
   particion y el rango vuelve a ser un filtro en memoria, asi que acotarlo solo esconderia
   historia sin ahorrar nada — y es lo que permite que un enlace desde la pantalla de una
   convocatoria abra su historia completa aunque empiece hace meses.
4. **La exportacion sigue exigiendo un agregado.** `BITACORA_EXPORTADA` es un evento y todo evento
   se ancla a un agregado: una exportacion del rango completo no tendria a que anclarse y saldria
   sin registrarse, que es el hueco que cerro la seccion 36. El boton se oculta en el modo global.

**Salida esperada:** una bitacora que se puede consultar sin saber de memoria un ULID.
**Cumplida.**

---

## Etapa 11.2 — Bitacora consultable por clave, IDs cortos e identificadores de negocio ✅

**Objetivo:** que la bitacora se consulte con condiciones de clave en lugar de filtrar en la
aplicacion, y que las pantallas puedan nombrar las cosas con los identificadores que usa la
organizacion en vez de un ULID.

**Dependencias:** Etapa 11.1.

> **Tres problemas que se resuelven juntos porque los tres exigen recrear la tabla.** El unico
> acceso cronologico era `GSI2PK = AUDIT#<dia>`, asi que un rango de 30 dias eran 31 `Query` y
> todo lo demas se filtraba en memoria con un tope de 2 000 eventos — un tope que ya produjo
> **tres** defectos seguidos, todos la misma clase de error (`desafios` 44 y 46). Ademas los
> identificadores eran 26 caracteres que en pantalla no dicen nada, y no habia ningun dato humano
> al que recurrir: la organizacion si tiene numeros propios —economico, de serie, folio— y el
> modelo no los guardaba.

**Decidido: una sola tabla con cinco GSIs nuevos.** Se evaluo una tabla dedicada para la bitacora
y se descarto: el diseno de datos, el rendimiento y el costo son identicos —los GSIs son dispersos,
asi que las claves nuevas solo existen en los items de evento— y su unica ventaja real, que el
`Deny` de inmutabilidad dejara de depender del prefijo `AUDIT#`, se cubre haciendo que la politica
IAM y la clave salgan de la **misma constante**.

**Los datos del sandbox se borraron y se regeneraron.** Un GSI nuevo nace vacio para los eventos ya
escritos, y a un evento append-only no se le pueden agregar atributos: `UpdateItem` lo deniega IAM
y un `PutItem` de reemplazo lo rechaza `attribute_not_exists(PK)`. De ahi la regla permanente: **lo
irreversible son los atributos, no los indices**. Un atributo de clave que hoy no se escribe es una
pregunta que nunca se podra responder sobre los eventos de hoy.

### A — Recrear la tabla: indices, atributos e IDs cortos ✅

- [x] `src/lib/data/identificadores.ts` — el ID interno pasa de 26 a **12 caracteres**: 7 de fecha
      a precision de segundo (~1 090 anos) y 5 de azar (33,5 M). Sigue ordenando
      lexicograficamente igual que cronologicamente. `nuevoUlid`/`esUlid`/`instanteDeUlid`
      renombrados a `nuevoId`/`esId`/`instanteDeId`
- [x] `src/lib/fila/reservas.ts` — `attribute_not_exists(SK)` en el `Put` de `anotarReserva`, que
      **no es opcional**: con 25 bits de azar una reserva sobrescrita en silencio borraria una
      reserva en vuelo y R18 dejaria de sostenerse. Convertida en rechazo reintentable
- [x] `src/lib/data/eventos.ts` y `claves.ts` — siete atributos nuevos en cada evento (`mesPK`,
      `tipoPK`, `diaPK`, `actorMesPK`, `cronoSK`, `agregadoSK`, `actorSK`), con nombres semanticos
      en lugar de `GSI5PK`…`GSI9SK`: los cinco indices tienen un proposito cada uno, y el nombre
      hace evidente la propiedad que sostiene el diseno — un vehiculo no tiene `mesPK`, asi que no
      esta en ese indice. `mes` se rebana de `dia` para que no puedan contradecirse
- [x] `amplify/tabla.ts` — cinco GSIs, proyeccion `ALL` en todos: `KEYS_ONLY` no ahorra un WCU
      porque el item ya redondea a 1 KB, y con menos proyeccion haria falta un `BatchGetItem` de
      hidratacion por pagina
- [x] `PREFIJO_PARTICION_AUDITORIA` con **una sola fuente de verdad**: `amplify/permisos.ts` arma
      la condicion `LeadingKeys` del `Deny` a partir de la misma constante con la que
      `clave.evento` construye la `PK`, asi que no pueden divergir por construccion
- [x] `ampx sandbox delete` y redespliegue — CloudFormation aplica **una operacion de indice por
      actualizacion de pila**, asi que los nueve GSIs se crean en una sola

### B — Identificadores y nombres de negocio ✅

- [x] `src/lib/domain/identificadorDeNegocio.ts` — normalizacion (recorte y mayusculas) y alfabeto
      de **lista blanca** (`A-Z`, `0-9`, `-`, `_`, `/`): el valor entra en la `PK` del centinela,
      asi que un `#` desplazaria el separador y fabricaria la clave de otro
- [x] `src/lib/data/centinelasDeIdentificador.ts` — un centinela por valor
      (`<ambito>#<valor> / CENTINELA`) con `attribute_not_exists`, en la **misma transaccion** que
      la creacion. Los centinelas van **primero**: `ejecutarTransaccion` devuelve el indice del
      item que cancelo, y es lo unico que distingue cual de los dos numeros de un vehiculo estaba
      duplicado
- [x] Campos nuevos: `folio` (unico) y `nombre` (no unico) en la convocatoria; `numeroEconomico` y
      `numeroDeSerie` (los dos unicos) en el vehiculo. `CAMPOS_CONVOCATORIA` y `CAMPOS_VEHICULO`
      extendidos — ver el defecto de abajo
- [x] `crearConvocatoria.ts` y `crearVehiculo.ts` — centinelas al frente y traduccion del indice
      que cancela al campo concreto, para que la pantalla pueda senalarlo
- [x] `editarConvocatoria.ts` y `editarVehiculo.ts` — **renombrado atomico**: reservar el nuevo,
      liberar el viejo (`attribute_exists`) y actualizar la entidad, en una sola transaccion.
      Partirlo en dos dejaria, si el segundo paso falla, o un valor reservado que nadie puede
      volver a usar, o dos entidades con el mismo
- [x] Los dos formularios y los diccionarios `es`/`en`, con los motivos nuevos
      `caracter_no_permitido` y `duplicado`
- [x] Los formularios **devuelven lo capturado** en el rechazo. React 19 reinicia el formulario a
      `defaultValue` cuando la action termina, asi que el rechazo del servidor —el unico que el
      navegador no puede anticipar— quedaba sobre campos vacios. Ver `desafios-implementacion.md`
      48
- [x] `editarConvocatoria.test.ts` — el archivo **no tenia ninguna prueba** antes de esta etapa

**El ID interno sigue siendo la clave y el ancla de la bitacora, no el folio.** Es la misma
decision que D-15 tomo para `participanteId`: la historia se ancla a un identificador inmutable y
el identificador humano es un atributo renombrable, para que corregir un typo no parta la historia
en dos.

**Verificacion de A y B:**

- [x] Compuerta completa en verde — 2 089 pruebas, `typecheck` y `build` limpios
- [x] Los nueve GSIs `ACTIVE` en el sandbox; `infraestructura.test.ts` afirma claves y
      proyecciones, y una prueba ata `clave.evento(...).PK` al patron de `LeadingKeys` del `Deny`
- [x] Propiedades del ID: 12 caracteres, alfabeto sin `#` ni `-`, orden lexicografico igual al
      cronologico al segundo, y N identificadores generados en el mismo segundo son distintos
- [x] `npm run carga:apertura` repoblo la tabla; una consulta directa confirma los siete atributos
      con dia y mes de negocio
- [x] **Contra DynamoDB real** (`src/lib/data/identificadoresUnicos.integracion.test.ts`, con el
      rol de computo SSR): la segunda alta con el mismo folio la rechaza la base de datos y no una
      lectura previa; `"  conv-1  "` y `"CONV-1"` colisionan; el numero economico y el de serie se
      reportan por separado; el renombrado libera el folio viejo y **lo deja usable por otra
      convocatoria**; y la particion de bitacora del identificador interno conserva los dos
      eventos despues del renombrado
- [x] **Recorrido en navegador** con Playwright y una sesion de Okta real mas la persona
      simulada `admin`: los dos formularios presentan los campos nuevos con su etiqueta y su
      ayuda, un identificador con un caracter fuera del alfabeto se marca **en su campo** con el
      motivo traducido, y todo lo capturado sobrevive al rechazo —incluida la descripcion
      enriquecida y el tipo elegido—. Consola sin errores. Corrigio dos defectos que solo se ven
      con la pantalla delante: el reinicio del formulario (`desafios` 48) y una ayuda que
      duplicaba el texto del propio error al concatenarse con el
- [ ] **[OPERADOR]** confirmar si el numero economico y el de serie son en la practica el **mismo**
      dato con dos nombres. Se dejaron separados porque describen cosas distintas —etiqueta interna
      de activo contra numero del fabricante—, pero si coinciden se colapsan a uno y se ahorra un
      centinela por alta

> **Un defecto real que encontro esta etapa, y que ninguna compuerta veia:** `CAMPOS_VEHICULO` se
> quedo sin los dos campos nuevos, y `as const satisfies readonly (keyof DatosVehiculo)[]` **no
> exige exhaustividad** — comprueba que cada elemento sea una clave valida, no que esten todas.
> Como `camposModificados` filtra esa lista, editar el numero economico devolvia `{ ok: true }`
> **sin escribir nada** y la pantalla decia "Cambios guardados". Typecheck limpio y 2 073 pruebas
> en verde. Ver `desafios-implementacion.md` 47.

### C — Lectores y pantalla ✅

- [x] Las cuatro consultas de rango reescritas por **condicion de clave**, con un solo lugar
      —`consultasDe`— que decide que indice sirve a que criterio: el mes en `GSI5`, el tipo de
      evento en `GSI6`, la persona que firmo en `GSI9` y el tipo de registro en `GSI7` con
      `begins_with`. Las tres primeras particionan por mes y cuestan **1-4 consultas por rango**
      donde antes eran 31
- [x] `src/lib/auditoria/rangoDeBitacora.ts` — la cota, en un solo lugar porque las cuatro
      consultas la comparten. Limite superior en la medianoche **siguiente**: `BETWEEN` es
      inclusivo y aun asi la cota queda exclusiva del instante, porque `cronoSK` es
      `<ocurridoEn>#<eventoId>` y toda cadena ordena despues que su prefijo. **Sin centinela**
- [x] `src/lib/auditoria/valoresConActividad.ts` — las opciones por sondeo con salto de grupo
      sobre GSI7 y GSI8, con lectura por pagina y dias en tandas (ver el defecto de abajo)
- [x] `src/lib/auditoria/etiquetasDeBitacora.ts` — el etiquetador, **compartido** por las opciones
      y la columna «Registro»: dos consumidores que nombraran por su cuenta harian que la misma
      convocatoria se llamara de dos maneras en la misma pantalla
- [x] Consulta 3b, que **devolvia vacio siempre**: leia particiones `AUDIT#SOLICITUD#` que ningun
      escritor escribe. Ahora es GSI3 mas las particiones de **lote**, agrupadas por lote y con el
      rango en la clave. **Sin** agregar un `sujetoId`: solo responderia sobre eventos futuros y
      3b es retrospectiva por definicion
- [x] `MAXIMO_DIAS_DE_RANGO` a 90, y desacoplado del valor por defecto: era 31 porque era el
      numero de `Query` que costaba el rango
- [x] `comparandoClaves` en `claves.ts` — todo ordenamiento en memoria que afirme reproducir el
      orden de una `SK` compara por punto de codigo. `localeCompare` usa la colacion del idioma y
      puede invertir dos claves respecto de lo que hace la tabla
- [x] `gsi2.bitacoraDelDia` retirada, con su escritura en `eventos.ts`. GSI2 vuelve a servir solo
      sus cinco patrones de negocio y deja de duplicar cada evento

**Verificacion, con Playwright y la sesion real contra el sandbox:**

- [x] Compuerta completa en verde — 2 100 pruebas, `typecheck` y `build` limpios
- [x] **El defecto que reporto el usuario, medido:** el select de identificadores ofrece ahora 14
      vehiculos y 60 convocatorias donde antes ofrecia 2 y 1. Ya no compiten por un cupo
      compartido, porque son lecturas con particiones distintas
- [x] Buscar por tipo de evento devuelve **355 filas sin aviso de truncamiento**; el tipo es la
      particion de GSI6, asi que no puede responder de menos
- [x] **Consulta 3b viva:** el participante `e10-p1-0c348eec-382b7a` devuelve 3 eventos, **2 de
      ellos firmados por `SISTEMA`** —"Vehículo adjudicado" y "Solicitud vencida por plazo"—, que
      es exactamente la mitad que antes devolvia cero
- [x] Etiquetas legibles con datos reales: `Toyota · Prius · 2021 · 20 · 1NA3R5MPXEHK`. Los
      registros de la prueba de carga caen al identificador crudo, que es el respaldo correcto y
      probado: sus entidades nunca existieron como items
- [x] Rango de 90 dias, consola sin errores
- [x] Latencia: **3,0-3,7 s** por carga, contra 1,8-4,3 s de referencia — con un rango que ahora
      responde completo y con el servidor de desarrollo, sin cache

> **Dos defectos que solo el navegador podia encontrar.** `cronoSK >= :a AND cronoSK < :b` lo
> rechaza DynamoDB —admite **una condicion por clave**— y las 18 pruebas del lector pasaban en
> verde afirmando esa cadena exacta, porque el doble captura comandos y no los evalua
> (`desafios` 51). Y el sondeo con `Limit: 1` dejo la pantalla en **20 segundos**: 200 valores
> distintos son 200 viajes de red encadenados, un costo que no aparece en ningun analisis de RCU
> (`desafios` 52, corregido a 3,5 s con lectura por pagina y dias en tandas).

> **A decidir en la Etapa D: `GSI5` no tiene lector.** La pantalla exige al menos un criterio
> —identificador, tipo de evento o participante—, y los tres tienen su propio indice, asi que la
> consulta "todo el rango cronologico" no la lanza nadie. El atributo `mesPK`/`cronoSK` **se
> sigue escribiendo** y eso es lo irreversible; el indice se puede borrar y volver a crear cuando
> haya un lector. Dejarlo sin decidir repetiria la situacion de PA-13, que se escribio dos etapas
> sin que nadie lo leyera.

### D — Limpieza y documentacion ✅

- [x] **`GSI5` borrado del despliegue.** Quedo sin lector al reescribir las consultas: la pantalla
      exige un criterio y los tres tienen su propio indice. Un indice con proyeccion `ALL` y sin
      lector cobra una escritura por evento a cambio de nada — el mismo argumento con el que la
      bitacora salio de GSI2. Verificado contra la tabla: ocho GSIs `ACTIVE`, y `mesPK` ya no
      figura entre las claves de ningun indice
- [x] Los atributos `mesPK`/`cronoSK` **se siguen escribiendo**. Es la regla que gobierna el
      modelo: lo irreversible son los atributos, no los indices. El indice se crea cuando aparezca
      el lector y su relleno vera todo lo ya escrito
- [x] **El criterio pasa a ser obligatorio en el tipo.** `BusquedaGlobal` es una union de tres
      ramas, cada una exigiendo uno de los tres criterios: un rango sin criterio ya no compila. Sin
      eso, borrar el indice convertia una llamada valida en un `ValidationException` en runtime
      sobre codigo que compilaba. Cubierto con `@ts-expect-error`, que **falla el typecheck** si
      algun dia deja de ser un error
- [x] `consultarPorTipoDeEvento` borrada en la Etapa C
- [ ] `LIMITE_DE_EVENTOS_GLOBAL` y la bandera `truncada` **se conservan**, y no es un pendiente
      olvidado: la tabla de resultados se pinta entera, sin paginar, asi que el tope sigue
      significando algo. Lo que cambio es su naturaleza — ahora acota una lectura **ya restringida
      al criterio**, no una del rango entero que se descartaba en memoria, asi que su corte ya no
      puede cambiar la respuesta de preguntas ajenas. Se van el dia que la pantalla pagine
- [x] `modelo-datos-dynamodb.md`: seccion 3 reescrita (dos familias de indices y por que
      convenciones distintas), 4.5 nueva (centinela de identificador de negocio), 5.3 reescrita,
      5.4 y 5.5 nuevas, PA-15 y PA-16 agregados
- [x] `proyecto.md` 4.1 y 4.2: folio, nombre corto, numero economico y numero de serie como reglas
      de negocio, con su unicidad y su caracter corregible
- [x] `api-contracts.md` 2, 3 y 6.2, **y la divergencia de la Etapa 0 cerrada**: el contrato
      prometia `titulo` y `descripcion` desde el principio y el codigo nunca tuvo ninguno de los
      dos. Se cierra con `nombre` y conservando `descripcionParticipacion`, que dice de que habla
      ese texto
- [x] `ui-ux-requerimientos.md` 4.2, 4.4 y 7
- [x] `desafios-implementacion.md` 47 a 52 — los seis defectos que encontraron las etapas B, C y D
- [x] `.claude/adr.md`: **D-14 reescrito**, **la justificacion de D-2 corregida** —"single-table
      permite escribir la mutacion y su evento en la misma transaccion" era falso como argumento a
      favor, porque `TransactWriteItems` puede abarcar tablas distintas—, y **D-16** y **D-17**
      nuevos. Sincronizado en el orden obligatorio: editar, `index_repository`, `manage_adr`;
      verificado con `mode: "sections"`
- [x] Compuerta completa en verde — 2 101 pruebas, `typecheck` y `build` limpios

**Salida esperada:** una pantalla de auditoria que consulta por clave y unas listas que dicen
nombres. **Cumplida.**

---

## Etapa 12 — Endurecimiento y despliegue — **parcial**

**Objetivo:** listo para produccion.

**Dependencias:** Etapa 11.

> **Lo que puede cerrarse aqui esta cerrado; el resto exige un entorno real y queda
> `[OPERADOR]`.** La etapa se divide de forma limpia en dos mitades y conviene no confundirlas:
> lo que es codigo, configuracion o analisis esta hecho y probado; lo que consiste en *mirar la
> aplicacion corriendo* —navegador, AWS desplegado, correo entregado— no se puede hacer sin
> credenciales que este entorno no tiene. Marcar esos puntos como hechos seria justamente el
> tipo de suposicion que la cabecera de `runbooks.md` prohibe.

- [x] Accesibilidad: axe sin violaciones en **todos los componentes**, mas el inventario que lo
      mantiene asi — `src/components/accesibilidad.test.ts`
- [ ] **[OPERADOR]** Accesibilidad de las **pantallas** completas: axe sobre `/auditoria`,
      `/convocatorias/[id]` y el resto, en navegador con sesion real
- [ ] **[OPERADOR]** Responsividad verificada en movil, tableta y escritorio
- [x] Cabeceras de seguridad y CSP — `next.config.ts`, `src/proxy.ts`, `next.config.test.ts`
- [x] Observabilidad: registro estructurado, trazas de las operaciones criticas y diagnostico de
      cancelacion de transacciones — `src/lib/observabilidad/`
- [x] Alarmas: seis, en `amplify/alarmas.ts`, verificadas por sintesis de la pila
- [ ] **[OPERADOR]** Disparar una alarma de verdad y confirmar que el aviso llega
      (`runbooks.md` R-11 paso 6)
- [x] Revision de costos y capacidad de DynamoDB — `modelo-datos-dynamodb.md` 8.1 y 8.2
- [x] Diccionarios completos, sin claves faltantes — ya garantizado por dos mecanismos; se
      verifico y se documento cual cubre que
- [ ] **[OPERADOR]** `runbooks.md` verificado ejecutando cada procedimiento al menos una vez
- [ ] **[OPERADOR]** Despliegue a produccion y prueba de humo

**Verificacion:**

- [x] Compuerta de calidad completa en verde — `typecheck`, `lint`, `build` y 1861 pruebas
- [x] **Prueba de carga ejecutada contra el sandbox real** — `npm run carga:apertura`. 100
      solicitudes concurrentes sobre 10 lotes: **100 aceptadas, 0 rechazadas, exactamente 10
      adjudicaciones** (una por lote, siempre al turno menor). En caliente: p50 965 ms,
      p95 1 296 ms, 62 solicitudes/s; en frio, diez veces mas lento por los apretones de manos
      TLS y no por DynamoDB
- [ ] **[OPERADOR]** Repetir la carga desde el entorno desplegado y **calibrar
      `UMBRAL_CONFLICTOS_POR_PERIODO`** con la metrica `TransactionConflict` de CloudWatch — ver
      la nota de abajo sobre por que esta corrida no alcanza para calibrarlo
- [ ] **[OPERADOR]** Cada runbook ejecutado y corregido si su procedimiento no coincide con la
      realidad

**Lo que se hizo, y por que asi:**

1. **Observabilidad** (`src/lib/observabilidad/`). `registro.ts` escribe una linea por operacion
   con el `correlacionId` que comparte con la bitacora; `traza.ts` envuelve las tres operaciones
   criticas mas el barrido y el outbox con su desenlace y su duracion. Dos propiedades salen de
   que el registro **no** es la bitacora: nunca lanza —perder una linea no puede tumbar la
   adjudicacion que describia— y nunca escribe identidad de personas. `participanteId` si se
   escribe, porque es un ULID interno y sin el el runbook R-8 no se puede ejecutar.

2. **Trazas propias en lugar de X-Ray**, decidido y no omitido. X-Ray responde "donde se fue el
   tiempo entre servicios"; aqui hay un proceso hablando con DynamoDB y la pregunta es "que le
   paso a esta solicitud". El `correlacionId` ya la responde, sin SDK, sin permiso de IAM y sin
   costo por traza.

3. **Alarmas repartidas entre metrica nativa y filtro de log, segun lo que cada una tenga que
   sobrevivir.** Lo que hay que detectar *aunque el codigo este roto* va a metrica nativa: si el
   `handler` del barrido lanza antes de la primera linea, un filtro de log no ve nada y **calla**,
   que es exactamente el fallo que R6 existe para gritar. Por eso "el barrido no se ejecuta" trata
   la ausencia de datos como fallo (`BREACHING`), contra el valor por omision de CloudWatch.

4. **La contencion se vigila con `TransactionConflict` y no con `ConditionalCheckFailedRequests`**,
   que es la metrica que parece obvia. En este sistema una condicion que falla es el mecanismo
   normal: la adjudicacion se gana con escritura condicional (regla 6), asi que en cada lote N-1
   intentos fallan su condicion **por diseno** y esa alarma estaria disparada siempre.

5. **Ninguna metrica lleva `loteId` como dimension.** CloudWatch cobra por combinacion de
   dimensiones y `loteId` es de cardinalidad ilimitada y creciente: "solicitudes por lote" como
   metrica crearia una serie por cada lote que haya existido, para siempre. Eso vive en la linea
   de registro y se consulta con Logs Insights, que no se cobra por serie. Las consultas quedaron
   escritas en `runbooks.md`.

6. **La CSP se reviso y `style-src 'unsafe-inline'` se queda**, cerrando el pendiente del
   2026-09-04 con evidencia en lugar de con otra postergacion: Eden no publica ningun `.css` —cada
   componente monta su hoja con `<style href precedence>` de React 19, sin nonce que pasarle— y
   ademas usa atributos `style={{...}}` en `eden-table`, `eden-form-parts` y `eden-grid`. Las dos
   cosas exigen el permiso, y partir la directiva no ganaria nada. El endurecimiento real fue por
   otro lado: `X-Frame-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` y
   `Cross-Origin-Resource-Policy`, cada una con prueba.

7. **La revision de costos concluye no estrechar los GSIs**, revirtiendo la expectativa que este
   plan traia desde el 2026-09-04. DynamoDB cobra la escritura en bloques de 1 KB redondeando
   hacia arriba, asi que el ahorro de `INCLUDE` es **cero** sobre los items de alto volumen
   —solicitudes (~600 B) y eventos (~400 B), ya bajo el minimo facturable— y solo aparece en
   vehiculos y convocatorias, que se escriben unas pocas veces al mes. Cambiar una decision
   irreversible —la proyeccion de un GSI no se puede modificar, hay que recrear el indice y
   durante esa ventana PA-05 y PA-11 dejan de responder— por menos de un centavo al mes no es una
   optimizacion.

8. **La cota de una corrida del barrido queda medida y documentada** (8.2). `leerVencidasDelDia` y
   `leerPendientes` leen una sola pagina de `Query`, y eso es un retraso y no trabajo perdido:
   GSI4 es disperso, las dos leen de lo mas viejo a lo mas nuevo y el barrido es idempotente cada
   5 minutos, asi que la corrida siguiente empieza donde la anterior dejo de ver. La cota es de
   unas 1 700 solicitudes por corrida.

9. **Accesibilidad: lo que faltaba no eran violaciones sino el inventario.** Cada componente ya
   pasaba por axe via `genericTests`; lo que no existia era lo que impide que llegue un componente
   nuevo sin esa comprobacion. Una prueba que cubre 26 de 27 componentes pasa en verde, y el que
   falta es justo el que nadie revisara. Ahora la ausencia de prueba **es** el fallo, con tres
   excepciones declaradas y razonadas (los Server Components asincronos, que jsdom no puede
   montar).

10. **Diccionarios: ya estaba garantizado, y se documento por que.** La garantia son dos
    mecanismos y ninguno bastaba solo: las pruebas de catalogo cubren las etiquetas que salen de
    un `as const` runtime, y `npm run typecheck` cubre todo lo demas, porque los JSON se importan
    con sus tipos literales y indexarlos con una union obliga a TypeScript a comprobar cada
    variante. Se verifico quitando `acciones.hecho_PUBLICAR`: `tsc` responde TS7053. El segundo
    mecanismo es silencioso y se desactivaria por completo anotando los diccionarios como
    `Record<string, ...>`, asi que se anadio un `@ts-expect-error` que rompe la compuerta si eso
    pasa.

11. **La prueba de carga es un arnes nuevo, no una repeticion de la de la Etapa 8.** Aquella
    responde una pregunta de correccion sobre **un** lote y vive en la compuerta. Esta abre L
    lotes a la vez —que es lo que ocurre en `inicioVenta`— y mide latencia, contencion y
    solicitudes por segundo, reafirmando las invariantes a esa escala.

    **Corrio contra el sandbox real y el resultado de correccion es limpio:** 100 solicitudes
    concurrentes sobre 10 lotes, 100 aceptadas, cero rechazadas, exactamente una adjudicacion
    por lote y siempre al turno menor de su fila. Es diez veces la escala de la prueba de la
    Etapa 8, con diez particiones compitiendo a la vez, y la reserva de R18 aguanta: las 7
    abstenciones son la respuesta correcta ante turnos en vuelo.

    **Encontro un defecto real de produccion**, que era su otra razon de ser: el `ADD` del paso 1
    de T1 escribe **fuera** de transaccion sobre un item que si participa en otras —el lote, en
    T2—, y `TransactionConflictException` escapaba de `solicitarCompra` como excepcion sin
    atrapar en vez de responder `conflicto_concurrencia`. El SDK lo reintenta solo, asi que nunca
    se habia visto; con contencion sostenida los tres intentos tambien se agotan y el
    participante recibiria un 500 en el peor momento.

    Al revisar el resto aparecieron **dos sitios mas con el mismo agujero**, y peores en un
    sentido: `liberarReserva` y `incrementarIntento` estan documentados como "de mejor esfuerzo"
    —su fallo no deberia importar— y sin embargo dejaban escapar la excepcion. El primero se
    invoca en cada ronda de `adjudicarLote`, asi que una limpieza opcional podia tumbar una
    adjudicacion; el segundo abortaba el resto del outbox por no poder escribir un contador de
    reintentos. Los tres corregidos, con pruebas, y `reservas.ts` estrena archivo de prueba
    (`desafios-implementacion.md` 41).

12. **La misma prueba, dos veces seguidas, dio numeros diez veces distintos — y ese contraste es
    el hallazgo.** Mismo escenario, mismo sandbox: en frio p95 de 15,5 s y 6,4 solicitudes/s; en
    caliente p95 de 1,3 s y 62 solicitudes/s. Lo que cambio no fue DynamoDB sino los apretones de
    manos TLS: con la inspeccion corporativa de por medio (riesgo R11), abrir trescientas
    conexiones domina la primera corrida y la segunda reusa el agente HTTPS. El factor de nueve
    entre p50 y p95 en frio es la firma de una cola de conexiones. Ninguna de las dos es la
    latencia de produccion, pero la segunda esta mucho mas cerca — y la primera se parece a lo
    que pagara un arranque en frio de Lambda.

    Y **`UMBRAL_CONFLICTOS_POR_PERIODO` sigue sin calibrar** por una razon distinta: el informe
    reporta cero rechazos por conflicto, porque los reintentos del SDK los absorbieron antes de
    llegar a la aplicacion. Los conflictos si ocurrieron —el diagnostico de la seccion 41 los
    vio— pero solo la metrica nativa `TransactionConflict` de CloudWatch sabe cuantos. Calibrarlo
    exige mirar esa metrica despues de una carga en el entorno desplegado, que es el punto
    `[OPERADOR]` de la verificacion.

    Tres corridas fallidas antes de esta, y **ninguna por culpa del sistema**: cupo de sockets,
    una configuracion de cliente que no era la de produccion, y una asercion que comparaba el
    turno de quien solicitaba contra el turno adjudicado —dos campos distintos con nombres
    parecidos— y por tanto fallaba con el motor de fila funcionando bien
    (`desafios-implementacion.md` 42).

**Salida esperada:** aplicacion en produccion, operable y auditable.

> **Lo que falta para produccion no es codigo.** Son cinco pasos de operador, y tres de ellos
> estan bloqueados por lo mismo que bloquea las Etapas 5 a 11: no hay sesion de Okta ni entorno
> desplegado en esta maquina. El cuarto —`ALARMAS_CORREO` y confirmar la suscripcion de SNS— es
> el que mas facil pasa inadvertido, porque su modo de fallo es el silencio: alarmas que
> funcionan y no avisan a nadie (`runbooks.md` R-13). El quinto es la aprobacion de CES, que
> sigue siendo R17 y no depende de esta etapa.

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

### R6 — Barrido de vencimientos caido — **cerrado**

**Probabilidad:** media · **Impacto:** alto · **Estado:** cerrado — mitigacion en la Etapa 10,
alarma en la Etapa 12

Si el barrido no corre, la fila se congela y nadie avanza.

**Mitigacion:** barrido idempotente (`src/lib/fila/barridoDeVencimientos.ts`), mas
**verificacion perezosa** al leer la fila (`consultarMiLugar.ts`) para que el sistema se
autocorrija sin depender del barrido. `detectadoPor` en `SOLICITUD_VENCIDA` distingue cual de
los dos caminos resolvio cada vencimiento, que es lo que permite medir si el barrido esta
cumpliendo su funcion.

> **La alarma que faltaba se construyo en la Etapa 12** (`amplify/alarmas.ts`), y son dos
> distintas porque detectan cosas distintas:
>
> - `barrido-sin-ejecutar` mira `AWS/Lambda` `Invocations` con `TreatMissingData.BREACHING`. La
>   metrica es **nativa** a proposito: si el `handler` lanza antes de escribir su primera linea,
>   un filtro sobre los logs no ve nada y **calla**, que es precisamente este fallo. Y el trato
>   de la ausencia de datos va contra el valor por omision de CloudWatch, porque un barrido que
>   no corre no publica ceros: no publica nada, y `INSUFFICIENT_DATA` es indistinguible de "todo
>   bien" para quien no esta mirando.
> - `vencimientos-sin-resolver` mira `errores` del barrido —las vencidas que **encontro y no
>   pudo resolver**—, que es el sintoma de que los dos caminos de D-7 fallaron. No mira
>   `vencimientosAbstenidos`: abstenerse ante turnos en vuelo es correcto (R18) y la corrida
>   siguiente lo resuelve.
>
> Queda `[OPERADOR]` poner `ALARMAS_CORREO` y **confirmar la suscripcion de SNS**: sin ese paso
> las alarmas cambian de estado y no avisan a nadie (`runbooks.md` R-13).

**Senal de alerta:** adjudicaciones con vencimiento pasado que siguen vigentes.

### R7 — Desfase de zona horaria en las ventanas de venta

**Probabilidad:** alta · **Impacto:** alto

Abrir la venta una hora antes o despues arruina la convocatoria.

**Mitigacion:** persistir siempre ISO-8601 UTC; formatear a `America/Mexico_City` solo en
servidor; prohibido comparar ventanas contra la hora del cliente. Tests de frontera y de
horario de verano.

**Senal de alerta:** un `new Date()` sin zona explicita en codigo de cliente que decida
visibilidad.

### R8 — El correo bloquea o revierte la adjudicacion — **cerrado**

**Probabilidad:** media · **Impacto:** medio · **Estado:** cerrado en la Etapa 10

**Mitigacion:** patron outbox. El mensaje se encola en la **misma** transaccion que adjudica
(`src/lib/correo/outbox.ts`, llamado desde `adjudicarLote.ts` y `vencerYReasignar.ts`) pero el
envio real ocurre aparte, en `procesarOutbox.ts`, con reintentos acotados por
`MAXIMO_INTENTOS_CORREO` y sin bloquear ni revertir nada si CES falla o esta ausente (R17).

**Senal de alerta:** un `await enviarCorreo(...)` dentro de `adjudicarLote.ts` o
`vencerYReasignar.ts`, fuera de `itemsDeEncoladoAdjudicacion`.

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

**Probabilidad:** media · **Impacto:** alto si se materializa tarde · **Estado:** materializado
segun lo previsto — la mitigacion de codigo esta completa, la aprobacion sigue pendiente

> Se llego a la Etapa 10 sin aprobacion de CES, que era la senal de alerta de este riesgo. Se
> construyo igual el adaptador (`src/lib/correo/clienteCes.ts`) y el procesador del outbox
> (`procesarOutbox.ts`), asi que el riesgo se convirtio exactamente en la demora que anticipaba
> esta mitigacion y no en un bloqueo: la aplicacion adjudica y notifica en cuanto CES este
> aprobado y sus credenciales (`CES_URL`, `CES_USER`, `CES_PASSWORD`, `CES_FROM_ADDRESS`) se
> configuren como secretos de Amplify. **[OPERADOR]** sigue pendiente de gestionar la
> aprobacion; sin ella, los correos se acumulan `PENDIENTE` en el outbox indefinidamente sin
> afectar la fila.

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
(S3 con Object Lock o equivalente).

**Evaluado en la Etapa 11, y deliberadamente diferido.** Streams + Lambda consumidor + bucket con
Object Lock es infraestructura AWS nueva —costo, politica de retencion, idempotencia del
consumidor—, y nada de eso estaba en el alcance que la etapa recibio ("vista de auditor,
reconstruccion, verificacion, exportacion"). Construirla sin que el operador la pidiera seria
alcance no autorizado, no una compuerta de calidad. Lo que la Etapa 11 si agrega es una segunda
red, de lectura: `verificarIntegridad` recalcula la bitacora entera contra el estado vigente de la
tabla (comprobacion 5 de `trazabilidad-auditoria.md` 5.1) y delataria una discrepancia dejada por
un `Put` sin condicion — no la impide, pero la hace visible sin esperar a un auditor externo.
Con `probabilidad: baja` y esa red nueva, el riesgo se acepta explicitamente en vez de cerrarse:
construir el sumidero queda pendiente de decision del operador, no de una etapa de este plan.

**Senal de alerta:** un `PutCommand` sobre una clave `AUDIT#` sin `ConditionExpression`, o una
comprobacion 5 de `verificarIntegridad` en `incumple` sin que ninguna otra explique por que.

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
| 2026-09-04 | CSP con nonce por peticion en `script-src`; `style-src` con `unsafe-inline` — **confirmado en la Etapa 12, ver abajo** | `style-src` con nonce tambien: mas estricto, pero arriesga romper visualmente componentes Eden cuyo uso de estilos en linea no se pudo verificar (sin acceso al MCP de Eden en este entorno) |
| 2026-09-04 | GSIs 2, 3 y 4 con proyeccion `ALL` — **confirmado en la Etapa 12, ver abajo** | `INCLUDE` con lista de atributos: mas barato, pero la proyeccion de un GSI **no se puede modificar** despues de creado y las pantallas que la consumen aun no existen. Estrechar es una optimizacion para la Etapa 12 |
| 2026-09-04 | Rol de computo SSR creado en la pila, adjuntado a mano en la consola | Crearlo tambien a mano: dejaria el `Deny` de la bitacora fuera del repositorio, en un procedimiento que se puede omitir |
| 2026-09-04 | `esbuild` como dependencia directa de desarrollo | Depender de Docker Desktop para empaquetar el Lambda del barrido, que en una maquina corporativa puede no existir |
| 2026-09-04 | Llave **publica** de CloudFront versionada en el repositorio | Inyectarla por variable de entorno: los PEM multilinea en variables son fragiles, y rotar la llave invalidaria todas las URLs firmadas vigentes |
| 2026-09-04 | Correo por **CES** (REST corporativo), no por SES | Amazon SES: era lo planeado en la Etapa 0, pero no hay configuracion ni aprobacion para usarlo. Saca el correo de la infraestructura por completo (riesgo R17) |
| 2026-09-04 | Importaciones relativas con extension **`.ts`** literal en `amplify/backend.ts`, mas `allowImportingTsExtensions` | Sin extension (como documenta Amplify) y con `.js` (la convencion ESM de TypeScript): **ninguna de las dos funciona**, porque `ampx` ejecuta el archivo con el type stripping de Node 24, que no completa extensiones ni mapea `.js` a `.ts` |
| 2026-09-04 | **Autorizacion por permisos, no por roles** (D-9). EAS responde un booleano por permiso | RBAC con la lista de roles en el codigo, que era el modelo de la Etapa 2: EAS no puede entregar roles, y congelaba politica organizacional en el repositorio. Tambien se descarto el `deny-override` ("quien administra nunca compra"): mismo defecto, y volveria inexpresable el caso legitimo de que la organizacion decida permitirlo |
| 2026-09-04 | Siete permisos a granularidad de **capacidad** | Un permiso por accion (33): mas fino, pero fragmenta capacidades que en la practica se conceden juntas y multiplica el costo de configuracion en EAS |
| 2026-09-04 | Guardas cerradas por omision: toda precondicion exige `=== true` | Contexto tipado por accion (33 tipos), que el diagnostico externo proponia: mas seguro en compilacion, pero mucho mas costoso. La invariante 8 —quitar un campo a la vez y exigir denegacion— cubre la misma clase de defecto y ademas atrapa los futuros |
| 2026-09-04 | `attribute_not_exists(PK)` en cada `Put` de evento | Confiar solo en el `Deny` de IAM, que es lo que afirmaban tres documentos: **es falso**, `PutItem` sobrescribe y no se puede denegar sin romper la regla 4 |
| 2026-09-08 | El sumidero append-only independiente de R20 (DynamoDB Streams + S3 Object Lock) se evalua en la Etapa 11 y se **difiere**, no se construye | Construirlo dentro del alcance recibido ("vista de auditor, reconstruccion, verificacion, exportacion"): es infraestructura AWS nueva sin pedirla el operador. La Etapa 11 agrega en su lugar una red de lectura — la comprobacion 5 de `verificarIntegridad` — que delata la discrepancia sin impedirla |
| 2026-09-04 | ~~`ConditionCheck` sobre la convocatoria dentro de la transaccion de T1~~ — **revertida el 2026-09-05**, ver abajo | Confiar en los atributos desnormalizados del lote: una publicacion por tandas interrumpida deja lotes comprables bajo una convocatoria sin publicar |
| 2026-09-04 | `style-src` y `font-src` autorizan el origen del Font Foundry | Mantener `self`: bloquea la hoja de estilo remota de `<Fonts>` de Eden y sus woff2, y ni `build` ni jsdom lo detectan porque no aplican CSP |
| 2026-09-05 | Reserva de turno como **item propio** `LOTE#<id>/RESERVA#<id>`, escrita antes del contador | Anotarla como atributo mapa del item del lote, que era el mecanismo que este plan proponia: cierra la carrera igual, pero mete el item del lote en la transaccion de toda solicitud y DynamoDB las cancela con `TransactionConflict` — medido, entre 5 y 9 de cada 10 |
| 2026-09-05 | Publicacion parcial cerrada por **orden de propagacion** en T8: convocatoria primero al publicar, lotes primero al ocultar | El `ConditionCheck` sobre la convocatoria en T1 (decidido el 2026-09-04): correcto, pero el item lo comparten todas las solicitudes de la convocatoria y un `ConditionCheck` lo retiene igual que una escritura — cancelaba entre 5 y 7 de cada 10 |
| 2026-09-05 | El paso 1 admite fila con el lote `EN_OFERTA` **o** `ADJUDICADO` | Exigir `EN_OFERTA`, como decia el modelo de datos: cierra la fila en la primera adjudicacion, que ocurre a los segundos de `inicioVenta`, y vuelve inalcanzables R-17, R-15, `miPosicion` y `tamanoFila` |
| 2026-09-05 | El prototipo se **omite** en la compuerta, tras la bandera `PROTOTIPO_R18` | Dejarlo en `verify:rapido`: son dos minutos contra AWS en cada iteracion, que deshace la decision que creo `verify:rapido`. No es prueba de regresion sino registro reproducible de una decision; la regresion permanente la aporta la Etapa 8 |
| 2026-09-08 | Las alarmas viven en una **tercera pila**, `AutobAlarmas` | Ponerlas en `AutobRecursos`, que es donde parece que corresponden: una metrica dimensionada por `FunctionName` es una referencia a la pila de la funcion, y esa pila ya toma `AUTOB_TABLE_NAME` de `AutobRecursos` — cierra un ciclo entre pilas y `ampx` falla al sintetizar |
| 2026-09-08 | Cada alarma toma su senal de **metrica nativa** cuando existe; de filtro de log solo lo que unicamente el dominio sabe contar | Derivarlas todas de los logs de la aplicacion, que es mas uniforme: si el `handler` del barrido lanza antes de su primera linea, un filtro no ve nada y **calla**, que es exactamente el fallo que R6 existe para gritar |
| 2026-09-08 | La contencion se vigila con `TransactionConflict` de DynamoDB | `ConditionalCheckFailedRequests`, que parece la metrica obvia: la adjudicacion se gana con escritura condicional (regla 6), asi que en cada lote N-1 intentos fallan su condicion **por diseno** y la alarma estaria disparada siempre |
| 2026-09-08 | Trazas propias por `correlacionId` en lugar de **AWS X-Ray** | X-Ray: responde "donde se fue el tiempo entre servicios" y aqui hay un proceso hablando con DynamoDB. La pregunta real —"que le paso a esta solicitud"— la responde el `correlacionId` que ya comparte con la bitacora, sin SDK, sin permiso de IAM y sin costo por traza |
| 2026-09-08 | `loteId` **no** es dimension de ninguna metrica; vive en la linea de registro | "Solicitudes por lote" como metrica dimensionada, que es lo que pedia `arquitectura-tecnica-aws.md` 7: CloudWatch cobra por combinacion de dimensiones y `loteId` es de cardinalidad ilimitada y creciente — seria una serie por cada lote que haya existido, para siempre. Logs Insights responde lo mismo sin cobrarse por serie |
| 2026-09-08 | El registro operativo se **silencia dentro de Vitest**, comprobando `VITEST` | Una variable propia del tipo `REGISTRO_OPERATIVO=off`: seria una palanca para apagar todo el diagnostico en produccion sin que nada lo delate, justo el fallback silencioso que prohibe la regla 15. `VITEST` no se puede activar por error en un despliegue |
| 2026-09-08 | `style-src 'unsafe-inline'` **se queda**, y el pendiente del 2026-09-04 se cierra como riesgo aceptado | Endurecerlo, que era la expectativa de la Etapa 12: Eden no publica ningun `.css` —monta cada hoja con `<style href precedence>` de React 19, sin nonce que pasarle— y ademas usa atributos `style={{...}}` en `eden-table`, `eden-form-parts` y `eden-grid`. Partir la directiva en `-elem` y `-attr` no gana nada: las dos necesitan el mismo permiso |
| 2026-09-08 | Los GSIs se quedan en `ALL`; **no** se estrechan a `INCLUDE` | Estrecharlos, que era lo que este plan preveia para la Etapa 12: DynamoDB cobra la escritura en bloques de 1 KB redondeando hacia arriba, asi que el ahorro es **cero** en solicitudes (~600 B) y eventos (~400 B) —el volumen real— y solo aparece en vehiculos y convocatorias, que se escriben unas pocas veces al mes. Menos de un centavo al mes contra una decision irreversible que exige recrear el indice con PA-05 y PA-11 caidas |
| 2026-09-08 | La prueba de carga es un **arnes aparte**, tras la bandera `CARGA_APERTURA` | Ampliar la prueba de concurrencia de la Etapa 8: responden preguntas distintas —aquella, correccion sobre un lote; esta, capacidad de la convocatoria entera— y meter cientos de escrituras contra AWS en la compuerta deshace la decision que creo `verify:rapido` |
| 2026-09-08 | La prueba de carga mide **con los reintentos del SDK**, como produccion | Medir con `maxAttempts: 1`, que fue el primer intento: sin reintentos se mide una configuracion que el sistema no tiene, y la latencia que importa es la que percibe el participante. El modo sin reintentos se conserva tras `CARGA_SIN_REINTENTOS=1` porque como **diagnostico** si valio: descubrio el defecto de la seccion 41 |
| 2026-09-08 | El paso 1 de T1 traduce `TransactionConflictException` a `conflicto_concurrencia` | Dejarla escapar, que era el comportamiento anterior: el SDK la reintenta y casi nunca llega, pero con contencion sostenida los tres intentos se agotan y el participante recibe un 500 en `inicioVenta` en lugar del "relee y reintenta" que el diseno define para una carrera perdida |
