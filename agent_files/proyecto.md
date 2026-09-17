# Proyecto — Reglas de Negocio y Alcance Funcional

Documento fundacional. Define **que** hace la aplicacion y bajo que reglas. Los demas
documentos derivan de este: si algo contradice a este archivo, este archivo gana.

El **como** se implementa vive en `estrategia-aplicacion.md`, `modelo-datos-dynamodb.md` y
`arquitectura-tecnica-aws.md`.

---

## 1. Proposito

Vender vehiculos obsoletos de una flotilla mediante **convocatorias de venta**, adjudicando
cada vehiculo por **orden de llegada** de forma verificable, con trazabilidad suficiente para
que un auditor demuestre que el proceso fue justo, ordenado y claro.

## 2. Fuera de alcance

Fijar esto evita que el proyecto crezca sin control:

- **El cobro no ocurre aqui.** El pago se realiza en un sistema externo. Esta aplicacion
  registra el comprobante y el aval, nunca procesa dinero.
- **No hay negociacion de precio ni subasta.** El precio es fijo por lote y quien llega primero
  y paga, se lo lleva.
- **No hay entrega ni logistica.** El traslado del vehiculo se coordina fuera del sistema.
- **No hay alta de usuarios.** La identidad viene de Okta y los roles de EAS.
- **No hay facturacion ni documentacion fiscal.**

## 3. Perfiles

Siete perfiles de negocio. Una misma persona puede tener mas de uno.

| Perfil | Que puede hacer | Permiso que lo materializa |
| --- | --- | --- |
| Administrador de vehiculos | Registrar y editar vehiculos y sus fotografias | `Autob_Administrar_Vehiculos` |
| Administrador de convocatorias | Crear convocatorias; incluir y retirar vehiculos; enviar a aprobacion; publicar y concluir | `Autob_Administrar_Convocatorias` |
| Aprobador | Aprobar o rechazar una convocatoria antes de su publicacion | `Autob_Aprobar_Convocatorias` |
| Comprador empleado | Participar en convocatorias de empleados **y** de publico general | `Autob_Venta_a_empleados` **y** `Autob_Venta_en_general` |
| Comprador general | Participar solo en convocatorias de publico general | `Autob_Venta_en_general` |
| Operador de tesoreria | Avalar o rechazar comprobantes de pago y marcar el vehiculo como vendido | `Autob_Operar_Tesoreria` |
| Adjudicador | Decidir a mano el ganador de cada lote en convocatorias de modalidad `MANUAL` (R-23) | `Autob_Adjudicar_Convocatorias` |
| Auditor de cumplimiento | Consultar la bitacora completa, en solo lectura | `Autob_Auditar` |

### 3.1 Los perfiles son de negocio; la aplicacion solo conoce permisos

**EAS no expone roles: responde un booleano por permiso.** Los perfiles de la tabla son el
lenguaje con el que la organizacion piensa el sistema, y EAS los traduce a permisos con sus
propias reglas internas. La aplicacion recibe unicamente el resultado.

Consecuencia importante para el alcance de este documento: **las reglas de quien puede hacer que
se configuran en EAS, no en el codigo.** Cuando una regla de este documento diga "quien
administra no compra", eso describe la configuracion vigente de EAS, no una prohibicion
programada. Si la organizacion decide lo contrario, cambia la configuracion y la aplicacion no
se modifica.

Lo que **si** vive en el codigo son las reglas que dependen del recurso y del momento — estado
de la maquina, propiedad de la solicitud, auto-aprobacion, plazos —, porque EAS no puede
conocerlas. Es la division que detalla `identidad-autorizacion.md`.

### 3.2 A que convocatorias accede cada quien

Los dos permisos de venta determinan el acceso, y **lo resuelve el servidor**, nunca el cliente:

| Permiso | Da acceso a |
| --- | --- |
| `Autob_Venta_a_empleados` | Convocatorias `EMPLEADOS` |
| `Autob_Venta_en_general` | Convocatorias `PUBLICO_GENERAL` |

Un empleado recibe ambos, asi que ve todo lo que ve un comprador general mas las convocatorias
de empleados. Esa relacion de superconjunto es una **decision de configuracion**, no un caso
especial del codigo.

---

## 4. Entidades del dominio

### 4.1 Vehiculo

Existe con independencia de las convocatorias. Un mismo vehiculo puede participar en varias
convocatorias a lo largo del tiempo, pero **nunca en dos convocatorias activas al mismo tiempo**.

