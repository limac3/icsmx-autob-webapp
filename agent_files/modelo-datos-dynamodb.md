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
| Participante | `PART#<participanteId>` | `PERFIL` | `nombre`, `correo`, `actualizadoEn`. **`participanteId` es el `sub` de Okta**, no un ULID propio: ver 2.2 |
| Vehiculo | `VEH#<vehiculoId>` | `META` | |
| Fotografia | `VEH#<vehiculoId>` | `FOTO#<orden:04d>#<fotoId>` | Se leen con `begins_with(SK, "FOTO#")`, ya ordenadas |
| **Centinela de vehiculo activo** | `VEH#<vehiculoId>` | `ACTIVO` | Garantiza R-10. Ver 4.1 |
| Convocatoria | `CONV#<convocatoriaId>` | `META` | |
| **Lote** | `CONV#<convocatoriaId>` | `LOTE#<loteId>` | Contiene el contador y la adjudicacion |
| **Solicitud** | `LOTE#<loteId>` | `SOL#<turno:010d>` | El relleno de ceros es lo que da el orden |
| **Centinela de fila** | `LOTE#<loteId>` | `PART#<participanteId>` | Garantiza R-07. Ver 4.2 |
| **Cupo de participacion** | `PART#<participanteId>` | `CUPO#<convocatoriaId>` | Contadores de R-09 y R-22. Ver 4.3 |
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

**Participante:**

```
participanteId, nombre, correo, actualizadoEn
GSI1PK/GSI1SK           OKTA#<encodeURIComponent(sub)> / PERFIL
```

Lo escribe `registrarPerfil` desde `getSession()`, **una vez por proceso y por persona** y de
mejor esfuerzo: si falla, se registra y la peticion sigue. Nada de negocio depende de este item —
los permisos los responde EAS en cada peticion (regla 17) y nunca este perfil. Existe para que la
bitacora se pueda **leer**: todo evento guarda solo `actorId`, y sin este item el auditor no puede
buscar la actividad de una persona ni ver un nombre en lugar de un `sub`.

> **`participanteId` es el `sub` de Okta, y se queda asi.** El diseno de la Etapa 0 preveia que el
> *upsert* acunara un ULID propio; hacerlo hoy **partiria en dos la historia de cada persona**,
> porque `actorId` guarda el identificador vigente cuando se escribio cada evento y la bitacora es
> append-only. Se implemento por tanto solo la mitad del *upsert* pendiente: el perfil, no la
> identidad (`desafios-implementacion.md` 8, 31 y 45).
>
> El perfil **no conserva historia**: se sobrescribe en cada acceso. Lo que necesita el dato del
> momento ya se copia al item que lo necesita — `correoTitular` en la solicitud, `actorPermisos`
> en el evento.

**Vehiculo:**

```
vehiculoId, marca, version, modelo (anio), kilometraje
nivelEquipamiento, especificacionMecanica, condicionesMecanicas, detallesEsteticos  (opcionales)
estatus                 DISPONIBLE | EN_CONVOCATORIA | RESERVADO | VENDIDO | RETIRADO
fotografiaPrincipalId   cual fotografia lo representa en listados
convocatoriaId          mientras esta EN_CONVOCATORIA (desnormalizado)
motivoRetiro
creadoEn, creadoPor, actualizadoEn, actualizadoPor
GSI2PK/GSI2SK           VEH_ESTATUS#<estatus> / <creadoEn>#<vehiculoId>
```

La fecha de GSI2 es la de **creacion** y no la de la ultima edicion: asi el catalogo de un
estatus conserva un orden estable y una correccion de kilometraje no reordena la pantalla. Al
cambiar de estatus hay que reescribir **las dos** claves del indice; olvidarlas deja el vehiculo
listado para siempre en el estatus anterior.

Los opcionales en blanco se **eliminan**, no se guardan como cadena vacia: asi una lectura
distingue "no se capturo" de "se capturo vacio".

**Fotografia:**

```
fotoId, vehiculoId, orden, claveS3, contentType, bytes, descripcion
subidaEn, subidaPor
```

`claveS3` es la ruta del objeto, **nunca una URL firmada**: esas se generan por peticion en SSR y
caducan en minutos (regla 13). El orden va en la `SK` con relleno de ceros, igual que el turno de
la fila, asi que la galeria se lee ordenada. La contrapartida es que reordenar no es actualizar
sino reubicar: un `Delete` y un `Put` por fotografia que cambia de lugar, todo en una transaccion.

**Lote** — el item mas cargado del modelo:

```
vehiculoId, precio, estatus            EN_OFERTA | ADJUDICADO | VENDIDO | NO_VENDIDO | RETIRADO
contadorTurnos                         entero, solo crece, objetivo del ADD atomico
adjudicacionActual                     solicitudId. AUSENTE cuando el lote esta libre
adjudicadoEn, venceEn, turnoAdjudicado
inicioVenta, finVenta, tipoConvocatoria, estatusConvocatoria, horasLiquidacion,
limiteAdjudicaciones, limiteSolicitudes, modalidadAdjudicacion           (desnormalizados)
```

**Los dos limites y la modalidad viajan desnormalizados por la misma razon que los otros cinco**:
el motor decide a partir del lote que ya tiene en la mano. T2 necesita el
`limiteAdjudicaciones` como literal de la condicion del item 3 y ya tiene el lote en la mano, asi
que leer la convocatoria seria una lectura de mas en el camino caliente. Como toda copia, pueden
quedarse **atras** de la convocatoria pero nunca adelantarse; en la practica no se mueven, porque
solo se editan en `BORRADOR`.

**`adjudicacionActual` se elimina con `REMOVE`, nunca se pone en `null`.** Toda la exclusion
mutua depende de `attribute_not_exists(adjudicacionActual)`; un `null` es un atributo que
existe y haria pasar la condicion, adjudicando el mismo lote dos veces.

**Solicitud:**

```
solicitudId, loteId, convocatoriaId, participanteId, turno, solicitadoEn
ordenEnConvocatoria   -- el n-esimo intento de este participante en esta convocatoria
                      -- (R-22). Ordena entre lotes distintos, que es lo que el turno
                      -- no puede hacer. Puede faltar en solicitudes anteriores a la
                      -- Etapa 14
estatus     EN_FILA | CONGELADA | ADJUDICADA | EN_VERIFICACION | VENDIDA
            | CANCELADA_POR_VENCIMIENTO | RECHAZADA_POR_TESORERIA
            | CANCELADA_POR_PARTICIPANTE | CANCELADA_POR_LIMITE | NO_ADJUDICADA
adjudicadoEn, venceEn, comprobanteClaveS3, comprobanteSubidoEn, motivoRechazo
correoTitular   -- copia de la sesion en T1 (Etapa 9). No hay perfil de
                -- participante persistido; sin esta copia PA-11 no podria
                -- decirle a tesoreria a quien le pertenece un comprobante
                -- (desafios-implementacion.md 31)
```

Todas las fechas en **ISO-8601 UTC** (R-04). La conversion a `America/Mexico_City` ocurre solo
al presentar.

---

## 3. Indices secundarios globales

Ocho GSIs, en dos familias con convenciones distintas y por una razon.

**Los cuatro de negocio** usan claves genericas (`GSInPK`/`GSInSK`) porque estan
**sobrecargados**: GSI2 solo sirve a cinco entidades distintas, y una clave con nombre semantico
mentiria sobre cuatro de ellas.

| Indice | `GSI#PK` | `GSI#SK` | Proyeccion |
| --- | --- | --- | --- |
| **GSI1** — identidad alterna | `OKTA#<oktaSub>` | `PERFIL` | `KEYS_ONLY` |
| **GSI2** — listados por estatus | `<TIPO>_ESTATUS#<estatus>` | `<fecha>#<id>` | `ALL` |
| **GSI3** — por participante | `PART#<participanteId>` | `SOL#<solicitadoEn>#<loteId>` | `ALL` |
| **GSI4** — trabajo pendiente (disperso) | `VENCE#<yyyy-mm-dd>` / `OUTBOX_PENDIENTE` | `<venceEn>` / `<creadoEn>` | `ALL` |

**Los cuatro de la bitacora** llevan **nombre semantico**, porque cada uno responde una sola
pregunta del auditor y el nombre hace evidente la propiedad que sostiene el diseno: un vehiculo no
tiene `diaPK`, asi que **no esta en ese indice**. Los cuatro son dispersos: solo los eventos pagan
escritura por ellos.

| Indice | `PK` | `SK` | Responde |
| --- | --- | --- | --- |
| **GSI6** — por tipo de evento | `TIPO#<tipo>#<yyyy-mm>` | `cronoSK` | "todos los rechazos de pago del mes" |
| **GSI7** — agregados de un dia | `DIA#<yyyy-mm-dd>` | `agregadoSK` | "que identificadores tuvieron actividad" |
| **GSI8** — personas de un dia | `DIA#<yyyy-mm-dd>` | `actorSK` | "quienes actuaron" |
| **GSI9** — actividad de una persona | `ACTOR#<actorId>#<yyyy-mm>` | `cronoSK` | "que firmo esta persona" |

```
cronoSK      <ocurridoEn>#<eventoId>
agregadoSK   <agregado>#<agregadoId>#<ocurridoEn>#<eventoId>
actorSK      ACTOR#<actorId>#<ocurridoEn>#<eventoId>
mesPK        MES#<yyyy-mm>              -- escrito, SIN indice; ver abajo
```

