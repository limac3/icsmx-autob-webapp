# Plan de Ejecucion — icsmx-autob-webapp

Fuente de verdad del avance del proyecto. Cada etapa se marca `[x]` solo cuando **todos** sus
entregables estan hechos y su compuerta de calidad pasa en verde.

> Ultima actualizacion: 2026-09-04 — **Etapa 1 completada.** Siguiente: Etapa 2 (identidad y autorizacion).

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
npm run verify     # lint + test + format check, limpio
npm run build      # build de produccion exitoso
```

Ademas, de la Definition of Done de `CLAUDE.md`:

- [ ] Pruebas unitarias de las validaciones y reglas de negocio puras de la etapa
- [ ] Casos **allow** y **deny** de autorizacion cubiertos por rol
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
- [x] `agent_files/permission-matrix.md` — matriz rol x accion
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
- [x] Los seis roles y los nombres de estado son identicos en `proyecto.md`,
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

**Objetivo:** saber quien entra, de que tipo es y que puede hacer. Sin datos de negocio aun.

**Dependencias:** Etapa 1.

- [x] `src/lib/auth/auth0.ts` — cliente `Auth0Client` apuntando a Okta, con helper que devuelve
      valor de relleno durante `next build` para no exigir secretos en build
- [x] `src/proxy.ts` — middleware del SDK, resolucion de idioma y `Cache-Control: no-store` en
      rutas autenticadas (Next.js 16 usa `proxy`, no `middleware`) — incluye ademas CSP con nonce
      por peticion (ver `arquitectura-tecnica-aws.md` seccion 5)
- [x] `src/lib/auth/session.ts` — `getSession()` con `import "server-only"`, devuelve
      `{ participanteId, oktaSub, correo, nombre, roles, tipoParticipante }` o `null`
      (`participanteId` = `oktaSub` hasta el *upsert* real de la Etapa 4 — ver
      `desafios-implementacion.md` seccion 8)
- [x] `src/lib/auth/eas.ts` — adaptador conmutable (real / mock) segun `ENABLE_DEV_TOOLS`
- [x] `src/lib/auth/easAdapter.ts` — consulta real con timeout; **sin fallback silencioso**:
      si EAS falla, error explicito (regla 15)
- [x] `src/lib/auth/devMode.ts` — `ENABLE_DEV_TOOLS`, lanza error si no es `OFF` en produccion
- [x] `src/lib/auth/permisos.ts` — `puedeEjecutar({ accion, roles, contexto })` puro, sin I/O,
      derivado linea por linea de `permission-matrix.md`
- [x] `src/types/identidad.ts` — tipos de rol, tipo de participante y sesion
- [x] Pagina protegida de prueba que muestra rol y tipo de participante (`src/app/sesion/page.tsx`
      + `src/app/forbidden.tsx`)
- [x] `src/lib/auth/permisos.test.ts` — casos **allow y deny para los seis roles** (cobertura
      cartesiana completa de las 33 acciones, mas los 7 invariantes de `permission-matrix.md`)
- [x] `src/proxy.test.ts`

**Verificacion:**

- [x] Compuerta de calidad completa en verde
- [x] Un usuario sin sesion es redirigido a login — verificado con `curl` contra `npm run dev`
      (307 a `/auth/login`)
- [x] Un usuario con sesion pero sin rol suficiente recibe 403, no 500 — mecanismo verificado
      (`forbidden()` + `experimental.authInterrupts`, documentado por Next.js; `build` confirma
      que compila). El recorrido de punta a punta exige una sesion real de Okta, que no existe en
      este entorno de desarrollo; queda pendiente de una verificacion manual cuando haya
      credenciales de un tenant de prueba
- [x] Cobertura de allow y deny para cada uno de los seis roles

**Salida esperada:** login real contra Okta y decisiones de permiso probadas de forma aislada.

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
- [ ] **PENDIENTE — bloqueado por la primera tarea.** `npx ampx sandbox` levanta el backend
      personal sin errores. Lo verificable sin AWS ya se verifico: `amplify/backend.test.ts`
      sintetiza `backend.ts` completo —incluido el empaquetado del Lambda del barrido— y
      comprueba la pila, los permisos heredados y las variables de entorno. Falta solo el
      despliegue real

**Verificacion:**

- [x] Compuerta de calidad completa en verde
- [ ] **ESCRITA, PENDIENTE DE EJECUTAR.** Prueba de integracion que confirma que **escribir**
      un item `AUDIT#` funciona y que **modificarlo o borrarlo es rechazado por IAM**
      (`amplify/auditoriaInmutable.integracion.test.ts`). Asume el rol real de computo SSR, no
      credenciales de desarrollador. Se omite sola mientras no haya sandbox desplegado, para
      que la compuerta corra en una maquina sin AWS. La cobertura que **si** corre hoy esta en
      `amplify/infraestructura.test.ts`: la politica existe con las acciones y la condicion
      exactas