Atributos: **numero economico**, **numero de serie**, marca, version, modelo (anio), nivel de
equipamiento, especificacion mecanica, condiciones mecanicas, detalles esteticos, kilometraje,
fotografia principal y fotografias adicionales.

**El numero economico y el numero de serie los teclea el operador y son unicos.** El primero es la
etiqueta interna del activo; el segundo, el codigo del fabricante. La unicidad la garantiza la base
de datos con un centinela por valor (`modelo-datos-dynamodb.md` 4.5) y **no** una lectura previa:
dos altas simultaneas con el mismo numero pasarian las dos.

Los dos **se pueden corregir**. No son la clave del vehiculo ni el ancla de su bitacora —eso sigue
siendo el identificador interno—, asi que arreglar un typo no parte la historia en dos. El cambio
es una sola transaccion: reservar el valor nuevo, liberar el viejo y actualizar el vehiculo.

> **A confirmar con el operador:** si en la practica el numero economico y el de serie son el mismo
> dato con dos nombres, se colapsan a uno. Estan separados porque describen cosas distintas.

### 4.2 Convocatoria

Agrupa uno o mas vehiculos para su venta durante una ventana de tiempo.

Atributos: **folio**, **nombre corto**, tipo, descripcion de participacion, fecha y hora de
publicacion, de inicio de venta y de fin de venta, horas para liquidacion del pago,
**limite de adjudicaciones por participante**, **limite de solicitudes por participante**,
**modalidad de adjudicacion**, y estatus.

**El folio lo teclea el operador y es unico**, con la misma garantia y la misma posibilidad de
correccion que los numeros del vehiculo. Es como la organizacion nombra la convocatoria.

**El nombre corto no es unico, y eso es deliberado**: dos ventas recurrentes pueden llamarse igual
y el folio las distingue. Existe porque sin el una convocatoria solo se distinguia por su tipo y
sus fechas, y las listas y las opciones de auditoria no tenian mas que un identificador generado
que ofrecer.

**Tipos:** `EMPLEADOS` (exige `Autob_Venta_a_empleados`) y `PUBLICO_GENERAL` (exige
`Autob_Venta_en_general`).

**Los dos limites son por participante y por convocatoria**, y miden cosas distintas: cuantos
vehiculos puede llevarse (R-09) y en cuantos lotes puede formarse (R-22). Se capturan al crear o
editar la convocatoria, que solo se edita en `BORRADOR`, asi que **quedan congelados al
publicar**: nadie cambia las reglas con la fila ya formada.

**La modalidad** (R-23) sigue la misma suerte y por una razon mas fuerte: cambiarla con la fila
formada alteraria retroactivamente las reglas bajo las que la gente se formo.

### 4.3 Lote

**La entidad central del sistema.** Un lote es *un vehiculo dentro de una convocatoria
concreta*. La fila, el contador de turnos, la adjudicacion y el precio existen a nivel de lote,
no de vehiculo.

Esta separacion es lo que permite que un vehiculo no vendido en una convocatoria de empleados
se reoferte despues al publico general con una fila nueva, sin arrastrar la historia de la
convocatoria anterior — pero conservandola para el auditor.

### 4.4 Solicitud de compra

La manifestacion de interes de un participante sobre un lote. Lleva su **turno**, asignado por
el servidor.

### 4.5 Evento de auditoria

Registro inmutable de toda transicion. Ver `trazabilidad-auditoria.md`.

---

## 5. Maquinas de estado

Toda transicion se valida **en el servidor** contra estas tablas. La UI puede ocultar acciones
no disponibles, pero ocultar no es validar.

### 5.1 Convocatoria

```
BORRADOR ──enviar a aprobacion──> EN_APROBACION ──aprobar──> APROBADA ──publicar──> PUBLICADA ──concluir──> CONCLUIDA
    ^                                   │                                                │
    └──────────rechazar─────────────────┘                                                │
    ^                                                                                    │
    └─────────────────────────── (OCULTA puede volver a BORRADOR) ────────────────────────
```

