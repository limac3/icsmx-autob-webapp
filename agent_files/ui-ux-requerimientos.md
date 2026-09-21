# Requerimientos de UI/UX

Pantalla por pantalla: estructura, datos, interacciones y estados. Mobile-first.

Los contratos de datos estan en `api-contracts.md`; los permisos, en `permission-matrix.md`.

---

## 1. Principios de interfaz

1. **Mobile-first real.** Se disena primero la pantalla angosta. El participante tipico entra
   desde el telefono, muchas veces en el instante exacto de la apertura de venta.
2. **Tabla en escritorio, CardView en movil** (regla 12). Nunca una tabla con desplazamiento
   horizontal en el telefono.
3. **Eden tal cual** (regla 10). Consultar el MCP de Eden **antes** de crear cualquier
   componente. CSS propio solo para responsividad o adecuacion visual pedida.
4. **Sin ENUMs crudos** (regla 11). Todo estado y tipo pasa por `src/dictionaries/`. El usuario
   nunca ve `CANCELADA_POR_VENCIMIENTO`.
5. **Hora de negocio siempre visible.** Toda fecha se muestra en `America/Mexico_City`, con la
   zona indicada. Formateo en servidor (R-04).
6. **La UI oculta, el servidor decide.** Ocultar un boton es cortesia, no seguridad.

### 1.1 Componentes Eden verificados

Disponibles en la organizacion: `eden-buttons` (`Primary`, `Secondary`), `eden-form-parts`
(`Label`, `Input`, `Radio`, `Select`, `TextArea`), `eden-headings` (`H1`…`H4`), `eden-text`
(`Text2`), `eden-table`, `eden-alert`, `eden-badge`, `eden-tabs`, `eden-accordion`,
`eden-tool-modal`, `eden-media-thumbnail-gallery`, `eden-description-list` (`DL`, `DT`, `DD`),
`eden-progress-stepper`, `eden-contextual-menu`, `eden-workforce-header`, `eden-workforce-footer`,
`eden-fonts`, `eden-normalize`.

> **Las hojas de Eden viven en `@layer`, asi que el CSS de la aplicacion gana sin `!important`.**
> Todo paquete `eden-*` inyecta su CSS dentro de `@layer eden.atom` / `eden.molecule` /
> `eden.organism`, y en la cascada **lo no estratificado vence a lo estratificado**, sin importar la
> especificidad. Una regla propia de una sola clase sobreescribe una de Eden de dos. Es lo que
> permite corregir el comportamiento de un componente —el rebote de `ScrollTrack`
> (`desafios-implementacion.md` 61), el centrado de un boton (62)— sin `!important` y sin envolverlo
> en algo propio.

> **`eden-description-list` es el par etiqueta/valor, y llego tarde.** La ficha tecnica y las
> fichas de datos se habian escrito con `dl`/`dt`/`dd` a mano mas un `.css` propio que ponia la
> etiqueta arriba del valor. El paquete hace exactamente eso con los tokens de Unity, y su ejemplo
> agrupa cada par en un `div` igual que el marcado que se habia escrito. Se reemplazo y se borro el
> CSS. Es el costo de no buscar primero (regla 10).

> **`CardView` si existe: lo exporta `eden-table`** (comprobado al implementar la Etapa 5,
> inspeccionando `lib/es/index.d.ts` del paquete). No hay que escribir uno propio. Envuelve una
> `<Table>` y la apila en tarjetas por debajo de 480 px, tomando los encabezados de las columnas,
> de modo que **hay un solo arbol y no dos vistas que se desincronizan**. Es lo que cumple la
> regla 12 sin codigo custom.
>
> `eden-table` trae ademas `OverflowWrapper`, `Sorting`, `ColumnHiding` y `SelfSelect`, por si una
> pantalla posterior los necesita.

---

## 2. Armazon

`src/app/layout.tsx`: `Normalize` + `Fonts`, `WorkforceHeader`, contenido, `WorkforceFooter`.
Rejilla `auto 1fr auto` en `.envoltura`, para que el pie quede abajo aunque la pantalla tenga
poco contenido, y contenido centrado con ancho maximo (`layout.css`). Mismo armado que
`icsmx-camp-webapp`, para que las dos aplicaciones se vean igual de encuadradas.

El encabezado y el pie van cada uno en su `<Suspense>`: los dos leen datos de la peticion —el
encabezado la sesion, el pie el idioma— y ninguno debe retrasar el contenido, que es lo que la
persona vino a ver. El contenido lo envuelve un `<div>`, no un `<main>`: cada pantalla monta el
suyo con su propia clase, y anidar landmarks `main` seria HTML invalido.

**Navegacion por permiso, en dos componentes separados dentro del slot `tools` del
`WorkforceHeader`.** Solo se muestran las secciones que la persona puede usar.

- **`NavegacionPrincipal.tsx`** — las secciones por permiso, **siempre visibles junto al nombre
  de usuario**, no escondidas detras de un clic. Dos variantes siempre renderizadas y el CSS
  decide cual se ve, el mismo patron mobile-first que `Table`/`CardView`: en pantalla ancha una
  fila horizontal en blanco alineada a la derecha (Server Component, son enlaces); en pantalla
  angosta delega en `MenuDeSecciones`.
- **`MenuDeSecciones.tsx`** — la variante angosta. Con **una sola** seccion la muestra suelta y
  navegable, porque envolverla solo agregaria un clic. Con **varias**, las colapsa en un
  desplegable **vertical, hacia abajo**, con la misma forma que el menu de la cuenta
  (`ContextualMenu` + disparador con `aria-expanded`, cierre con Escape y al elegir). El
  disparador muestra la primera seccion como **vista previa, no como enlace**: para navegar
  —incluso a esa primera— hay que expandirlo.

  **El primer intento fue un `<details>` de `eden-accordion` reutilizando la misma fila.** No
  sirvio: la lista seguia siendo horizontal, asi que al expandirse crecia hacia los costados,
  se salia de la pantalla y empujaba el nombre de usuario fuera de vista. Vertical, y con el
  desplegable que la aplicacion ya usa para lo mismo.
- **`MenuDeUsuario.tsx`** — solo los accesos fijos de la cuenta, "Mi sesion" y "Cerrar sesion",
  en el desplegable de siempre sobre el nombre. Antes compartia el desplegable con las secciones
  por permiso; se separaron porque el pedido era que esas se vieran siempre, no en un menu.

  Cada menu **se nombra distinto** (`menu` y `menuCuenta`): dos landmarks de navegacion con el
  mismo nombre accesible no se distinguirian con un lector de pantalla.

**Cada entrada declara la accion que abre su puerta, no una lista de permisos**
(`src/lib/navegacion.ts`). Es lo que mantiene el menu pegado a la matriz: si
`permission-matrix.md` cambia que permisos habilitan una accion, el menu lo hereda sin tocarse.

| Seccion | Ruta | Accion que la abre |
| --- | --- | --- |
| Convocatorias | `/convocatorias` | `solicitud:ver-mis-solicitudes` |
| Vehiculos | `/admin/vehiculos` | `vehiculo:ver-catalogo` |
| Administrar convocatorias | `/admin/convocatorias` | `convocatoria:ver-administracion` |
| Aprobaciones | `/aprobaciones` | `convocatoria:ver-aprobaciones` |
| Tesoreria | `/tesoreria/verificacion` | `tesoreria:ver-bandeja` |

