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

**Mensajes en `ENVIANDO`:** es una adquisicion con plazo, no un estado atascado. Una corrida del
barrido lo pone antes de llamar a CES para que dos corridas solapadas no manden el mismo correo dos
veces, y lo quita al resolverlo. Un `ENVIANDO` con `leaseHasta` **futuro** esta en vuelo ahora
mismo; con `leaseHasta` **pasado** significa que la corrida que lo tenia murio, y la siguiente lo
retoma sola —hasta 15 minutos, `LEASE_MS`—. No hay que sanearlo a mano.

Lo que **si** hay que mirar: si `enVuelo` de la linea de traza es alto de forma sostenida, las
corridas se estan solapando mucho, y si `sinPresupuesto` no baja, la mora es mayor de lo que una
corrida alcanza a drenar (`PRESUPUESTO_DE_ENVIO_MS`). Las dos se ven aqui:

```
fields @timestamp, message.enviados, message.enVuelo, message.sinPresupuesto, message.reintentaraDespues
| filter message.operacion = "procesarOutbox"
| sort @timestamp desc
```

**Un correo duplicado es posible y esta acotado:** si el proceso muere entre que CES acepta y que se
escribe `ENVIADO`, el reintento lo reenvia. CES no ofrece clave de idempotencia, asi que esa ventana
no se cierra desde la aplicacion. El contenido es un aviso —monto, plazo y enlace a la pagina del
lote—, sin token ni enlace de pago: molesto, no peligroso. Ver `desafios-implementacion.md` 57.

### Mensajes en `CANCELADO` — un ambiente de pruebas sin CES