| Origen | Evento | Destino | Permiso | Guardas |
| --- | --- | --- | --- | --- |
| `BORRADOR` | Enviar a aprobacion | `EN_APROBACION` | `Autob_Administrar_Convocatorias` | Al menos un lote; fechas coherentes (R-14); horas de liquidacion > 0 |
| `EN_APROBACION` | Aprobar | `APROBADA` | `Autob_Aprobar_Convocatorias` | **No puede ser quien la creo** (R-05) |
| `EN_APROBACION` | Rechazar | `BORRADOR` | `Autob_Aprobar_Convocatorias` | Motivo obligatorio, se guarda en la bitacora |
| `APROBADA` | Publicar | `PUBLICADA` | `Autob_Administrar_Convocatorias` | — |
| `PUBLICADA` | Concluir | `CONCLUIDA` | `Autob_Administrar_Convocatorias` | Solo despues del fin de venta, o sin solicitudes vivas |
| `BORRADOR`, `EN_APROBACION`, `APROBADA` | Ocultar | `OCULTA` | `Autob_Administrar_Convocatorias` | — |
| `OCULTA` | Reactivar | `BORRADOR` | `Autob_Administrar_Convocatorias` | — |
| `PUBLICADA` | Ocultar | `OCULTA` | `Autob_Administrar_Convocatorias` | **Prohibido si existe alguna solicitud** (R-06) |

> `EN_APROBACION` es una adicion deliberada a los cinco estatus del enunciado original. Sin el
> no se puede distinguir un borrador que se sigue editando de uno que espera dictamen, y el
> aprobador no tiene bandeja de trabajo. El rechazo devuelve a `BORRADOR` con motivo en la
> bitacora, en lugar de introducir un estatus `RECHAZADA`.

**Publicacion vs. visibilidad.** Estatus `PUBLICADA` **no** significa visible. Un participante
solo la ve si ademas `publicadaEn <= ahora`. Ver R-01.

### 5.2 Vehiculo

| Origen | Evento | Destino | Permiso |
| --- | --- | --- | --- |
| — | Registrar | `DISPONIBLE` | `Autob_Administrar_Vehiculos` |
| `DISPONIBLE` | Incluir en convocatoria | `EN_CONVOCATORIA` | `Autob_Administrar_Convocatorias` |
| `EN_CONVOCATORIA` | Retirar de convocatoria | `DISPONIBLE` | `Autob_Administrar_Convocatorias` |
| `EN_CONVOCATORIA` | Adjudicar su lote | `RESERVADO` | sistema |
| `RESERVADO` | Liberar (vencimiento o rechazo) | `EN_CONVOCATORIA` | sistema |
| `RESERVADO` | Avalar pago | `VENDIDO` | `Autob_Operar_Tesoreria` |
| `EN_CONVOCATORIA` | Concluir sin venta | `DISPONIBLE` | sistema |
| `DISPONIBLE` | Retirar del catalogo | `RETIRADO` | `Autob_Administrar_Vehiculos` |

`VENDIDO` es **terminal**. `DISPONIBLE` es lo que habilita la reoferta descrita en R-11.

### 5.3 Lote

| Origen | Evento | Destino | Guardas |
| --- | --- | --- | --- |
| — | Incluir vehiculo en convocatoria | `EN_OFERTA` | El vehiculo esta `DISPONIBLE` (R-10) |
| `EN_OFERTA` | Adjudicar | `ADJUDICADO` | `attribute_not_exists(adjudicacionActual)` (R-08) |
| `ADJUDICADO` | Vencer o rechazar pago | `EN_OFERTA` | Libera para el siguiente de la fila |
| `ADJUDICADO` | Avalar pago | `VENDIDO` | — |
| `EN_OFERTA` | Concluir convocatoria | `NO_VENDIDO` | — |
| `EN_OFERTA` | Retirar | `RETIRADO` | Sin solicitudes vivas |

> **`ADJUDICADO` no cierra la fila.** Un lote adjudicado sigue admitiendo solicitudes mientras la
> venta este abierta: es lo que exige R-17 y de lo que dependen `miPosicion`, `tamanoFila` y la
> reasignacion de R-15 —que necesita un siguiente turno vivo al que reasignar—. Lo que si cierra
> la fila es `VENDIDO`, `NO_VENDIDO` o `RETIRADO`. Se aclara aqui porque el modelo de datos
> exigia `EN_OFERTA` para entrar a la fila, lo que la cerraba a los segundos de abrir la venta;
> lo detecto el prototipo concurrente.

### 5.4 Solicitud de compra

```
EN_FILA ──adjudicar──> ADJUDICADA ──subir comprobante──> EN_VERIFICACION ──avalar──> VENDIDA
   │                        │                                   │
   │                        │ vence el plazo                    │ rechazar
   │                        v                                   v
   │              CANCELADA_POR_VENCIMIENTO         RECHAZADA_POR_TESORERIA
   │
   ├── cancelar ──> CANCELADA_POR_PARTICIPANTE
   ├── excede el tope de la convocatoria ──> CANCELADA_POR_LIMITE
   └── el lote se vende o se concluye ──> NO_ADJUDICADA
```