- [ ] **ESCRITA, PENDIENTE DE EJECUTAR.** La tabla responde a un `PutItem` y un `Query` de
      humo desde la aplicacion (en el mismo archivo de integracion)

**Salida esperada:** sandbox funcional y auditoria demostrablemente inmutable.

---

## Etapa 4 — Dominio y capa de datos

**Objetivo:** las reglas puras y el acceso a datos, probados sin UI.

**Dependencias:** Etapas 2 y 3.

Dominio puro, sin I/O (`src/lib/domain/`):

- [ ] `fechas.ts` — constante `America/Mexico_City`, formateo con
      `Intl.DateTimeFormat().formatToParts`, conversion desde y hacia ISO-8601 UTC (regla 9)
- [ ] `ventanas.ts` — esta publicada, esta abierta la venta, esta cerrada
- [ ] `plazos.ts` — calculo de vencimiento en **horas naturales** desde la adjudicacion
- [ ] `transiciones.ts` — transiciones validas de las cuatro maquinas de estado
- [ ] `gating.ts` — el gating triple de convocatoria (estatus, `publicadaEn`, tipo)
- [ ] Un `.test.ts` por cada uno, con casos limite de zona horaria y de frontera de ventana

Capa de datos (`src/lib/data/`):

- [ ] `cliente.ts` — `DynamoDBDocumentClient` singleton diferido
- [ ] `claves.ts` — constructores de `PK`/`SK` por entidad, con tests
- [ ] `transacciones.ts` — helpers de `TransactWriteItems` y traduccion de
      `TransactionCanceledException` a errores de dominio
- [ ] Convencion de inyeccion de dependencias `(input, deps = {})` en todos los servicios

**Verificacion:**

- [ ] Compuerta de calidad completa en verde
- [ ] Los tests de dominio corren **sin red ni AWS**
- [ ] Casos de frontera cubiertos: instante exacto de publicacion, de apertura, de cierre y de
      vencimiento; horario de verano si aplica

**Salida esperada:** reglas de negocio probadas de forma aislada y determinista.

---

## Etapa 5 — Administracion de vehiculos

**Objetivo:** que un administrador registre vehiculos con sus fotografias.

**Dependencias:** Etapa 4.

- [ ] `src/lib/vehiculos/` — crear, editar, listar, obtener, retirar
- [ ] `src/app/actions/vehiculos.ts` — Server Actions con guarda de sesion y permiso
- [ ] Validacion de los atributos: marca, version, modelo (anio), nivel de equipamiento,
      especificacion mecanica, condiciones mecanicas, detalles esteticos, kilometraje
- [ ] `src/lib/media/` — subida a S3, normalizacion de imagenes, fotografia principal y
      adicionales, orden de galeria
- [ ] `src/lib/media/cloudfrontSigner.ts` — firma en SSR; **nunca** persistir la URL firmada ni
      generarla dentro de un bloque `"use cache"` (regla 13)
- [ ] Pantallas de alta, edicion y listado de vehiculos
- [ ] Tests de validacion, de autorizacion y de la capa de media

**Verificacion:**

- [ ] Compuerta de calidad completa en verde
- [ ] Un rol no administrador recibe `forbidden` en cada action
- [ ] Ninguna URL firmada aparece persistida en la tabla
- [ ] Alta de vehiculo con fotografias funciona de punta a punta contra el sandbox

**Salida esperada:** catalogo de vehiculos administrable.

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
- [ ] Tests de transiciones validas e invalidas y de autorizacion por rol

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
- [ ] Tests de gating: un `OTRO_USUARIO` **no** ve una convocatoria de empleados aunque conozca
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

- [ ] `src/lib/fila/solicitarCompra.ts` — en **una sola** `TransactWriteItems`:
  - [ ] `ADD` atomico al contador de turnos **del lote** para obtener `turno` (regla 3)
  - [ ] Item de solicitud con `turno`, `solicitadoEn` informativo y estado `EN_FILA`
  - [ ] Condicion de unicidad: el participante no puede tener dos solicitudes en el mismo lote
  - [ ] Evento de auditoria en la misma transaccion (regla 4)
- [ ] `src/lib/fila/adjudicar.ts` — adjudicacion por **escritura condicional**
      `attribute_not_exists(adjudicacionActual)`, jamas leer-y-decidir (regla 6)
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
- [ ] Acceso de **solo lectura** para `AUDITOR_CUMPLIMIENTO`, sin ninguna action de mutacion
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
| 2026-09-04 | Importaciones relativas con extension `.js` en `amplify/backend.ts` | Sin extension, como en la documentacion de Amplify: falla en el paso de ensamblado de CDK, que ejecuta el archivo con el resolvedor ESM de Node (`Cannot find module`) |