**Seis atributos sirven a los cuatro indices**, no ocho: `cronoSK` es la clave de ordenamiento de
GSI6 y GSI9, y `diaPK` la particion de GSI7 y GSI8. Es lo que mantiene el item de evento por
debajo del minimo facturable de 1 KB, o sea a 1 WCU por evento.

**GSI6 y GSI9 particionan por mes, GSI7 y GSI8 por dia**, y la diferencia no es de rendimiento:

- Por **mes**, el rango se acota dentro de la particion con `cronoSK`, asi que 90 dias cuestan
  entre una y cuatro `Query` en vez de 90.
- Por **dia**, porque de ahi salen las **listas de opciones** de la pantalla: una opcion "activa en
  el mes pero no en el rango" devolveria una tabla vacia, que es exactamente lo que esas listas
  existen para evitar.

> **`mesPK` se escribe y no tiene indice, a proposito.** Iba a ser la particion de un GSI5
> cronologico que se borro por no tener lector: la pantalla exige al menos un criterio y los tres
> tienen su propio indice, asi que nadie pregunta por el rango a secas. Un indice con proyeccion
> `ALL` y sin lector cobra una escritura por evento a cambio de nada.
>
> El atributo se conserva porque **lo irreversible son los atributos, no los indices**: a un evento
> append-only no se le pueden agregar despues —IAM deniega `UpdateItem` y
> `attribute_not_exists(PK)` rechaza un `Put` de reemplazo—, asi que un atributo que hoy no se
> escribe es una pregunta que nunca se podra responder sobre los eventos de hoy. El indice se crea
> cuando aparezca el lector y su relleno vera todo lo ya escrito.
>
> Los indices **no se renumeraron** al borrar GSI5: pasar GSI6 a GSI5 exigiria borrar y recrear
> cuatro indices para ganar consecutividad.

> **GSI2 ya no lleva la bitacora.** Hasta la Etapa 11.2 tenia una particion `AUDIT#<yyyy-mm-dd>`
> por dia, que era el unico acceso cronologico. Con la familia de arriba quedo redundante, y
> mientras existiera duplicaba **cada evento** en un indice `ALL`. Volvio a servir solo sus cinco
> patrones de negocio.

**Por que `ALL` y no `INCLUDE`** (decidido al implementar la Etapa 3). GSI2 sirve a cinco
accesos sobre entidades distintas —vehiculos, convocatorias, solicitudes y bitacora—, asi que
su lista de atributos incluidos seria la union de lo que necesitan cinco pantallas que aun no
existen. Y **la proyeccion de un GSI no se puede modificar despues de creado**: ampliarla exige
borrar el indice y recrearlo, con una ventana en la que PA-05 y PA-11 dejan de responder. Los
items del modelo son pequenos —las fotografias y los comprobantes son claves de S3, no datos—,
asi que el sobrecosto de `ALL` es acotado y compra no tener que migrar indices cada vez que una
pantalla pide un campo mas.

> **Revisado en la Etapa 12 y confirmado: no se estrecha.** Con las pantallas ya construidas se
> hizo la cuenta, y el ahorro cae entero sobre los items que casi nunca se escriben. Ver 8.1.

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
> `src/lib/domain/fechas.ts`). Aplica igual a `DIA#<yyyy-mm-dd>` en GSI7 y GSI8, y al `mes` de
> GSI6 y GSI9 — que se **recorta del dia** (`dia.slice(0, 7)`) en vez de calcularse aparte, para
> que no puedan hablar de calendarios distintos en la frontera de fin de mes.
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

### 4.3 Item de cupo de participacion — R-09 y R-22

`PART#<participanteId> / CUPO#<convocatoriaId>`, con dos contadores:

| Atributo | Que mide | Como se mueve |
| --- | --- | --- |
| `solicitudesCreadas` | Cuantas veces intento formarse en esta convocatoria | `ADD :uno`. **Monotonico: jamas decrece** |
| `cupoConsumido` | Cuantos vehiculos de esta convocatoria tiene o tuvo en firme | `ADD :uno` al adjudicar, `ADD :menosUno` al perder la adjudicacion. **No baja al vender** |

**No es un centinela**, aunque viva en esta seccion: un centinela existe o no existe, y estos son
contadores. Comparten con ellos lo unico que importa aqui — convertir una regla de negocio en una
garantia atomica sin leer antes de decidir.

**El tope de adjudicaciones se aplica con la condicion del propio `ADD`**, dentro de la
transaccion de T2:

```
UpdateExpression:     ADD cupoConsumido :uno
ConditionExpression:  attribute_not_exists(cupoConsumido) OR cupoConsumido < :limite
```

La condicion se evalua contra el valor **previo** al `ADD`, en el mismo item y la misma operacion
atomica: no hay ventana entre comprobar y sumar. El `:limite` llega desnormalizado en el lote, que
T2 ya tiene en la mano, asi que no cuesta una lectura extra.

**El tope de solicitudes no viaja en la transaccion de T1**, y no por comodidad. Va en un `ADD`
suelto con `ReturnValues: UPDATED_NEW` —igual que el contador de turnos, porque
`TransactWriteItems` no devuelve valores— cuyo valor nuevo **es** el `ordenEnConvocatoria` de esa
solicitud. Si excede el tope, la solicitud se crea igual y se cancela a continuacion a
`CANCELADA_POR_LIMITE`: queda constancia del intento (R-22).

**Va despues de `pedirTurno`, no antes.** Un `ADD` es atomico y no se puede deshacer, asi que un
ordinal gastado por una solicitud que despues falla no se recupera — igual que los huecos de
turno, que el diseno acepta. La diferencia es que este ordinal **cuenta contra un tope**, asi que
quemarlo le cuesta una participacion a quien no hizo nada mal. Tras `pedirTurno` ya estan
validados la ventana de venta y el estado del lote, y lo unico que aun puede fallar es una carrera
genuina.

**El decremento no necesita maquinaria contra el doble conteo.** Viaja dentro de las transacciones
que ya quitan la adjudicacion (T5, T5b, T6), que ya llevan condiciones que fallan al repetirse
—`#estatus = :adjudicada`, `adjudicacionActual = :vencida`—: un reintento posterior al exito no
escribe nada. **T4 (avalar pago) no decrementa**: la venta consume el cupo definitivamente.

**Solo lo escribe su propio participante**, asi que no es una particion caliente compartida. Es lo
contrario del `ConditionCheck` sobre la convocatoria que T1 tuvo que retirar (seccion 4.4 y
desafios-implementacion.md 17).

> **Sustituye al centinela de adjudicacion activa.** Hasta la Etapa 14 esta seccion describia
> `PART#<participanteId> / ADJUDICACION_ACTIVA`, un centinela que garantizaba una sola
> adjudicacion viva por participante **en todo el sistema** y hacia que la adjudicacion congelara
> a quien ya la tuviera. Ese item ya no se escribe ni se lee. El cambio de forma no es
> caprichoso: un centinela responde "¿existe?" y el negocio ahora pregunta "¿cuantos?".

### 4.4 Reserva de turno — R18

`LOTE#<loteId> / RESERVA#<reservaId>`, con `anotadaEn`.

Marca que un turno ya se entrego y su solicitud **todavia no es visible** en la fila. Es lo que
cierra la carrera entre los dos pasos de T1; el razonamiento completo esta en T1.

- Se escribe **antes** de pedir el turno, no despues. El orden es la garantia: al reves quedaria
  abierta justo la ventana que se quiere cerrar. Al derecho, lo peor que puede pasar es una
  reserva huerfana que nadie reclama.
- Se borra dentro de la **misma** `TransactWriteItems` que hace visible la solicitud, con
  `attribute_exists(SK)`.
- La adjudicacion se abstiene mientras exista alguna reserva mas joven que el umbral, y depura
  las mas viejas.

`reservaId` identifica el **intento**, no al participante: se genera nuevo cada vez, de modo que
retirar una reserva nunca puede retirar la de otro intento.

**Es un item propio y no un atributo del lote, y la diferencia es medible.** Dentro de una
`TransactWriteItems`, tocar el item del lote hace que las solicitudes simultaneas se cancelen
entre si con `TransactionConflict`: en el prototipo, de 10 solicitudes concurrentes se perdian
entre 5 y 9. Con un item por intento no hay dos transacciones que compartan item, y las 10
entran. Ver desafios-implementacion.md seccion 17.

Ordena entre `PART#` y `SOL#`, asi que ninguna consulta de la fila la ve.

### 4.5 Centinela de identificador de negocio

`<ambito>#<valorNormalizado> / CENTINELA`, con el identificador de la entidad como atributo.

Tres ambitos, uno por pregunta distinta: `FOLIO_CONV`, `NUMECO_VEH` y `SERIE_VEH`. **No uno
compartido**: si el folio de una convocatoria y el numero economico de un vehiculo cayeran en el
mismo ambito, un folio `A-1` impediria registrar el vehiculo `A-1`. Son universos separados porque
nombran cosas separadas.

Convierte "no puede haber dos" en una garantia de la base de datos, con `attribute_not_exists(SK)`
y **en la misma transaccion** que la entidad. Comprobarlo leyendo antes de escribir seria el "leer
y luego decidir" que prohibe la regla 6: dos altas simultaneas con el mismo folio pasarian las dos.

Su particion es el **valor** y no la entidad, porque es lo unico que dos registros duplicados
comparten. De ahi salen dos propiedades gratis:

- **Es tambien el indice de busqueda** (PA-16): encontrar un vehiculo por su numero economico es un
  `GetItem`, no un recorrido.