> **Esta tabla ya no enumera permisos, y es a proposito.** La version anterior lo hacia y se
> despego de la matriz: afirmaba que `Autob_Auditar` solo abria "Auditoria", cuando ese permiso
> concede tambien `vehiculo:ver-catalogo`, `convocatoria:ver-administracion` y
> `tesoreria:ver-bandeja` — un auditor ve esas tres secciones, en modo lectura. Dos fuentes de
> verdad para lo mismo y una se olvida de actualizar.

Se comprueba la **capacidad** de la accion, no su aplicabilidad: un enlace es una puerta a una
pantalla, no una operacion sobre un recurso, asi que no hay contexto que evaluar. Por eso todas
las acciones de la tabla son `ver-*` sin guarda — una accion guardada, evaluada sin recurso,
denegaria siempre (regla 18) y el enlace quedaria oculto para todo el mundo. Detalle en
`desafios-implementacion.md` seccion 35.

`/mis-solicitudes` (seccion 3.5) y `/auditoria` (seccion 7) entran al menu cuando existan sus
rutas. Un enlace hacia una ruta inexistente es un 404 ofrecido por la propia aplicacion, y hay
una prueba que lo impide (`navegacion.test.ts`). **Las dos ya existen y estan en el menu.**

`/mis-solicitudes` comparte accion con el catalogo —`solicitud:ver-mis-solicitudes`— y eso es
correcto, no una duplicidad: las dos preguntan "¿esta persona compra?", que es una sola
capacidad. Quien compra ve las dos entradas, porque responden preguntas distintas: el catalogo
es para entrar a una fila y `/mis-solicitudes` para saber en cuales ya esta.

Con varios permisos, se muestran todas las secciones que correspondan, en el orden declarado.
Una sesion autenticada **sin ningun permiso** ve el menu vacio con un aviso, y conserva sus
accesos de cuenta (Mi sesion, Cerrar sesion): es un caso real y distinto de un EAS caido.

Ocultar una seccion es solo cortesia: el servidor vuelve a decidir en cada action y en cada
pagina, con `puedeEjecutar` completo. El menu tampoco recibe los permisos de la sesion — el
servidor le pasa enlaces ya filtrados, asi que el cliente no tiene con que equivocarse.

En movil la navegacion colapsa; el destino mas usado de cada rol queda accesible en un toque.

---

## 3. Pantallas de participante

### 3.1 `/convocatorias` — Listado

**Datos:** `ConvocatoriaListadoDTO[]` con gating triple aplicado en la consulta (R-01).

**Movil:** una tarjeta por convocatoria. **Escritorio:** `eden-table`.

Cada elemento muestra: **el `nombre` como enlace y el `folio` debajo**, cantidad de vehiculos, y el
dato temporal mas relevante segun el momento:

| Momento | Se muestra |
| --- | --- |
| Antes de `inicioVenta` | **"Abre en 2 d 4 h"** — cuenta regresiva |
| Venta abierta | **"Abierta · cierra el 12 sep, 18:00"** |
| Despues de `finVenta` | **"Cerrada"**, atenuada |

> Anteponer el tiempo restante al titulo es deliberado: durante la ventana entre publicacion y
> apertura (R-03), lo unico que el participante quiere saber es **cuando puede actuar**.

> **Nombre y folio, no el tipo ni un resumen de la descripcion.** La primera version mostraba el
> tipo como titulo —dos convocatorias de empleados quedaban indistinguibles— y debajo un resumen de
> 160 caracteres de la descripcion, que se repite casi palabra por palabra de una convocatoria a la
> siguiente y ocupaba tres renglones por fila. El folio es el dato con el que la organizacion
> pregunta por una. La descripcion es de `ConvocatoriaDetalleDTO` y no del listado, que es lo que
> `api-contracts.md` 8 ya decia: el servicio la arrastraba de mas.

**Cuenta regresiva:** el valor inicial lo calcula el servidor y el cliente solo decrementa.
Jamas se compara contra `Date.now()` del navegador para decidir si la venta abrio (R-04) — un
reloj adelantado habilitaria el boton antes de tiempo. Al llegar a cero se **revalida contra el
servidor**, no se habilita nada localmente.

**Vacio:** "No hay convocatorias disponibles en este momento." Sin insinuar que existan otras
ocultas.

### 3.2 `/convocatorias/[id]` — Detalle

**Datos:** `ConvocatoriaDetalleDTO`. Si no pasa el gating triple → **404** (R-01).

**El titulo es el `nombre` de la convocatoria, con el `folio` debajo.** No el tipo: "De
empleados" no distingue una venta de la siguiente, y todas las de empleados aparecian con el
mismo encabezado. El tipo baja a ser un campo mas. Aviso `Alert` con el estado de la venta.

**Dos recuadros (`Card`) y no un encabezado corrido:**

1. **Descripcion de la participacion** — texto libre de varios parrafos, lo que hay que *leer*.
2. **Datos de la convocatoria** — tipo, inicio y fin de venta, horas de liquidacion y **el estado
   de venta otra vez, con lo que significa**, en un `eden-description-list`; lo que hay que
   *consultar*. La nota de hora de negocio (regla 9) va una vez al pie del recuadro, no colgada de
   cada fecha.

   **El estado aparece dos veces a proposito y no es una repeticion.** Arriba la insignia sola
   basta para reconocerlo de un vistazo; en la ficha de datos lleva al lado una frase de lo que se
   puede hacer en ese estado, que es la pregunta real: "abierta" no dice por si sola que hay que
   formarse en una fila, ni "cerrada" que un plazo de pago adjudicado puede seguir corriendo. Las
   tres frases estan en el diccionario y el mapa fase → frase es **exhaustivo**: agregar una fase a
   `EstadoDeVentaUi` rompe la compilacion, que es cuando hay que decidir su explicacion.

Mezclados en un solo encabezado, la descripcion se traga las fechas.

Rejilla de lotes: fotografia principal, marca/version/modelo, kilometraje, precio, `Badge` de
estatus y `tamanoFila` (**"3 en fila"** — cantidad, jamas identidades).

Una columna en movil, dos o tres en escritorio.

### 3.3 `/convocatorias/[id]/lotes/[loteId]` — Detalle del lote

La pantalla mas importante para el participante.

**Datos:** `LoteDetalleDTO`, con `MiLugarDTO | null`.

**Estructura (movil, de arriba abajo):**

1. **Volver a la convocatoria** — boton `Secondary`. Sin el, quien llega por un enlace directo al
   lote no tiene ninguna salida mas que el boton "atras" del navegador.
2. **Identificacion** — marca, version y modelo como titulo; **numero economico y numero de
   serie** en un `eden-description-list`, porque dos unidades de la misma marca, version y anio se
   llaman igual y solo esos dos numeros las distinguen; precio destacado y `Badge` de estatus.
3. **Bloque de accion** — seccion 3.4. En escritorio queda fijo en columna derecha; en movil, en
   una barra inferior adherida, para que el boton este siempre al alcance del pulgar.
4. **Ficha tecnica** — `eden-accordion` con **dos** desplegables, la misma division que el
   formulario de alta (4.2): especificacion es lo que el vehiculo *es* —kilometraje, nivel de
   equipamiento, especificacion mecanica— y condicion lo que *tiene* —condiciones mecanicas,
   detalles esteticos—. Un desplegable por campo obligaba a abrir cinco de uno en uno.