**`CANCELADO` es "nunca se intento y no se va a intentar"**, distinto de `FALLIDO` ("se intento y
CES lo rechazo o estaba caido"). Hoy tiene una sola causa: el entorno no tiene configuracion de CES,
y **solo ocurre con `APP_ENV=pruebas`** (D-18). En produccion, faltar la configuracion lanza y hay
que arreglar el despliegue — no se descarta correo con datos reales.

No hay nada que sanear: el mensaje sale de GSI4 porque no hay trabajo pendiente, y reintentarlo cada
cinco minutos contra un entorno sin CES no cambia nada. Volver a notificar es **R-3**, que encola un
mensaje nuevo.

**La linea del registro es el sustituto del correo**, y con ella se verifica que la notificacion se
habria generado bien cuando no hay bandeja donde mirar:

```
fields @timestamp, message.mensajeId, message.asunto, message.loteId, message.solicitudId,
       message.vehiculoId, message.precio, message.venceEn, message.faltan
| filter message.operacion = "procesarOutbox" and message.desenlace = "cancelado"
| sort @timestamp desc
```

`message.faltan` nombra las variables ausentes, que es lo que se arregla. **`message.destinatario`
sale como `[redactado]` a proposito**: el registro operativo no acumula identidad de personas
(D-13). A quien le tocaba el correo esta en la **bitacora** —evento `CORREO_FALLIDO` anclado al
lote, con el `solicitudId`—, que es donde la identidad si pertenece.

Y el contador de la corrida, para ver que se drena la mora:

```
fields @timestamp, message.cancelados, message.enviados, message.antiguedadMaximaMin
| filter message.operacion = "procesarOutbox"
| sort @timestamp desc
```

**Los cancelados no cuentan como `fallidosPermanentes`**, asi que la alarma `correos-fallidos` no se
dispara con ellos. Es deliberado: en un ambiente sin CES aprobado los dispararia en cada corrida, y
una alarma que suena siempre es una alarma que nadie cree.

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
| Lote `VENDIDO` o `NO_VENDIDO` con solicitudes `EN_FILA`/`CONGELADA` | El cierre de fila de `avalarPago` fallo despues de que la venta quedo firme | **Se repara solo** en la corrida siguiente del barrido. Confirmar con la consulta de abajo; si persiste dos corridas, es un fallo sostenido y hay que mirar el motivo |

El caso del `null` rompe toda la exclusion mutua: `attribute_not_exists` da falso con un `null`
presente y el lote se puede adjudicar dos veces. Trata el hallazgo como incidente grave.

**Si el cierre de fila fallo**, la linea que lo dice es esta (Logs Insights):

```
fields @timestamp, message.loteId, message.error, message.descripcion
| filter message.operacion = "cerrarFilaDelLote"
| sort @timestamp desc
```

Es la unica senal: la venta salio con exito y nadie mas la reporta. La reparacion la hace
`barridoDeVencimientos` al recorrer los lotes de las convocatorias `PUBLICADA`, y se cuenta en
`filasCerradas` de su linea de traza. Un `filasCerradas` distinto de cero **de forma sostenida** no
es el barrido trabajando: significa que cada venta esta fallando su cierre y hay que buscar la causa
aguas arriba.

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
`CES_FROM_ADDRESS`, en `.env.local` para trabajar en local, y como **secretos** para un backend
desplegado — `npx ampx sandbox secret set <nombre>` en un sandbox personal; desde la consola de
Amplify o en SSM para una rama, porque no hay comando de CLI para ramas. El detalle, con el formato
de la ruta en SSM, esta en **R-14**, seccion "CES — destino B".

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

### Paso 6 — Confirmar la suscripcion de las alarmas · **[OPERADOR]**

Solo en un entorno que alguien tenga que vigilar; un sandbox personal puede quedarse sin
suscriptor a proposito.

1. Antes de desplegar, poner `ALARMAS_CORREO` con la direccion que recibira los avisos. **Es lo
   unico que este paso no puede arreglar despues sin redesplegar**: sin la variable, el tema de
   SNS se crea vacio.
2. Tras el despliegue, AWS manda un correo de confirmacion a esa direccion. **Hay que aceptarlo.**
   Una suscripcion `PendingConfirmation` en la consola de SNS parece configurada y no entrega
   nada — el modo de fallo mas peligroso de todo este paso, porque el silencio se confunde con
   calma.
3. Comprobar que las seis alarmas existen en CloudWatch y no estan en `ALARM`.
   `barrido-sin-ejecutar` tarda hasta 15 minutos en salir de `INSUFFICIENT_DATA`; las que
   dependen de un filtro de metrica no publican su primer punto hasta que el barrido corre y
   produce una linea que coincida.
4. **Ejecutar una de verdad al menos una vez**, que es lo que exige la Etapa 12 de todo runbook:
   la forma barata es cambiar temporalmente el umbral de una alarma en la consola para que se
   dispare, confirmar que el correo llega, y devolver el umbral. Asi se prueba el camino
   completo —alarma, tema, suscripcion, buzon— sin provocar un incidente real.

Para agregar destinatarios despues sin redesplegar, suscribirlos al tema cuyo ARN sale en
`amplify_outputs.json` bajo `custom.autob.temaDeAvisos`.

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

## R-13 — Una alarma se disparo (o nunca avisa)

**Sintoma:** llego un aviso de CloudWatch, o se sospecha que las alarmas no avisan a nadie.

**Cada alarma lleva su runbook en la descripcion.** El nombre indica el sintoma y
`AlarmDescription` remite al procedimiento; no hay que adivinar el mapeo:

| Alarma | Lleva a |
| --- | --- |
| `...-barrido-sin-ejecutar` | R-1 |
| `...-barrido-con-errores` | R-1 |
| `...-vencimientos-sin-resolver` | R-4. **Es el sintoma mas grave del sistema**: los dos caminos de D-7 fallaron |
| `...-outbox-retrasado` | R-2 |
| `...-correos-fallidos` | R-2, y R-3 para reencolar un caso puntual |
| `...-contencion-de-transacciones` | R-4, y las consultas de cancelacion de arriba |

**Si no llega ningun aviso** — el caso mas peligroso, porque el silencio se confunde con calma:

1. Comprueba que `ALARMAS_CORREO` estaba puesta al desplegar. **Sin ella el tema de SNS se crea
   sin suscriptores**: las alarmas funcionan y cambian de estado, pero nadie se entera.
2. Si estaba puesta, comprueba que la suscripcion este **confirmada**. AWS manda un correo de
   confirmacion y no entrega nada hasta que se acepta. En la consola de SNS, una suscripcion
   `PendingConfirmation` parece configurada y no lo esta.
3. Para agregar destinatarios sin volver a desplegar, suscribelos al tema cuyo ARN sale en
   `amplify_outputs.json` como `custom.autob.temaDeAvisos`.

**Si una alarma quedo en `INSUFFICIENT_DATA`:** normal en las que dependen de un filtro de
metrica hasta que el barrido corre por primera vez y produce una linea que coincida. La de
`barrido-sin-ejecutar` **no** debe quedarse ahi: trata la ausencia de datos como fallo a
proposito, asi que si aparece en ese estado revisa que la metrica de la funcion exista.

**Si una alarma es puro ruido:** `UMBRAL_OUTBOX_MIN` y `UMBRAL_CONFLICTOS_POR_PERIODO` en
`amplify/alarmas.ts` son valores de partida, no medidas. Calibralos con
`npm run carga:apertura` o con el pico real de la primera convocatoria; ajustar un umbral con
datos es preferible a convivir con una alarma que nadie cree.

---

## R-14 — Desplegar la aplicacion en AWS

**R-11 prepara el backend; esto publica la aplicacion.** Son dos cosas distintas y confundirlas
cuesta tiempo: `ampx sandbox` crea la tabla, el bucket, CloudFront, la Lambda del barrido y el rol
SSR, pero **no** publica Next.js en ningun sitio. La aplicacion sigue corriendo en la maquina de
quien la desarrolla hasta que existe una app de **Amplify Hosting**.

### Estado de partida, y como comprobarlo

Antes de seguir, verificar en que punto se esta. Todos son comandos de lectura:

```bash
aws amplify list-apps --query 'apps[].{nombre:name,appId:appId,repo:repository}'
aws amplify list-jobs --app-id <appId> --branch-name main --max-results 3 \
  --query 'jobSummaries[].{id:jobId,estado:status,commit:commitId}'
aws amplify list-branches --app-id <appId> \
  --query 'branches[].{rama:branchName,stack:backendEnvironmentArn}'
git remote -v && git status -sb
```

**`backendEnvironmentArn` en `null` significa que el backend nunca se desplego**, aunque la app y la
rama existan. Es el dato que distingue "hay una app creada" de "hay un entorno funcionando", y no se
ve en la lista de apps.

Al **2026-09-11**: app `icsmx-autob-webapp` (`d2i0gloex3vqjp`, plataforma `WEB_COMPUTE`) conectada a
`limac3/icsmx-autob-webapp` rama `main`; **build #1 en `FAILED`** por el 401 de `npm ci` —el paso 4
sin hacer— y por tanto **nada desplegado**: ni frontend ni backend. Mas un sandbox personal aparte
(`amplify-icsmxautobwebapp-CesarLima-sandbox-cbbf835390`), que no tiene relacion con la app.

### Paso 1 — Un remoto que Amplify pueda leer · **[OPERADOR]** — hecho

**Es el bloqueo primero y no tiene rodeo:** Amplify Hosting construye desde un repositorio Git
conectado, no desde un directorio local. Sin remoto no hay despliegue.

> **Y construye desde el remoto, no desde el disco.** Un commit sin empujar no entra al build,
> asi que `git status -sb` es parte de la comprobacion previa a cada despliegue: si dice
> `ahead N`, lo que se va a desplegar es codigo viejo.

### Paso 2 — Rotar los secretos expuestos · **[OPERADOR]** — hecho en lo critico

**Que paso.** En una sesion de desarrollo, una edicion de `.env.local` hizo que la herramienta
devolviera el archivo completo, asi que quedaron expuestos en un transcripto
`AUTH0_CLIENT_SECRET`, `AUTH_SECRET` y la **llave privada de CloudFront**.

| Secreto | Estado |
| --- | --- |
| `AUTH0_CLIENT_SECRET` | **Rotado** (2026-09-11) |
| `AUTH_SECRET` | **Rotado** (2026-09-11) |
| Llave privada de CloudFront | **No rotada, riesgo aceptado** — ver abajo |

**La llave de CloudFront no se rota por ahora, y es una decision con razon.** Lo que firma son las
fotografias de vehiculos de un entorno con **datos desechables**, y aprovecharla exigiria ademas
conocer el dominio de la distribucion. Los dos secretos de Okta son de otra categoria: son
credenciales de **identidad**, y por eso se rotaron primero.

Verificable en cualquier momento, sin exponer material de llave —comparando el DER normalizado de la
publica que CloudFront tiene desplegada contra `amplify/claves/cloudfront-publica.pem`—: al
2026-09-11 son la misma, o sea que sigue siendo el par original del commit `f0f0826`.

**La condicion que cambia la decision:** en cuanto el entorno deje de tener datos desechables —o
antes de un entorno de produccion— hay que rotarla. Y **rotarla son cuatro pasos encadenados**, no
uno:

1. Generar el par nuevo (R-11 paso 1).
2. Reemplazar `amplify/claves/cloudfront-publica.pem`, **que se versiona**.
3. **Redesplegar el backend**, para que CloudFront confie en la publica nueva. Cambia el
   `CLOUDFRONT_KEY_PAIR_ID`.
4. Actualizar `CLOUDFRONT_PRIVATE_KEY` y `CLOUDFRONT_KEY_PAIR_ID` donde corresponda.

Hacerlo a medias tiene el peor modo de fallo posible: firmar con una privada que no corresponde a la
publica desplegada **no da error de firma ni 403** — da una galeria vacia con la consola limpia
(desafios 50). Y rotarla **invalida todas las URLs firmadas vigentes**, asi que conviene hacerlo
antes de que existan usuarios.

### Paso 3 — Crear la app y conectar la rama · **[OPERADOR]** — hecho

Amplify detecta [`amplify.yml`](../amplify.yml), que ya esta escrito y no hay que tocar. Hace dos
cosas que conviene conocer:

- `backend` corre `ampx pipeline-deploy --branch $AWS_BRANCH --app-id $AWS_APP_ID`, o sea despliega
  la pila de `amplify/` con la misma definicion que el sandbox.
- `frontend` corre **`typecheck`, `test` y `build`** antes de publicar. Una rama que no compila o
  cuyas pruebas fallan no llega a produccion; el fallo se ve en el registro de build.

### Paso 4 — Donde va cada variable · **[OPERADOR]**

**`.env.local` no participa en el despliegue.** Esta en `.gitignore`, asi que no llega al
repositorio ni al contenedor de build: solo lo usa `npm run dev` en la maquina de quien desarrolla.
Es la plantilla documentada de todas las variables ([`.env.local.example`](../.env.local.example)),
no el sitio donde se configuran.

En un despliegue hay **tres destinos distintos, y no son intercambiables**. Lo que decide cual es
**quien lee la variable**:

| Destino | Quien la lee | Cuando |
| --- | --- | --- |
| **A.** Consola de Amplify — *App settings > Environment variables* | **Solo el contenedor de build** | Build |
| **B.** Secretos de Amplify — parametros de **SSM Parameter Store** | El **Lambda del barrido**, por `secret()` en `amplify/backend.ts` | Ejecucion del barrido |
| **C.** `amplify/backend.ts`, con `addEnvironment` | El **Lambda del barrido** | Ejecucion del barrido |
| **D.** Bloque `env` de `next.config.ts` | El **servidor de Next** (paginas, actions y middleware) | Ejecucion de la aplicacion web |

> **La consola configura el build y nada mas.** Ningun proceso fuera del contenedor ve esas
> variables: ni el Lambda —una funcion de `defineFunction` solo recibe lo que `backend.ts` le pasa—
> ni el computo SSR de Next, que **no** las hereda. Cada consumidor necesita su propio camino, y por
> eso los destinos **C** y **D** existen: son puentes desde el build hacia cada tiempo de ejecucion.
>
> Las dos veces que se aprendio costaron un despliegue cada una. Con el Lambda: `APP_ENV=pruebas` en
> la consola configuraba la aplicacion y dejaba el barrido leyendo `produccion`, que con CES sin
> configurar lanza en cada invocacion (`desafios-implementacion.md` 65). Con el servidor: la
> aplicacion respondia **500 en cada peticion** —"Falta configuracion de autenticacion requerida:
> AUTH0_DOMAIN"— aunque la variable estuviera puesta (seccion 72).
>
> El sentido inverso tambien vale: un secreto del destino **B** no lo ve la aplicacion web.
>
> **Y todo lo de C y D se fija al compilar**, asi que cambiar cualquiera de esas variables en la
> consola exige **redesplegar**. Guardar el valor no basta.

**Destino A — variables de la consola.** Dos son de **construccion** y no existen en ejecucion:

| Variable | Por que |
| --- | --- |
| `NODE_AUTH_TOKEN` | Token de Artifactory. Sin el `npm ci` falla con 401 en los paquetes `@churchofjesuschrist/*` (riesgo R10) |
| `ALARMAS_CORREO` | Destinatario de las seis alarmas. La lee `amplify/backend.ts` **al sintetizar**, no en ejecucion, y por eso es **lo unico que no se puede poner despues sin redesplegar**: sin ella el tema de SNS se crea vacio |

Y estas se ponen **aqui tambien**, porque es de donde el build las toma para incrustarlas (destino
**D**). Las lee la aplicacion web:

| Grupo | Variables | De donde sale el valor |
| --- | --- | --- |
| Okta | `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH_SECRET`, `APP_BASE_URL` | Del tenant. `APP_BASE_URL` **debe** coincidir con la URL de callback registrada en Okta. La barra final sobra y el codigo la quita (desafios 71) |
| EAS | `EAS_PROFILE_URL`, `EAS_API_KEY` | Del equipo de EAS (contrato aun sin confirmar: riesgo R19) |
| Datos | `AUTOB_TABLE_NAME`, `AUTOB_MEDIA_BUCKET` | `amplify_outputs.json`, bajo `custom.autob` |
| CloudFront | `CLOUDFRONT_DOMAIN`, `CLOUDFRONT_KEY_PAIR_ID`, `CLOUDFRONT_PRIVATE_KEY` | Los dos primeros de `custom.autob`. **`llavePublicaCloudFront`, no `grupoDeLlavesCloudFront`**: confundirlos da un 403 que no dice cual de los dos esta mal (desafios 50) |
| Herramientas | `ENABLE_DEV_TOOLS`, `APP_ENV` | `OFF` + `produccion` en produccion. En un ambiente de pruebas, `FULL` + `pruebas` — ver abajo |

**Destino B — secretos en SSM.** `CES_URL`, `CES_USER`, `CES_PASSWORD`, `CES_FROM_ADDRESS`. Ver el
detalle mas abajo: mientras CES siga sin aprobar, **no hay que ponerlos**.

**Destino D — lo que el servidor de Next necesita, incrustado al compilar.** No se configura en
ninguna consola: la lista vive en `VARIABLES_DEL_SERVIDOR` de `next.config.ts`, que las toma del
entorno del build —o sea del destino **A**— y Next las sustituye en los chunks del servidor. Si el
servidor necesita una variable nueva, se agrega **ahi**; ponerla solo en la consola no la hace
llegar, y el sintoma es un 500 en cada peticion.

La lista es explicita a proposito: un barrido del entorno arrastraria `NODE_AUTH_TOKEN` y las
credenciales de AWS del contenedor al artefacto desplegado. Una prueba de `next.config.test.ts`
afirma que ninguna de esas entra.

**Destino C — lo que ya esta en el codigo y solo hay que saber que existe.** `AUTOB_TABLE_NAME`
(sale de la pila), `APP_BASE_URL` y `APP_ENV` (se resuelven en sintesis desde el entorno del build,
o sea desde el destino **A**, con respaldo cerrado). No se configuran en ninguna consola: se leen de
`amplify/backend.ts`. Si el barrido necesitara una variable nueva, se agrega ahi — y
`amplify/backend.test.ts` afirma que llegan.

### Paso 5 — Cargar los valores · **[OPERADOR]**

Con la tabla de arriba decidida, los valores en si. La lista completa y comentada esta en
[`.env.local.example`](../.env.local.example).

#### Un ambiente de pruebas con el conmutador de identidades

`NODE_ENV=production` **no distingue produccion de pruebas**: Amplify Hosting compila y sirve toda
rama en modo produccion. El entorno se declara, y son dos variables:

```
ENABLE_DEV_TOOLS=FULL
APP_ENV=pruebas
```

`ON` **no es un valor valido** de `ENABLE_DEV_TOOLS` — los tres son `OFF`, `MOCK_USERS` y `FULL`, y
uno invalido cae a `OFF` con un aviso en el registro. El sintoma no es un error de configuracion
sino que la aplicacion intenta consultar EAS de verdad. Para recorrer el flujo completo hace falta
`FULL`: `MOCK_USERS` da los permisos de una sola identidad por variable de entorno, y el ciclo exige
**dos distintas** (R-12).

De `APP_ENV`, los dos valores son `produccion` y `pruebas`. **Ausente o desconocido se asume
`produccion`**, asi que olvidarla deja las herramientas bloqueadas, no abiertas; la aplicacion lanza
en cada peticion con un mensaje que la nombra. `production` en ingles es un valor invalido y cae del
lado seguro.

**La matriz completa de las dos variables** —las 40 combinaciones, con lo que hace la aplicacion en
cada una— esta en `identidad-autorizacion.md` 4.1.2, y la verifica
`src/lib/auth/modoYEntorno.test.ts`.

**Lo que hay que aceptar para hacerlo, dicho sin rodeos:** con cualquier modo distinto de `OFF`,
`src/lib/auth/eas.ts` **no consulta EAS**. La autenticacion de Okta sigue siendo real y obligatoria
—es cierto que es un candado—, pero **deja de implicar autorizacion**: cualquier cuenta del tenant
que alcance la URL recibe los permisos de `DEV_TOOLS_MOCK_ROLES` (`ADMINISTRADOR` si no se pone) y
puede cambiarse a cualquier identidad del roster. Es admisible con **datos desechables**; deja de
serlo en cuanto el ambiente tenga datos reales.

Si se quiere estrechar sin perder el conmutador, las dos palancas son gratis y no exigen codigo:
restringir la aplicacion en Okta a un grupo de prueba, y poner `DEV_TOOLS_MOCK_ROLES` con el rol
minimo en vez del `ADMINISTRADOR` por omision.

**`APP_ENV` hay que ponerla en la consola aunque el barrido la reciba por `backend.ts`**, y las dos
cosas no se contradicen: la aplicacion web la lee del destino **A**, y el Lambda recibe una copia que
`backend.ts` resuelve **en sintesis** desde ese mismo entorno de build. O sea que se escribe una vez,
en la consola, y de ahi salen las dos. Si se cambia, hay que **redesplegar** para que el Lambda vea
el valor nuevo — no basta con guardar la variable, porque la suya se fija al sintetizar.

Al pasar ese mismo ambiente a produccion: `ENABLE_DEV_TOOLS=OFF` y `APP_ENV=produccion`. Poner las
dos y no solo la primera: `APP_ENV` no enciende nada por si sola —la fila de `OFF` es EAS en las
cuatro columnas de la matriz— pero dejarla en `pruebas` deja armada la trampa para el proximo cambio
de `ENABLE_DEV_TOOLS`.

#### CES — destino B, y hoy vacio a proposito

Los cuatro —`CES_URL`, `CES_USER`, `CES_PASSWORD`, `CES_FROM_ADDRESS`— son **secretos**, no variables
de la consola: los consume el Lambda del barrido, que los recibe por `secret()` en
`amplify/backend.ts`. Ponerlos en *Environment variables* no haria nada —el Lambda no las ve— y la
aplicacion web no los usa para nada.

**Son parametros de SSM Parameter Store, no de Secrets Manager.** Lo implementa
`@aws-amplify/backend-secret` (sus modulos son `ssm_secret.js`), y la ruta la arma
`ParameterPathConversions`:

```
/amplify/<appId>/<rama>-branch-<hash>/<NOMBRE>          una rama de Amplify Hosting
/amplify/<proyecto>/<usuario>-sandbox-<hash>/<NOMBRE>   un sandbox personal
```

En `backend.ts` solo va el **nombre corto** (`CES_URL`); el prefijo lo pone Amplify segun a que
backend se despliega. No hay que inventar ningun nombre ni crear nada a mano.

Como se pone el valor, y **no es igual en los dos casos**:

| Destino | Como |
| --- | --- |
| Sandbox personal | `npx ampx sandbox secret set CES_URL` — pide el valor por consola. Tambien `list`, `get` y `remove` |
| Rama de Amplify Hosting | **Desde la consola de Amplify**, o escribiendo el parametro `SecureString` en SSM (receta abajo). **No existe un `ampx secret set` para ramas**: el CLI solo expone `ampx sandbox secret`, y `ampx --help` no ofrece otro |

El backend despliega igual sin sus valores: declarar la referencia no exige que el valor exista.

##### Escribir el secreto de una rama a mano

```bash
aws ssm put-parameter \
  --name "/amplify/<appId>/<rama>-branch-<hash>/CES_URL" \
  --value "https://ces.example.org/api/send" \
  --type SecureString \
  --overwrite
```

- **`SecureString`** y no `String`: lo cifra con KMS. Con `String`, `CES_PASSWORD` queda en claro.
- **`--overwrite`**: sin el, falla si el parametro ya existe. Es lo que hace falta para actualizar.

**El hash no se adivina, se calcula.** Sale de `BackendIdentifierConversions`, y para una rama es
`sha512(appId + rama)` truncado a 10 caracteres hexadecimales, con los caracteres no alfanumericos
quitados de las dos partes. Asi que la ruta se puede saber **antes** de desplegar, teniendo el
`appId`:

```bash
node -e "const{createHash}=require('node:crypto');const l=s=>s.replace(/[^A-Za-z0-9]/g,'');const[a,r]=process.argv.slice(1);const h=createHash('sha512').update(l(a)).update(l(r)).digest('hex').slice(0,10);console.log('/amplify/'+l(a)+'/'+l(r)+'-branch-'+h+'/')" <appId> main
```

Verificado contra un parametro real de la cuenta: para la app `d2fp4jlzinrqk4` y la rama `main`, la
formula da `a5e6fafe45`, que es el hash que AWS tiene escrito.

Y si ya hubo un despliegue, se puede leer en vez de calcular:

```bash
aws ssm get-parameters-by-path --path "/amplify" --recursive --query 'Parameters[].Name'
```

**Dos trampas al ejecutarlo:**

1. **En Git Bash la ruta se corrompe.** Todo argumento que empiece con `/` se convierte a una ruta
   de Windows. Hay que prefijar `MSYS_NO_PATHCONV=1`, igual que con las demas llamadas de AWS CLI de
   estos runbooks. En `cmd.exe` y PowerShell no pasa.
2. **`--value` queda en el historial del shell**, que para `CES_PASSWORD` es justo lo que no se
   quiere. Usar `--value file:///ruta/al/archivo` y borrar el archivo despues, o ponerlo desde la
   consola de AWS.

**Y mientras CES siga sin aprobar (R17) no hay que ponerlos.** Con `APP_ENV=pruebas`, el barrido
descarta cada mensaje como `CANCELADO` y deja en el registro la notificacion que habria enviado —
asunto, lote, solicitud, vehiculo, precio y plazo—, que es con lo que se verifica el flujo cuando no
hay bandeja de correo. Las consultas estan en **R-2**, seccion "Mensajes en `CANCELADO`". La fila y
la adjudicacion no se ven afectadas (D-6).

### Paso 6 — Los dos pasos de consola que no son de codigo · **[OPERADOR]**

1. **Adjuntar el rol de computo SSR** (R-11 paso 5). Sin esto la aplicacion desplegada no puede
   leer la tabla. Se puede cambiar sin redesplegar.
2. **Aceptar el correo de confirmacion de SNS** (R-11 paso 6). Una suscripcion
   `PendingConfirmation` parece configurada y no entrega nada.

### Paso 7 — Verificar · **[AGENTE]** lo automatizable, **[OPERADOR]** el resto

```bash
npx vitest run amplify/auditoriaInmutable.integracion.test.ts   # la bitacora es inmutable
npm run carga:apertura                                           # contra el entorno desplegado
```

De la carga sale el dato con el que **calibrar `UMBRAL_CONFLICTOS_POR_PERIODO`** contra la metrica
`TransactionConflict` de CloudWatch (R-13). Los umbrales de `amplify/alarmas.ts` son valores de
partida, no medidas.

Falta ademas la prueba de humo del ciclo completo, que exige **dos identidades distintas**: R-05
impide aprobar la propia convocatoria y una fila de un solo participante no tiene orden. Con
`ENABLE_DEV_TOOLS=OFF` no hay conmutador de identidad simulada, asi que son dos personas de verdad;
en un ambiente de pruebas habilitado, una sola persona las recorre con el conmutador —dos ventanas,
o una normal y una de incognito, porque la cookie es por navegador—. Ver R-12 para el recorrido y
por que.

### Si el build falla

Ver **R-10**.

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

## Consultas del registro operativo (CloudWatch Logs Insights)

Complementan las de arriba y responden otra clase de pregunta. La tabla dice **en que estado
esta** algo; el registro dice **que le paso y cuanto tardo**. El hilo entre los dos es el
`correlacionId`: el mismo valor viaja en los eventos de la bitacora y en la linea de registro de
la operacion que los escribio, asi que un hallazgo de auditoria se lleva al diagnostico tecnico
y al reves.

Los campos van bajo `message` porque la funcion emite con el formato JSON de Lambda. Grupos:
`/aws/lambda/...` de la funcion de barrido, y el grupo de computo SSR que crea Amplify Hosting.

**Que paso con un lote** (sustituye "solicitudes por lote" como metrica; ver
`arquitectura-tecnica-aws.md` 7.2 para por que no es una metrica):

```
fields @timestamp, message.operacion, message.desenlace, message.estado, message.turno, message.duracionMs
| filter message.loteId = "L7"
| sort @timestamp asc
```

**Todo lo de una transaccion**, siguiendo el `correlacionId` que aparece en la bitacora:

```
fields @timestamp, message.operacion, message.desenlace, message.error, message.descripcion
| filter message.correlacionId = "01J..."
| sort @timestamp asc
```

**Por que se cancelan las transacciones** — R-4. `descripcion` es la intencion que le puso quien
escribio la transaccion ("lote sin adjudicacion", "centinela de adjudicacion"), asi que dice
**cual** condicion fallo y no solo que fallo alguna:

```
fields @timestamp, message.error, message.descripcion, message.codigos
| filter message.operacion = "transaccion"
| stats count() by message.descripcion, message.error
```

**Salud del barrido, corrida por corrida** — R-1. `errores` son las vencidas que encontro y no
pudo resolver; `vencimientosAbstenidos` son las que dejo para la corrida siguiente por turnos en
vuelo (R18), que es correcto y no un problema:

```
fields @timestamp, message.vencimientosResueltos, message.vencimientosAbstenidos, message.errores, message.lotesRecuperados, message.filasCerradas
| filter message.operacion = "barridoDeVencimientos"
| sort @timestamp desc
```

`filasCerradas` son las solicitudes que el barrido cerro al reconciliar un lote ya vendido cuya fila
habia quedado viva — el cierre que `avalarPago` no pudo completar (R-4). Cuenta aparte de `errores` a
proposito: mayor que cero es el barrido trabajando, no un fallo.

**Cuanto lleva esperando el correo** — R-2:

```
fields @timestamp, message.antiguedadMaximaMin, message.enviados, message.fallidosPermanentes, message.reintentaraDespues, message.enVuelo, message.sinPresupuesto
| filter message.operacion = "procesarOutbox"
| sort @timestamp desc
```

**Latencia de la fila bajo carga**, para comparar contra la prueba de carga:

```
filter message.operacion = "solicitarCompra"
| stats count(), avg(message.duracionMs), pct(message.duracionMs, 95), max(message.duracionMs) by bin(5m)
```

**Cual de los dos caminos de vencimiento esta trabajando** — el dato que dice si el barrido esta
cumpliendo su funcion o si todo lo resuelve la verificacion perezosa:

```
fields message.detectadoPor, message.estado
| filter message.operacion = "vencerYReasignar"
| stats count() by message.detectadoPor, message.estado
```

> **No busques correos ni nombres en el registro: no estan.** `redactar` sustituye `correo`,
> `nombre`, `destinatario` y `telefono` por `[redactado]` antes de escribir. Para saber a quien
> pertenece una solicitud, lleva el `participanteId` —ese si se registra— a la tabla.

---

## Escalamiento

| Situacion | Accion |
| --- | --- |
| Dos adjudicaciones vigentes en un lote | **Critico.** Congelar la convocatoria, preservar evidencia, escalar de inmediato |
| Sospecha de bitacora alterada | **Critico.** Preservar, escalar, revisar politicas IAM |
| Fila bloqueada durante una venta activa | Alto. Aplicar R-4; si no se resuelve, escalar |
| Correo caido durante una ventana de venta | Alto. Aplicar R-2 y evaluar ampliacion de plazos con negocio |
| Barrido caido con verificacion perezosa operando | Medio. Aplicar R-1 en horario habil |