- **El renombrado es atomico**: `Put` del nuevo con `attribute_not_exists`, `Delete` del viejo con
  `attribute_exists` y `Update` de la entidad, en una sola transaccion. Partirlo en dos dejaria, si
  el segundo paso falla, o un valor reservado que nadie puede volver a usar, o dos entidades con el
  mismo.

**Los centinelas van primero en la transaccion**, y no es cosmetico: `ejecutarTransaccion` devuelve
el **indice** del item que cancelo, y es la unica forma de saber *cual* de los dos numeros de un
vehiculo estaba duplicado. Con ellos al frente ese indice es estable y no se mueve al agregar items
despues.

El valor llega **ya normalizado** —recortado y en mayusculas, con alfabeto de lista blanca
(`A-Z`, `0-9`, `-`, `_`, `/`)—. Sin normalizar, `"ab-1"` y `"AB-1"` serian dos centinelas y el
duplicado se colaria; sin lista blanca, un `#` dentro del valor desplazaria el separador de la
clave y podria fabricar el centinela de otro ambito.

> **El identificador de negocio no es la clave de la entidad ni el ancla de su bitacora.** Eso
> sigue siendo el identificador interno, y es lo que permite **corregir un typo** sin partir la
> historia en dos. Misma division que D-15 hizo para `participanteId`.

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
| PA-13 | Bitacora de un rango, por criterio | `Query` sobre GSI6, GSI9 o GSI7 segun el criterio; el rango es **condicion de clave**. Ver 5.3 |
| PA-14 | Correos pendientes | `Query` GSI4 `OUTBOX_PENDIENTE` |
| PA-15 | Valores distintos con actividad | `Query` con salto de grupo sobre GSI7 u GSI8. Ver 5.4 |
| PA-16 | Entidad por su identificador de negocio | `GetItem` del centinela 4.5 |

### 5.1 El gating triple es una consulta, no un filtro

PA-05 aplica las tres condiciones de R-01 **dentro** de la lectura
(`listarConvocatoriasVisibles`, Etapa 7):

- `estatus = PUBLICADA` → esta en la clave de particion del GSI2.
- `publicadaEn <= ahora` → condicion de rango sobre `GSI2SK`, con
  `gsi2.cotaSuperiorPorFecha(ahora)` como limite superior — **no el valor de `ahora` a
  secas**. `GSI2SK` es `<fecha>#<id>`, y comparar contra la fecha sola excluye por error un
  item publicado en el mismo instante: la cadena con sufijo ordena despues que su propio
  prefijo (`desafios-implementacion.md` 29).
- Tipo compatible → filtro **en memoria**, despues de `aConvocatoria`, contra los
  **permisos de venta de la sesion** ya resueltos en `tiposDeConvocatoriaPermitidos`. Igual que
  la busqueda de `listarVehiculos`: un `FilterExpression` se aplicaria igual despues de leer, sin
  ahorrar nada, y filtrar el tipo ya deserializado evita construir una expresion dinamica para
  uno o dos valores.

Lo que no se recupera no puede filtrarse mal despues. El tipo se descarta despues y no en la
clave porque un `EMPLEADO` necesita ambos tipos en una sola pantalla; el volumen es pequeno y el
descarte, marginal.

### 5.2 `miPosicion` y `tamanoFila`

- `miTurno` — del centinela. Inmutable.
- `tamanoFila` — cantidad de solicitudes en estado vivo del lote.
- `miPosicion` — cuantas solicitudes vivas tienen turno **menor** que el mio, mas uno.

Se calculan con un `Query` `Select: COUNT` sobre PA-07, **sin traer los items**. Es lo que
hace estructuralmente imposible filtrar identidades (R-12): los datos de terceros nunca salen
de DynamoDB.

### 5.3 PA-13: cada criterio tiene su indice, y el rango es condicion de clave

`consultarBitacoraGlobal` traduce la busqueda en una lista de consultas, y **un solo lugar**
—`consultasDe`— decide cual:

| Criterio | Indice | Particiones por rango |
| --- | --- | --- |
| tipo de evento | GSI6 | 1-4 (una por mes) |
| persona que **firmo** | GSI9 | 1-4 |
| tipo de registro | GSI7 con `begins_with` | una por dia |

Hasta la Etapa 11.2 era **una `Query` por dia** sobre `AUDIT#<dia>` en GSI2, con todo lo demas en
`FilterExpression` sobre un tope de 2 000 eventos acumulados en memoria. Ese tope produjo **tres**
defectos seguidos, los tres de la misma clase —una cota que cambia la respuesta en silencio— y
ninguno detectable con una prueba que solo cuente cuantos eventos sobreviven
(`desafios-implementacion.md` 44 y 46).

**La cota del rango vive en un solo lugar** (`rangoDeBitacora.ts`), porque las cuatro consultas la
comparten y una cota que cada lector calculara por su cuenta puede divergir:

```
cronoSK BETWEEN :desde AND :hasta
  :desde = medianoche de negocio del primer dia
  :hasta = medianoche de negocio del dia SIGUIENTE al ultimo
```

Dos propiedades que hay que leer juntas:

- **La frontera es la medianoche de Mexico**, la misma con la que `atributosDeEvento` calcula el
  `dia` y el `mes`. La de UTC movia el rango seis horas respecto de las particiones consultadas, y
  el mismo rango devolvia conjuntos distintos segun como se buscara (seccion 44).
- **Es `BETWEEN` y el limite superior queda exclusivo del instante, sin centinela.** DynamoDB admite
  **una sola condicion por clave**: `cronoSK >= :a AND cronoSK < :b` se rechaza con
  `ValidationException`, y ningun doble de cliente lo detecta (seccion 51). `BETWEEN` es inclusivo,
  pero `cronoSK` es `<ocurridoEn>#<eventoId>` y toda cadena ordena despues que su propio prefijo:
  un evento ocurrido exactamente en esa medianoche queda fuera. La propiedad que obligaba a
  inventar un `U+FFFF` cuando la cota era el ultimo instante del rango trabaja a favor cuando la
  cota es la medianoche siguiente, donde no puede haber ningun evento ambiguo.

Tres reglas del recorrido:

- **De lo mas nuevo a lo mas viejo, en secuencia**, y se voltea al final. Es lo que hace correcto el
  truncamiento: lo que sobra tiene que ser lo mas viejo. En secuencia y no en paralelo para poder
  **dejar de consultar** en cuanto se llena el cupo; el caso lento —recorrer las cuatro
  particiones— es exactamente el caso en que casi no hay datos.
- **El rango se acota a 90 dias** (`MAXIMO_DIAS_DE_RANGO`), y lo valida la pantalla **y otra vez el
  servicio**. Eran 31 cuando el tope era el numero de `Query`; ahora acota cuanta historia cabe en
  una pantalla sin paginar, y el costo real que limita es el de los sondeos de 5.4, que si son por
  dia. Solo aplica al modo global: con un identificador concreto se lee una sola particion (PA-12) y
  el rango vuelve a ser un filtro en memoria.
- **Solo queda un filtro, y es el unico que no cabe en ninguna clave**: tipo de evento **combinado
  con** tipo de registro. GSI7 particiona por dia y ordena por agregado, asi que el tipo no entra en
  su clave; el filtro se aplica sobre una lectura ya restringida a un dia y a un tipo de registro.
  Si esa funcion crece, es la senal de que alguien agrego un criterio sin darle clave.

> **El criterio es obligatorio en el tipo.** `BusquedaGlobal` es una union de tres ramas, cada una
> exigiendo uno de los tres criterios, asi que un rango sin criterio **no se puede construir**.
> Antes se podia y caia en el indice cronologico; hoy ese indice no existe, y sin el tipo el error
> seria un `ValidationException` en runtime sobre codigo que compila.

### 5.4 PA-15: los valores distintos sin leer todos los eventos

Las dos listas de opciones de `/auditoria` preguntan "que identificadores —o que personas— tuvieron
actividad en el rango". La respuesta natural —leer los eventos y quedarse con los distintos— cuesta
miles de items para devolver docenas: un dia de apertura escribe 3 288 eventos de lote sobre 10
lotes.

GSI7 y GSI8 agrupan **por valor antes que por tiempo**, y eso permite saltar:

1. Leer una pagina descendente del dia (`Limit: 100`).
2. Quedarse con todos los valores distintos que trae.
3. Poner `ExclusiveStartKey` en el **prefijo sin sufijo** del ultimo grupo visto
   —`"LOTE#<id>"` ordena estrictamente antes que `"LOTE#<id>#<crono>"`—, lo que deja atras ese
   grupo entero.

DynamoDB acepta esa clave sintetizada aunque no corresponda a ningun item; verificado contra la
tabla real. Los dias se recorren de nuevo a viejo **en tandas de ocho concurrentes**, procesadas en
orden para no perder el criterio de "ultimo dia con actividad primero".

> **La pagina de 100 no es un detalle de afinacion.** La primera version sondeaba de a **un** item,
> que es optimo con grupos enormes y pesimo con muchos grupos chicos: 200 valores distintos son 200
> viajes de red **encadenados**, y la pantalla tardaba 20 segundos. Contar consultas no es medir
> latencia (`desafios-implementacion.md` 52).

Lo que se pierde, dicho para que nadie lo redescubra: el orden deja de ser "ultima actividad
exacta" y pasa a ser "ultimo dia con actividad". Para poblar un `<select>` alcanza; para una tabla
de resultados no alcanzaria.

**Lo que no funciona, para que nadie lo reintente:** un item marcador por (dia, agregado). Con
`attribute_not_exists` el segundo evento del dia cancelaria la transaccion de negocio completa; sin
condicion, N solicitantes del mismo lote escribirian el mismo item dentro de sus transacciones y
reabririan R18.

