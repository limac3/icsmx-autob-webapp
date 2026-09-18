# Arquitectura Tecnica — AWS

Topologia, componentes y flujos de ejecucion. Las decisiones y su justificacion estan en
`estrategia-aplicacion.md`; las claves y transacciones, en `modelo-datos-dynamodb.md`.

---

## 1. Topologia

```
                    Okta (OIDC)
                        │
                        ▼
  Navegador ──▶ Amplify Hosting (Next.js 16 SSR)
                        │
      ┌─────────────────┼──────────────────┬──────────────┐
      ▼                 ▼                  ▼              ▼
  DynamoDB           S3 (privado)         CES           EAS
  tabla unica            │              (correo)      (roles)
      ▲                  ▼
      │            CloudFront ──▶ fotografias con URL firmada
      │
  Lambda programada (barrido de vencimientos)
```

Todo el backend se declara con **Amplify Gen2** (`defineBackend` + constructos CDK) en
`amplify/`. La aplicacion nunca habla con AWS desde el navegador: el unico componente que
alcanza el cliente son las fotografias, y llegan por CloudFront con URL firmada.

---

## 2. Componentes

### 2.1 Amplify Hosting — SSR

Ejecuta Next.js 16 App Router. Server Components y Server Actions corren aqui, con un rol de
ejecucion propio.

Variables sensibles (`AUTH0_CLIENT_SECRET`, `AUTH_SECRET`, `EAS_API_KEY`, llave privada de
CloudFront) se inyectan como secretos, nunca en el repositorio.

**El build no debe requerir secretos.** Se usa el patron `required()` descrito en
`identidad-autorizacion.md`, seccion 2.1.

### 2.2 DynamoDB

Tabla unica, modo **bajo demanda**, PITR activado, cifrado en reposo. Cuatro GSIs (seccion 3 de
`modelo-datos-dynamodb.md`).

Bajo demanda porque la carga es a rafagas: la apertura de una convocatoria concentra casi toda
la escritura del ciclo.

### 2.3 S3

Bucket privado para fotografias y comprobantes, **sin acceso publico**, cifrado y versionado.

```
vehiculos/<vehiculoId>/<fotoId>-{min,med,max}.webp
comprobantes/<solicitudId>/<archivoId>.<ext>
```

Los dos prefijos se tratan distinto: las fotografias se sirven por CloudFront; **los
comprobantes nunca**. Un comprobante de pago es un documento sensible y se entrega solo por el
Route Handler de descarga, que verifica permiso y audita el acceso.

Cada fotografia son **tres objetos**, uno por variante de ancho, todos WebP: el original no se
guarda (seccion 5.4 de `estrategia-aplicacion.md`). El sufijo es el nombre de la variante y no su
ancho, para que la clave sea predecible sin leer el item.

Las fotografias se escriben con `Cache-Control: public, max-age=31536000, immutable`, que es
correcto porque los bytes de una fotografia nunca se reemplazan — se borra y se sube otra con
`fotoId` nuevo. **El `Cache-Control` entra como parametro de `guardarObjeto`, no como constante
del modulo**, y eso es deliberado: la misma funcion guarda comprobantes, y un comprobante marcado
`public` seria un defecto de seguridad regalado por herencia.

> **El bucket esta versionado y sin `lifecycleRules`**: las versiones no actuales se conservan
> para siempre. Con tres objetos por fotografia, cada re-subida multiplica el almacenamiento
> retenido. No es urgente al volumen actual, pero es una regla de ciclo de vida pendiente.

### 2.4 CloudFront

Distribucion con **Origin Access Control** hacia S3 — el bucket sigue privado. Solo el prefijo
`vehiculos/`.

URLs firmadas generadas en SSR en cada peticion. La llave privada vive en
secretos; la **publica se versiona** en `amplify/claves/cloudfront-publica.pem`, porque no es
un secreto y porque rotarla invalidaria de golpe todas las URLs firmadas vigentes. Si falta,
el backend falla al sintetizar en vez de crear una distribucion sin grupo de llaves de
confianza, que serviria las fotografias a cualquiera que conociera la URL.