| Origen | Evento | Destino | Permiso | Guardas |
| --- | --- | --- | --- | --- |
| — | Solicitar compra | `EN_FILA` | permiso de venta del tipo | Venta abierta; acceso al tipo de convocatoria; sin solicitud previa viva en el mismo lote (R-07) |
| `EN_FILA` | Adjudicar | `ADJUDICADA` | sistema | Turno menor vivo; lote sin adjudicacion; titular con cupo disponible en la convocatoria (R-09) |
| `EN_FILA` | Cancelar | `CANCELADA_POR_PARTICIPANTE` | titular | — |
| `EN_FILA` | Excede el tope de solicitudes de la convocatoria | `CANCELADA_POR_LIMITE` | sistema | R-22. Ocurre inmediatamente despues de crearla, para que quede constancia del intento |
| `CONGELADA` | Cancelar | `CANCELADA_POR_PARTICIPANTE` | titular | — |
| `EN_FILA`, `CONGELADA` | El lote se vende o la convocatoria concluye | `NO_ADJUDICADA` | sistema | — |
| `ADJUDICADA` | Subir comprobante | `EN_VERIFICACION` | titular | Dentro del plazo |
| `ADJUDICADA` | Vencer el plazo | `CANCELADA_POR_VENCIMIENTO` | sistema | `ahora > venceEn` (R-13) |
| `ADJUDICADA` | Cancelar | `CANCELADA_POR_PARTICIPANTE` | titular | Libera el lote de inmediato |
| `EN_VERIFICACION` | Avalar pago | `VENDIDA` | `Autob_Operar_Tesoreria` | — |
| `EN_VERIFICACION` | Rechazar pago | `RECHAZADA_POR_TESORERIA` | `Autob_Operar_Tesoreria` | Motivo obligatorio (R-16) |

> El enunciado original decia que al adjuntar el comprobante la solicitud "se marca como en
> proceso de verificacion". Por eso **no existe** un estado intermedio `COMPROBANTE_CARGADO`:
> subir el comprobante y entrar en verificacion son el mismo evento.

**Estados vivos:** `EN_FILA`, `CONGELADA`, `ADJUDICADA`, `EN_VERIFICACION`. Los demas son
terminales.

> **`CONGELADA` ya no se escribe.** Desde la Etapa 14, R-09 se sostiene con el cupo por
> convocatoria y nada congela solicitudes: a quien no tiene cupo se le **omite** dejando su
> evento, y sigue `EN_FILA`. El estado se conserva en el catalogo —y sus dos transiciones de
> salida tambien— porque la bitacora es append-only y las historias ya escritas tienen que seguir
> siendo legibles.

**Una vez `EN_VERIFICACION`, el plazo deja de correr.** La demora de tesoreria nunca perjudica
al participante. Por lo mismo, ese estado **no admite cancelar**: quien ya pago y espera
dictamen no puede retirarse por su cuenta, y el arrepentimiento lo resuelve tesoreria
rechazando el pago, con motivo y bitacora (R-16).

> La fila `CONGELADA → Cancelar` se agrego al implementar la Etapa 4. R-09 ya la exigia
> —"sus `CONGELADA` permanecen congeladas **hasta que las cancele** o el lote se resuelva"— y
> `permission-matrix.md` ya la permitia, pero esta tabla no la traia. Sin ella, un participante
> con un vehiculo comprado quedaba atrapado en las filas restantes.

---

## 6. Reglas de negocio

### Visibilidad y acceso

**R-01 — Gating triple, siempre en servidor.** Una convocatoria es visible para un participante
solo si se cumplen las tres condiciones: `estatus = PUBLICADA`, `publicadaEn <= ahora`, y tiene
el permiso de venta que corresponde al tipo de la convocatoria. Falla cualquiera, la respuesta es
404 — no 403, para no revelar que existe. Nunca confiar en filtros de UI.

**R-02 — Las convocatorias de empleados son exclusivas.** Tipo `EMPLEADOS` solo para quien tiene
`Autob_Venta_a_empleados`. Tipo `PUBLICO_GENERAL` solo para quien tiene `Autob_Venta_en_general`.
Un empleado tiene ambos permisos y por eso alcanza ambos tipos (seccion 3.2).