### 5.5 Costo por render de `/auditoria`

Los sondeos de las dos listas (5.4), mas la consulta del modo elegido (5.3), mas una lectura por
lote de las entidades que hay que nombrar. Rastrear un participante suma su `Query` de GSI3 (PA-09)
y **una particion de lote por lote suyo** —agrupadas, asi que varios turnos en la misma fila son
una sola consulta—, acotadas a `MAXIMO_SOLICITUDES_A_RASTREAR`.

> **Los eventos de una solicitud viven en la particion de su lote.** Los 19 escritores anclan a
> `LOTE`, porque la fila **es** del lote y la solicitud es un lugar dentro de ella. La consulta
> "que le ocurrio a esta persona" leia particiones `AUDIT#SOLICITUD#<id>` que ningun escritor
> escribe: devolvia cero siempre, y nadie lo noto porque cero es una respuesta plausible. Se
> resolvio sin agregar ningun atributo —un `sujetoId` solo responderia sobre los eventos futuros, y
> esta consulta es retrospectiva por definicion.

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

Tres escrituras, en este orden y no en otro. El diseno esta **validado contra DynamoDB real**
por el prototipo de R18 (`src/lib/fila/prototipoDeFila.integracion.test.ts`).

**Paso 0 — `Put` de la reserva de turno** (seccion 4.4):

```
Item:   LOTE#<loteId> / RESERVA#<reservaId>, anotadaEn = :ahora
```

Va **antes** del contador, no despues. Si fuera despues, entre la entrega del turno y la marca
quedaria abierta exactamente la ventana que la reserva existe para cerrar.

**Paso 1 — `UpdateItem` sobre el lote** (atomico, sin transaccion):

```
UpdateExpression:    ADD contadorTurnos :uno
ConditionExpression: (estatus = :enOferta OR estatus = :adjudicado)
                     AND estatusConvocatoria = :publicada
                     AND inicioVenta <= :ahora AND finVenta > :ahora
ReturnValues:        UPDATED_NEW        -> devuelve el turno asignado
```

La condicion usa los atributos desnormalizados del lote (seccion 1). Sin ellos habria que leer
la convocatoria y decidir despues, que es la carrera que el diseno evita.

> **`ADJUDICADO` tambien admite fila, y esto es una correccion.** Este documento exigia
> `estatus = EN_OFERTA`. Con adjudicacion inmediata el turno 1 pasa el lote a `ADJUDICADO` a los
> segundos de `inicioVenta`, asi que esa condicion cerraba la fila casi al abrirla: nadie mas
> podia formarse, `miPosicion` y `tamanoFila` no tendrian a quien contar, la reasignacion de
> R-15 no tendria a quien reasignar, y R-17 —"sigue disponible para quien solicite despues,
> mientras la venta siga abierta"— seria inalcanzable. Lo que si cierra la fila es un lote
> `VENDIDO`, `NO_VENDIDO` o `RETIRADO`.

Si el paso 1 falla, se borra la reserva del paso 0: no corresponde a ningun turno y solo
demoraria adjudicaciones ajenas hasta el umbral.

**Paso 1b — `UpdateItem` sobre el item de cupo** (atomico, sin transaccion):

```
Key:              PART#<participanteId> / CUPO#<convocatoriaId>
UpdateExpression: ADD solicitudesCreadas :uno
ReturnValues:     UPDATED_NEW        -> devuelve el ordenEnConvocatoria
```

**Sin condicion, y es deliberado:** el tope no rechaza, cancela despues (R-22). El valor nuevo se
persiste en la solicitud como `ordenEnConvocatoria` y es lo unico que permite comparar el orden de
llegada de un participante **entre lotes distintos** — los turnos son por lote y no se comparan
entre si.

Va **despues** del paso 1 por la misma razon que el paso 0 va antes: el ordinal cuenta contra un
tope y quemarlo tiene costo. Ver seccion 4.3.

**Paso 2 — `TransactWriteItems`:**

1. `Put` solicitud con `SK = SOL#<turno:010d>`, estado `EN_FILA` y `ordenEnConvocatoria`.
2. `Put` centinela de fila, con `attribute_not_exists(SK)` — R-07.
3. `Put` evento `SOLICITUD_CREADA`, con `attribute_not_exists(PK)`.
4. `Delete` de la reserva del paso 0, con `attribute_exists(SK)`.

**Paso 3 — cancelacion por tope, solo si `ordenEnConvocatoria > limiteSolicitudes`** (R-22). Es
una transaccion aparte —`Update` de la solicitud a `CANCELADA_POR_LIMITE`, `Delete` del centinela
de fila y evento `SOLICITUD_CANCELADA_POR_LIMITE`— y **no** un item mas del paso 2: la solicitud
tiene que existir antes de poder cancelarse, que es exactamente lo que el negocio pidio.

El orden de los items fija la prioridad del diagnostico: `CancellationReasons` es posicional y
se toma el **primer** motivo distinto de `None`, asi que "ya estabas en la fila" (item 2) gana
sobre "tu reserva ya se dio por muerta" (item 4).

> **Por que el item 4 lleva condicion.** Sin ella el mecanismo seria solo una espera cortes: un
> proceso al que la adjudicacion ya dio por muerto escribiria igual su solicitud, con un turno
> menor que el del ganador, y R18 seguiria abierto — solo que mas dificil de reproducir. Con
> ella, quien pierde su reserva pierde su turno y queda un hueco, que el diseno ya acepta. El
> umbral pasa a ser un compromiso de **espera**, no de correccion.

> **Lo que este paso ya no lleva: el `ConditionCheck` sobre la convocatoria.** Se agrego en la
> Etapa 2.1 contra la publicacion parcial y es correcto, pero apunta a un unico item que
> comparten **todas** las solicitudes de la convocatoria, y dentro de una transaccion un
> `ConditionCheck` retiene el item igual que una escritura. Medido con 10 solicitudes
> simultaneas, cancelaba entre 5 y 7 por `TransactionConflict`: la garantia se pagaba rechazando
> a quien llega puntual, en el unico instante en que todos llegan a la vez. La publicacion
> parcial se cierra ahora en T8, ordenando la propagacion; ver ahi.

> **Los turnos son unicos y estrictamente crecientes, pero pueden tener huecos.** Si el paso 1
> tiene exito y el paso 2 falla — tipicamente porque el participante ya estaba en la fila — el
> turno consumido no se reutiliza. `ADD` es atomico precisamente porque no se puede deshacer.
>
> Un hueco es inofensivo: la equidad depende del **orden relativo**, y ese orden es total y
> verificable con o sin huecos.
>
> **La reserva del paso 0 no cambia esto y no pretende cambiarlo.** Sirve para saber que un
> turno esta en vuelo, no para devolverlo: cuando su solicitud no llega, la reserva se retira y
> el turno queda consumido. Reciclarlo exigiria decidir a quien se le entrega el hueco, que es
> justo la clase de decision que este diseno saca del codigo y le deja al contador atomico.
>
> Para que los huecos sean raros, la Server Action hace un `GetItem` del centinela antes del
> paso 1 y rechaza los duplicados evidentes (doble clic). Es una **optimizacion, no una
> garantia**: la autoridad sigue siendo la condicion del paso 2.
>
> La prueba de concurrencia debe afirmar **unicidad y orden estricto**, no contiguidad.

#### La carrera entre el turno y su visibilidad — riesgo R18, cerrado

Sin el paso 0, entre el paso 1 y el paso 2 existe una ventana en la que el turno ya se asigno
pero la solicitud **aun no es visible** para PA-07. Con adjudicacion inmediata —`proyecto.md`
seccion 7 punto 7: "el turno 1 obtiene la adjudicacion"— esta intercalacion ocurre:

1. A obtiene el turno 1 y su proceso se pausa antes del paso 2.
2. B obtiene el turno 2, completa su paso 2 y dispara la adjudicacion.
3. PA-07 solo ve a B. **B gana el vehiculo.**
4. A completa su paso 2 con el turno 1, ya tarde.

Viola R-08 ("el orden manda sobre el tiempo") y la invariante 4 de la seccion 7. El prototipo
**lo reproduce de forma determinista**, no como hipotesis: con una pausa deliberada en el paso 2
de A, el turno 2 gana el vehiculo en todas las corridas.

**Lo que NO es el problema:** que los contadores atomicos no sean idempotentes. Un reintento
ambiguo consume un turno de mas y produce un **hueco**, que este diseno ya acepta de forma
explicita. Eso no rompe ninguna invariante.

**Lo que tampoco funciona:** hacerlo todo en una sola `TransactWriteItems`.
`TransactWriteItems` **no devuelve valores**, asi que el turno que produce un `ADD` no se puede
usar como clave de un `Put` de la misma transaccion.

**Lo que se probo y se descarto:** anotar la reserva en el propio item del lote
(`ADD contadorTurnos :uno SET reservas.#id = :ahora`), que era el mecanismo candidato. Cierra la
carrera, pero obliga al paso 2 a escribir el item del lote, y ese item lo comparten todas las
solicitudes simultaneas: DynamoDB no las serializa, las cancela con `TransactionConflict`. Con
10 solicitudes a la vez se perdian entre 5 y 9. El razonamiento que lo proponia —"el lote ya es
el punto de serializacion, asi que no cuesta una escritura adicional"— confundia dos cosas
distintas: un `UpdateItem` suelto sobre un item caliente **espera**, y el mismo item dentro de
una transaccion **falla**.