**Ventana de validez: entre una y dos horas.** El vencimiento se redondea a una cubeta de una hora
mas una hora de gracia, de modo que la URL es byte-identica durante toda la hora en curso para
todos los usuarios. Sin eso la firma cambiaba en cada render y el cache del navegador jamas
acertaba. El razonamiento completo, con lo que se paga en seguridad y por que la determinacion no
relaja la regla 13, esta en la seccion 5.3 de `estrategia-aplicacion.md`.

**`cachePolicy: CachePolicy.CACHING_OPTIMIZED` se declara explicita** en `defaultBehavior`, aunque
sea el valor por omision del constructo. Todo el esquema depende de una propiedad de esa politica:
que **los query strings no entran en la clave de cache**. Como la firma viaja en el query string,
una politica que los incluyera convertiria cada render en un MISS de borde y anularia por completo
tanto la cubeta como el `Cache-Control` de los objetos. Es una linea que convierte una suerte en
una decision, y `amplify/infraestructura.test.ts` la vigila. La actualizacion es in situ: no
reemplaza la distribucion, asi que `CLOUDFRONT_DOMAIN` no cambia.

El acotamiento al prefijo `vehiculos/` es `originPath`, no una regla de comportamiento: una
peticion a `/x.jpg` resuelve `s3://<bucket>/vehiculos/x.jpg`, de modo que `comprobantes/` es
inalcanzable por esta distribucion aunque alguien lo intente.

### 2.5 CES — Church Email Service

Correos transaccionales. **No se usa SES.** CES es un servicio REST corporativo: se le hace
`POST` de un JSON con los datos del mensaje y se autentica con `Authorization: Basic`.

La consecuencia arquitectonica es que **el correo no es infraestructura**. No hay identidad que
verificar, ni DKIM que activar, ni plantilla que declarar en CloudFormation, ni permiso de IAM
que otorgar: solo una URL y unas credenciales que llegan como secretos. La plantilla del mensaje
pasa a ser codigo de la aplicacion en vez de un recurso de AWS.

Se consume **solo desde el procesador del outbox**, nunca desde el flujo de adjudicacion (D-6).
Que sea un servicio externo por HTTP refuerza D-6 en vez de debilitarlo: un tercero remoto
tiene mas formas de fallar que un servicio de AWS, y ninguna puede tocar la transaccion.

> CES **aun no esta aprobado** para este proyecto (riesgo R17). El procesador del outbox se
> construye en la Etapa 10; hasta entonces no hay integracion que probar.

### 2.6 Lambda programada — barrido

Se ejecuta cada pocos minutos y realiza tres tareas, todas sobre GSI4:

1. Consulta `VENCE#<dia>` las adjudicaciones vencidas y aplica T5. De paso reconcilia los lotes
   de las convocatorias `PUBLICADA`: los que quedaron libres con fila viva, y los ya cerrados
   cuya fila nadie alcanzo a cerrar.
2. Consulta `OUTBOX_PENDIENTE` y envia los correos pendientes.
3. Consulta `CIERRE_PENDIENTE` y cierra los lotes que sobrevivieron a la conclusion de su
   convocatoria y cuyo compromiso se cayo despues (R-11b): el lote queda `NO_VENDIDO` y su
   vehiculo vuelve al catalogo. Sin esto el vehiculo quedaba invendible e inofertable a la vez.

**Idempotente:** cada operacion es condicional, asi que dos ejecuciones simultaneas o una
repetida no producen doble efecto. Se puede reejecutar sin miedo (`runbooks.md`).

> **Las tres particiones son dispersas**, asi que el trabajo de cada corrida es proporcional a lo
> que falta por hacer y no al tamano del historico. Es lo que permite que la tercera tarea exista
> sin recorrer las convocatorias concluidas una por una — un recorrido que ademas habria empezado
> a perder las mas recientes al superar el tope de `listarConvocatorias`
> (`modelo-datos-dynamodb.md` 5.6).

### 2.7 EAS

Servicio externo de roles. Se consulta por HTTPS con `AbortController` y timeout de 5 segundos.
Sin fallback silencioso (P-4).

---

## 3. Politica de cache

Riesgo R4 — el punto mas delicado de la arquitectura.

