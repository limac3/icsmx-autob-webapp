# Runbooks — Operacion e Incidentes

Procedimientos para operar la aplicacion y responder a incidentes.

**Todo runbook debe haberse ejecutado al menos una vez antes de salir a produccion**
(Etapa 12). Un procedimiento no probado es una suposicion.

## Quien ejecuta cada paso

Estos procedimientos los ejecutan dos partes distintas, y **cada paso dice cual**:

| Marca | Quien | Por que |
| --- | --- | --- |
| **[OPERADOR]** | La persona con credenciales de AWS, consola y secretos | Requiere una sesion humana: consola de AWS, SSO, verificacion de correo, custodia de llaves privadas |
| **[AGENTE]** | Claude Code, con la terminal del proyecto | Es codigo, comandos o pruebas dentro del repositorio |

Un paso sin marca es **[OPERADOR]**: ante la duda, lo hace la persona.

> **El agente no gestiona accesos.** Si un procedimiento requiere una credencial que no
> tiene, **la solicita y se detiene**; no intenta obtenerla por su cuenta ni lanza flujos que
> abran un navegador. `aws sso login` es del operador, siempre.

---

## 0. Antes de tocar nada

1. **Anota la hora en UTC y en hora de Ciudad de Mexico.** Toda la bitacora esta en UTC.
2. **La bitacora es la fuente de verdad**, no la pantalla. Consulta `AUDIT#LOTE#<loteId>`.
3. **Nunca edites ni borres un item `AUDIT#`.** Ademas de estar prohibido por IAM, un error se
   corrige con un evento compensatorio (R-20).
4. **Prefiere siempre la accion de la aplicacion a la escritura directa en DynamoDB.** Una
   escritura manual no genera evento de auditoria y rompe la trazabilidad. Si no queda mas
   remedio, ver R-6.

---

## R-1 — El barrido de vencimientos no se ejecuta

**Sintoma:** alarma de barrido, o adjudicaciones con `venceEn` pasado que siguen vigentes.

**Impacto:** medio. La verificacion perezosa (D-7) resuelve cada fila al ser consultada, asi que
el sistema se autocorrige donde hay actividad. Lo que queda bloqueado son los lotes que nadie
mira.

**Diagnostico:**

1. Ultima ejecucion de la Lambda y su error.
2. `Query` GSI4 `VENCE#<dia>` con `GSI4SK <= ahora` → cuantas adjudicaciones vencidas quedan.
3. Revisa varios dias: el indice esta particionado por dia de vencimiento.

**Resolucion:**

1. Corrige la causa (permisos, timeout, error de codigo).
2. Invoca la Lambda manualmente. **Es idempotente**: reejecutarla es seguro.
3. Verifica que la consulta de GSI4 quede vacia.
4. Confirma que los `SOLICITUD_VENCIDA` generados traen `detectadoPor: BARRIDO`.

**Si no se puede restaurar pronto:** no hace falta accion manual masiva. Cada lectura de fila
resuelve su propio vencimiento. Comunica la demora y prioriza el arreglo.

---

## R-2 — Correos no se entregan

**Sintoma:** alarma de outbox, o un adjudicado reporta que no recibio aviso.

**Impacto:** alto para el participante. Su plazo corre aunque no le haya llegado el correo.

**Diagnostico:**

1. `Query` GSI4 `OUTBOX_PENDIENTE` → antiguedad de lo encolado.
2. Eventos `CORREO_FALLIDO` y su motivo.
3. Respuesta de **CES** al ultimo intento: codigo HTTP y cuerpo. Un `401` es credenciales
   (`CES_USER`/`CES_PASSWORD`); un `4xx` con detalle suele ser el JSON mal formado o un
   destinatario rechazado; un `5xx` o un timeout es indisponibilidad del servicio y se
   reintenta solo.

**Resolucion:**