**Lo que se adopto:** la reserva como item propio (seccion 4.4). Cierra la carrera igual y no
introduce ningun item compartido: con 10 solicitudes simultaneas entran las 10, con turnos
unicos, orden estricto y un solo ganador, repetido en varias rondas.

**La prueba tiene que intercalar solicitud y adjudicacion.** Adjudicar solo despues de que todas
las solicitudes terminaron no ejerce la carrera. El prototipo lo confirmo por medicion: en once
rondas de rafaga con el diseno defectuoso, la adjudicacion la gano el turno 1 **todas las
veces**. Una prueba con esa forma habria pasado en verde con el defecto presente.

### T2 — Adjudicar

Una sola `TransactWriteItems`, con bucle de candidatos por fuera.
Implementada en `src/lib/fila/adjudicarLote.ts` (Etapa 8).

> **T2b — adjudicacion manual (R-23).** `src/lib/fila/adjudicarManualmente.ts` reusa esta
> transaccion **cambiando solo como se elige al candidato**: en vez de recorrer la fila de menor a
> mayor, toma el turno que indico el adjudicador. Las cinco condiciones se conservan intactas —lote
> libre y `EN_OFERTA`, solicitud `EN_FILA`, cupo disponible, vehiculo `EN_CONVOCATORIA`, evento
> append-only—, porque **la regla 6 aplica igual cuando quien decide es una persona**: el servidor
> no lee para decidir, escribe condicionalmente y acepta perder la carrera.
>
> Si el elegido agota su cupo, la accion **falla con `limite_alcanzado`** y la pantalla lo explica.
> No prueba con otro: elegir por su cuenta seria volver a la modalidad automatica.

```
1. Update lote        SET adjudicacionActual = :solicitudId, adjudicadoEn, venceEn,
                          turnoAdjudicado, estatus = ADJUDICADO
                      CONDITION attribute_not_exists(adjudicacionActual)      <- regla 6
                            AND estatus = EN_OFERTA
2. Update solicitud   SET estatus = ADJUDICADA, adjudicadoEn, venceEn,
                          GSI4PK = VENCE#<dia>, GSI4SK = <venceEn>
                      CONDITION estatus = EN_FILA
3. Update cupo        PART#<id> / CUPO#<convocatoriaId>
                      ADD cupoConsumido :uno
                      CONDITION attribute_not_exists(cupoConsumido)
                            OR cupoConsumido < :limite                        <- R-09
4. Update vehiculo    -> RESERVADO          CONDITION estatus = EN_CONVOCATORIA
5. Put evento         LOTE_ADJUDICADO
                      CONDITION attribute_not_exists(PK)
6. Put mensaje +      outbox del correo de adjudicacion (seccion 6.1) — solo si el
   evento             ganador tiene correoTitular; lista vacia si no, sin bloquear
                      CONDITION attribute_not_exists(PK)
```

**Cuando falla el item 3, la reaccion es omitir, no congelar.** El candidato agoto su cupo en esta
convocatoria: se deja `SOLICITUD_OMITIDA` con razon `LIMITE_ALCANZADO` y se sigue con el turno
siguiente. **La solicitud saltada se queda `EN_FILA` con su turno intacto** — el cupo se libera al
vencer o al ser rechazado, y quien lo recupere vuelve a ser candidato en este lote por delante de
quien llego despues.

> **Eso obliga a corregir la comprobacion de integridad.** `comprobarOrdenDeAdjudicacion` daba por
> justificado un salto solo si el turno saltado ademas habia cambiado de estado, porque hasta la
> Etapa 14 omitir implicaba congelar. Ya no: sin quitar esa clausula, **cada salto por cupo
> aparece como `saltosSinJustificar`**, es decir, la pantalla de auditoria acusa de fraude al
> comportamiento que el negocio pidio. Un `SOLICITUD_OMITIDA` justifica el salto por si solo.

#### 6.1 El outbox viaja en la transaccion que adjudica (D-6, riesgo R8)

`itemsDeEncoladoAdjudicacion` (`src/lib/correo/outbox.ts`, Etapa 10) devuelve el `Put` del
mensaje (`OUTBOX#<mensajeId> / META`, con las claves dispersas de GSI4 — seccion 3) y el `Put`
de `CORREO_ENCOLADO`, listos para aplanarse dentro del arreglo de items de T2 y T5. Devuelve una
lista **vacia** si el ganador no tiene `correoTitular`: la adjudicacion nunca depende del
correo.

**Por que en la misma transaccion, y no despues.** Un `Put` suelto tras el `TransactWriteItems`
dejaria la misma ventana que ya cerro la regla 4 para los eventos: si el proceso muere entre las
dos escrituras, la adjudicacion existe y el aviso nunca se encola, y nada lo detecta —el barrido
de correos solo actua sobre lo que ya esta en el outbox—. Meterlo en la transaccion lo hace tan
garantizado como el propio evento.

El envio real —el `POST` a CES— sigue sin participar nunca: ocurre aparte, en
`src/lib/correo/procesarOutbox.ts`, que el barrido invoca despues de resolver los vencimientos
(`arquitectura-tecnica-aws.md` 4.5).

**El despacho adquiere el mensaje antes de llamar a CES** (Etapa 13). `ENVIANDO` es una adquisicion
con plazo y no un estado de negocio:

```
PENDIENTE --[Update condicional: estatus = PENDIENTE
             OR (estatus = ENVIANDO AND leaseHasta <= ahora)]--> ENVIANDO  (+ leaseHasta)
                 -> sin configuracion de CES y APP_ENV=pruebas
                                       -> CANCELADO (+ CORREO_FALLIDO, REMOVE GSI4)
                 -> CES ok            -> ENVIADO    (+ CORREO_ENVIADO, REMOVE GSI4 y leaseHasta)
                 -> fallo reintentable -> PENDIENTE  (+ intentos+1, REMOVE leaseHasta)
                 -> no reintentable o intentos agotados -> FALLIDO (+ CORREO_FALLIDO, REMOVE GSI4)
```

`PENDIENTE` y `ENVIANDO` son los **dos** estatus presentes en GSI4: el item se queda en el indice
mientras esta adquirido, que es lo que permite retomarlo si la corrida que lo tenia murio. Las claves
se retiran al llegar a `ENVIADO`, `FALLIDO` o `CANCELADO`.

**`CANCELADO` es "nunca se intento y no se va a intentar"**, y solo tiene una causa: el entorno no
tiene configuracion de CES. Se distingue de `FALLIDO` porque la pregunta operativa es distinta —
aquel puede ser del mensaje o del servicio; este solo dice que el despliegue no podia enviar correo.
Comparte el evento `CORREO_FALLIDO`, con el motivo nombrando las variables ausentes: el hecho de
negocio es el mismo —nadie va a recibir ese correo— y agregar un tipo de evento no responderia
ninguna pregunta que el motivo no responda. **Solo ocurre con `APP_ENV=pruebas`** (D-18); en
produccion faltar la configuracion lanza, y lanza **antes** de adquirir, asi que no deja mensajes
atascados.

El orden importa y es el arreglo de un defecto: llamar a CES **antes** del `Update` hacia que dos
corridas solapadas del barrido —cada 5 min, con limite de ejecucion de 300 s— mandaran dos correos,
aunque la condicion impidiera el segundo evento `CORREO_ENVIADO`. Ver
`desafios-implementacion.md` 57, incluida la ventana que **no** se puede cerrar: CES no ofrece clave
de idempotencia.

`venceEn = adjudicadoEn + horasLiquidacion` en horas naturales (R-13).

> **Dos correcciones al escribir la Etapa 8.**
>
> **`estatus = EN_OFERTA` en la condicion del item 1.** Con solo
> `attribute_not_exists(adjudicacionActual)`, un lote `NO_VENDIDO` pasa la condicion: al concluir
> la convocatoria el lote cierra **sin** `adjudicacionActual`, asi que una adjudicacion en vuelo
> podria entregarlo despues del cierre. Un lote `VENDIDO` ya quedaba excluido por conservar su
> adjudicacion; `NO_VENDIDO` y `RETIRADO` no.
>
> **El item 4, que lleva el vehiculo a `RESERVADO`.** T2 no lo mencionaba, pero la maquina de
> estados del vehiculo (`proyecto.md` 5.2) solo admite `AVALAR_PAGO` desde `RESERVADO`: sin este
> item, `RESERVADO` seria inalcanzable y T4 no tendria transicion valida al vender. No
> reintroduce la contencion de R18 —el vehiculo se toca una vez por adjudicacion, no una vez por
> solicitud— y R-10 garantiza que ningun otro lote activo lo comparte. Su fallo se trata como
> "el lote no es adjudicable", no como "prueba con el siguiente candidato": el problema no es
> del turno que se esta evaluando.

**Nunca se lee el lote para comprobar si esta libre.** La condicion del item 1 es la unica
autoridad. Ante N intentos simultaneos, DynamoDB deja pasar exactamente uno.

**Paso previo — abstencion por reservas vigentes (R18).** Antes del bucle se leen las reservas
del lote con `Query` consistente sobre `begins_with(SK, "RESERVA#")`. Si queda alguna mas joven
que el umbral, hay un turno en vuelo que la fila todavia no muestra y **la adjudicacion no
ocurre**: se devuelve "abstenido" y la dispara quien complete su solicitud despues. Las reservas
mas viejas que el umbral se borran ahi mismo.

Esa lectura **solo puede detener**, nunca conceder: quien gana el lote lo sigue decidiendo la
condicion del item 1. Una lectura que unicamente se abstiene no puede autorizar de mas, asi que
no contradice la regla 6.

