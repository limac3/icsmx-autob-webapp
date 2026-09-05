# Modelo de Datos — DynamoDB Single-Table

Claves, indices, patrones de acceso y transacciones. Es el documento tecnico mas denso del
proyecto: aqui vive la correccion de la fila.

Las reglas de negocio que justifica estan en `proyecto.md`. Los eventos que escribe estan en
`trazabilidad-auditoria.md`, y se leen juntos: **ninguna mutacion existe sin su evento**.

---

## 1. Decisiones estructurales

| Decision | Razon |
| --- | --- |
| Tabla unica | Las lecturas de la aplicacion son jerarquicas (convocatoria → lotes → fila); una sola `Query` resuelve cada pantalla |
| `turno` en la clave de ordenamiento, con relleno de ceros | DynamoDB devuelve la fila **ya ordenada**, sin ordenar en memoria y sin posibilidad de reordenar por error |
| Contador atomico **en el item del lote** | `ADD` sobre un atributo es atomico sin transaccion ni lectura previa. Uno por lote, nunca global (evita particion caliente) |
| Ventana de venta **desnormalizada** en el lote | Permite condicionar la escritura a "la venta esta abierta" sin leer la convocatoria: sin esta copia habria que leer-y-decidir, que es justo lo prohibido |
| Items **centinela** para unicidad | `attribute_not_exists` sobre un item dedicado convierte reglas de negocio en garantias de la base de datos, no en validaciones que compiten entre si |
| Eventos de auditoria en la **misma tabla** | Es lo unico que permite escribirlos en la misma `TransactWriteItems` que la mutacion |

---

## 2. Claves

Tabla `AUTOB_TABLE_NAME`. Clave primaria `PK` (particion) + `SK` (ordenamiento).

**Las construye `src/lib/data/claves.ts` y nadie mas.** Ningun otro archivo concatena cadenas
para formar una clave: es el unico modo de que la forma de una clave sea una propiedad del
sistema y no una convencion que hay que recordar en quince lugares. Ese modulo rechaza ademas
los identificadores que contienen `#` —el separador— porque uno colado dentro de un
identificador desplazaria el resto de la clave y permitiria fabricar el centinela de otro
participante.

### 2.1 Items

| Entidad | `PK` | `SK` | Notas |
| --- | --- | --- | --- |
| Participante | `PART#<participanteId>` | `PERFIL` | `participanteId` es un ULID propio, no el `sub` de Okta |
| Vehiculo | `VEH#<vehiculoId>` | `META` | |
| Fotografia | `VEH#<vehiculoId>` | `FOTO#<orden:04d>#<fotoId>` | Se leen con `begins_with(SK, "FOTO#")`, ya ordenadas |
| **Centinela de vehiculo activo** | `VEH#<vehiculoId>` | `ACTIVO` | Garantiza R-10. Ver 4.1 |
| Convocatoria | `CONV#<convocatoriaId>` | `META` | |
| **Lote** | `CONV#<convocatoriaId>` | `LOTE#<loteId>` | Contiene el contador y la adjudicacion |
| **Solicitud** | `LOTE#<loteId>` | `SOL#<turno:010d>` | El relleno de ceros es lo que da el orden |
| **Centinela de fila** | `LOTE#<loteId>` | `PART#<participanteId>` | Garantiza R-07. Ver 4.2 |
| **Centinela de adjudicacion** | `PART#<participanteId>` | `ADJUDICACION_ACTIVA` | Garantiza R-09. Ver 4.3 |
| Evento de auditoria | `AUDIT#<agregado>#<agregadoId>` | `<ocurridoEn>#<eventoId>` | Append-only |
| Mensaje de correo | `OUTBOX#<mensajeId>` | `META` | |

> **`SOL#<turno:010d>`** es el nucleo del diseno. Con `turno = 7` la clave es `SOL#0000000007`.
> Un `Query` con `ScanIndexForward: true` devuelve la fila en orden de turno **por
> construccion**. No hay ningun punto del codigo donde se pueda ordenar la fila mal, porque
> nunca se ordena: se lee ya ordenada. Diez digitos soportan mil millones de solicitudes por
> lote, holgura de sobra.
>
> Consecuencia deliberada: `solicitadoEn` **no participa en ninguna clave**. Es imposible
> ordenar la fila por tiempo aunque alguien lo intente (R-08).

