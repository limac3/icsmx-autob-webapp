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
| `CONVOCATORIA_CONCLUIDA` | Con el resumen de vendidos y no vendidos |

### Fila y adjudicacion — el nucleo

| Tipo | Cuando | `datos` |
| --- | --- | --- |
| `SOLICITUD_CREADA` | Entrada a la fila | `turno`, `solicitadoEn`, `tamanoFilaAlMomento` |
| `SOLICITUD_CANCELADA_POR_PARTICIPANTE` | Retiro voluntario | `turno` |
| `LOTE_ADJUDICADO` | Adjudicacion | `turno`, `adjudicadoEn`, `venceEn`, `motivoAdjudicacion` |
| `SOLICITUD_CONGELADA` | El titular gano otro lote (R-09) | `turno`, `loteQueGano` |
| `SOLICITUD_DESCONGELADA` | Perdio su adjudicacion | `turno` |
| `SOLICITUD_OMITIDA` | Se salto un turno al adjudicar | `turno`, `razonOmision` |
| `SOLICITUD_VENCIDA` | Plazo agotado | `turno`, `venceEn`, `detectadoEn`, `detectadoPor` |
| `SOLICITUD_NO_ADJUDICADA` | Fila cerrada sin alcanzarle | `turno` |
| `FILA_AGOTADA` | Sin candidatos vivos (R-17) | `turnosRevisados` |

`motivoAdjudicacion` distingue `PRIMERA_ADJUDICACION`, `REASIGNACION_POR_VENCIMIENTO`,
`REASIGNACION_POR_RECHAZO`, `REASIGNACION_POR_CANCELACION` y `RECUPERACION_POR_BARRIDO` — este
ultimo, agregado en la Etapa 10: el barrido encuentra un lote `EN_OFERTA` con fila viva que
nadie llego a adjudicar (un proceso murio entre dos escrituras que no pueden ir en la misma
transaccion, `modelo-datos-dynamodb.md` T5b), y no es ni la primera vez ni una reasignacion con
causa conocida.

> **`SOLICITUD_OMITIDA` es el evento que hace auditable la regla R-09.** Sin el, la bitacora
> mostraria una adjudicacion al turno 5 mientras los turnos 3 y 4 seguian vivos, y pareceria una
> violacion del orden. Con el, queda registrado por que se les salto — tenian una adjudicacion
> activa en otro lote — y `razonOmision` lo nombra explicitamente.
>
> Es el ejemplo de la regla general: **toda desviacion aparente del orden debe tener su propio
> evento explicativo.** Un salto sin registro es indistinguible de un fraude.

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

---

## 6. Que **no** va en la bitacora

Separar esto evita que la bitacora se llene de ruido y pierda valor probatorio:

- Navegacion, vistas de pagina y busquedas.
- Inicios y cierres de sesion — pertenecen a Okta.
- Errores tecnicos, tiempos de respuesta y trazas — pertenecen a observabilidad.
- Borradores intermedios de un formulario no enviado.
- Datos personales mas alla del `participanteId` y del correo necesario para notificar.