> **Las reservas se leen antes que la fila, y el orden es parte del mecanismo.** Al reves no
> sirve: una solicitud cuyo paso 2 se confirmara entre la lectura de la fila y la de las
> reservas no apareceria en la primera y ya no tendria reserva en la segunda — quedaria
> invisible por ambos lados. Leyendo las reservas primero, toda reserva ausente pertenece a una
> solicitud que o bien ya esta escrita —y la `Query` consistente posterior la vera— o bien nunca
> se escribira.

**Bucle de candidatos:** se recorre PA-07 en orden de turno. Para cada solicitud `EN_FILA` se
intenta la transaccion.

- Falla el item 1 o el item 4 → el problema es del lote, no del candidato. **Se aborta**, no se
  reintenta: probar con el turno siguiente daria N fracasos identicos.
- Falla el item 3 → el candidato ya tiene una adjudicacion activa. Se marca `CONGELADA` y se
  continua con el turno siguiente. Ese congelamiento va en **su propia transaccion, con dos
  eventos**: `SOLICITUD_CONGELADA`, que explica el cambio de estado, y `SOLICITUD_OMITIDA`, que
  explica en la historia del lote por que la adjudicacion siguio de largo con un turno mayor.
  Sin el segundo, la comprobacion 2 de integridad veria una adjudicacion al turno 5 con los
  turnos 3 y 4 vivos.
- Falla el item 2 → la solicitud cambio de estado. Se continua con la siguiente, **sin evento**:
  quien provoco ese cambio escribio el suyo, y una solicitud que ya no esta viva no es un turno
  saltado.
- Se agota la fila → R-17: el lote queda `EN_OFERTA` y se escribe `FILA_AGOTADA`. Es un evento
  sin mutacion, y es correcto que lo sea: sin el, una fila con turnos vivos y un lote sin
  adjudicar pareceria un proceso que dejo de correr.

`TransactionCanceledException` trae `CancellationReasons` posicional; **hay que inspeccionar el
indice** para saber cual condicion fallo. Tratar todas las cancelaciones igual haria imposible
distinguir "el lote ya se adjudico" de "prueba con el siguiente".

Falta un tercer caso: `TransactionConflict` sobre el item del lote, cuando dos procesos intentan
adjudicar a la vez. No dice quien gano, asi que la unica respuesta correcta es **releer y
reintentar** con espera y jitter, no decidir. Aqui el item caliente esta solo en el camino de la
adjudicacion —que ocurre una vez por lote— y no en el de cada solicitud, que es lo que hacia
inviable la variante descartada de R18.

### T3 — Subir comprobante

```
0. S3 PutObject       comprobantes/<solicitudId>/<archivoId>.<ext>   <- antes que DynamoDB
1. Update solicitud   SET estatus = EN_VERIFICACION, comprobanteClaveS3, comprobanteSubidoEn,
                          GSI2PK = SOL_ESTATUS#EN_VERIFICACION, GSI2SK = <comprobanteSubidoEn>#<id>
                      REMOVE GSI4PK, GSI4SK                    <- detiene el reloj
                      CONDITION estatus = ADJUDICADA AND venceEn > :ahora
2. Put evento         COMPROBANTE_CARGADO   CONDITION attribute_not_exists(PK)
```

La condicion `venceEn > :ahora` impide subir el comprobante fuera de plazo aunque el barrido
todavia no haya pasado. Las claves de GSI2 son las que alimentan PA-11 (la bandeja de
tesoreria): son **dispersas**, con la misma logica que GSI4 (seccion 3) — solo existen mientras
la solicitud espera dictamen.

> **El paso 0 no tiene compensacion**, a diferencia de `agregarFotografia`. Si el paso 1 falla,
> el objeto queda huerfano en S3: la politica IAM del rol de la aplicacion niega
> `s3:DeleteObject` sobre `comprobantes/*` (`amplify/permisos.ts`), asi que ni siquiera se
> intenta borrarlo. Un comprobante de pago es evidencia; el huerfano es el peor caso aceptable.
>
> **La condicion combinada no distingue por si sola `invalid_state` de `plazo_vencido`**
> (`api-contracts.md` seccion 5 los exige separados). Como los dos casos comparten un solo item
> de la transaccion, no se puede usar el truco posicional de T2: el diagnostico se calcula
> **antes** de intentar la escritura, con la solicitud que quien invoca ya leyo — mismo criterio
> que `motivoDelRechazo` de T1 (`src/lib/tesoreria/subirComprobante.ts`).

### T4 — Avalar pago

```
1. Update solicitud   SET estatus = VENDIDA, vendidaEn
                      REMOVE GSI2PK, GSI2SK                   <- ya no es trabajo pendiente
                      CONDITION estatus = EN_VERIFICACION
2. Update lote        -> VENDIDO   CONDITION estatus = ADJUDICADO AND adjudicacionActual = :solicitudId
3. Update vehiculo    -> VENDIDO   CONDITION estatus = RESERVADO
4. Delete centinela   VEH#<id> / ACTIVO                 CONDITION attribute_exists(SK)
5. Put evento         PAGO_AVALADO          CONDITION attribute_not_exists(PK)
```

> **T4 es la unica salida de una adjudicacion que NO devuelve cupo, y es el punto entero de
> R-09.** Hasta la Etapa 14 esta transaccion **borraba** el centinela `ADJUDICACION_ACTIVA`, de
> modo que completar una compra dejaba al participante libre para ganar otro lote de inmediato.
> Con el cupo ocurre lo contrario: una compra consumada lo gasta para siempre. Es una inversion
> deliberada del comportamiento anterior — un tope que la compra liberara no seria un tope.

Las solicitudes restantes del lote pasan a `NO_ADJUDICADA` **fuera** de esta transaccion: son
una cantidad no acotada y no afectan ninguna invariante. `avalarPago.ts` no repite esa logica —
llama a `cerrarFilaDelLote` (Etapa 8, R-18), que ya la implementa e ignora el estatus del lote
para decidir que cerrar.

> **Corrige el documento igual que T2 lo hizo con `RESERVADO`.** El enunciado original no
> mencionaba retirar las claves de GSI2 (item 1) ni las condiciones de los items 2–5. Sin la
> primera, una solicitud `VENDIDA` seguiria en la particion que lee PA-11.

### T5 — Vencer y reasignar (R-15)

Un solo acto atomico que cierra al vencido y adjudica al siguiente. Implementado en
`src/lib/fila/vencerYReasignar.ts` (Etapa 10), estructuralmente T2 con dos escrituras del lado
del vencido intercaladas delante: reusa `leerFila` de `adjudicarLote.ts` en vez de duplicar la
abstencion por reservas (R18) y el manejo del cupo por R-09.

```
1. Update solicitud vencida  -> CANCELADA_POR_VENCIMIENTO
                                REMOVE GSI4PK, GSI4SK
                                CONDITION estatus = ADJUDICADA AND venceEn <= :ahora
2. Update cupo del vencido   ADD cupoConsumido :menosUno          <- libera su cupo (R-09)
3. Update lote               SET adjudicacionActual = :solicitudNueva, adjudicadoEn, venceEn
                             CONDITION adjudicacionActual = :solicitudVencida
4. Update solicitud nueva    -> ADJUDICADA, con claves GSI4
                             CONDITION estatus = EN_FILA
5. Update cupo del nuevo     ADD cupoConsumido :uno
                             CONDITION attribute_not_exists(cupoConsumido)
                                   OR cupoConsumido < :limite     <- R-09
6. Put evento                SOLICITUD_VENCIDA   CONDITION attribute_not_exists(PK)
7. Put evento                LOTE_ADJUDICADO     CONDITION attribute_not_exists(PK)
8. Put mensaje + evento      outbox del correo de adjudicacion, si el nuevo tiene correoTitular
                             (seccion 6.1) — lista vacia si no lo tiene, nunca bloquea
```

> **Los items 2 y 5 tocan el mismo tipo de item, y eso seria fatal si coincidieran.**
> `TransactWriteItems` rechaza dos operaciones sobre **el mismo item** con `ValidationException`,
> asi que si el vencido y el candidato fueran el mismo participante la transaccion no fallaria
> por condicion sino por forma, sin diagnostico util. No pueden coincidir, y la razon es R-07:
> T5 **no** retira el centinela de fila del vencido —lo deja para que `consultarMiLugar` siga
> mostrandole `CANCELADA_POR_VENCIMIENTO`—, asi que mientras esa solicitud existio el
> participante nunca pudo tener una segunda solicitud viva en este lote. La garantia es de R-07,
> no de esta transaccion; quien toque el centinela de fila de T5 tiene que volver aqui.

La condicion del item 3 (`adjudicacionActual = :solicitudVencida`) es lo que hace segura la
operacion frente a concurrencia: si otro proceso ya reasigno el lote, esta transaccion se
cancela sin efectos.

Si el item 5 falla, se reintenta con el siguiente candidato. Si la fila se agota, se ejecuta
una variante reducida.

> **Correccion al implementar la Etapa 10: la variante reducida tambien libera el vehiculo.**
> Este documento la describia como "items 1, 2, 6 mas `REMOVE adjudicacionActual` y
> `estatus = EN_OFERTA`", sin tocar `VEH#<id>`. Dejarlo `RESERVADO` mientras el lote vuelve a
> `EN_OFERTA` reproduce de forma **permanente** el defecto que la propia Etapa 10 pide corregir
> en el barrido ("lotes libres con fila viva", ver el callout de T5b): el siguiente que se
> forme entraria a la fila, pero el item 4 de T2 exige `vehiculo.estatus = EN_CONVOCATORIA` y
> fallaria siempre — el lote quedaria huerfano para siempre, no solo hasta el proximo barrido.
> La variante reducida real es: items 1, 2, 6, mas el mismo `Update` de vehiculo que usan T4,
> T5b y T6 (`RESERVADO -> EN_CONVOCATORIA`). Validado contra DynamoDB real: tras la fila
> agotada, un participante nuevo se forma y se adjudica sin intervencion
> (`src/lib/fila/vencimiento.integracion.test.ts`).