### 2.2 Atributos relevantes

**Lote** — el item mas cargado del modelo:

```
vehiculoId, precio, estatus            EN_OFERTA | ADJUDICADO | VENDIDO | NO_VENDIDO | RETIRADO
contadorTurnos                         entero, solo crece, objetivo del ADD atomico
adjudicacionActual                     solicitudId. AUSENTE cuando el lote esta libre
adjudicadoEn, venceEn, turnoAdjudicado
inicioVenta, finVenta, tipoConvocatoria, estatusConvocatoria, horasLiquidacion   (desnormalizados)
```

**`adjudicacionActual` se elimina con `REMOVE`, nunca se pone en `null`.** Toda la exclusion
mutua depende de `attribute_not_exists(adjudicacionActual)`; un `null` es un atributo que
existe y haria pasar la condicion, adjudicando el mismo lote dos veces.

**Solicitud:**

```
solicitudId, participanteId, turno, solicitadoEn
estatus     EN_FILA | CONGELADA | ADJUDICADA | EN_VERIFICACION | VENDIDA
            | CANCELADA_POR_VENCIMIENTO | RECHAZADA_POR_TESORERIA
            | CANCELADA_POR_PARTICIPANTE | NO_ADJUDICADA
adjudicadoEn, venceEn, comprobanteClaveS3, motivoRechazo
```

Todas las fechas en **ISO-8601 UTC** (R-04). La conversion a `America/Mexico_City` ocurre solo
al presentar.

---

## 3. Indices secundarios globales

Cuatro GSIs genericos. Cada uno resuelve una familia de accesos, no una consulta suelta.

| Indice | `GSI#PK` | `GSI#SK` | Proyeccion |
| --- | --- | --- | --- |
| **GSI1** — identidad alterna | `OKTA#<oktaSub>` | `PERFIL` | `KEYS_ONLY` |
| **GSI2** — listados por estatus | `<TIPO>_ESTATUS#<estatus>` | `<fecha>#<id>` | `ALL` |
| **GSI3** — por participante | `PART#<participanteId>` | `SOL#<solicitadoEn>#<loteId>` | `ALL` |
| **GSI4** — trabajo pendiente (disperso) | `VENCE#<yyyy-mm-dd>` / `OUTBOX_PENDIENTE` | `<venceEn>` / `<creadoEn>` | `ALL` |

**Por que `ALL` y no `INCLUDE`** (decidido al implementar la Etapa 3). GSI2 sirve a cinco
accesos sobre entidades distintas —vehiculos, convocatorias, solicitudes y bitacora—, asi que
su lista de atributos incluidos seria la union de lo que necesitan cinco pantallas que aun no
existen. Y **la proyeccion de un GSI no se puede modificar despues de creado**: ampliarla exige
borrar el indice y recrearlo, con una ventana en la que PA-05 y PA-11 dejan de responder. Los
items del modelo son pequenos —las fotografias y los comprobantes son claves de S3, no datos—,
asi que el sobrecosto de `ALL` es acotado y compra no tener que migrar indices cada vez que una
pantalla pide un campo mas. Estrechar a `INCLUDE` es una optimizacion legitima para la Etapa 12,
cuando el conjunto de atributos ya no se mueva.

GSI1 se queda en `KEYS_ONLY` porque su unico trabajo es traducir `oktaSub` a `participanteId`;
el perfil se lee luego de la tabla base.

**GSI4 es disperso a proposito.** Sus claves solo se escriben mientras el item requiere
atencion: una solicitud las tiene mientras esta `ADJUDICADA`, y se **eliminan** al subir el
comprobante o al resolverse. El indice contiene entonces exactamente el trabajo pendiente, y el
barrido no filtra nada.

La particion se reparte **por dia de vencimiento** (`VENCE#2026-09-04`) en lugar de una sola
clave fija. Con una clave unica, todo el trabajo pendiente del sistema caeria en una particion
(riesgo R12).