**R-03 — Publicacion y venta son dos momentos distintos.** Entre `publicadaEn` e `inicioVenta`
el participante ve la convocatoria, sus vehiculos y sus fotografias, y sabe cuando abre la
venta, pero **no puede solicitar**. Es la ventana que da a todos la misma oportunidad de
prepararse.

**R-04 — La hora de negocio es `America/Mexico_City`.** Toda fecha se persiste en ISO-8601 UTC
y se presenta en esa zona. **Prohibido** decidir visibilidad, apertura o vencimiento con la
hora del reloj del cliente.

### Convocatorias

**R-05 — Separacion de funciones.** Quien crea o edita una convocatoria no puede aprobarla,
aunque tenga ambos permisos.

**R-06 — Una convocatoria con solicitudes no se puede ocultar ni borrar.** Ocultarla dejaria
participantes en una fila invisible. Para terminarla anticipadamente se concluye, lo que cierra
las filas de forma explicita y auditada.

### Fila y adjudicacion

**R-07 — Una solicitud viva por participante y lote.** No se puede solicitar dos veces el mismo
lote. Si su solicitud anterior termino en un estado terminal, puede volver a formarse y recibe
un **turno nuevo**; jamas recupera el anterior.

**R-08 — El servidor asigna el orden, el cliente nunca.** El `turno` proviene de un contador
atomico del lote y es **la unica fuente de verdad del orden**. `solicitadoEn` es informativo y
sirve para la bitacora, no para ordenar. Esta prohibido ordenar la fila por tiempo: dos
solicitudes pueden compartir milisegundo, y el reloj puede retroceder — un contador atomico no.

**R-09 — Cupo de adjudicaciones por convocatoria.** Un participante puede formarse en cuantos
lotes le permita R-22, pero **no puede adjudicarse mas de `limiteAdjudicaciones` vehiculos de una
misma convocatoria**. El limite lo fija quien captura la convocatoria.

- **Que consume cupo:** una adjudicacion **viva** (`ADJUDICADA`, `EN_VERIFICACION`) o
  **consumada** (`VENDIDA`).
- **Que lo libera:** el vencimiento del plazo, el rechazo de tesoreria y la cancelacion del
  propio titular. Todos devuelven la unidad al cupo.
- **Que no lo libera:** completar la compra. Un vehiculo comprado gasta cupo **para siempre**,
  que es lo que hace que el limite signifique algo.
- **A quien se salta cuando esta agotado:** la adjudicacion omite a ese candidato y sigue con el
  turno siguiente, dejando `SOLICITUD_OMITIDA` con razon `LIMITE_ALCANZADO`. **El saltado sigue
  `EN_FILA` con su turno intacto**: si mas tarde libera cupo vuelve a ser candidato en ese lote
  sin perder su lugar, por delante de quien llego despues.

El cupo se comprueba con **escritura condicional dentro de la misma transaccion que adjudica**,
nunca con una lectura previa (regla 6 de CLAUDE.md). No se puede diferir como el tope de
solicitudes: adjudicar no es poner una marca, es dejar el lote `ADJUDICADO`, el vehiculo
`RESERVADO`, arrancar el plazo y encolar el correo de aviso.

Razon de la regla: permite participar ampliamente sin acaparar, que es lo mismo que buscaba su
version anterior —"una sola adjudicacion activa en todo el sistema"— pero medido por convocatoria,
que es la unidad en la que el negocio reparte.

> **Version anterior, y lo que se perdio al cambiarla.** Hasta la Etapa 14, R-09 decia que un
> participante sostenia **una sola adjudicacion activa en todo el sistema**, garantizada por un
> centinela `PART#<id> / ADJUDICACION_ACTIVA`, y sus demas solicitudes se congelaban mientras
> tanto. Ese mecanismo limitaba la **simultaneidad**, no el total, y no distinguia una
> convocatoria de otra. Al sustituirlo **desaparece el unico tope entre convocatorias**: un
> participante puede sostener su cupo completo en la convocatoria A y otro tanto en la B al mismo
> tiempo. Si hiciera falta un tope global, vuelve como un contador mas sobre el mismo item, no
> como un rediseno.
>
> El estado `CONGELADA` y los eventos `SOLICITUD_CONGELADA` / `SOLICITUD_DESCONGELADA`
> **se conservan en el catalogo** aunque ya nada los escriba: la bitacora es append-only (R-20) y
> las historias ya escritas tienen que seguir siendo legibles.

**R-22 — Tope de solicitudes por convocatoria.** Un participante no puede tener mas de
`limiteSolicitudes` solicitudes en una misma convocatoria. Las que excedan **se crean y se
cancelan a continuacion**, a `CANCELADA_POR_LIMITE`, con su evento.