| Ruta | Estrategia | Por que |
| --- | --- | --- |
| `/convocatorias` | Dinamica o `cacheLife` corto + `revalidateTag` | Depende de `publicadaEn` y del tipo de participante |
| `/convocatorias/[id]` | Igual | Idem |
| `/convocatorias/[id]/lotes/[loteId]` | Ficha del vehiculo cacheable; estado de fila dinamico | Se separan con `Suspense` |
| Estado de la fila | **Nunca cacheado** | Cambia con cada solicitud |
| `/admin/*` | Nunca cacheado | Contenido no publicado |
| Fotografias | CloudFront, `max-age` de un ano + `immutable` | Los bytes nunca se reemplazan; la firma es estable por hora (2.4) |

### 3.1 La regla

**Ninguna respuesta que dependa de `publicadaEn` o de los permisos de venta puede ser estatica.**

Dos razones distintas y ambas suficientes: una convocatoria programada no puede filtrarse antes
de su hora, y una respuesta cacheada para quien tiene `Autob_Venta_a_empleados` no puede servirse
a quien no lo tiene.

El patron es envolver la parte dependiente de sesion o de tiempo en `Suspense` con lectura
dinamica, dejando estatico solo el armazon.

### 3.2 Invalidacion

| Evento | Etiquetas |
| --- | --- |
| Publicar convocatoria | `convocatorias:visibles`, `convocatoria:<id>` |
| Editar vehiculo | `vehiculo:<id>` y las convocatorias que lo incluyen |
| Cambio en la fila | `lote:<loteId>` |
| Concluir convocatoria | `convocatorias:visibles`, `convocatoria:<id>` |

> **`revalidateTag` no cubre la publicacion programada.** Si `publicadaEn` esta en el futuro, no
> hay ninguna accion humana en ese instante que dispare la invalidacion. Por eso el listado de
> convocatorias visibles **no puede depender solo de etiquetas**: necesita lectura dinamica o
> una `cacheLife` mas corta que la precision exigida a la hora de publicacion.
>
> Es el error facil de cometer: publicar dispara `revalidateTag` y todo parece correcto en
> pruebas, hasta que una convocatoria programada aparece tarde en produccion.

---

## 4. Flujos criticos

### 4.1 Ver convocatorias

```
Navegador → proxy.ts (sesion) → page.tsx
    → getSession() → oktaSub + permisos EAS → tipos de convocatoria permitidos
    → listarConvocatoriasVisibles(tiposPermitidos, ahora)
        → Query GSI2 CONV_ESTATUS#PUBLICADA, GSI2SK <= ahora, filtro por tipo
    → DTO sin datos de otros participantes → render
```

El gating triple ocurre **dentro de la consulta** (R-01). Lo que no se recupera no se puede
filtrar mal despues.

### 4.2 Solicitar compra

```
Cliente → Server Action solicitarCompra(loteId)
    → getSession()  +  puedeEjecutar("solicitud:crear")
    → servicio:
        1. GetItem centinela de fila        (atajo contra doble clic, no autoridad)
        2. Put RESERVA#<reservaId>          (marca la ventana; va ANTES del contador)
        3. UpdateItem ADD contadorTurnos    (condicion: venta abierta) → turno
        4. TransactWriteItems: solicitud + centinela + evento + Delete de la reserva
           (si 3 o 4 fallan: borrar la reserva, de mejor esfuerzo)
    → intentar adjudicacion (T2), siempre
    → revalidateTag(`lote:<id>`)
```

> **"Siempre", y antes decia "si la fila estaba vacia".** Con la abstencion por reservas, esa
> optimizacion produce un bloqueo: si A (turno 1) y B (turno 2) llegan juntos, A ve la fila
> vacia e intenta adjudicar pero se abstiene porque B esta en vuelo, y B ya no intenta porque
> la fila no estaba vacia. Nadie adjudica hasta el barrido. Intentar siempre es barato —una
> `Query` consistente y, si hay reservas, nada mas— y es lo unico que garantiza que el ultimo en
> aterrizar cierre la ronda.

### 4.3 Adjudicar

```
Leer reservas del lote (Query consistente, RESERVA#) ANTES que la fila
  ├─ alguna vigente → abstenerse; la disparara quien termine despues
  └─ vencidas       → borrarlas

Recorrer la fila en orden de turno (Query, ScanIndexForward: true)
  Para cada solicitud EN_FILA:
      TransactWriteItems T2
        ├─ falla item 1 → el lote ya se adjudico → abortar
        ├─ falla item 3 → el candidato ya tiene adjudicacion → CONGELADA, siguiente
        ├─ TransactionConflict → otro proceso adjudica → releer y reintentar con jitter
        └─ exito        → encolar correo en outbox
  Fila agotada → evento FILA_AGOTADA, lote queda EN_OFERTA
```