5. **Galeria** — `eden-media-thumbnail-gallery` con URLs firmadas en SSR (regla 13), **al final y
   no arriba**: arriba empujaba la identificacion y el bloque de accion —precio, fila, boton de
   formarse— fuera de la primera pantalla en movil, que es donde se decide. Cada foto lleva su
   descripcion **debajo**, y el encabezado de la seccion lo pone la pagina, no la galeria (ver
   `desafios-implementacion.md` 59).

**La ficha tecnica es cacheable; el bloque de accion nunca.** Se separan con `Suspense`.

### 3.4 Bloque de accion — matriz de estados

Toda la logica de la pantalla se reduce a esta tabla:

| Situacion | Se muestra |
| --- | --- |
| Venta no abierta | Cuenta regresiva + `Primary` **deshabilitado** "Solicitar compra" |
| Abierta, sin solicitud | `Primary` **"Solicitar compra"** activo |
| `EN_FILA` | "Tu lugar: **3** de 7 · turno 4" + `Secondary` "Cancelar" |
| `CONGELADA` | Lugar + `Alert` informativo: "Tienes una adjudicacion activa en otro vehiculo. Tu lugar esta reservado." |
| `ADJUDICADA` | `Alert` de exito, datos de pago, **plazo con cuenta regresiva**, `Primary` "Subir comprobante", `Secondary` "Cancelar" |
| `EN_VERIFICACION` | `Alert`: "Comprobante en revision por tesoreria." **Sin cuenta regresiva** |
| `VENDIDA` (propia) | `Alert` de exito: "Compra completada." |
| `CANCELADA_POR_VENCIMIENTO` | `Alert` de advertencia con la fecha de vencimiento |
| `RECHAZADA_POR_TESORERIA` | `Alert` de error **con el motivo** |
| `NO_ADJUDICADA` | "Este vehiculo fue vendido a otro participante." |
| Lote `VENDIDO`, sin solicitud propia | `Badge` "Vendido"; boton oculto |
| Sin `Autob_Venta_a_empleados` en convocatoria de empleados | **No llega aqui:** 404 |

> Que `EN_VERIFICACION` **no** muestre cuenta regresiva es un requisito, no un olvido: el reloj
> se detuvo (`proyecto.md`, 5.4) y dejarlo corriendo haria creer al participante que puede
> perder el vehiculo por la demora de tesoreria.

**Al solicitar:** el boton se deshabilita en el envio para evitar el doble clic — pero la
garantia real es el centinela de fila (R-07), no el estado del boton.

Errores traducidos por diccionario:

| Codigo | Mensaje |
| --- | --- |
| `already_in_queue` | "Ya estas en la fila de este vehiculo." |
| `lote_no_disponible` | "Este vehiculo ya no esta disponible." |
| `invalid_state` | "La venta no esta abierta en este momento." |
| `conflicto_concurrencia` | "Intentalo de nuevo." + recarga automatica |
| `plazo_vencido` | "El plazo para subir tu comprobante ya vencio." |

### 3.5 `/mis-solicitudes`

`MiSolicitudDTO[]` de `listarMisSolicitudes`, agrupadas: **Requieren tu atencion** (`ADJUDICADA`
con plazo corriendo) primero, luego activas, luego historicas.

Las `ADJUDICADA` muestran cuenta regresiva prominente. Es la pantalla que evita que alguien
pierda un vehiculo por olvido — y mientras CES siga sin aprobacion (R17), **el unico canal que
lo hace**: sin correo, no hay otra forma de enterarse de que se gano algo.

**Dentro de "requieren tu atencion" manda el plazo que vence antes, no lo mas reciente.** Es el
unico grupo donde el orden decide algo: quien tiene tres adjudicaciones vivas necesita ver
primero la que esta a punto de perder, y esa puede ser la mas antigua.

**Una `ADJUDICADA` con el plazo ya vencido no encabeza la pantalla y tampoco es historica.** No
requiere atencion porque ya no hay nada que hacer —T3 condiciona la subida del comprobante a
`venceEn > :ahora`—, y no es historica porque la transicion aun no se ha escrito: la escribira
el barrido o la lectura del propio lote. Sale entre las activas, con el aviso de que vencio, y
sin cuenta regresiva: un contador en cero seria cruel y falso.

**La lista no lleva `miPosicion`.** Costaria dos `Select: COUNT` por fila; "que tan cerca estoy"
se responde en el detalle del lote, donde vale una lectura. El turno si viene, porque esta en el
item y es gratis.

Se avisa cuando la consulta **se trunco**, igual que en la bitacora.

### 3.6 Subir comprobante

`ToolModal` desde el bloque de accion. Arrastrar o seleccionar; JPG, PNG o PDF hasta 10 MB.
Vista previa antes de confirmar, con aviso de que el archivo sera revisado por tesoreria.

Validacion de tipo y tamano en cliente **y** en servidor. La del cliente es cortesia.

---

## 4. Pantallas de administracion

### 4.1 `/admin/vehiculos`

Tabla en escritorio, tarjetas en movil. Columnas: fotografia, **vehiculo**, kilometraje, `Badge`
de estatus, convocatoria activa si la tiene.

**La columna "Vehiculo" encabeza con el numero economico, y ese es el enlace.** Marca, version y
modelo bajan a una linea de apoyo. La razon es la misma por la que 4.2 abre el formulario con los
dos numeros: veinte NP300 2019 se ven identicas en una tabla y lo unico que distingue una fila de
otra es el numero con el que la organizacion nombra ese activo. Un enlace tiene que ser el
**indice**, no la descripcion — mismo reparto que el nombre y el folio en el catalogo de
convocatorias. Por lo mismo, el `aria-label` del menu de acciones se identifica con el numero
economico: con marca y version nombraria veinte filas distintas.

Filtros por estatus y busqueda por marca o version. Acciones por fila en
`eden-contextual-menu`.

**Ninguna de las dos columnas de apoyo cuesta una lectura por fila, y las dos lo costaban.** El
catalogo llega a 500 items por estatus, asi que resolverlas fila a fila lo habria convertido en
la lectura mas cara del sistema:

- **La fotografia** sale de `fotografiaPrincipalClave`, desnormalizada en el item del vehiculo
  junto a `fotografiaPrincipalId`. Ese identificador ya existia con el proposito declarado de
  que el listado no leyera la galeria de cada uno, pero con un ID no se construye una URL: la
  desnormalizacion estaba a medias. La firma se hace en SSR, por peticion (regla 13).
- **La convocatoria activa** se resuelve con **una** lectura del listado de convocatorias, no
  con una por vehiculo. Si el identificador no resuelve a nombre no se muestra crudo: un ULID no
  le dice nada a nadie.

**Editar vive en el menu y tambien en el nombre de la fila.** El menu es un control del cliente y
los filtros son un formulario `GET` que funciona sin JavaScript; dejar la unica via de edicion
dentro del desplegable romperia esa propiedad.

### 4.2 `/admin/vehiculos/nuevo` y `/[id]/editar`