- **Se cancela despues de crear, no se rechaza antes.** Es lo que pidio el negocio —que quede
  constancia del intento— y ademas lo que exige el motor: comprobar antes seria *leer y luego
  decidir*, y obligaria a meter un item compartido en la transaccion de cada solicitud, que es la
  causa medida de cancelaciones masivas por `TransactionConflict`.
- **El conteo jamas decrece.** Una solicitud cancelada por el titular, vencida por tiempo o
  rechazada por tesoreria **sigue contando**: el tope mide cuantas veces intento, no cuantas le
  quedan vivas.
- En consecuencia, **cada reintento de R-07 consume otro lugar del tope**. Quien agota sus
  intentos no puede volver a formarse aunque no tenga ninguna solicitud viva.

> **El cupo de adjudicaciones se recupera; el de solicitudes no.** Los dos contadores miden cosas
> distintas —cuantos vehiculos tiene en firme, y cuantas veces intento— y por eso se comportan al
> reves. No es una inconsistencia: es la diferencia entre limitar el resultado y limitar la
> participacion.

Su valor tambien fija el **orden del participante dentro de la convocatoria**: el contador que
lo produce es atomico y monotonico, asi que el n-esimo intento lleva `ordenEnConvocatoria = n`.
Ese ordinal responde algo que los turnos no pueden —los turnos son por lote y no se comparan
entre si— y es lo que el adjudicador de R-23 necesita para ver en que orden llego cada quien.

**R-23 — Modalidad de adjudicacion.** Cada convocatoria declara como se decide al ganador de sus
lotes, y la decision se toma al capturarla:

- **`AUTOMATICA`** — el motor de fila actual: gana el turno vivo menor con cupo disponible, sin
  intervencion humana. Es la modalidad por omision y la unica que existia hasta la Etapa 15.
- **`MANUAL`** — decide una persona con `Autob_Adjudicar_Convocatorias`, el **adjudicador**. Los
  lotes se quedan `EN_OFERTA` con su fila creciendo hasta que alguien dictamina.

Reglas de la modalidad manual:

- **El adjudicador puede decidir en cualquier momento**, incluso con la venta abierta y la fila
  todavia creciendo. La pantalla lo advierte y la bitacora lo registra: quien audite tiene que
  poder ver que la fila no estaba cerrada al decidir.
- **Nada adjudica solo.** Los cinco disparadores automaticos —crear solicitud, vencer, rechazar,
  cancelar y el barrido nocturno— no adjudican en esta modalidad. El barrido ademas **tiene que
  excluir explicitamente los lotes manuales**: un lote en espera de dictamen le es, si no,
  indistinguible de uno automatico que se quedo atorado.
- **Si el ganador elegido no paga, el lote vuelve al adjudicador**, no al siguiente turno. Vencer,
  rechazar y cancelar liberan el lote a `EN_OFERTA` y lo devuelven a la bandeja.
- **Los cupos aplican igual** (R-09 y R-22). Si el elegido no tiene cupo, la accion falla y la
  pantalla lo explica; el sistema **no elige a otro por su cuenta**, porque la decision es humana
  por definicion.
- **El orden deja de ser la invariante.** Saltarse turnos menores es el proposito de la modalidad,
  no una anomalia — pero cada decision lleva su `LOTE_ADJUDICADO` firmado por una persona y con su
  motivo. La verificacion de integridad tiene que ser **consciente de la modalidad**: en un lote
  `AUTOMATICA` la invariante sigue siendo el orden FIFO; en uno `MANUAL` es que exista esa firma.

> **La modalidad manual vuelve irrelevante la carrera del instante de apertura.** Si quien decide
> es una persona, llegar primero no compra nada. Es la mitigacion mas fuerte de R25, y sale gratis
> donde el negocio pueda usarla.

**R-10 — Un vehiculo en una sola convocatoria activa.** Puede figurar en el historico de muchas,
pero no puede estar simultaneamente en dos convocatorias no concluidas.

**R-11 — Reoferta de lo no vendido.** Al concluir una convocatoria, los vehiculos sin vender
vuelven a `DISPONIBLE` y **un administrador** puede incluirlos en otra convocatoria. El flujo
habitual es empleados primero y despues publico general, pero **la aplicacion no lo automatiza
ni lo exige**: la inclusion es siempre una decision explicita del administrador.