1. Corrige la causa (credenciales, formato del mensaje, o esperar a que CES se restablezca).
2. Reejecuta el procesador del outbox. Los mensajes pendientes se reintentan solos.
3. Para un caso puntual, reencola con el runbook R-3.

> **Si el correo estuvo caido durante una ventana de venta, evalua ampliar el plazo de los
> adjudicados afectados (R-5).** No es justo vencer a alguien que nunca fue notificado. La
> decision es de negocio, no de operacion — escalala.

---

## R-3 — Reenviar la notificacion de adjudicacion

**Cuando:** el participante no recibio el correo, o lo perdio.

1. Confirma que la solicitud sigue `ADJUDICADA` y con plazo vigente.
2. Encola un mensaje nuevo en el outbox para esa solicitud.
3. Verifica el evento `CORREO_ENVIADO`.

**No modifiques `venceEn`.** Reenviar notifica; no amplia el plazo. Si ademas hace falta ampliar,
es el runbook R-5 y es una decision distinta que debe quedar registrada como tal.

---

## R-4 — Un lote quedo bloqueado

**Sintoma:** un lote con fila no adjudicado, o `ADJUDICADO` con la solicitud ya resuelta.

**Diagnostico:**

1. `GetItem` del lote: `estatus`, `adjudicacionActual`, `venceEn`.
2. `Query` de la fila (PA-07) en orden de turno.
3. `Query` de `AUDIT#LOTE#<loteId>` para ver el ultimo acto y su `correlacionId`.

**Casos:**

| Sintoma | Causa probable | Accion |
| --- | --- | --- |
| `adjudicacionActual` apunta a una solicitud terminal | Una transaccion se cancelo a medias | Ejecutar T5 manualmente |
| Lote `EN_OFERTA` con fila viva | Adjudicacion no disparada | Invocar la adjudicacion (T2) |
| Todas las solicitudes `CONGELADA` | Sus titulares tienen adjudicacion activa en otros lotes | **Correcto.** Se desbloquea solo (R-09) |
| `adjudicacionActual` con valor `null` | Se uso `SET ... = null` en lugar de `REMOVE` | **Defecto de codigo.** Corregir el codigo y sanear el item |

El ultimo caso rompe toda la exclusion mutua: `attribute_not_exists` da falso con un `null`
presente y el lote se puede adjudicar dos veces. Trata el hallazgo como incidente grave.

---

## R-5 — Ampliar el plazo de una adjudicacion

**Cuando:** el sistema fallo de forma atribuible (correo caido, indisponibilidad durante el
plazo). **Nunca** por cortesia.

**Requiere aprobacion de negocio y queda registrado.**

1. Documenta el motivo y la duracion.
2. Actualiza `venceEn` en la solicitud **y sus claves GSI4**, para que el barrido use la fecha
   nueva. Olvidar GSI4 la vence con el plazo viejo.
3. Escribe un evento compensatorio con actor, motivo y autorizacion.
4. Notifica al participante.

---

## R-6 — Revertir una adjudicacion erronea

**Ultimo recurso.** Solo con autorizacion de negocio documentada.

1. Reune la evidencia desde la bitacora: por que la adjudicacion fue incorrecta.
2. **No borres ni edites ningun evento.**
3. Ejecuta la reversion mediante acciones de la aplicacion donde sea posible.
4. Si hay que escribir directo en DynamoDB, escribe **en la misma transaccion** el evento
   compensatorio con actor, motivo y autorizacion. Una escritura manual sin evento rompe la
   trazabilidad y es exactamente lo que el sistema existe para impedir.
5. Notifica a los afectados: al que pierde la adjudicacion y al que la recibe.
6. Verifica la integridad del lote (`verificarIntegridad`).

---

## R-7 — Un participante no ve una convocatoria que deberia ver

Recorre el gating triple (R-01) **en este orden**:

1. `estatus = PUBLICADA`.
2. `publicadaEn <= ahora`. **Comparalo en UTC**, no en hora local: es la confusion mas frecuente.
3. Tipo compatible: convocatoria `EMPLEADOS` solo para quien tiene `Autob_Venta_a_empleados`.
4. Permisos del participante en EAS. Si EAS estaba caido, la sesion debio fallar de forma
   explicita, no dejarlo con el conjunto de permisos vacio — si ves un usuario "sin permisos",
   descarta primero que no sea un `ErrorConsultaEas` mal manejado aguas arriba.
5. Cache: si el estatus y las fechas son correctos pero no aparece, **es cache** (riesgo R4).
   Fuerza `revalidateTag("convocatorias:visibles")` y registra el hallazgo — significa que una
   ruta dependiente de `publicadaEn` quedo cacheada, que es un defecto a corregir.

---

## R-8 — Sospecha de orden injusto en una fila

El incidente mas delicado. Se responde con datos, no con opiniones.

1. `reconstruirFila(loteId)` y `verificarIntegridad(loteId)`.
2. Verifica en la bitacora:
   - Turnos **unicos y estrictamente crecientes**. Los huecos son legitimos (T1) y no son
     evidencia de nada.
   - Cada adjudicacion fue al turno vivo menor **o** existe un `SOLICITUD_OMITIDA` que explica
     cada salto.
   - No hubo dos adjudicaciones vigentes simultaneas.
3. Si todo cuadra, responde con la reconstruccion como evidencia. **Los huecos de turno son la
   objecion mas comun y son inofensivos**: la equidad depende del orden relativo, no de la
   contiguidad. Ten la explicacion lista.
4. Si algo **no** cuadra, es un incidente grave: congela la convocatoria afectada, escala y
   preserva la evidencia. No intentes arreglarlo antes de documentarlo.

---

## R-9 — Fallo de certificado desde Node en la maquina de desarrollo

**Sintoma:** `UNABLE_TO_VERIFY_LEAF_SIGNATURE` en `npm install`, `npx ampx sandbox` o los SDK de
AWS.

**Causa:** inspeccion TLS corporativa. Node no usa el almacen de certificados de Windows.

**Resolucion:**

1. `echo $env:NODE_EXTRA_CA_CERTS` — debe apuntar al PEM del CA corporativo.
2. Si falta, configuralo como variable de usuario y reinicia la terminal.
3. Si el CA rotó, reexporta el PEM desde el almacen de Windows.

**Nunca uses `NODE_TLS_REJECT_UNAUTHORIZED=0`.** Desactiva la verificacion TLS de todo el
proceso, incluidas las llamadas a AWS.

Ver seccion 1 de `desafios-implementacion.md`.

---

## R-10 — Despliegue fallido o reversion

1. Revisa el registro de build. Si es fallo de dependencias privadas, verifica
   `NODE_AUTH_TOKEN` y `.npmrc` (riesgo R10).
2. Revierte al despliegue anterior desde Amplify Hosting.
3. **Las migraciones de datos no se revierten solas.** Si el despliegue cambio la forma de algun
   item, evalua el impacto antes de revertir el codigo: una version anterior puede no entender
   los items nuevos.
4. Documenta la causa en `desafios-implementacion.md`.

---

## R-11 — Preparar un entorno nuevo (o un sandbox personal)

Es un procedimiento **a cuatro manos**: alterna entre el operador y el agente, y ninguno lo
completa solo. El orden importa — cada paso depende del anterior.

### Paso 0 — Habilitar el acceso a AWS · **[OPERADOR]**

```bash
aws sso login --profile aws-church-dev
```

Solo el operador puede hacerlo: abre un navegador y exige una sesion humana. **El agente no
lo lanza**; si detecta el token vencido, lo reporta y espera.

En la primera preparacion, aprovecha para resolver el riesgo **R1**: confirmar que la cuenta
permite crear apps de Amplify Gen2 y que existe un camino de despliegue aprobado. Si no lo
hay, **detener** y decidir entre gestionarlo o migrar el IaC a Terraform/ECS.

