# Trazabilidad y Auditoria

Que se registra, con que formato, y que garantiza que ese registro sea creible.

Se lee junto a `modelo-datos-dynamodb.md`: los eventos viven en la misma tabla y se escriben en
la misma transaccion que la mutacion que describen.

---

## 1. Que tiene que poder demostrar un auditor

La bitacora no existe para "tener logs". Existe para responder, sin ambiguedad y sin acceso a
la aplicacion:

1. **Orden.** En que turno entro cada participante a cada fila, y que ese orden lo asigno el
   servidor.
2. **Equidad.** Que el lote se adjudico siempre al turno vivo menor, y por que se salto a
   alguien cuando se le salto.
3. **Plazos.** Cuando se adjudico, cuando vencia y si el vencimiento se aplico a tiempo.
4. **Decisiones humanas.** Quien aprobo, quien avalo, quien rechazo, y con que motivo.
5. **Integridad.** Que nadie edito la historia despues del hecho.

Si un evento no aporta a alguna de estas cinco preguntas, no pertenece a la bitacora — pertenece
al registro operativo de la aplicacion, que es otra cosa.

---

## 2. Formato del evento

```
PK   AUDIT#<agregado>#<agregadoId>       VEHICULO | CONVOCATORIA | LOTE | SOLICITUD
SK   <ocurridoEn>#<eventoId>             ISO-8601 UTC + ULID

eventoId        ULID
tipo            del catalogo de la seccion 3
ocurridoEn      ISO-8601 UTC
actorTipo       USUARIO | SISTEMA
actorId         participanteId, o SISTEMA
actorPermisos   permisos vigentes al momento del acto
correlacionId   ULID compartido por los eventos de una misma transaccion
convocatoriaId, loteId, solicitudId, vehiculoId     los que apliquen
estadoAnterior, estadoNuevo
motivo          obligatorio en rechazos y cancelaciones
datos           campos especificos del tipo de evento
```

### 2.1 Por que el agregado es el lote

La mayoria de los eventos de la fila se anclan a `AUDIT#LOTE#<loteId>`. Con eso, **la historia
completa de un lote — todas las solicitudes, adjudicaciones, vencimientos y reasignaciones — se
reconstruye con una sola `Query` en orden cronologico**, sin unir nada.

Es la consulta que el auditor hace mas veces, y la que sostiene las preguntas 1, 2 y 3.

> **Los nueve eventos de la fila se anclan al lote, sin excepcion** (Etapa 8). Incluye
> `SOLICITUD_CREADA`, que podria parecer de la solicitud: la pregunta "reconstruir la fila" de la
> seccion 5 es exactamente "los `SOLICITUD_CREADA` **del lote**, ordenados por turno", y anclarlos
> a `AUDIT#SOLICITUD#<id>` obligaria a una consulta por participante para responderla. Cada
> evento lleva ademas `solicitudId`, asi que la historia de una solicitud concreta se filtra sin
> perder nada.

### 2.2 `correlacionId`

Los eventos escritos en la misma transaccion comparten `correlacionId`. Un vencimiento con
reasignacion produce `SOLICITUD_VENCIDA` y `LOTE_ADJUDICADO` con el mismo valor.

Sin el, el auditor veria dos hechos sueltos y tendria que inferir por cercania temporal que uno
causo el otro. Con el, la causalidad esta registrada, no deducida.

### 2.3 `actorPermisos`

Se guardan **los permisos vigentes en ese momento**, no los actuales. Si a alguien se le revoca
un permiso despues, la bitacora sigue mostrando con que autoridad actuo. Reconstruirlo
consultando EAS mas tarde daria una respuesta distinta y equivocada.

> El campo se llamaba `actorRoles` hasta la Etapa 5. Se renombro porque desde la Etapa 2.1 EAS
> entrega **permisos y no roles**, y la aplicacion nunca llega a ver un rol fuera del simulador
> de desarrollo: guardar "roles" habria sido guardar algo que no existe.
>
> Los nombres de agregado son los cuatro de `TIPOS_DE_AGREGADO` en `src/lib/data/claves.ts`,
> completos y no abreviados: quien lee una clave de particion es una persona. No hay agregado
> `PART`: ningun evento del catalogo se ancla a un participante.