> **El rechazo de una tanda nombra el archivo, no solo el motivo.** Con varias fotografias
> elegidas, un mensaje como "el contenido del archivo no corresponde a su formato declarado" es
> correcto e **inaccionable**: describe un archivo concreto entre siete y no dice cual. El dato no
> puede venir del servidor —cada alta es su propia peticion y ahi el archivo es el unico que
> hay—, asi que lo aporta el bucle que recorre la tanda. Se limpia en cada intento nuevo, y no
> aparece cuando el fallo no es de un archivo (por ejemplo, el reordenamiento final). Reportado
> por el operador usando la pantalla.

Formulario con `eden-form-parts`, en secciones: identificacion, especificacion, condicion,
fotografias.

**La seccion de identificacion abre con los dos numeros que teclea el operador** —numero economico
y numero de serie—, antes de marca y version: son con lo que la organizacion nombra el vehiculo, y
el identificador interno nunca se captura. Los dos son unicos, pero **eso no lo puede saber el
navegador**: lo decide un centinela dentro de la transaccion, y el motivo `duplicado` vuelve
marcado en el campo que repitio, para que quien captura no tenga que adivinar cual de los dos fue.

Cada seccion es una **tarjeta** (`Card renderAs="fieldset"` con un `Stack` dentro): el marco es
lo que separa a la vista —con solo un titulo encima, las secciones se leen como una lista
continua—, y el `renderAs` conserva el `<fieldset>`/`<legend>`, que es lo que hace que un lector
de pantalla anuncie la seccion como contexto de cada campo. El titulo va con `H4 renderAs="legend"`
y no con el `Legend` de `eden-form-parts`, que renderiza `Text4` —tamano de descripcion— y dejaba
los titulos indistinguibles de las etiquetas de campo.

**Un rechazo del servidor conserva lo capturado.** React 19 reinicia el formulario a
`defaultValue` cuando la action termina, asi que la action devuelve lo que llego y el formulario lo
repinta. Sin eso, el unico rechazo que el navegador no puede anticipar —un numero duplicado— dejaba
todos los campos vacios con el error senalado sobre nada. Aplica igual al formulario de convocatoria,
donde ademas hay que **remontar el editor enriquecido**: Lexical solo lee su contenido inicial al
montar, asi que una prop nueva se ignora en silencio (`desafios-implementacion.md` 48).

**No se usa el `FieldSet` de Eden**: esta documentado para agrupar `Radio` y `Checkbox`, y con
campos de texto reparte mal el ancho y duplica los mensajes de error. Eden **no tiene** separador
de proposito general: no hay `Divider` fuera de `eden-vertical-tiles`, que es una tarjeta de media
para cuadriculas. Ver `desafios-implementacion.md` seccion 25.

**Los tres bloques de la pantalla van separados por una linea**: el formulario del vehiculo, la
galeria de fotografias y el retiro del catalogo. No son variaciones de lo mismo — el formulario se
guarda con su boton, la galeria escribe al momento y el retiro es terminal—, y sin la separacion la
pantalla se lee como una lista continua en la que el boton de retirar queda a la altura de
cualquier otro. Al no haber componente de Eden que lo haga, es un `border-top` con el token de
color de linea, **identico en las dos separaciones** para que se lea como una regla y no como dos
estilos.

El reparto en columnas lo hace `Grid` de `eden-grid`, con `@container` queries sobre el ancho del
contenedor y no de la ventana: identificacion y especificacion a media rejilla, condicion al ancho
completo.

### Gestion de fotografias

**La rejilla es solo fotografias.** Todas del mismo tamano, la principal con su distintivo
**dentro** de la imagen, la descripcion **completa** debajo, y un unico boton: "Editar". Sobre la
rejilla, al lado del titulo "Fotografias", un boton "Agregar". Nada mas.

> **Dos versiones anteriores fallaron por lo mismo: meter los controles en la rejilla.** La primera
> repartia cinco botones bajo cada fotografia —subir, bajar, marcar principal, editar, eliminar— y
> mostraba el pie solo al entrar a editar, asi que saber que decia cada foto obligaba a abrirlas de
> una en una. La segunda saco el pie a un campo de solo lectura de una linea, y quedaba **recortado
> justo en lo que se venia a leer**. Con veinte fotografias, la rejilla era un tablero de cien
> controles alrededor de lo unico que importa: las imagenes y lo que dicen.
>
> De ahi la regla: **la rejilla muestra, los modales editan.** El pie es un parrafo que se ajusta en
> varias lineas y nunca se recorta; sin descripcion dice "Sin descripcion" en cursiva atenuada, para
> que el hueco se lea como un dato que falta y no como un error de maquetacion.

**La posicion 1 es la principal.** No hay "marcar como principal": designar es mover al frente, y
lo hace el mismo campo de orden de los dos modales. Es una sola idea en vez de dos controles que
podian contradecirse, y el servidor mantiene el invariante en la transaccion del reordenamiento
—`reordenarFotografias` actualiza `fotografiaPrincipalId` a la que quede primera—, asi que la
interfaz no puede dejar el puntero apuntando a otra parte.

**No se puede eliminar la ultima** — el boton del modal se deshabilita con explicacion, y el
servidor lo vuelve a comprobar.

#### Modal de agregar — una o varias de un tiro

Se abre con el boton de arriba. Contiene:

- El control de archivo de Eden con **arrastrar y soltar y seleccion multiple** (`FileInput` con
  `isDroppable` y `multiple`). No existe ningun componente aparte para esto: son dos props del
  mismo control que ya se usaba.
- **Todas las elegidas, pintadas con su nombre de archivo.** No es una vista previa decorativa:
  `FileInput` **deduplica por nombre**, asi que dos fotografias distintas llamadas `IMG_0001.jpg`
  —lo normal saliendo de una camara— dejarian caer la segunda **en silencio**. Viendolas, la que
  falta se nota antes de guardar. El nombre se recorta en pantalla y va completo en el `title`.
- El **volumen de la tanda**, `X / 10 MB`, y el aviso de que todavia no se subio nada.
- La **descripcion**, con su tope. Si se captura, **se guarda igual en todas** las fotografias de
  la tanda; despues se corrige una por una en el modal de edicion. La ayuda del campo lo dice
  cuando hay mas de una elegida.
- La **posicion**, de 1 al total resultante. Con varias, **es la posicion de la primera y las demas
  la siguen** en el orden en que se eligieron; la ayuda tambien lo dice. El rango **no depende de
  cuantas se suban**: es donde arranca el bloque, de antes de la primera existente a despues de la
  ultima. **Con la galeria vacia el campo no se muestra**: la primera es la 1 y por tanto la
  principal, y un campo con una sola opcion es una pregunta sin respuestas.
- Guardar y cancelar. Mientras sube, el boton dice **"Subiendo… 3 / 7"**: siete fotografias no es
  una espera instantanea.

> **El tope de 10 MB pasa a ser del total de la tanda, y si se excede no se sube nada.** El aviso
> lo dice y el boton de guardar se deshabilita. **No se recorta la tanda sola** — cual dejar fuera
> es una decision de quien sube, no del programa. En el servidor el tope sigue siendo **por
> archivo**, que es la frontera real y la unica que no se puede eludir; el total es una guarda de
> pantalla, y es la que hace que una tanda entera no pueda pasarse del limite que el servidor
> aplicaria de a uno.
>
> Se avisa igual, antes de empezar, si la tanda **pasaria del maximo de 20 por vehiculo**: sin eso,
> con 18 ya subidas y 5 elegidas las tres ultimas fallarian a mitad de la tanda.