**El correo no participa en el sentido critico**: el envio por CES nunca ocurre dentro de esta
transaccion (riesgo R8). Pero **encolarlo si participa** — el item 8 viaja en la misma
transaccion que la adjudicacion, igual que en T2 (seccion 6.1) —, porque es lo unico que
garantiza al correo la misma atomicidad que a su propio evento de auditoria (regla 4 de
`CLAUDE.md`).

#### Verificacion perezosa y el barrido — dos caminos a la misma escritura (D-7)

`consultarMiLugar` (PA-08) aplica T5 **antes** de construir el `MiLugarDTO` si la solicitud
propia esta `ADJUDICADA` y su `venceEn` ya paso, con `detectadoPor: VERIFICACION_PEREZOSA`. El
barrido programado (`src/lib/fila/barridoDeVencimientos.ts`) recorre GSI4 `VENCE#<dia>` con
`GSI4SK <= ahora` y aplica lo mismo con `detectadoPor: BARRIDO`. Competir es inofensivo: los dos
ejecutan la misma transaccion condicional sobre el item 1, y quien llega segundo encuentra la
condicion ya falsa y recibe `no_vigente` sin ningun efecto.

#### Recoger los lotes libres con fila viva

El mismo barrido resuelve el hueco que anota el callout de T5b: un lote `EN_OFERTA` con
candidatos `EN_FILA` y sin `adjudicacionActual`, dejado asi por un proceso que murio entre
registrar la solicitud (o liberar el lote) y llamar a `adjudicarLote`. Se acota a convocatorias
`PUBLICADA` (PA-05) y sus lotes (PA-04): fuera de ahi ningun lote admite fila nueva. Antes de
llamar a `adjudicarLote` se comprueba con una `Query COUNT` barata que exista al menos un
candidato `EN_FILA` — sin esa comprobacion, cada lote `EN_OFERTA` sin tocar (la inmensa mayoria
del inventario en cualquier instante) escribiria un `FILA_AGOTADA` en cada corrida del barrido,
para siempre. La adjudicacion resultante usa el motivo `RECUPERACION_POR_BARRIDO` — no es
"primera adjudicacion" ni ninguna de las tres reasignaciones con causa conocida.

#### T5b — Cancelacion voluntaria: liberar y **volver a adjudicar**, no un intercambio atomico

La cancelacion de una solicitud `ADJUDICADA` (Etapa 8,
`src/lib/fila/cancelarSolicitud.ts`) no usa la forma de T5. Libera en una transaccion —solicitud
a `CANCELADA_POR_PARTICIPANTE`, centinela de fila fuera, decremento del cupo (R-09), lote a
`EN_OFERTA` con `REMOVE adjudicacionActual`, vehiculo a `EN_CONVOCATORIA`, mas su evento— y
**despues** llama a T2, el mismo camino que dispara cualquier solicitud nueva.

La condicion `adjudicacionActual = :solicitudId` del item del lote es lo que la hace segura: si
otro proceso ya reasigno, la transaccion se cancela sin efectos y la cancelacion falla entera,
en vez de arrebatarle el vehiculo a quien acaba de recibirlo.

**Por que aqui si y en T5 no.** El barrido de T5 actua sobre un plazo vencido y no puede dejar
el lote libre sin dueno si el proceso se cae a la mitad. La cancelacion, en cambio, la dispara
una persona que esta mirando la pantalla, y reutilizar T2 con su abstencion por reservas, su
manejo del cupo por R-09 y sus reintentos vale mas que replicar esa logica dentro de una
transaccion. La ventana que abre —lote libre con fila viva— **ya existe en el diseno**: T1
tampoco puede adjudicar dentro de su propia transaccion, porque `TransactWriteItems` no devuelve
valores.

> **Consecuencia para la Etapa 10.** Un lote libre con fila viva y sin nadie que dispare la
> adjudicacion es un estado alcanzable —basta que el proceso muera entre las dos escrituras—, y
> hoy solo lo resuelve la siguiente solicitud. El barrido deberia recogerlo junto con los
> vencimientos.

Al perder la adjudicacion, las solicitudes `CONGELADA` del participante vuelven a `EN_FILA` con
su turno intacto (R-09), **una transaccion por solicitud y fuera de la que provoca la perdida**:
son una cantidad no acotada y `TransactWriteItems` admite 100. Meterlas dentro convertiria una
garantia de negocio en un limite tecnico.

### T6 — Rechazar pago (R-16)

> **Corregido al implementar la Etapa 9: no es "identica a T5".** Esa frase describia la forma
> de la escritura, pero T6 sigue la **estrategia de T5b** (liberar-y-volver-a-llamar-a-T2), no
> la de T5 (un solo acto atomico). El barrido de T5 tiene que ser atomico porque actua sobre un
> plazo vencido y no puede dejar el lote sin dueno si el proceso se cae a la mitad; rechazar lo
> dispara una persona de tesoreria mirando la pantalla, y reutilizar T2 —con su abstencion por
> reservas, su manejo del cupo por R-09 y sus reintentos— vale mas que replicarlo dentro de una
> transaccion (mismo argumento de T5b).

```
1. Update solicitud   SET estatus = RECHAZADA_POR_TESORERIA, motivoRechazo, rechazadaEn
                      REMOVE GSI2PK, GSI2SK                   <- ya no es trabajo pendiente
                      CONDITION estatus = EN_VERIFICACION
2. Update cupo        PART#<id> / CUPO#<convId>   ADD cupoConsumido :menosUno   <- libera (R-09)
3. Update lote        SET estatus = EN_OFERTA REMOVE adjudicacionActual, adjudicadoEn, venceEn,
                          turnoAdjudicado
                      CONDITION adjudicacionActual = :solicitudId
4. Update vehiculo    -> EN_CONVOCATORIA   CONDITION estatus = RESERVADO
5. Put evento         PAGO_RECHAZADO (motivo obligatorio)   CONDITION attribute_not_exists(PK)
```

**No retira el centinela de fila** (`LOTE#<id> / PART#<participanteId>`), a diferencia de la
cancelacion voluntaria de T5b: `RECHAZADA_POR_TESORERIA` tiene que seguir siendo visible para
`consultarMiLugar`, que es como el titular se entera del motivo (`ui-ux-requerimientos.md`
seccion 3.4).

**Fuera de esta transaccion**: `adjudicarLote` con `motivo: REASIGNACION_POR_RECHAZO`,
exactamente como hace T5b. El paso intermedio que habia aqui —`descongelarSolicitudes` para el
participante rechazado— desaparecio con el congelamiento en la Etapa 14: sus demas solicitudes
nunca dejaron de estar `EN_FILA`, y el decremento del item 2 les devuelve el cupo en la misma
transaccion.

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

Con mas de ~95 lotes se supera el limite de `TransactWriteItems` y se procesa por tandas, asi
que una interrupcion siempre es posible. **La regla que la hace inofensiva es el orden de
propagacion: el estado intermedio tiene que ser el mas restrictivo de los dos.**

- **Al publicar** se marca **primero la convocatoria** y despues los lotes. Una interrupcion deja
  la convocatoria publicada con lotes que todavia dicen `BORRADOR`: no se pueden comprar, que es
  el lado seguro. Al reanudar aparecen.
- **Al ocultar** (R-06) se marca **primero los lotes** y despues la convocatoria. Una
  interrupcion deja lotes ya cerrados bajo una convocatoria aun visible; tambien el lado seguro.

> **Este documento decia lo contrario, y la correccion tiene historia.** Marcaba la publicacion
> al final "de modo que una interrupcion deje la convocatoria sin publicar en lugar de publicada
> a medias". Protegia a la convocatoria y desprotegia a los lotes: los de las tandas ya
> procesadas quedaban con `estatusConvocatoria = PUBLICADA` grabado, y como la condicion del paso
> 1 de T1 solo mira el lote, eran comprables bajo una convocatoria sin publicar.
>
> La Etapa 2.1 lo cerro con un `ConditionCheck` sobre la convocatoria en el paso 2 de T1. Era
> correcto y resulto inviable: ese item lo comparten todas las solicitudes de la convocatoria y,
> dentro de una transaccion, un `ConditionCheck` lo retiene igual que una escritura. Medido, de
> 10 solicitudes simultaneas cancelaba entre 5 y 7 (desafios-implementacion.md seccion 17).
>
> Invertir el orden de propagacion consigue lo mismo sin costo en tiempo de ejecucion: el
> atributo desnormalizado del lote puede **quedarse atras** de la convocatoria, nunca
> adelantarse. Y "atras" siempre significa menos permisivo.

Consecuencia para quien implemente el gating: **la convocatoria sigue siendo el registro
autoritativo**. Los atributos desnormalizados del lote sirven para filtrar y para condicionar
barato. El `estatusConvocatoria` que se le pasa a `puedeEjecutar` debe salir de la convocatoria,
no de la copia del lote.