### Paso 1 — Llave de CloudFront · **[OPERADOR]** en entornos compartidos · **[AGENTE]** en un sandbox personal

Sin ella el backend falla al sintetizar, a proposito: una distribucion sin grupo de llaves de
confianza serviria las fotografias a cualquiera que conociera la URL.

```bash
openssl genrsa -out cloudfront-privada.pem 2048
openssl rsa -pubout -in cloudfront-privada.pem -out amplify/claves/cloudfront-publica.pem
```

La publica se versiona; la privada va a `CLOUDFRONT_PRIVATE_KEY` (secreto) y el `.gitignore`
de `amplify/claves/` impide versionarla. **Rotarla invalida todas las URLs firmadas
vigentes**, asi que no se regenera por costumbre.

En desarrollo o produccion la genera el operador y la privada nunca sale de su custodia. En un
sandbox personal —cuyos datos son desechables— el agente puede generarla si el operador lo
autoriza.

### Paso 2 — Credenciales de CES · **[OPERADOR]**

El correo transaccional sale por **CES** (Church Email Service), un servicio REST corporativo,
no por SES. No hay nada que preparar en AWS: son `CES_URL`, `CES_USER`, `CES_PASSWORD` y
`CES_FROM_ADDRESS`, en `.env.local` para el sandbox local o como secretos de Amplify
(`ampx sandbox secret set <nombre>`) para un sandbox personal desplegado o una rama compartida.

**CES aun no esta aprobado para este proyecto** (riesgo R17). El backend ya declara las
**referencias** a estos cuatro secretos desde la Etapa 10 (`amplify/backend.ts`) y despliega
igual sin que existan sus valores — declarar la referencia no exige que el valor ya este puesto.
Lo que si exige un valor es **ejecutar** el procesador del outbox: sin el, cada intento de envio
falla con "Falta configuracion de CES" (sin fallback silencioso, regla 15) y los mensajes se
acumulan `PENDIENTE`, sin afectar la fila ni la adjudicacion (D-6).

### Paso 3 — Desplegar el backend · **[AGENTE]**

```bash
npx ampx sandbox
```

Produce `amplify_outputs.json`, de donde salen el nombre de la tabla y el ARN del rol.

### Paso 4 — Verificar que la bitacora es inmutable · **[AGENTE]**

```bash
npx vitest run amplify/auditoriaInmutable.integracion.test.ts
```

Si se **omite** en vez de correr, es que no encontro `amplify_outputs.json`: el paso 3 no
termino. No requiere el paso 5 — la prueba asume el rol directamente con STS.

### Paso 5 — Adjuntar el rol de computo SSR · **[OPERADOR]**

Amplify Hosting no forma parte de `defineBackend`, asi que el rol se crea en la pila pero la
asociacion es un paso de consola: **App settings > IAM roles > Compute role**, eligiendo el
ARN que aparece en `amplify_outputs.json` bajo `custom.autob.rolComputoSsr`.

Sin este paso la aplicacion desplegada no puede leer la tabla; con el, hereda tambien el
`Deny` que hace inmutable la bitacora. Se puede cambiar sin redesplegar.

Solo aplica a una app de Amplify Hosting ya creada — **un sandbox local no lo necesita**,
porque ahi la aplicacion corre con las credenciales del operador.

---

## R-12 — Recorrer el flujo completo en local · **[AGENTE]** o **[OPERADOR]**

Para probar el ciclo entero hacen falta **varias identidades**, no varios permisos: quien crea
una convocatoria no puede aprobarla (`self_approval`) y una fila de un participante no tiene
orden. Eso lo da el conmutador de identidad simulada (`identidad-autorizacion.md` 4.1.1).