> **El dia se calcula en hora de negocio, no en UTC** (`diaDeNegocio` de
> `src/lib/domain/fechas.ts`). Aplica igual a `AUDIT#<yyyy-mm-dd>` en GSI2.
>
> Quien lee esas claves es una persona: el operador que sigue R-1 de `runbooks.md`, el auditor
> que pide "todo lo del 4 de septiembre". Un dia UTC mandaria un vencimiento de las 18:00 de
> Mexico a la particion del dia siguiente, y el operador concluiria que el barrido esta roto.
>
> La contrapartida —que la frontera del dia no coincida con la de UTC— no compromete nada,
> porque el barrido recorre varios dias por diseno (R-1, paso 3). El dia solo reparte carga; no
> es un punto de correccion.

> Subir el comprobante elimina las claves de GSI4: es la implementacion literal de "una vez en
> verificacion, el plazo deja de correr" (`proyecto.md`, seccion 5.4). La demora de tesoreria
> no puede vencer al participante porque el item deja de ser visible para el barrido.

---

## 4. Items centinela

Convierten reglas de negocio en garantias atomicas. Sin ellos, cada regla seria una lectura
seguida de una decision — exactamente el antipatron que prohibe la regla 6 de `CLAUDE.md`.

### 4.1 Centinela de vehiculo activo — R-10

`VEH#<vehiculoId> / ACTIVO`, con `convocatoriaId`.

- Se crea con `attribute_not_exists(SK)` al incluir el vehiculo en una convocatoria.
- Se elimina al retirarlo, al concluir la convocatoria o al venderse.
- Un segundo intento de incluirlo en otra convocatoria activa **falla en la base de datos**, sin
  importar la concurrencia.

### 4.2 Centinela de fila — R-07

`LOTE#<loteId> / PART#<participanteId>`, con `solicitudId` y `turno`.

- Se crea con `attribute_not_exists(SK)` en la misma transaccion que la solicitud.
- Impide dos solicitudes vivas del mismo participante en el mismo lote, incluso ante un doble
  clic o dos pestanas.
- Se elimina cuando la solicitud alcanza un estado terminal, para permitir volver a formarse
  con un **turno nuevo** (R-07).

Ademas sirve de acceso directo: "¿ya estoy en esta fila y en que lugar?" es un `GetItem`, no un
recorrido.

### 4.3 Centinela de adjudicacion activa — R-09

`PART#<participanteId> / ADJUDICACION_ACTIVA`, con `loteId` y `solicitudId`.

- Se crea con `attribute_not_exists(SK)` dentro de la transaccion de adjudicacion.
- Se elimina al completarse la compra, al vencer, al rechazarse el pago o al cancelar.

**Este centinela, no el estado `CONGELADA`, es lo que garantiza R-09.** El punto es importante:
congelar las demas solicitudes de un ganador exigiria actualizar una cantidad no acotada de
items, y `TransactWriteItems` admite 100. Seria imposible de garantizar transaccionalmente.

El diseno lo invierte. La adjudicacion recorre los turnos en orden e **intenta** la transaccion
con cada candidato. Si el candidato ya tiene una adjudicacion activa, el `Put` del centinela
falla, la transaccion completa se cancela sin efectos, y el algoritmo marca esa solicitud como
`CONGELADA` y prueba con el turno siguiente.

Asi, `CONGELADA` es un estado **derivado y de presentacion** — le explica al participante por
que no avanza — mientras la garantia real la sostiene la base de datos.

---

## 5. Patrones de acceso