La propagacion debe ser **idempotente y reanudable**: repetir una tanda ya aplicada no puede
cambiar nada.

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
5. **El cupo nunca se excede.** `cupoConsumido` de un participante jamas supera el
   `limiteAdjudicaciones` de esa convocatoria, ni siquiera con N intentos simultaneos; y nunca
   queda negativo, porque cada decremento viaja en la transaccion que quita una adjudicacion que
   el mismo participante sostenia.
6. **Un vehiculo, una convocatoria activa.** Nunca dos centinelas `VEH#<id> / ACTIVO`.
7. **Atomicidad de la auditoria.** Si el evento no se puede escribir, la mutacion no ocurre.
8. **Sin identidades en la fila.** El DTO de PA-08 no contiene `participanteId`, correo ni
   nombre de terceros.
9. **`adjudicacionActual` nunca es `null`.** O existe con un valor, o no existe.
10. **Coherencia de GSI4.** Toda solicitud `ADJUDICADA` tiene claves GSI4; ninguna en otro
    estado las tiene.
11. **Ninguna reserva sobrevive a su solicitud.** Terminado el paso 2, no queda la reserva del
    intento; y una reserva ya depurada impide que su paso 2 se aplique.
12. **La fila sigue abierta con el lote `ADJUDICADO`.** Quien solicita despues de la primera
    adjudicacion obtiene turno y entra a la fila (R-17).

Las invariantes 11 y 12, junto con las cuatro primeras, estan cubiertas por el prototipo de R18
(`npm run prototipo:fila`), que corre contra el sandbox y **se omite** en la compuerta: no es una
prueba de regresion sino el registro reproducible de la decision. La regresion permanente la
aporta la prueba de concurrencia de la Etapa 8.

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

### 8.1 Revision de costos (Etapa 12)

La seccion 3 dejaba pendiente estrechar los GSIs de `ALL` a `INCLUDE` "cuando el conjunto de
atributos ya no se mueva". Con las pantallas ya construidas, se reviso. **Decision: no se
estrecha**, y la razon es aritmetica y no de comodidad.

DynamoDB cobra la escritura **en bloques de 1 KB, redondeando hacia arriba**, y cobra el indice
aparte de la tabla base. Eso reparte el ahorro de forma exactamente inversa al volumen:

| Item | Tamano tipico | Indices que lleva | Ahorro de `INCLUDE` | Volumen |
| --- | --- | --- | --- | --- |
| Solicitud | ~600 B | GSI3, GSI4 | **ninguno** — ya esta bajo 1 KB, y 1 KB es el minimo facturable | el mas alto del sistema |
| Evento `AUDIT#` | ~400 B | GSI2 | **ninguno** — misma razon | alto: uno por mutacion |
| Mensaje de outbox | ~500 B | GSI4 | **ninguno** | uno por adjudicacion |
| Vehiculo | hasta ~3 KB | GSI2 | ~2 unidades por escritura | decenas al mes |
| Convocatoria | hasta ~8 KB | GSI2 | ~7 unidades por escritura | unas pocas al mes |

Los items grandes son grandes por texto libre que **ninguna pantalla de listado muestra**
—`condicionesMecanicas`, `detallesEsteticos` y `especificacionMecanica` del vehiculo (2.5 KB
entre los tres) y `descripcionParticipacion` de la convocatoria (8 KB de HTML del editor)—, asi
que en teoria son el caso ideal para `INCLUDE`. Pero son tambien los que casi nunca se escriben:
el ahorro completo, sumando los dos, queda por debajo de un centavo al mes a los precios de
`us-east-1`, y el almacenamiento duplicado de un catalogo de 10 000 vehiculos son 30 MB, menos
de un centavo mas.

Contra eso: **la proyeccion de un GSI no se puede modificar despues de creado.** Estrechar exige
borrar el indice y recrearlo, y durante esa ventana PA-05 y PA-11 —el catalogo de
administracion y la bandeja de tesoreria— dejan de responder. Cambiar una decision irreversible
por centavos no es una optimizacion; es riesgo sin contrapartida. Si algun dia el catalogo de
vehiculos crece dos ordenes de magnitud, la cuenta se rehace con datos reales.

GSI1 se queda en `KEYS_ONLY` porque nunca necesito mas: traduce `oktaSub` a `participanteId` y
el perfil se lee de la tabla base.

### 8.2 Cota de una corrida del barrido

> **Esta excepcion vale para estas dos consultas y para ninguna otra.** Todo el resto del sistema
> recorre `LastEvaluatedKey`, y desde la Etapa 13 lo hace por un solo camino:
> `src/lib/data/paginacion.ts`. La excepcion se apoya en tres propiedades concretas —las de abajo— y
> leerla como permiso general costo cinco lecturas de fila sin paginar, una de ellas un defecto real
> (`desafios-implementacion.md` 55). Antes de reusar el argumento, comprobar que las tres se
> cumplen: si la lectura no es sobre un indice disperso que se vacia al resolver, o no hay corrida
> siguiente que retome donde quedo, **no basta una pagina**.

`leerVencidasDelDia` (PA-10) y `leerPendientes` (PA-14) leen **una sola pagina** de `Query`, sin
recorrer `LastEvaluatedKey`. Es deliberado, y la razon es que las dos consultas se apoyan en tres
propiedades que ya estan en el diseno:

1. **GSI4 es disperso.** Resolver un item le quita sus claves del indice, asi que lo atendido no
   vuelve a aparecer.
2. **Las dos leen de lo mas viejo a lo mas nuevo** (`ScanIndexForward` ascendente sobre `venceEn`
   y sobre `creadoEn`).
3. **El barrido corre cada 5 minutos y es idempotente.**

Juntas convierten una pagina truncada en un retraso y no en trabajo perdido: la corrida
siguiente empieza justo donde la anterior dejo de ver. La cota, con items de ~600 B y el limite
de 1 MB por pagina, es de unas **1 700 solicitudes por corrida**, o unas 20 000 por hora.

Alcanzarla exige que mas de 1 700 adjudicaciones venzan el **mismo dia** —una convocatoria de
ese tamano no existe todavia— y aun asi el atraso se drena en dos o tres corridas. Recorrer las
paginas dentro de una corrida acercaria el barrido a su limite de 300 s de ejecucion sin
resolver mas trabajo del que la corrida siguiente ya resuelve.

> Lo que **no** vale es agregar un `Limit` a `leerVencidasDelDia` para acotar el trabajo: hay un
> `FilterExpression` de por medio y `Limit` acota items **leidos**, no items que pasan el filtro.
> El comentario del propio archivo lo explica.

La alarma `vencimientos-sin-resolver` de `amplify/alarmas.ts` no vigila esta cota, y no debe:
mide `errores`, que son las vencidas que el barrido **encontro y no pudo resolver**. Una pagina
truncada no produce errores, produce una corrida siguiente con mas trabajo.

### 8.3 Lo que midio la prueba de carga

`npm run carga:apertura` (Etapa 12) contra el sandbox real, 10 lotes con 10 participantes cada
uno disparando `solicitarCompra` a la vez:

| Medida | En frio | En caliente |
| --- | --- | --- |
| Solicitudes concurrentes | 100 (300 escrituras: tres por solicitud) | 100 |
| Aceptadas / rechazadas | **100 / 0** | **100 / 0** |
| Adjudicaciones | **10** — una por lote, siempre al turno menor de su fila | **10**, idem |
| Abstenciones por reservas en vuelo | 7 | 13 |
| Latencia p50 / p95 / maxima | 1 709 / 15 525 / 15 599 ms | **965 / 1 296 / 1 592 ms** |
| Solicitudes por segundo | 6,4 | **62,3** |
| Duracion total | 15,6 s | **1,6 s** |

**Lo que estos numeros si dicen:** el mecanismo de la fila aguanta diez veces la escala de la
prueba de la Etapa 8 y con diez particiones compitiendo a la vez, sin perder una sola solicitud
por contencion y sin romper R-08 — en las dos corridas. Esa era la duda que solo la escala podia
resolver.

**Y el contraste entre las dos columnas es en si mismo el hallazgo.** Es el **mismo** escenario
contra el **mismo** sandbox, con diez veces de diferencia. Lo que cambio no fue DynamoDB: fueron
los apretones de manos TLS. Con la inspeccion corporativa de por medio (riesgo R11), abrir
trescientas conexiones nuevas domina por completo la primera corrida; la segunda reusa el agente
HTTPS del proceso. El factor de nueve entre p50 y p95 de la columna en frio es la firma de una
cola de conexiones, no de una base de datos lenta.

Conclusion practica: **ninguna de las dos columnas es la latencia de produccion**, pero la
segunda esta mucho mas cerca. Un arranque en frio de Lambda pagara algo parecido a la primera; el
estado estacionario, a la segunda. La medida que vale se toma desde el entorno desplegado.

**Lo que hace falta para calibrar el umbral de contencion.** El informe reporta cero rechazos por
conflicto, pero eso es porque los reintentos del SDK los absorbieron antes de llegar a la
aplicacion; los conflictos si ocurrieron. Solo la metrica nativa `TransactionConflict` de
CloudWatch dice cuantos, y de ahi sale el valor de `UMBRAL_CONFLICTOS_POR_PERIODO`
(`amplify/alarmas.ts`), que hoy es una estimacion de 50 por periodo de cinco minutos.

> La corrida sin reintentos del SDK —`CARGA_SIN_REINTENTOS=1`— es la que descubrio que el paso 1
> de T1 dejaba escapar `TransactionConflictException` como excepcion sin atrapar
> (`desafios-implementacion.md` 41). El `ADD contadorTurnos` es la unica escritura del sistema
> fuera de transaccion sobre un item que si participa en otras, y conviene que siga siendo la
> unica.