> **Cada fotografia viaja en su propia peticion, en serie.** No es una limitacion tecnica sino la
> decision correcta: mantiene el tope de tamano del cuerpo aplicado **por fotografia** —que es para
> lo que se dimensiono—, le da a cada alta su transaccion y su evento de bitacora (regla 4), y hace
> que un fallo a la mitad deje las anteriores subidas y visibles en vez de perderlo todo. En ese
> caso el proceso **se detiene** y no reordena: las que faltan se vuelven a intentar, y lo que ya
> esta arriba no se toca.
>
> La posicion se aplica al final con **un solo** reordenamiento, insertando el bloque entero donde
> se pidio. Mover una por una desplazaria el destino de las siguientes, que es justo donde se
> cometeria el error de un puesto.

#### Modal de edicion

Se abre con el boton "Editar" de cada fotografia. Contiene:

- **La fotografia, que no se puede cambiar.** Los bytes son inmutables: para cambiar la imagen se
  elimina y se sube otra. Por eso aqui **no hay control de archivo** (lo que ademas sostiene la
  cache de CloudFront, seccion 5.3 de `estrategia-aplicacion.md`).
- La **descripcion**, editable. Hasta la Etapa 17 solo se podia fijar al subir, y corregir una
  errata obligaba a borrar la foto entera.
- La **posicion**, de 1 al total de fotografias, con la 1 marcada como principal. Con una sola
  fotografia el campo no se muestra.
- **Guardar**, que escribe **solo la descripcion y la posicion**, y solo lo que cambio; si no
  cambio nada, cierra sin escribir.
- **Eliminar**, que pide confirmacion aparte.
- Cancelar.

> **El campo de posicion es un `Select`, no un campo numerico.** Asi la cota deja de ser una
> validacion que alguien tiene que escribir —y probar— y pasa a ser imposible de violar por
> construccion; y es donde cabe decir que la 1 es la principal, sin un texto de ayuda aparte.

#### El tope de la descripcion: 120 caracteres, en tres lugares

Es un requisito de presentacion, no de almacenamiento: el pie se muestra bajo la miniatura en el
visor publico y un texto largo desborda la tarjeta o empuja la rejilla. Los tres hacen falta:

1. **En el campo**, con `maxLength`, que frena el teclado. Por eso el campo de pie es un `TextArea`
   y no un `Input`: el `maxLength` de `Input` es inusable por sus tipos
   (`desafios-implementacion.md` 19).
2. **Antes de enviar**, con el boton de guardar deshabilitado y un aviso al lado. `maxLength` no
   recorta un valor que **ya venia largo** —una descripcion capturada antes de que el tope bajara—,
   asi que sin esta comprobacion se mandaba al servidor, volvia rechazada y se perdia lo escrito.
   El modal se queda abierto con el texto intacto, que es lo que el operador pidio.
3. **En el servidor**, que es la unica frontera que cuenta.

Un contador `N / 120` acompana al campo mientras se escribe. Cuenta el texto **recortado**, igual
que lo mide el servidor, para que unos espacios al final no marquen como excedido un pie que cabe.

La descripcion **sigue siendo opcional**. Cuando falta, la galeria publica usa marca/version/modelo
como texto alternativo, asi que la foto no queda inaccesible.

#### Confirmacion del borrado

**Eliminar pide confirmacion, y el aviso dice que es definitivo.** El borrado destruye los objetos
de S3 y no hay vuelta: un clic sobre el boton equivocado no puede ser suficiente. La confirmacion
**sustituye** al modal de edicion en vez de anidarse dentro: dos `<dialog>` abiertos a la vez dejan
la pila del top layer a merced del orden de cierre.

Los tres modales se montan **solo cuando estan abiertos**. Un `<dialog>` cerrado conserva sus hijos
en el DOM —lo que los oculta es `dialog:not([open]) { display: none }`, que es estilo—, asi que
dejarlos puestos mantendria sus campos y su boton de borrar en el arbol de la pantalla
(`desafios-implementacion.md` 87).

Las fotografias se sirven en la variante que cada pantalla necesita, no en su tamano original: la
tira de miniaturas ya no descarga la imagen completa. Es una decision de rendimiento y no un
requerimiento visual — vive en el codigo, con la derivacion de cada `sizes` escrita al lado.

> **El reordenamiento se hace por posicion, no arrastrando ni con flechas.** Hubo dos caminos
> —botones de mover arriba/abajo, y arrastre encima como atajo de raton— y los dos salieron de la
> rejilla al vaciarla de controles. Elegir "3" en un campo es ademas lo unico que resuelve el caso
> real de una galeria larga: mover la ultima al frente costaba diecinueve clics.
>
> Lo que se conserva de esa version es la funcion que calcula el orden resultante: los dos modales
> la comparten, asi que "ponla en la posicion 3" significa lo mismo viniendo de agregar o de
> editar. Y lo que se pierde no es accesibilidad —el `Select` es alcanzable con teclado y con
> lector, cosa que el arrastre nunca fue— sino el gesto directo de arrastrar, que solo servia con
> raton.

**Retiro del catalogo: un solo boton, y el motivo dentro del modal.** La pantalla ofrece
**"Retirar vehiculo"** y nada mas; al pulsarlo se abre un modal con el aviso de que **la operacion
es definitiva y no se puede deshacer**, el campo del motivo, y los dos botones de confirmar y
cancelar. El motivo sigue siendo obligatorio —`VEHICULO_RETIRADO` esta marcado con **M** en el
catalogo de eventos— y el boton de confirmar queda inerte hasta que se captura.

Antes el campo del motivo estaba **suelto sobre la pantalla de edicion**, con el boton de retirar
debajo: un campo obligatorio a la vista sin nada que dijera a que pertenecia, y una transicion
terminal a un clic de distancia. Es el mismo defecto que las convocatorias ya tenian corregido
(seccion 4.3, `AccionesDeConvocatoria`) y esta pantalla se habia quedado atras; el aviso va
**dentro** del modal porque es lo ultimo que se lee antes de confirmar, que es cuando importa.

> **Lo que costo, dicho explicito: el retiro deja de funcionar sin JavaScript.** Un modal es un
> control del cliente, asi que no hay forma de exigir la confirmacion y a la vez conservar el envio
> por `<form>` puro; la envoltura `retirarVehiculoDesdeFormulario` se retiro. El servidor sigue
> comprobando permiso, estado y motivo, asi que lo que se pierde es el camino degradado, no ninguna
> garantia.

Un vehiculo `RESERVADO` o `VENDIDO` se muestra en solo lectura, con aviso del motivo.

### 4.3 `/admin/convocatorias`

Listado con `eden-tabs` por estatus: Borrador · En aprobacion · Aprobadas · Publicadas ·
Concluidas · Ocultas. Encaja con lo que Eden dice de `Tabs` —"vistas alternables en la misma
pantalla"—, con la consecuencia de que es componente cliente: la pagina lee en el servidor y le
pasa los seis grupos ya resueltos.