### 4.4 Vencimiento

Dos caminos hacia el mismo resultado, deliberadamente redundantes (D-7):

```
Camino A — barrido programado
  Lambda cada N minutos → Query GSI4 VENCE#<dia>, GSI4SK <= ahora → T5

Camino B — verificacion perezosa
  Al leer una fila cuya adjudicacion vigente ya vencio → T5 antes de responder
```

Ambos ejecutan la misma transaccion condicional, asi que competir entre si es inofensivo: el
segundo en llegar falla la condicion y no hace nada.

### 4.5 Correo

```
T2 / T5 encolan mensaje en OUTBOX  (misma transaccion, evento CORREO_ENCOLADO)
Barrido → Query GSI4 OUTBOX_PENDIENTE
    → CES → exito: CORREO_ENVIADO y se retiran las claves GSI4
           → fallo: reintento con retroceso; agotados, CORREO_FALLIDO
```

El correo **nunca** bloquea ni revierte una adjudicacion.

---

## 5. Seguridad

| Aspecto | Medida |
| --- | --- |
| Transporte | HTTPS obligatorio, HSTS |
| Cabeceras | CSP con nonce, `X-Content-Type-Options`, `Referrer-Policy`, Permissions-Policy |
| Secretos | Gestor de secretos de Amplify. Nunca en el repositorio |
| S3 | Sin acceso publico; fotografias solo por CloudFront con OAC; comprobantes solo por Route Handler |
| DynamoDB | Rol de minimo privilegio, con **`Deny` explicito de `UpdateItem`/`DeleteItem` sobre `AUDIT#`** |
| Sesion | Cookie `httpOnly` y `secure`; duracion absoluta acotada |
| Rutas autenticadas | `Cache-Control: no-store` desde `proxy.ts` — en la practica es toda ruta: no hay contenido publico/anonimo en esta aplicacion (ni el catalogo publicado exige rol, seccion 3 de `permission-matrix.md`) |
| Subidas | Tipo y tamano validados en servidor; nombre de archivo generado, nunca el del cliente |

**CSP con nonce (Etapa 2, `src/proxy.ts`):** nonce distinto por peticion en `script-src`, con
`'strict-dynamic'`. `style-src` conserva `'unsafe-inline'` — el uso de estilos en linea de Eden no
esta verificado y endurecerlo sin una pasada visual completa es mas riesgo que beneficio; se
revisa en la Etapa 12.

`style-src` y `font-src` autorizan ademas **`https://foundry.churchofjesuschrist.org`**. No es una
concesion opcional: `<Fonts>` de `@churchofjesuschrist/eden-fonts` monta una hoja de estilo remota
de ese origen y desde ahi se descargan los woff2. Con `'self'` a secas el navegador bloqueaba las
dos cosas y la aplicacion se dibujaba con tipografia de respaldo — un defecto que **ni `next build`
ni jsdom pueden ver**, porque ninguno aplica CSP.

El nonce por peticion **obliga a renderizado dinamico en toda la aplicacion** (Next.js no puede
inyectar un nonce en una pagina generada en build). Esto no estorba la seccion 3: `cacheLife` y
`revalidateTag` siguen operando dentro de una respuesta dinamica, solo que ya no hay paginas
completamente estaticas que perder.

### 5.1 La politica IAM que mas importa

```json
{
  "Effect": "Deny",
  "Action": ["dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem"],
  "Resource": "<tabla>",
  "Condition": {
    "ForAnyValue:StringLike": { "dynamodb:LeadingKeys": ["AUDIT#*"] }
  }
}
```

Un `Deny` explicito no se puede sobrescribir con un `Allow`, asi que ningun permiso posterior
reabre esta puerta.

**Hasta donde llega — y hasta donde no.** Esta politica impide *modificar* y *borrar* un evento.
**No impide reescribirlo**: un `PutItem` con la misma clave reemplaza el item completo, y
`PutItem` tiene que quedar permitido porque es justo lo que la regla 4 obliga a escribir en la
misma transaccion que la mutacion. No hay condicion de IAM que distinga un `Put` que crea de uno
que reemplaza.