**R-11b — Lo que sobrevive al cierre tambien vuelve, cuando deja de estar comprometido.** Un lote
`ADJUDICADO` sigue vivo despues de concluir (R-18). Si esa adjudicacion termina en venta, no hay
mas que hacer. Si se cae —vencimiento, rechazo de tesoreria o cancelacion—, su vehiculo vuelve a
`DISPONIBLE` igual que el resto de lo no vendido, sin que nadie tenga que pedirlo.

> **Devolver al catalogo no es la decision que R-11 reserva a una persona.** Esa es la
> **inclusion** en otra convocatoria, y sigue siendo del administrador. Volver a `DISPONIBLE` ya
> era automatico al concluir; esto solo termina de aplicar la decision que entonces se tomo, sobre
> el lote que en ese momento seguia comprometido. Por eso lo hace el barrido y no un boton: nada
> le avisa a nadie de que el compromiso se cayo, y un boton que hay que descubrir no repara un
> estado que nadie sabe que existe.

> **Sin esto el vehiculo quedaba atrapado.** Ni vendible —su convocatoria termino— ni ofertable
> —el centinela de R-10 lo declaraba activo en ella—, en silencio y para siempre. El sintoma
> aparecia semanas despues, al intentar incluirlo en otra convocatoria y recibir un rechazo que
> nada explicaba.

**R-12 — Anonimato de la fila.** Un participante **jamas** ve la identidad de otro. Solo recibe
`miTurno`, `miPosicion` y `tamanoFila`. Ninguna proyeccion enviada al cliente puede incluir el
identificador, correo o nombre de un tercero. Aplica tambien a metadatos: no se expone cuando
solicito otro ni cuantas veces.

> `miTurno` es el numero asignado por el contador y no cambia nunca. `miPosicion` es cuantos le
> faltan por delante y **si** cambia conforme la fila avanza. Se exponen los dos porque
> responden preguntas distintas: "que lugar me toco" y "que tan cerca estoy".

### Pago y liquidacion

**R-13 — El plazo se cuenta en horas naturales.** `venceEn = adjudicadoEn + horasLiquidacion`,
reloj corrido 24/7, sin excluir fines de semana ni dias festivos. Es una comparacion directa de
timestamps UTC.

*Alternativa descartada:* horas habiles con calendario de festivos de Mexico. Se descarto por
complejidad de dominio y porque un plazo que depende de un calendario es mas dificil de
explicar a un participante y de auditar.

**R-14 — Coherencia de fechas.** `publicadaEn <= inicioVenta < finVenta`, y `horasLiquidacion`
mayor que cero. Se valida al enviar a aprobacion y en cada edicion.

**R-15 — El vencimiento libera y reasigna en un solo acto.** Al vencer el plazo, la solicitud
pasa a `CANCELADA_POR_VENCIMIENTO` y el lote se adjudica al **siguiente turno vivo** en la misma
transaccion. Al nuevo adjudicado se le notifica por correo, con plazo contado desde **su**
adjudicacion.

**R-16 — El rechazo de tesoreria exige motivo** y libera el lote igual que un vencimiento.

**R-17 — Fila agotada.** Si no queda ningun turno vivo, el lote vuelve a `EN_OFERTA` y sigue
disponible para quien solicite despues, mientras la venta siga abierta. Si ya cerro, queda
`NO_VENDIDO` al concluir la convocatoria.

**R-18 — Concluir cierra las filas.** Al concluir la convocatoria, las solicitudes `EN_FILA` y
`CONGELADA` pasan a `NO_ADJUDICADA`. Una adjudicacion `ADJUDICADA` o `EN_VERIFICACION` vigente
**sobrevive a la conclusion** y conserva su plazo: quien gano antes del cierre tiene derecho a
terminar de pagar.

### Trazabilidad

**R-19 — Toda transicion se audita en la misma transaccion que la muta.** Si el evento no se
puede escribir, la mutacion no ocurre. Sin excepciones.

**R-20 — La bitacora es append-only.** Nunca se modifica ni se borra un evento. Un error se
corrige con un evento compensatorio, no editando la historia.

**R-21 — Todo evento identifica a su actor**, incluido el sistema para las acciones
automaticas, y lleva motivo cuando la transicion lo exige.

---

## 7. Ciclo de vida completo — recorrido de referencia

1. El administrador registra vehiculos con sus fotografias. Quedan `DISPONIBLE`.
2. Crea una convocatoria `EMPLEADOS` en `BORRADOR` e incluye vehiculos: nace un **lote** por
   cada uno, con su contador de turnos en cero.