> **El avance del ciclo NO usa `eden-progress-stepper`.** Este documento lo pedia, y consultado
> el MCP resulto ser otra cosa: un **asistente** por pasos secuenciales, con un panel de
> contenido por paso y un hook `useProgressStepper` para avanzar y retroceder. Sirve para que
> alguien complete un formulario largo, no para indicar en que estado esta una entidad.
> `eden-progress-list` tampoco: sus pasos son **tareas** que el usuario completa en paginas
> distintas, cada una un enlace con su propio avance parcial.
>
> Eden no tiene un componente para "en que punto de su ciclo esta esto", asi que el estatus se
> muestra con el **`Badge`** que ya usa el catalogo de vehiculos. Es lo que `eden-badge`
> describe: "indicador compacto junto a un contenido para destacar cantidad, **estado** o
> categoria". Si mas adelante se quiere una linea de tiempo visual, seria un componente propio y
> habria que justificar por que vale su mantenimiento.

**La columna *Tipo* lleva dos datos: el tipo y la modalidad de adjudicacion.** Quien puede
participar (R-01) y como se decide al ganador (R-23) son las dos preguntas que se hacen a la vez
sobre una convocatoria, y ninguna de las dos sustituye a la otra. La modalidad va **debajo** del
tipo, con el mismo `Text4` secundario que el folio bajo el nombre y la hora de negocio bajo el
periodo; no se abre una quinta columna, que costaria ancho sin agrupar nada nuevo.

> **Con la etiqueta breve, no con la del formulario.** El diccionario tiene las dos:
> `modalidadesAdjudicacion` —"Automatica: gana el turno mas bajo"— explica una decision **en el
> momento de tomarla**, y es la que usa 4.4; `modalidadesAdjudicacionBreve` —"Automatica"— es la
> que sirve en una lista que se recorre con la vista, donde la explicacion se repetiria en cada
> renglon. Derivar una de la otra recortando en los dos puntos seria una suposicion sobre la
> puntuacion de cada idioma; son dos entradas y las dos estan vigiladas por `diccionarios.test.ts`.

### 4.4 `/admin/convocatorias/nueva` y la edicion

> **La edicion no tiene ruta propia, y es deliberado.** `/admin/convocatorias/[id]/editar` no
> responde: el formulario se monta dentro del detalle (`/admin/convocatorias/[id]`), que ya trae
> el estatus, los lotes y las acciones de transicion. Construir la ruta aparte seria una segunda
> vista de lo mismo, con dos sitios donde mantener el mismo formulario. Este documento pedia la
> ruta; se corrige el documento, no el codigo.

**El titulo de la pantalla es el `nombre`**, por la misma razon que en 3.2: el tipo no distingue
una convocatoria de otra. Aqui el folio **no** se repite en el encabezado porque ya es un campo del
formulario de abajo.

Formulario en tres secciones: **identificacion** (folio y nombre corto), participacion (tipo con
`Radio` y la descripcion en editor enriquecido) y calendario — las tres fechas con hora,
**etiquetadas explicitamente en hora de Ciudad de Mexico**.

**El folio es unico y el nombre corto no**, y la ayuda de cada campo lo dice: dos ventas
recurrentes pueden llamarse igual y el folio las distingue. Un folio repetido vuelve marcado en su
campo, igual que los numeros del vehiculo.

Validacion en vivo de R-14 (`publicadaEn <= inicioVenta < finVenta`), con el error junto al
campo culpable, no en un aviso general.

**Inclusion de vehiculos:** selector de vehiculos `DISPONIBLE` con precio por lote. Solo
editable en `BORRADOR`; en cualquier otro estatus, la lista de lotes se muestra en solo lectura.

El selector usa **`<option>` nativo** dentro del `Select` de Eden: su `Option` deduce el valor
con `value || children`, asi que la opcion vacia de marcador enviaria su propia etiqueta como
identificador de vehiculo (`desafios-implementacion.md` 28).

> **El error de vehiculo ya comprometido es `invalid_state`, no `conflicto_concurrencia`.** Este
> documento pedia lo segundo; el servicio devuelve lo primero, y con razon: que el vehiculo este
> en otra convocatoria activa no es una carrera perdida que convenga reintentar, es un estado que
> no se puede cambiar desde aqui. Como tres de las cinco condiciones de la transaccion producen
> el mismo codigo, el servicio distingue esta por la **posicion del item que cancelo** y devuelve
> `detalles: { vehiculo: "en_otra_convocatoria" }`. La pantalla lo traduce a "Ese vehiculo entro
> en otra convocatoria activa. Actualiza la lista y elige otro."

**Retiro de un lote:** boton por fila, con el motivo en un `DialogModal` —obligatorio, va a la
bitacora—. El lote no desaparece: pasa a `RETIRADO` y se queda a la vista con su motivo, porque
el auditor tiene que poder ver que ese vehiculo estuvo incluido y a que precio. Un lote con
participantes formados no ofrece el boton y explica por que.

**Enviar a aprobacion** pide confirmacion e indica que la convocatoria dejara de ser editable.

### 4.5 `/admin/convocatorias/[id]/lotes/[loteId]/fila`

Vista administrativa del lote: estatus, adjudicacion vigente, `venceEn`, `tamanoFila`.

> **No muestra la fila completa ni identidades.** `fila:ver-completa` es exclusiva del auditor
> (`permission-matrix.md`, seccion 4). El administrador ve agregados; quien configura la venta
> no conoce el orden.

### 4.6 `/admin/convocatorias/[id]/vista-publica` y `.../lotes/[loteId]` — vista previa

Quien administra no participa de las convocatorias, pero tiene que poder **consultar como la
veran los usuarios**. Dos pantallas, una por cada pantalla del participante: la convocatoria
(3.2) y el vehiculo (3.3 y 3.4). Se entra desde el boton "Ver como participante" del detalle
administrativo.

Las dos llevan arriba un aviso (`AvisoDeVistaPrevia`) que dice que es una vista previa, desde
cuando sera visible y que los enlaces se quedan dentro de ella. Su boton **"Salir de la vista
previa"** vuelve al detalle administrativo — con una etiqueta distinta a la del "Volver a la
convocatoria" del propio contenido, porque en la pantalla del vehiculo conviven las dos.

> **Se ve todo, no se pulsa nada.** El bloque de participacion (3.4) se renderiza igual y con
> sus botones deshabilitados. Ocultarlo dejaria fuera la mitad de la pantalla que se quiere
> revisar; dejarlo vivo invitaria a formarse en una fila desde una pantalla de revision.

> **Se mira desde `publicadaEn`, no desde ahora.** Un borrador no tiene fase de venta: mostrarlo
> "hoy" lo pintaba como **venta cerrada**, que es falso. Se renderiza como se vera al publicarse
> y el aviso dice desde cuando (`momentoDeVistaPrevia`). Una convocatoria ya visible se mira en
> el presente.

Lo que la vista previa **no** hace: ninguna concesion de permisos. Las rutas publicas conservan
su gating triple con 404 (`permission-matrix.md`, seccion 4).

---

## 5. Aprobador — `/aprobaciones`

Bandeja de convocatorias en `EN_APROBACION`, **las mas antiguas primero** —al reves que el
listado administrativo—: la que lleva mas tiempo esperando es la que esta reteniendo una venta.
Cada fila muestra quien la creo y cuanto lleva en espera, calculado con la hora del servidor.

Puerta propia: `convocatoria:ver-aprobaciones`, que exige `Autob_Aprobar_Convocatorias`.