Por eso la inmutabilidad se sostiene en **dos** mecanismos, no en uno:

| Amenaza | Que la contiene |
| --- | --- |
| Codigo que intenta `UpdateItem` o `DeleteItem` sobre un `AUDIT#` | Este `Deny` de IAM |
| Codigo con un error que reescribe un evento existente | `ConditionExpression: attribute_not_exists(PK)` en todo `Put` de evento (`modelo-datos-dynamodb.md` seccion 6) |
| Codigo que deliberadamente omite la condicion | **Ninguno de los dos.** Exige un sumidero append-only fuera del alcance de la aplicacion — riesgo R20, se resuelve en la Etapa 11 |

Las tres filas estan comprobadas contra AWS real en
`amplify/auditoriaInmutable.integracion.test.ts`, incluida la segunda columna vacia de la tercera:
hay una prueba que **confirma que la sobrescritura tiene exito** sin la condicion.

`BatchWriteItem` se incluye porque tambien puede borrar, y omitirlo dejaria abierta justo la
puerta que se intenta cerrar.

Cubre tambien las transacciones sin nombrarlas: `TransactWriteItems` **no es una accion de
IAM**, se autoriza con las acciones de item subyacentes, asi que un `Update` sobre un `AUDIT#`
dentro de una transaccion cae en este mismo `Deny`. `PutItem` queda fuera a proposito — es
justo lo que la regla 4 exige escribir en la misma transaccion que la mutacion.

**Implementada** en `amplify/permisos.ts` (Etapa 3), con dos `Deny` mas por la misma logica:
`dynamodb:PartiQLUpdate`/`PartiQLDelete`, que son acciones distintas y tambien mutan; y
`s3:DeleteObject` sobre `comprobantes/*`, porque un comprobante de pago es evidencia y que no
haya permiso de borrado lo vuelve una garantia en vez de un descuido.

La misma funcion aplica los permisos al rol de computo SSR y al de la funcion de barrido. Que
los compartan es deliberado: dos listas separadas se desincronizan, y la que se olvide seria
justo la que deja escribir la bitacora.

Se verifica en dos niveles. `amplify/infraestructura.test.ts` sintetiza la pila y comprueba que
la politica existe con las acciones y la condicion exactas —corre sin AWS, en segundos—; y
`amplify/auditoriaInmutable.integracion.test.ts` asume el rol real contra un sandbox y confirma
que IAM **rechaza de verdad** el `Update` y el `Delete`, que acepta el `Put`, y que el mismo rol
si modifica items que no son de la bitacora (sin esa ultima comprobacion, un `Deny` demasiado
amplio pasaria inadvertido).

---

## 6. Entornos

| Entorno | Backend | Datos | `ENABLE_DEV_TOOLS` | `APP_ENV` |
| --- | --- | --- | --- | --- |
| Local | `npx ampx sandbox` personal | Desechables | `MOCK_USERS` o `FULL` | no se pone |
| Pruebas desplegado | Rama de pruebas en Amplify Hosting | Desechables | `FULL` | `pruebas` |
| Desarrollo | Rama compartida | De prueba | `MOCK_USERS` | `pruebas` |
| Produccion | Rama principal | Reales | **`OFF` obligatorio** | `produccion` |

**La matriz completa de las dos variables, con lo que hace la aplicacion en cada casilla, esta en
`identidad-autorizacion.md` 4.1.2**, y la verifica `src/lib/auth/modoYEntorno.test.ts` recorriendo
las 40 combinaciones. No se resume aqui para no tener dos versiones de la misma tabla.

> **`NODE_ENV` no distingue produccion de un ambiente de pruebas.** Amplify Hosting compila y sirve
> **toda** rama con `NODE_ENV=production`, asi que la guarda original —"lanza si
> `NODE_ENV=production` y el modo no es `OFF`"— hacia imposible desplegar un ambiente de prueba con
> el conmutador de identidades. Y hace falta ahi precisamente: el flujo completo exige **dos
> identidades distintas**, porque R-05 impide aprobar la propia convocatoria y una fila de un solo
> participante no tiene orden. De ahi `APP_ENV`, que declara el entorno en vez de deducirlo.