### 2.4 Las identidades **si** se registran

La bitacora guarda `participanteId` de todos los involucrados. R-12 restringe lo que ve un
**participante**, no lo que se registra: sin identidades no habria nada que auditar.

El acceso a esos datos esta limitado a `Autob_Auditar` mediante
`auditoria:ver-fila-historica` (`permission-matrix.md`, seccion 6).

---

## 3. Catalogo de eventos

Motivo obligatorio marcado con **M**.

### Vehiculos

| Tipo | Cuando |
| --- | --- |
| `VEHICULO_REGISTRADO` | Alta |
| `VEHICULO_EDITADO` | Cambio de atributos; `datos` lleva los campos modificados |
| `VEHICULO_FOTOGRAFIA_AGREGADA` / `_ELIMINADA` | Gestion de galeria |
| `VEHICULO_RETIRADO` **M** | Salida del catalogo |

`VEHICULO_EDITADO` cubre tambien los cambios sobre la galeria que **no** tienen tipo propio, y
`datos.campos` dice cual: reordenar (`ordenFotografias`) y editar el pie de una fotografia
(`fotografia.descripcion`). El pie ademas lleva el `fotoId` en `datos`, para que la bitacora diga
de que fotografia se habla, y `anterior`/`nueva` con el rastro completo; al vaciarlo, `nueva` queda
en **`null` y no ausente** — `null` dice "se quito", un campo ausente diria "no se sabe".

**La designacion de la principal ya no es un evento aparte: viaja en el del reordenamiento.** Desde
que la posicion 1 **es** la principal, mover una fotografia al frente la designa, asi que el evento
de reordenamiento lleva `campos: ["ordenFotografias", "fotografiaPrincipalId"]` mas `anterior` y
`nueva` cuando la cabeza cambia. Eso importa para leer la bitacora: sin el par anterior/nueva,
reconstruir quien era la principal en una fecha exigiria replicar la regla de "la primera de la
lista" al leer, en vez de encontrarlo escrito.

**Ninguno escribe evento si el valor no cambio.** Una bitacora que registra actos sin efecto
entrena a quien la lee a ignorarla.

Los dos eventos de fotografia llevan `clavesDeVariantes` —las tres claves de S3 de la foto—, y en
el de eliminacion eso es lo unico que queda como rastro de que objetos habia que borrar si el
borrado de S3 fallo.

### Convocatorias

| Tipo | Cuando |
| --- | --- |
| `CONVOCATORIA_CREADA` | Alta en `BORRADOR` |
| `CONVOCATORIA_EDITADA` | Cambio de atributos o fechas |
| `VEHICULO_INCLUIDO` / `VEHICULO_RETIRADO_DE_CONVOCATORIA` | Alta y baja de lote |
| `CONVOCATORIA_ENVIADA_A_APROBACION` | → `EN_APROBACION` |
| `CONVOCATORIA_APROBADA` | Registra que el aprobador difiere del creador (R-05) |
| `CONVOCATORIA_RECHAZADA` **M** | Vuelve a `BORRADOR` |
| `CONVOCATORIA_PUBLICADA` | Registra `publicadaEn` e `inicioVenta` |
| `CONVOCATORIA_OCULTA` **M** / `CONVOCATORIA_REACTIVADA` | |
| `CONVOCATORIA_CONCLUIDA` | Con el resumen de vendidos, no vendidos y **comprometidos** |
| `LOTE_CERRADO_TRAS_CONCLUSION` | Un lote que sobrevivio al cierre (R-18) y cuyo compromiso se cayo despues. Anclado al **lote**, firmado por `SISTEMA` |

> **`VEHICULO_RETIRADO_DE_CONVOCATORIA` conserva su nombre aunque la accion se llame ahora
> retiro del lote** (`lote:retirar`). El catalogo de eventos es append-only y las historias ya
> escritas traen este tipo: renombrarlo obligaria a mantener los dos y el auditor veria dos
> entradas distintas para el mismo hecho en el filtro de la bitacora. Lo que si cambio es su
> etiqueta, que es lo que se lee: "Lote retirado de la convocatoria". Mismo criterio que
> `SOLICITUD_CONGELADA`.