| # | Necesidad | Operacion |
| --- | --- | --- |
| PA-01 | Participante por `oktaSub` | `Query` GSI1 `OKTA#<sub>` |
| PA-02 | Vehiculo con sus fotografias | `Query` `PK = VEH#<id>` |
| PA-03 | Vehiculos por estatus | `Query` GSI2 `VEH_ESTATUS#<estatus>` |
| PA-04 | Convocatoria con todos sus lotes | `Query` `PK = CONV#<id>` — una sola lectura por pantalla |
| PA-05 | Convocatorias visibles | `Query` GSI2 `CONV_ESTATUS#PUBLICADA`, `GSI2SK <= ahora`, filtrando por tipo. Ver 5.1 |
| PA-06 | Convocatorias por aprobar | `Query` GSI2 `CONV_ESTATUS#EN_APROBACION` |
| PA-07 | **Fila de un lote, en orden** | `Query` `PK = LOTE#<id>`, `begins_with(SK,"SOL#")`, `ScanIndexForward: true` |
| PA-08 | Mi lugar en la fila | `GetItem` centinela 4.2 → `turno`; `miPosicion` por conteo (ver 5.2) |
| PA-09 | Mis solicitudes | `Query` GSI3 `PART#<participanteId>` |
| PA-10 | Adjudicaciones por vencer | `Query` GSI4 `VENCE#<dia>`, `GSI4SK <= ahora` |
| PA-11 | Bandeja de tesoreria | `Query` GSI2 `SOL_ESTATUS#EN_VERIFICACION` |
| PA-12 | Bitacora de un agregado | `Query` `PK = AUDIT#<agregado>#<id>` |
| PA-13 | Bitacora cronologica global | `Query` GSI2 `AUDIT#<yyyy-mm-dd>` |
| PA-14 | Correos pendientes | `Query` GSI4 `OUTBOX_PENDIENTE` |

### 5.1 El gating triple es una consulta, no un filtro

PA-05 aplica las tres condiciones de R-01 **dentro** de la lectura:

- `estatus = PUBLICADA` → esta en la clave de particion del GSI2.
- `publicadaEn <= ahora` → condicion de rango sobre `GSI2SK`.
- Tipo compatible → `FilterExpression` derivado de los **permisos de venta de la sesion**.

Lo que no se recupera no puede filtrarse mal despues. El tipo va como filtro y no como clave
porque un `EMPLEADO` necesita ambos tipos en una sola pantalla; el volumen es pequeno y el
descarte, marginal.

### 5.2 `miPosicion` y `tamanoFila`

- `miTurno` — del centinela. Inmutable.
- `tamanoFila` — cantidad de solicitudes en estado vivo del lote.
- `miPosicion` — cuantas solicitudes vivas tienen turno **menor** que el mio, mas uno.

Se calculan con un `Query` `Select: COUNT` sobre PA-07, **sin traer los items**. Es lo que
hace estructuralmente imposible filtrar identidades (R-12): los datos de terceros nunca salen
de DynamoDB.

---

## 6. Transacciones criticas

Toda escritura de solicitud incluye su evento de auditoria en la **misma**
`TransactWriteItems` (regla 4 de `CLAUDE.md`). Si el evento no cabe, la mutacion no ocurre.

> **Todo `Put` de evento lleva `ConditionExpression: attribute_not_exists(PK)`.** Sin esa
> condicion la bitacora **no es append-only**: un `Put` con la misma clave reemplaza el item
> completo. El `Deny` de IAM no lo puede impedir, porque `PutItem` es justamente lo que la
> regla 4 obliga a permitir — esta comprobado contra AWS real en
> `amplify/auditoriaInmutable.integracion.test.ts`. La condicion es lo que convierte "no se
> puede modificar" en "no se puede modificar **ni** reescribir".

### T1 — Solicitar compra

Dos pasos, en este orden y no en otro.

**Paso 1 — `UpdateItem` sobre el lote** (atomico, sin transaccion):

```
UpdateExpression:    ADD contadorTurnos :uno
ConditionExpression: estatus = :enOferta
                     AND estatusConvocatoria = :publicada
                     AND inicioVenta <= :ahora AND finVenta > :ahora
ReturnValues:        UPDATED_NEW        -> devuelve el turno asignado
```

La condicion usa los atributos desnormalizados del lote (seccion 1). Sin ellos habria que leer
la convocatoria y decidir despues, que es la carrera que el diseno evita.

**Paso 2 — `TransactWriteItems`:**

1. `Put` solicitud con `SK = SOL#<turno:010d>` y estado `EN_FILA`.
2. `Put` centinela de fila, con `attribute_not_exists(SK)` — R-07.
3. `Put` evento `SOLICITUD_CREADA`, con `attribute_not_exists(PK)`.
4. `ConditionCheck` sobre la **convocatoria**: `estatus = PUBLICADA`.