> En esta maquina, `npx ampx sandbox` y los SDK de AWS fallan sin `NODE_EXTRA_CA_CERTS` por la
> inspeccion TLS corporativa (riesgo R11). El sintoma parece un problema de credenciales o de
> red. Ver `desafios-implementacion.md`.

---

## 7. Observabilidad

Implementada en la Etapa 12. `src/lib/observabilidad/` para la senal, `amplify/alarmas.ts` para
las alarmas.

| Senal | Como | Donde |
| --- | --- | --- |
| Registro estructurado | Una linea por operacion, con `correlacionId` compartido con la bitacora | `registro.ts` |
| Trazas | Desenlace y duracion de las operaciones criticas: solicitar, adjudicar, vencer, mas el barrido y el outbox | `traza.ts` (`conTraza`) |
| Intentos que no llegan al motor | Una linea por intento rechazado antes de `solicitarCompra`: estrangulado por tasa, o llegado antes de la apertura | `registro.ts`, operacion `intentoDeSolicitud` |
| Diagnostico de transacciones | Solo en el fallo: codigo crudo de DynamoDB, posicion e intencion del item que cancelo | `data/transacciones.ts` |
| Metricas y alarmas | Metricas nativas de Lambda y DynamoDB, mas filtros de metrica sobre el registro del barrido | `amplify/alarmas.ts` |

El registro operativo es **distinto** de la bitacora de auditoria. Aquel es para depurar y
caduca —un mes de retencion en la funcion de barrido—; esta es para probar y no caduca. De esa
diferencia salen dos consecuencias que el codigo respeta: `registrar` **nunca lanza** (perder
una linea no puede tumbar la adjudicacion que describia, al contrario de la regla 4), y **nunca
escribe identidad de personas** (`redactar` sustituye `correo`, `nombre` y `destinatario`;
`participanteId` si se escribe, porque es un ULID interno y sin el el runbook R-8 no se puede
ejecutar).

### 7.1 Trazas propias en lugar de X-Ray

X-Ray sirve para descubrir **donde** se fue el tiempo entre varios servicios. Aqui hay un solo
proceso hablando con DynamoDB, y la pregunta operativa es otra: **que le paso a esta solicitud**.
Eso lo responde una linea por operacion con el `correlacionId` que ya comparte con la bitacora
—el mismo identificador que el auditor tiene delante—, sin agregar el SDK, el permiso de IAM ni
el costo por traza. Si algun dia hace falta el detalle por segmento, X-Ray se activa por
configuracion de la funcion y este registro no estorba.

### 7.2 Que va a metrica y que se queda en el registro

Ninguna metrica lleva `loteId` como dimension, y no es un descuido. CloudWatch cobra por nombre
y **combinacion de dimensiones**: `loteId` es de cardinalidad ilimitada y creciente, asi que
"solicitudes por lote" como metrica dimensionada crearia una serie nueva por cada lote que haya
existido, para siempre. Lo que se necesita de ese dato es responder preguntas puntuales —"que
paso en el lote L7"—, y eso lo responde una consulta de Logs Insights sobre el registro, que no
se cobra por serie. Las consultas concretas estan en `runbooks.md`.

### 7.2.1 La equidad de la apertura: que se registra y por que no hay alarma

La Etapa 16 agrego una senal y **deliberadamente ninguna alarma**. Las dos decisiones salen de lo
mismo que ya dice 7.2 y 7.3.

**La senal.** La operacion `intentoDeSolicitud` deja una linea de nivel `warn` por cada intento
que **no llega** al motor de fila, con dos formas:

| Campos | Que dice |
| --- | --- |
| `error: "limite_de_tasa"`, `intentosEnVentana` | El participante excedio el umbral. `intentosEnVentana` sigue creciendo despues de rechazar, asi que distingue un doble clic de un bucle |
| `error: "invalid_state"`, `anticipacionMs` | Llego antes de la apertura, y cuanto antes. Distingue a quien se adelanto un segundo de quien sondea desde hace una hora |

Se escribe **solo en el rechazo**, nunca en el camino feliz: el volumen queda proporcional al
abuso y no al uso. Estos intentos no producian ninguna senal antes — el anticipado lo rechaza la
guarda de `solicitud:crear`, asi que `solicitarCompra` no llega a ejecutarse y `conTraza` no lo
ve; y como no es una transicion de estado, tampoco le corresponde un evento de bitacora.