> **La conclusion no escribe un evento por lote, y el cierre tardio si.** Ahi el resumen de
> `CONVOCATORIA_CONCLUIDA` responde por todos los lotes a la vez y un evento por lote repetiria N
> veces el mismo hecho. Aqui el cierre ocurre dias despues, lo dispara el barrido y no hay ningun
> evento que lo cubra: sin el, un vehiculo reapareceria en el catalogo sin que la bitacora pudiera
> decir por que. Sus `datos` llevan `razon: ADJUDICACION_CAIDA_TRAS_CONCLUSION` y el vehiculo
> liberado (R-11b).

### Fila y adjudicacion — el nucleo

| Tipo | Cuando | `datos` |
| --- | --- | --- |
| `SOLICITUD_CREADA` | Entrada a la fila | `turno`, `solicitadoEn`, `tamanoFilaAlMomento` |
| `SOLICITUD_CANCELADA_POR_PARTICIPANTE` | Retiro voluntario | `turno` |
| `LOTE_ADJUDICADO` | Adjudicacion | `turno`, `adjudicadoEn`, `venceEn`, `motivoAdjudicacion` |
| `SOLICITUD_CANCELADA_POR_LIMITE` | Excedio el tope de solicitudes de la convocatoria (R-22) | `turno`, `ordenEnConvocatoria`, `limiteSolicitudes` |
| ~~`SOLICITUD_CONGELADA`~~ | *Ya no se escribe* — el titular gano otro lote (R-09 anterior) | `turno`, `loteQueGano` |
| ~~`SOLICITUD_DESCONGELADA`~~ | *Ya no se escribe* — perdio su adjudicacion | `turno` |
| `SOLICITUD_OMITIDA` | Se salto un turno al adjudicar | `turno`, `razonOmision` |
| `SOLICITUD_VENCIDA` | Plazo agotado | `turno`, `venceEn`, `detectadoEn`, `detectadoPor` |
| `SOLICITUD_NO_ADJUDICADA` | Fila cerrada sin alcanzarle | `turno` |
| `FILA_AGOTADA` | Sin candidatos vivos (R-17) | `turnosRevisados` |

| `LOTE_LIBERADO_A_ADJUDICADOR` | El ganador manual no pago: el lote vuelve a la bandeja (R-23) | `turnoLiberado`, `causa` |

`motivoAdjudicacion` distingue `PRIMERA_ADJUDICACION`, `REASIGNACION_POR_VENCIMIENTO`,
`REASIGNACION_POR_RECHAZO`, `REASIGNACION_POR_CANCELACION` y `RECUPERACION_POR_BARRIDO` — este
ultimo, agregado en la Etapa 10: el barrido encuentra un lote `EN_OFERTA` con fila viva que
nadie llego a adjudicar (un proceso murio entre dos escrituras que no pueden ir en la misma
transaccion, `modelo-datos-dynamodb.md` T5b), y no es ni la primera vez ni una reasignacion con
causa conocida.

**`DECISION_MANUAL`** se suma en la Etapa 15, y es el unico motivo cuyo `actor` **no** es
`SISTEMA`: lo firma la persona que decidio, con sus permisos del momento y su `motivo`. Sus
`datos` llevan ademas `ventaAbiertaAlDecidir`, porque el adjudicador puede dictaminar con la fila
todavia creciendo y quien audite tiene que poder verlo sin reconstruir fechas.

> **`SOLICITUD_OMITIDA` es el evento que hace auditable la regla R-09.** Sin el, la bitacora
> mostraria una adjudicacion al turno 5 mientras los turnos 3 y 4 seguian vivos, y pareceria una
> violacion del orden. Con el, queda registrado por que se les salto y `razonOmision` lo nombra
> explicitamente.
>
> Es el ejemplo de la regla general: **toda desviacion aparente del orden debe tener su propio
> evento explicativo.** Un salto sin registro es indistinguible de un fraude.
>
> `razonOmision` vale hoy `LIMITE_ALCANZADO` — el candidato agoto su cupo de adjudicaciones en
> esta convocatoria — y conserva `ADJUDICACION_ACTIVA`, la razon de la version anterior de R-09,
> **solo para poder leer historias ya escritas**: la bitacora es append-only y un evento no se
> reinterpreta retroactivamente.
>
> **Con la Etapa 14, el turno omitido sigue `EN_FILA`.** Antes se le congelaba, asi que el salto
> quedaba explicado por partida doble —el evento y el cambio de estado— y la comprobacion de
> integridad podia apoyarse en cualquiera de los dos. Ya no: **el evento es la unica explicacion
> que queda**, y `comprobarOrdenDeAdjudicacion` tiene que tratarlo como suficiente por si solo.
> Ver la seccion 5.1.