> **La vista de dictamen es la pantalla de detalle**, no una ruta aparte. Las acciones de
> `/admin/convocatorias/[id]` se derivan de la maquina de estados y del permiso de quien mira, de
> modo que quien aprueba ve alli sus dos botones sobre exactamente los mismos datos —incluidos
> los lotes y quien la creo— que ve quien administra. Una segunda vista del mismo dictamen se
> separaria de la primera al primer cambio.

Dos acciones: **Aprobar** (confirmacion) y **Rechazar** (motivo obligatorio, `TextArea`; el boton
permanece deshabilitado mientras este vacio).

Si es el creador, ambos botones se ocultan y se muestra: "No puedes aprobar una convocatoria que
tu creaste." Se muestra el aviso y no solo se ocultan los botones: quien aprueba y creo la
convocatoria veria una pantalla identica a la de alguien sin autorizacion, y acabaria pidiendo un
permiso que ya tiene. La validacion real esta en el servidor (R-05).

---

## 6. Tesoreria — `/tesoreria/verificacion`

Bandeja de solicitudes `EN_VERIFICACION`, mas antiguas primero. Cada fila: vehiculo,
convocatoria, correo del titular, `adjudicadoEn`, fecha del comprobante.

Vista de detalle: datos de la solicitud, comprobante embebido (imagen o PDF) y las dos acciones.

- **Avalar pago** — confirmacion que advierte que el vehiculo quedara marcado como vendido y la
  operacion no se revierte.
- **Rechazar pago** — motivo obligatorio, y aviso explicito de que **el vehiculo se adjudicara
  automaticamente al siguiente de la fila**.

Que la consecuencia aparezca antes de confirmar es lo que evita rechazos por error.

---

## 6.1 Adjudicador — `/adjudicacion`

Solo existe para convocatorias de modalidad `MANUAL` (R-23).

- **Bandeja** (`/adjudicacion`) — los lotes que esperan decision, **los que llevan mas tiempo
  esperando primero**: un lote sin decidir es una venta detenida. Por cada lote: el vehiculo
  identificado —marca, version y modelo, con numero economico y numero de serie en una segunda
  linea, **nunca el `vehiculoId` interno**, que no dice nada a quien decide—, el **precio
  publicado del lote**, la convocatoria, **cuantos hay en la fila** —una cantidad, jamas
  identidades— y desde cuando espera. Avisa si la venta sigue abierta.

  **La bandeja no dictamina**, igual que la del aprobador: cada fila lleva al detalle, donde ya
  viven los datos completos y el boton. Dos vistas del mismo dictamen se separan al primer cambio.

- **Detalle del lote** (`/adjudicacion/<convocatoriaId>/<loteId>`) — **la unica pantalla fuera de
  auditoria que expone identidades de terceros**, y es el requerimiento entero: quien decide no
  puede hacerlo a ciegas. El encabezado identifica el vehiculo igual que la bandeja, no por su
  `vehiculoId`. Por cada candidato vivo:

  | Dato | Por que |
  | --- | --- |
  | Turno y **hora exacta de llegada, con milisegundos** | Distinguir que tan cerca llegaron dos solicitudes en la rafaga de apertura — `turno` sigue siendo la unica fuente de verdad del orden (regla 3); esto es para que quien decide entienda el margen, no para que lo reordene |
  | Nombre o correo, y su identificador | Para saber a quien se le adjudica |
  | Cuantas adjudicaciones lleva | Su cupo consumido en esta convocatoria (R-09) |
  | **Sus otras solicitudes aqui, cada una identificando su vehiculo** | El cruce que el requerimiento pidio. Un ordinal de solicitud sin decir de que vehiculo se trata no le sirve a quien decide, asi que se quito de la pantalla (no se muestra en ningun otro lado) |

  El ordinal de la solicitud (`ordenEnConvocatoria`) **ya no se muestra**: no aparecia en ninguna
  otra pantalla y por si solo no dice nada. Sigue existiendo como dato del servicio —ordena "sus
  otras solicitudes" por como llegaron— pero es un detalle de implementacion, no un dato de
  pantalla.

  **Cada "otra solicitud" es una fila expandible (`eden-accordion`), no un enlace.** Colapsada
  muestra `marca version modelo numeroEconomico`; con un clic se expande y agrega, en un segundo
  renglon, `numeroDeSerie`, `turno N de <tamaño de esa fila>` y el precio publicado de ese lote.
  Se decidio expandir en el lugar y no navegar al detalle de ese otro lote: quien adjudica esta
  decidiendo sobre **este** lote, y saltar de pantalla para ver que vehiculo es la otra solicitud
  interrumpe esa decision sin necesidad — los datos ya bastan para entender el contexto sin salir
  de aqui.

  **Se advierte cuando la venta sigue abierta**, porque puede decidir de todas formas y la fila que
  tiene delante puede no ser la ultima. **El motivo es obligatorio**: una decision humana sin razon
  escrita es tan opaca para el auditor como un salto de turno sin evento.

  **A quien agoto su cupo se le marca, pero no se le esconde.** La autoridad sobre el cupo es la
  condicion de la transaccion y no esta lectura: entre pintar la tabla y decidir, el cupo puede
  liberarse. Ocultarlo le quitaria al adjudicador una opcion que quiza si existe.

  Quien solo tiene `Autob_Auditar` ve la fila pero **no los botones**: fiscaliza la decision, no la
  toma.

---

## 7. Auditor — `/auditoria`

Solo lectura, sin un solo boton de mutacion.

- **Bitacora** (`/auditoria`) — **dos modos de consulta**, y la diferencia entre ellos explica
  casi todo el resto de la pantalla:
  - **Con identificador**: PA-12 lee la particion de ese agregado, que trae su historia entera.
    El rango de fechas es entonces un filtro en memoria, asi que **no se acota**; si hay eventos
    anteriores al rango, la pantalla lo dice y ofrece ampliarlo ("ver historia completa"), lo que
    no cuesta ninguna lectura extra porque la particion ya se leyo entera.
  - **Sin identificador** (por tipo de evento o por participante): PA-13 consulta la particion
    que corresponde al criterio —el tipo de evento y la persona tienen cada uno su indice— y el
    rango va como **condicion de clave**. Ahi el rango **es la llave** de la consulta y no un
    filtro: de eso salen las dos reglas de abajo —obligatorio y acotado a 90 dias.

  Reglas de los filtros:
  - **El rango nunca esta vacio.** Por defecto, los ultimos 30 dias contando hoy. El tope son 90,
    y los dos numeros dejaron de estar pegados: el tope era 31 cuando media el numero de `Query`
    que costaba el rango, y ahora mide cuanta historia cabe en una pantalla sin paginar. Los dos
    campos van **primero** en el formulario y son `required`. Un rango ausente en la URL se sustituye por el defecto; uno **presente y mal
    formado** se rechaza con aviso, sin sustituirlo en silencio — quien escribio esas fechas
    espera esas fechas.
  - **Buscar exige al menos un criterio completo**: identificador, tipo de evento o participante.
    Un tipo de registro sin identificador no es un criterio: solo acota las opciones del select.
  - **`Identificador` y `Participante` son selects, no campos de texto.** Sus opciones salen de la
    bitacora del rango —no del catalogo de entidades—, de modo que **toda opcion ofrecida devuelve
    resultados**. Cada una se presenta con datos legibles y su identificador al final: vehiculo con
    marca, version, modelo y **numero economico**; convocatoria con su **nombre corto y su folio**;
    lote con el vehiculo y la convocatoria; solicitud con el vehiculo, el turno y quien la pidio;
    participante con nombre y correo. Cambiar el tipo de registro o una fecha **reenvia el
    formulario solo** para recalcular las opciones, y limpia el identificador elegido antes de
    hacerlo. Sin JavaScript el boton sigue funcionando.
  - **Las dos listas son lecturas independientes**, y no un filtro sobre una lectura comun. Cuando
    lo eran, el tipo de registro con mas volumen consumia el cupo compartido y los demas aparecian
    como "sin actividad en este rango" siendo falso: en el sandbox el select ofrecia 2 vehiculos
    donde habia 14 y 1 convocatoria donde habia 60.
  - Se avisa cuando la consulta **se trunco** por volumen, para que se acote el rango, en vez de
    mostrar una lista incompleta que parece completa.