**La evidencia durable no es el log.** Son los items `PART#<pid> / TASA#<convId>#<ventana>`
(modelo-datos 4.3.1), que se consultan por participante y no caducan; y el desfase de cada
solicitud respecto de la apertura, que **ya era derivable** de `solicitadoEn` menos `inicioVenta`
sin escribir nada nuevo. El log sirve para diagnosticar; esos dos, para responder preguntas
meses despues.

**Por que no hay alarma.** Estas lineas las escribe el **SSR**, y 7.3 ya establecio que el grupo
de logs del SSR lo crea Amplify Hosting y no esta pila: no hay a que colgarle un filtro de
metrica. Desplegar uno de todas formas produciria "un filtro que compila, se despliega y nunca
coincide con nada", que es el fallo que 7.3 advierte que **no da error, da silencio**. Se
descarto tambien publicar una metrica propia con `PutMetricData` desde el camino de la solicitud:
seria una llamada de red mas en el instante que R26 senala como el mas caro, para vigilar algo
que no exige reaccion en minutos. Las consultas de Logs Insights estan en `runbooks.md` y son la
forma prevista de mirarlo.

### 7.3 Alarmas, y por que cada una toma su senal de donde la toma

Las metricas **nativas** las publica AWS y no dependen de que la aplicacion funcione. Las de
**filtro de log** salen de las lineas que escribe la aplicacion, asi que un defecto en ese
modulo las apaga. De ahi el reparto:

| Alarma | Senal | Por que esa |
| --- | --- | --- |
| Barrido sin ejecutar (R6) | `AWS/Lambda` `Invocations`, nativa | Si el `handler` lanza antes de la primera linea, un filtro de log no ve nada y **calla**, que es justo el fallo que hay que gritar |
| Barrido con errores | `AWS/Lambda` `Errors`, nativa | Igual: no depende del codigo de la aplicacion |
| Vencimientos sin resolver | filtro sobre `errores` del barrido | Solo el dominio sabe contar "encontradas y no resueltas"; no existe metrica nativa |
| Outbox retrasado | filtro sobre `antiguedadMaximaMin` | Idem. Los contadores no bastan: un CES caido deja un `reintentaraDespues` pequeno y constante, igual con dos minutos de retraso que con dos dias |
| Correos fallidos | filtro sobre `fallidosPermanentes` | Un fallo permanente es un correo que **nadie** recibira (R-13) |
| Contencion de transacciones | `AWS/DynamoDB` `TransactionConflict`, nativa | La contencion interesante ocurre en el SSR, cuyo grupo de logs lo crea Amplify Hosting y no esta pila: no hay a que colgarle un filtro. La metrica nativa cuenta lo mismo en los dos lados |

**"El barrido no se ejecuta" trata la ausencia de datos como fallo** (`TreatMissingData.BREACHING`),
al contrario del valor por omision de CloudWatch. Un barrido que no corre no publica ceros: no
publica nada, y una alarma en `INSUFFICIENT_DATA` es indistinguible de "todo bien" para quien no
la esta mirando.

**No se alarma sobre `ConditionalCheckFailedRequests`**, que a primera vista parece la metrica
obvia de contencion. En este sistema una condicion que falla es el mecanismo normal de
funcionamiento: la adjudicacion se gana con escritura condicional (regla 6), asi que en cada
lote N-1 intentos fallan su condicion **por diseno**. Esa alarma estaria disparada siempre.

Los umbrales de `UMBRAL_OUTBOX_MIN` (60 min) y `UMBRAL_CONFLICTOS_POR_PERIODO` (50 por periodo
de 5 min) son **valores de partida, no medidas**. La contencion legitima se concentra en
`inicioVenta`, asi que "lo normal" no se sabe sin haber abierto una convocatoria real:
`npm run carga:apertura` existe entre otras cosas para calibrarlos.

Los avisos salen por un tema de SNS. **Sin `ALARMAS_CORREO` no hay suscriptor**: las alarmas se
crean y cambian de estado igual —se ven en la consola— pero no avisan a nadie. Es lo deseable en
un sandbox personal y lo que hay que llenar en un entorno vigilado.