3. La envia a aprobacion (`EN_APROBACION`). Un aprobador distinto la aprueba (`APROBADA`).
4. El administrador la publica (`PUBLICADA`). Sigue invisible hasta `publicadaEn`.
5. Llegado `publicadaEn`, quienes tienen `Autob_Venta_a_empleados` la ven con sus vehiculos, fotografias y
   la hora de apertura. Todavia no pueden solicitar (R-03).
6. Llegado `inicioVenta`, solicitan. Cada uno recibe un `turno` del contador atomico del lote.
7. El turno 1 obtiene la adjudicacion y recibe por correo los datos de pago y su plazo, siempre
   que le quede cupo en la convocatoria; si no, se le omite y pasa al turno siguiente (R-09). Sus
   demas solicitudes siguen `EN_FILA`. Los demas ven solo su lugar y el tamano de la fila.
8. Segun lo que ocurra:
   - **Paga y sube el comprobante** → `EN_VERIFICACION`. Tesoreria avala → solicitud `VENDIDA`,
     vehiculo `VENDIDO`. Las demas solicitudes del lote pasan a `NO_ADJUDICADA`.
   - **Se le vence el plazo** → `CANCELADA_POR_VENCIMIENTO`, el lote pasa al siguiente turno
     vivo, que recibe su correo y su propio plazo (R-15).
   - **Tesoreria rechaza el pago** → `RECHAZADA_POR_TESORERIA` y el lote pasa al siguiente
     (R-16).
9. Al concluir la convocatoria, los vehiculos no vendidos vuelven a `DISPONIBLE`.
10. El administrador puede incluirlos en una convocatoria `PUBLICO_GENERAL`, con filas nuevas
    (R-11).
11. En cualquier momento, el auditor reconstruye toda la secuencia desde la bitacora.

---

## 8. Decisiones registradas

| Decision | Alternativa descartada | Razon |
| --- | --- | --- |
| ~~Varias filas simultaneas, una sola adjudicacion activa (R-09)~~ | ~~Sin limite; una sola solicitud por convocatoria~~ | *Sustituida en la Etapa 14 por el cupo por convocatoria* |
| Cupo de adjudicaciones por convocatoria (R-09) | Conservar el tope global de una adjudicacion activa | El negocio reparte por convocatoria; el tope global limitaba la simultaneidad, no el total |
| Tope de solicitudes que **cancela despues de crear** (R-22) | Rechazar la solicitud antes de crearla | Deja constancia del intento, y comprobar antes seria leer-y-decidir sobre un item compartido |
| El conteo de solicitudes jamas decrece | Devolver el lugar al cancelar o vencer | El tope mide cuantas veces intento, no cuantas le quedan vivas |
| Al saltar por cupo agotado, el saltado sigue `EN_FILA` | Congelarlo, como hacia R-09 | El cupo se libera; congelarlo le costaria su lugar por una condicion reversible |
| Modalidad por convocatoria (R-23), no por lote | Una aplicacion entera manual o automatica | El negocio reparte por convocatoria, y el motor decide leyendo el lote que ya tiene en la mano |
| El adjudicador decide **en cualquier momento** | Exigir la venta cerrada primero | Es lo que el operador pidio; la pantalla advierte y la bitacora registra que la fila seguia abierta |
| Si el elegido no paga, el lote **vuelve al adjudicador** | Reasignar al siguiente turno | En modalidad manual el orden no decide: reasignar automaticamente contradiria la modalidad entera |
| Si el elegido no tiene cupo, la accion **falla** | Que el sistema elija a otro | La decision es humana por definicion; elegir por su cuenta seria volver a la modalidad automatica |
| Plazo en horas naturales (R-13) | Horas habiles con calendario de festivos | Auditabilidad y simplicidad de dominio |
| `EN_APROBACION` como estatus adicional | Reusar `BORRADOR` para lo enviado a dictamen | Sin el no hay bandeja de aprobacion ni bloqueo de edicion |
| Rechazo devuelve a `BORRADOR` con motivo en bitacora | Estatus `RECHAZADA` | Menos estados; el motivo ya queda trazado |
| Sin estado `COMPROBANTE_CARGADO` | Separarlo de `EN_VERIFICACION` | El enunciado los define como el mismo evento |
| El lote es la entidad de la fila, no el vehiculo | Fila a nivel de vehiculo | Permite reofertar sin arrastrar la historia previa |
| 404 en lugar de 403 para lo no visible (R-01) | 403 explicito | No revelar la existencia de convocatorias no publicadas |