> **Por que el `ConditionCheck` del item 4.** Los atributos desnormalizados del lote se propagan
> por tandas al publicar (T8), y la convocatoria se marca al final. Una interrupcion a la mitad
> deja lotes que ya dicen `PUBLICADA` bajo una convocatoria que todavia no lo esta — y como el
> paso 1 solo mira el lote, esos lotes serian comprables. El `ConditionCheck` devuelve la
> autoridad a la convocatoria **en el momento del commit**, sin costo de una lectura previa.
>
> Contrapartida: una lectura fuerte sobre un unico item por cada solicitud. A la escala de esta
> aplicacion es aceptable; si el volumen crece hasta hacer del item de convocatoria una particion
> caliente, se revisa. El paso 1 puede haber incrementado igual y dejar un hueco, que ya es un
> resultado aceptado.

> **Los turnos son unicos y estrictamente crecientes, pero pueden tener huecos.** Si el paso 1
> tiene exito y el paso 2 falla — tipicamente porque el participante ya estaba en la fila — el
> turno consumido no se reutiliza. `ADD` es atomico precisamente porque no se puede deshacer.
>
> Un hueco es inofensivo: la equidad depende del **orden relativo**, y ese orden es total y
> verificable con o sin huecos. Intentar garantizar contiguidad exigiria un mecanismo de
> reserva y liberacion que reintroduciria justo las carreras que este diseno elimina.
>
> Para que los huecos sean raros, la Server Action hace un `GetItem` del centinela antes del
> paso 1 y rechaza los duplicados evidentes (doble clic). Es una **optimizacion, no una
> garantia**: la autoridad sigue siendo la condicion del paso 2.
>
> La prueba de concurrencia debe afirmar **unicidad y orden estricto**, no contiguidad.

#### Carrera abierta entre el paso 1 y el paso 2 — riesgo R18

**Este diseno todavia no es correcto y no debe implementarse tal cual.** Entre el paso 1 y el
paso 2 existe una ventana en la que el turno ya se asigno pero la solicitud **aun no es visible**
para la consulta de la fila (PA-07). Con adjudicacion inmediata —`proyecto.md` seccion 7 punto 7:
"el turno 1 obtiene la adjudicacion"— esta intercalacion es posible:

1. A obtiene el turno 1 y su proceso se pausa antes del paso 2.
2. B obtiene el turno 2, completa su paso 2 y dispara la adjudicacion.
3. PA-07 solo ve a B. **B gana el vehiculo.**
4. A completa su paso 2 con el turno 1, ya tarde.

Viola R-08 ("el orden manda sobre el tiempo") y la invariante 4 de la seccion 7 de este mismo
documento. La ventana es de un viaje de red, pero el momento de maxima concurrencia es
exactamente `inicioVenta`, cuando llegan todas las solicitudes a la vez.

**Lo que NO es el problema:** que los contadores atomicos no sean idempotentes. Un reintento
ambiguo consume un turno de mas y produce un **hueco**, que este diseno ya acepta de forma
explicita. Eso no rompe ninguna invariante.

**Lo que tampoco funciona:** hacerlo todo en una sola `TransactWriteItems`.
`TransactWriteItems` **no devuelve valores**, asi que el turno que produce un `ADD` no se puede
usar como clave de un `Put` de la misma transaccion. La Etapa 8 de `plan-ejecucion.md` lo exigia;
era irrealizable y ya esta corregido ahi.

**Mecanismo candidato, a validar con el prototipo:** que el paso 1 registre la reserva del turno
en el propio item del lote (`ADD contadorTurnos :uno SET reservas.#id = :ahora`) y que el paso 2
la retire dentro de su transaccion. La adjudicacion se abstiene mientras haya reservas vigentes,
y una reserva vieja se da por muerta pasado un umbral. El lote ya es el punto de serializacion
—el paso 1 lo escribe de todos modos—, asi que no cuesta una escritura adicional.

**La prueba tiene que intercalar solicitud y adjudicacion.** Adjudicar solo despues de que todas
las solicitudes terminaron no ejerce la carrera: con esa forma de prueba, el defecto pasa.

### T2 — Adjudicar

Una sola `TransactWriteItems`, con bucle de candidatos por fuera.