`detectadoPor` vale `BARRIDO` o `VERIFICACION_PEREZOSA`, y permite medir si el barrido esta
cumpliendo su funcion (riesgo R6).

### Pago

| Tipo | Cuando |
| --- | --- |
| `COMPROBANTE_CARGADO` | Sube el comprobante; registra que el reloj se detuvo |
| `PAGO_AVALADO` | Tesoreria confirma; el lote pasa a `VENDIDO` |
| `PAGO_RECHAZADO` **M** | Tesoreria rechaza (R-16) |
| `COMPROBANTE_DESCARGADO` | Quien lo descargo y cuando |

`COMPROBANTE_DESCARGADO` registra un acceso, no una mutacion. Se incluye porque el comprobante
es un documento sensible y el acceso a documentos sensibles es en si mismo auditable.

### Correo

| Tipo | Cuando |
| --- | --- |
| `CORREO_ENCOLADO` | Mensaje puesto en el outbox |
| `CORREO_ENVIADO` | Aceptado por CES, con el identificador de mensaje |
| `CORREO_FALLIDO` **M** | Fallo permanente tras agotar reintentos |

Prueban que se notifico al adjudicado, que es parte de la equidad del proceso.

### Auditoria

| Tipo | Cuando |
| --- | --- |
| `BITACORA_EXPORTADA` | El auditor exporta; registra alcance y filtros |

La exportacion se audita: quien mira los datos sensibles tambien deja rastro.

---

## 4. Garantias de inmutabilidad

Cuatro capas independientes. Ninguna basta sola.

### 4.1 Atomicidad — regla 4 de `CLAUDE.md`

Todo evento se escribe en la **misma `TransactWriteItems`** que la mutacion. No hay ventana en
la que una mutacion exista sin su evento: si el evento no se puede escribir, la mutacion no
ocurre.

Prohibido escribir el evento en un `catch`, en un `finally`, en una cola posterior o en un
`Promise.all` paralelo a la mutacion.

### 4.2 Append-only — regla 5

Se sostiene en **dos** mecanismos, y conviene no confundir lo que hace cada uno.

**1. `Deny` de IAM.** La politica del rol de la aplicacion deniega `UpdateItem`, `DeleteItem` y
`BatchWriteItem` sobre items cuya clave empieza con `AUDIT#`. Se cumple aunque el codigo este mal,
y un `Deny` explicito no se puede sobrescribir con un `Allow`.

**2. `ConditionExpression: attribute_not_exists(PK)` en todo `Put` de evento.** Hace falta porque
el `Deny` **no cubre la reescritura**: un `PutItem` con la misma clave reemplaza el item completo,
y `PutItem` tiene que quedar permitido — es justamente lo que la regla 4 obliga a escribir en la
misma transaccion que la mutacion. No existe condicion de IAM que distinga un `Put` que crea de
uno que reemplaza.

> Este documento afirmaba que el `Deny` era "la capa que se cumple aunque el codigo este mal", a
> secas. Era **falso para la reescritura**, y quedo comprobado contra AWS real: la prueba de
> integracion confirma que sobrescribir un `AUDIT#` con `Put` **tiene exito**. La correccion
> importa porque de esa afirmacion dependia no poner la condicion en el codigo.

**Lo que ninguno de los dos contiene** es codigo que deliberadamente omita la condicion. Para eso
la bitacora tendria que salir del alcance de la aplicacion — un sumidero append-only alimentado
por DynamoDB Streams (S3 con Object Lock o equivalente). Es el riesgo **R20** de
`plan-ejecucion.md` y se resuelve en la Etapa 11.

La **prueba de integracion** de `amplify/auditoriaInmutable.integracion.test.ts` cubre los tres
casos: escribir funciona, modificar y borrar los rechaza IAM, y la condicion cierra la
sobrescritura que IAM deja abierta.