**Preparacion.** En `.env.local`, `ENABLE_DEV_TOOLS=FULL`. Reiniciar `npm run dev` — las
variables de entorno se leen al arrancar, no por peticion. Iniciar sesion con Okta una vez: la
impersonacion no sustituye la autenticacion. Aparece una barra abajo a la derecha; se despliega
y se elige la persona.

| Paso | Persona | Que hacer | Que comprobar |
| --- | --- | --- | --- |
| 1 | Ana (admin) | Alta de vehiculo con fotografia | Queda `DISPONIBLE` |
| 2 | Ana | Crear convocatoria, incluir el lote, enviar a aprobacion | `horasLiquidacion` **en 1** si se va a probar el vencimiento; con 48 hay que esperar dos dias |
| 3 | Beto (aprobador) | Aprobar desde `/aprobaciones` | Ana no puede aprobarla: es la guarda, no un defecto |
| 4 | Ana | Publicar | Con `inicioVenta` ya pasado, si se quiere comprar de inmediato |
| 5 | Elena (solo publico) | Abrir el catalogo | Una convocatoria de tipo `EMPLEADOS` **no aparece** — tercera pata del gating (R-01) |
| 6 | Carla (empleada) | Entrar a la fila | Turno 1, y queda `ADJUDICADA` sin esperar ningun proceso de fondo |
| 7 | Dario (empleado) | Entrar a la misma fila | Turno 2, `EN_FILA` |
| 8 | Carla | Subir comprobante | Pasa a `EN_VERIFICACION` |
| 9 | Fabio (tesoreria) | Avalar o rechazar | Al avalar, el lote se vende y la fila restante se cierra; al rechazar, se reasigna a Dario |
| 10 | Gina (auditora) | Revisar la bitacora del lote | Todas las transiciones con su actor `dev-*` |

**Dos participantes a la vez.** La eleccion vive en una cookie, no en el servidor: una ventana
normal y una de incognito son dos personas distintas al mismo tiempo, que es la unica forma de
ver la fila moverse sin conmutar de ida y vuelta.

**Vencimiento sin esperar.** Con `horasLiquidacion=1`, pasada la hora basta con que Carla o
Dario abran la pantalla del lote: la verificacion perezosa de D-7 resuelve el vencimiento en esa
misma lectura, sin depender del barrido programado.

Los datos que se generen llevan `participanteId` con prefijo `dev-`, asi que se distinguen de
cualquier dato real en la misma tabla. Los correos van a un dominio `.invalid` y no pueden
salir.

---

## Consultas de diagnostico frecuentes

| Necesidad | Consulta |
| --- | --- |
| Estado de un lote | `GetItem` `PK=CONV#<id>`, `SK=LOTE#<loteId>` |
| Fila en orden | `Query` `PK=LOTE#<id>`, `begins_with(SK,"SOL#")`, `ScanIndexForward: true` |
| Historia de un lote | `Query` `PK=AUDIT#LOTE#<loteId>` |
| Vencidos pendientes | `Query` GSI4 `VENCE#<dia>`, `GSI4SK <= ahora` |
| Correos atorados | `Query` GSI4 `OUTBOX_PENDIENTE` |
| Actividad de un participante | `Query` `PK=AUDIT#PART#<participanteId>` |
| Todo lo de un dia | `Query` GSI2 `AUDIT#<yyyy-mm-dd>` |

---

## Escalamiento

| Situacion | Accion |
| --- | --- |
| Dos adjudicaciones vigentes en un lote | **Critico.** Congelar la convocatoria, preservar evidencia, escalar de inmediato |
| Sospecha de bitacora alterada | **Critico.** Preservar, escalar, revisar politicas IAM |
| Fila bloqueada durante una venta activa | Alto. Aplicar R-4; si no se resuelve, escalar |
| Correo caido durante una ventana de venta | Alto. Aplicar R-2 y evaluar ampliacion de plazos con negocio |
| Barrido caido con verificacion perezosa operando | Medio. Aplicar R-1 en horario habil |