```
1. Update lote        SET adjudicacionActual = :solicitudId, adjudicadoEn, venceEn,
                          turnoAdjudicado, estatus = ADJUDICADO
                      CONDITION attribute_not_exists(adjudicacionActual)      <- regla 6
2. Update solicitud   SET estatus = ADJUDICADA, adjudicadoEn, venceEn,
                          GSI4PK = VENCE#<dia>, GSI4SK = <venceEn>
                      CONDITION estatus = EN_FILA
3. Put centinela      PART#<id> / ADJUDICACION_ACTIVA
                      CONDITION attribute_not_exists(SK)                      <- R-09
4. Put evento         LOTE_ADJUDICADO
                      CONDITION attribute_not_exists(PK)
```

`venceEn = adjudicadoEn + horasLiquidacion` en horas naturales (R-13).

**Nunca se lee el lote para comprobar si esta libre.** La condicion del item 1 es la unica
autoridad. Ante N intentos simultaneos, DynamoDB deja pasar exactamente uno.

**Bucle de candidatos:** se recorre PA-07 en orden de turno. Para cada solicitud `EN_FILA` se
intenta la transaccion.

- Falla el item 1 → otro proceso ya adjudico el lote. **Se aborta**, no se reintenta.
- Falla el item 3 → el candidato ya tiene una adjudicacion activa. Se marca `CONGELADA` y se
  continua con el turno siguiente.
- Falla el item 2 → la solicitud cambio de estado. Se continua con la siguiente.
- Se agota la fila → R-17: el lote queda `EN_OFERTA`.

`TransactionCanceledException` trae `CancellationReasons` posicional; **hay que inspeccionar el
indice** para saber cual condicion fallo. Tratar todas las cancelaciones igual haria imposible
distinguir "el lote ya se adjudico" de "prueba con el siguiente".

### T3 — Subir comprobante

```
1. Update solicitud   SET estatus = EN_VERIFICACION, comprobanteClaveS3,
                          GSI2PK = SOL_ESTATUS#EN_VERIFICACION
                      REMOVE GSI4PK, GSI4SK                    <- detiene el reloj
                      CONDITION estatus = ADJUDICADA AND venceEn > :ahora
2. Put evento         COMPROBANTE_CARGADO   CONDITION attribute_not_exists(PK)
```

La condicion `venceEn > :ahora` impide subir el comprobante fuera de plazo aunque el barrido
todavia no haya pasado.

### T4 — Avalar pago

```
1. Update solicitud   -> VENDIDA                CONDITION estatus = EN_VERIFICACION
2. Update lote        -> VENDIDO
3. Update vehiculo    -> VENDIDO
4. Delete centinela   PART#<id> / ADJUDICACION_ACTIVA
5. Delete centinela   VEH#<id> / ACTIVO
6. Put evento         PAGO_AVALADO          CONDITION attribute_not_exists(PK)
```

Las solicitudes restantes del lote pasan a `NO_ADJUDICADA` **fuera** de esta transaccion: son
una cantidad no acotada y no afectan ninguna invariante.

### T5 — Vencer y reasignar (R-15)

Un solo acto atomico que cierra al vencido y adjudica al siguiente:

```
1. Update solicitud vencida  -> CANCELADA_POR_VENCIMIENTO
                                REMOVE GSI4PK, GSI4SK
                                CONDITION estatus = ADJUDICADA AND venceEn <= :ahora
2. Delete centinela          adjudicacion activa del vencido
3. Update lote               SET adjudicacionActual = :solicitudNueva, adjudicadoEn, venceEn
                             CONDITION adjudicacionActual = :solicitudVencida
4. Update solicitud nueva    -> ADJUDICADA, con claves GSI4
                             CONDITION estatus = EN_FILA
5. Put centinela             adjudicacion activa del nuevo   CONDITION attribute_not_exists
6. Put evento                SOLICITUD_VENCIDA   CONDITION attribute_not_exists(PK)
7. Put evento                LOTE_ADJUDICADO     CONDITION attribute_not_exists(PK)
```

La condicion del item 3 (`adjudicacionActual = :solicitudVencida`) es lo que hace segura la
operacion frente a concurrencia: si otro proceso ya reasigno el lote, esta transaccion se
cancela sin efectos.

Si el item 5 falla, se reintenta con el siguiente candidato. Si la fila se agota, se ejecuta
una variante reducida (items 1, 2, 6 mas `REMOVE adjudicacionActual` y `estatus = EN_OFERTA`).