### 4.3 Correccion por compensacion — R-20

Un error no se corrige editando el evento equivocado. Se corrige **agregando** un evento nuevo
que lo explica y lo revierte, con su motivo.

La historia queda mas larga y con el error a la vista. Es lo correcto: una bitacora que se puede
"limpiar" no prueba nada.

### 4.4 Respaldo

PITR sobre la tabla. Sin TTL sobre items `AUDIT#`.

---

## 5. Consultas del auditor

| Pregunta | Consulta |
| --- | --- |
| Historia completa de un lote | PA-12 sobre `AUDIT#LOTE#<loteId>` |
| Reconstruccion de la fila | Los `SOLICITUD_CREADA` del lote, ordenados por `turno` |
| Por que se adjudico a quien se adjudico | Los `LOTE_ADJUDICADO` y `SOLICITUD_OMITIDA` de ese lote |
| Actividad de un participante | PA-12 sobre `AUDIT#PART#<participanteId>` |
| Todo lo ocurrido un dia | PA-13 sobre `AUDIT#<yyyy-mm-dd>` |
| Decisiones de un operador | PA-13 filtrando por `actorId` |

### 5.1 Verificacion automatica de integridad

La vista de auditoria ejecuta estas comprobaciones y **muestra el resultado**, en lugar de
esperar a que alguien las haga a mano:

1. Los turnos de un lote son **unicos y estrictamente crecientes**. Los huecos son legitimos y
   se reportan como informativos, no como error (ver seccion 6 de `modelo-datos-dynamodb.md`).
2. Toda adjudicacion corresponde al turno vivo menor, **salvo** que exista un
   `SOLICITUD_OMITIDA` que justifique cada salto.
3. Nunca hubo dos adjudicaciones vigentes simultaneas sobre el mismo lote.
4. Todo `SOLICITUD_VENCIDA` tiene `detectadoEn >= venceEn`.
5. Toda transicion de estado tiene su evento; no hay estados actuales sin historia que los
   explique.
6. Todo evento con motivo obligatorio lo tiene y no esta vacio.

La comprobacion 2 es la que responde la pregunta central del auditor: **¿se respeto el orden?**

> **Que exige y que no exige la comprobacion 2.** Exige un `SOLICITUD_OMITIDA` por cada turno
> vivo menor que el adjudicado. **No** exige, ademas, que el turno saltado haya cambiado de
> estado. Lo exigia hasta la Etapa 14, cuando omitir implicaba congelar y las dos senales
> llegaban siempre juntas; con el cupo por convocatoria el saltado sigue `EN_FILA` a proposito
> —el cupo se libera y quiere recuperar su lugar—, asi que esa exigencia extra **acusaria de
> fraude a cada salto legitimo**. El evento es la explicacion; el estado nunca lo fue.
>
> Lo que la comprobacion sigue detectando, que es para lo que existe: una adjudicacion a un turno
> mayor con turnos vivos menores **sin ningun evento que lo explique**.

> **En modalidad `MANUAL` la invariante es otra, y la comprobacion tiene que saberlo (R-23).**
> Saltarse turnos menores no es una anomalia ahi: es el proposito. Exigir el orden FIFO marcaria
> `incumple` en **cada decision humana legitima**, que es el mismo error que la nota anterior
> corrige para los cupos. En un lote manual lo que se comprueba es que exista un `LOTE_ADJUDICADO`
> con `motivoAdjudicacion = DECISION_MANUAL`, firmado por una persona —`actorTipo = USUARIO`— y
> con su `motivo` no vacio. Una adjudicacion **sin firma** sobre un lote manual si es la senal de
> alarma: significa que algo automatico decidio donde debia decidir alguien.

---

## 6. Que **no** va en la bitacora

Separar esto evita que la bitacora se llene de ruido y pierda valor probatorio:

- Navegacion, vistas de pagina y busquedas.
- Inicios y cierres de sesion — pertenecen a Okta.
- Errores tecnicos, tiempos de respuesta y trazas — pertenecen a observabilidad.
- Borradores intermedios de un formulario no enviado.
- Datos personales mas alla del `participanteId` y del correo necesario para notificar.