- **Nomenclatura de los tipos de registro.** "Lote y su fila" y "Solicitud (lugar en la fila)", no
  "Lote" y "Solicitud" a secas: **no existe un registro de fila** al que buscarle un
  identificador. La historia de una fila **es** la del lote, con el mismo `loteId`, y una solicitud
  es un lugar dentro de ella.
- **Columnas de la tabla.** Fecha con **milisegundos** en hora de negocio —toda la resolucion que
  el dato tiene; ver `desafios-implementacion.md`—, el registro al que pertenece el evento (solo en
  el modo global, donde los eventos vienen mezclados, y **con la misma etiqueta legible que las
  opciones** — es el mismo etiquetador, para que la misma convocatoria no se llame de dos maneras
  en la misma pantalla), tipo traducido, actor con **nombre y identificador** (el nombre lo hace reconocible; el identificador es lo que quedo escrito y lo que
  se puede citar), motivo, `correlacionId` y `eventoId`. Los dos ultimos son columnas y no
  agrupaciones visuales: `correlacionId` relaciona los eventos de una misma transaccion sin
  necesitar que queden contiguos, y `eventoId` es lo que **desempata dos eventos del mismo
  milisegundo**, igual que en la `SK` de la bitacora.
- **Atajos desde el resto de la aplicacion.** El listado de vehiculos, el detalle de convocatoria,
  cada lote de esa convocatoria y la vista de fila del lote ofrecen "ver en la bitacora de
  auditoria" con el tipo y el identificador ya puestos, solo a quien tiene `Autob_Auditar`. Es lo
  que evita copiar un ULID a mano, que era el motivo real por el que la pantalla no se usaba.
- **Reconstruccion de fila** (`/auditoria/lotes/[loteId]`) — linea de tiempo con todas las
  solicitudes en orden de turno, sus estados y las adjudicaciones. **Aqui si se muestran
  identidades.** Todo salto de turno aparece con su `SOLICITUD_OMITIDA` y su razon.
- **Verificacion de integridad** (misma ruta que la reconstruccion) — las seis comprobaciones de
  `trazabilidad-auditoria.md` 5.1, recalculadas desde el evento crudo y no desde lo que la
  aplicacion cree que paso, cada una con veredicto visible. Los huecos de turno se marcan
  **informativos**, no como incumplimiento.
- **Exportacion** — descarga en CSV con los filtros aplicados, por un enlace que entrega un
  `Route Handler`. Avisa que la exportacion queda registrada, y la queda: `BITACORA_EXPORTADA` se
  escribe al momento de la descarga, no antes. **Solo se ofrece en el modo con identificador**, y
  no por comodidad: `BITACORA_EXPORTADA` es un evento, y todo evento se ancla a un agregado
  (`trazabilidad-auditoria.md` 2.1). Una exportacion del rango completo no tendria a que anclarse
  y saldria sin registrarse, que es exactamente el hueco que cerro la seccion 36 de
  `desafios-implementacion.md`.

---

## 8. Estados transversales

| Estado | Tratamiento |
| --- | --- |
| Carga | `loading.tsx` con esqueleto de la forma real, no un giro centrado |
| Vacio | Mensaje concreto + accion sugerida si el rol la permite |
| Error | `error.tsx` con mensaje traducido y boton de reintento |
| Error del layout | `global-error.tsx`, que trae su propio `<html>` |
| 404 | Mensaje neutro. **Sin distinguir "no existe" de "no tienes acceso"** (R-01) |
| Sin sesion | Redireccion a Okta, conservando el destino |
| Sin permiso | Mensaje claro, sin revelar la existencia del recurso |
| Fuera de linea | Aviso; la accion no se encola ni se reintenta sola |

**Donde vive cada uno, y por que no en todas partes:**

- **`error.tsx` y `global-error.tsx` son unicos, en la raiz**, y cubren todo lo que cuelga de
  ella. Un boundary por pantalla repetiria el mismo marcado sin decir nada distinto.
- **`loading.tsx` va solo donde la espera es real y la forma es estable**: el catalogo y el
  detalle de convocatoria, `/mis-solicitudes`, el catalogo de vehiculos y la bitacora. Uno en la
  raiz seria imposible: el esqueleto tiene que tener *la forma de lo que viene*, y esa forma
  cambia por pantalla. El componente `Esqueleto` trae las dos que hacen falta —tabla y rejilla— y
  se detiene con `prefers-reduced-motion`.

**Un error boundary de Next es forzosamente un componente cliente**, asi que no puede leer el
header `x-lang` como las paginas. El idioma se toma del `lang` del documento, que el layout de
servidor ya escribio — el mismo valor, no una segunda resolucion. `global-error.tsx` es la
excepcion: sustituye al layout entero, asi que cae al idioma por omision y no usa componentes de
Eden, porque apoyarse en el layout que acaba de fallar seria apostar a lo unico que ya se rompio.

**Ningun boundary muestra `error.message`.** Puede llevar nombres de tabla, claves o fragmentos
de consulta. Se muestra el `digest`, que es lo unico que ata la pantalla con la traza del
servidor sin filtrar nada.

---

## 9. Diccionarios

`src/dictionaries/es.json` es la referencia; `en.json` se mantiene en paralelo. Idioma por
defecto `es`.

Claves por familia: `estatusConvocatoria.*`, `estatusVehiculo.*`, `estatusLote.*`,
`estatusSolicitud.*`, `tipoConvocatoria.*`, `rol.*`, `error.*`, `evento.*`, `accion.*`.

Ejemplos: `CANCELADA_POR_VENCIMIENTO` → "Cancelada por vencimiento del plazo";
`EN_VERIFICACION` → "En verificacion de pago"; `NO_ADJUDICADA` → "No adjudicada".

**Un test recorre cada ENUM y falla si le falta traduccion.** Es lo que impide que un estado
nuevo llegue crudo a la pantalla.

---

## 10. Accesibilidad

- `axe` sin violaciones en todo componente (`genericTests`).
- Navegacion completa por teclado; foco visible.
- Contraste AA como minimo.
- Las cuentas regresivas usan `aria-live="polite"` — no `assertive`, que interrumpiria al lector
  de pantalla cada segundo.
- Las fotografias llevan texto alternativo derivado de marca, version y descripcion.
- El estado nunca se comunica **solo** por color: `Badge` siempre lleva texto.