El **correo no participa**: se encola en el outbox (riesgo R8).

### T6 — Rechazar pago (R-16)

Identica a T5 cambiando el estado a `RECHAZADA_POR_TESORERIA`, con `motivoRechazo` obligatorio
y condicion `estatus = EN_VERIFICACION`.

### T7 — Incluir vehiculo en convocatoria

```
1. Put lote            con contadorTurnos = 0
2. Put centinela       VEH#<id> / ACTIVO    CONDITION attribute_not_exists(SK)   <- R-10
3. Update vehiculo     -> EN_CONVOCATORIA
4. Put evento          VEHICULO_INCLUIDO   CONDITION attribute_not_exists(PK)
```

### T8 — Publicar convocatoria

Actualiza la convocatoria y **propaga los atributos desnormalizados a cada lote**
(`estatusConvocatoria`, `inicioVenta`, `finVenta`, `horasLiquidacion`, `tipoConvocatoria`).

Con mas de ~95 lotes se supera el limite de `TransactWriteItems`; se procesa por tandas y la
publicacion se marca **al final**, de modo que una interrupcion deje la convocatoria sin
publicar en lugar de publicada a medias.

> **Esa intencion no bastaba por si sola.** Marcar la convocatoria al final protege a la
> convocatoria, pero no a los lotes: los de las tandas ya procesadas quedan con
> `estatusConvocatoria = PUBLICADA` grabado, y la condicion del paso 1 de T1 solo mira el lote.
> Una interrupcion dejaba esos lotes comprables bajo una convocatoria sin publicar. Lo cierra el
> `ConditionCheck` sobre la convocatoria que ahora lleva el paso 2 de T1.
>
> Consecuencia para quien implemente el gating: **la convocatoria es el registro autoritativo**.
> Los atributos desnormalizados del lote sirven para filtrar y para condicionar barato, nunca
> para ser la ultima palabra. El `estatusConvocatoria` que se le pasa a `puedeEjecutar` debe
> salir de la convocatoria, no de la copia del lote.
>
> La propagacion debe ser **idempotente y reanudable**: repetir una tanda ya aplicada no puede
> cambiar nada.

---

## 7. Invariantes verificables

Cada una es un test. Las cuatro primeras son la prueba de concurrencia obligatoria de la
regla 16.

1. **Unicidad de turno.** N solicitudes simultaneas sobre un lote producen N turnos distintos.
2. **Orden estricto.** PA-07 devuelve turnos estrictamente crecientes. Puede haber huecos; no
   puede haber repetidos ni desorden.
3. **Adjudicacion unica.** N intentos simultaneos producen exactamente un ganador.
4. **El orden manda sobre el tiempo.** Con `solicitadoEn` deliberadamente desordenados respecto
   al turno, gana siempre el turno menor (R-08).
5. **Una adjudicacion activa.** Nunca existen dos centinelas `ADJUDICACION_ACTIVA` del mismo
   participante.
6. **Un vehiculo, una convocatoria activa.** Nunca dos centinelas `VEH#<id> / ACTIVO`.
7. **Atomicidad de la auditoria.** Si el evento no se puede escribir, la mutacion no ocurre.
8. **Sin identidades en la fila.** El DTO de PA-08 no contiene `participanteId`, correo ni
   nombre de terceros.
9. **`adjudicacionActual` nunca es `null`.** O existe con un valor, o no existe.
10. **Coherencia de GSI4.** Toda solicitud `ADJUDICADA` tiene claves GSI4; ninguna en otro
    estado las tiene.

---

## 8. Capacidad y operacion

- **Modo bajo demanda.** La carga es a rafagas: la apertura de una convocatoria concentra casi
  todo el trafico de escritura. Aprovisionar para ese pico seria caro el resto del tiempo.
- **PITR activado.** Es la unica red de seguridad ante un error de datos, dado que la bitacora
  no se puede reescribir.
- **Sin TTL en ningun item.** Nada del dominio caduca solo, y una expiracion automatica sobre
  la bitacora violaria R-20.
- **`ConsistentRead` en las lecturas previas a una escritura condicional.** Las lecturas de
  presentacion pueden ser eventuales; las que alimentan un bucle de candidatos, no.
