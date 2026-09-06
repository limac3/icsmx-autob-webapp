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
`eden-tool-modal`, `eden-media-thumbnail-gallery`, `eden-progress-stepper`,
`eden-contextual-menu`, `eden-workforce-header`, `eden-workforce-footer`, `eden-fonts`,
`eden-normalize`.

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

**Navegacion por permiso.** Solo se muestran las secciones que el usuario puede usar:

| Permiso | Secciones |
| --- | --- |
| `Autob_Venta_a_empleados`, `Autob_Venta_en_general` | Convocatorias · Mis solicitudes |
| `Autob_Administrar_Vehiculos`, `Autob_Administrar_Convocatorias` | Vehiculos · Convocatorias (admin) |
| `Autob_Aprobar_Convocatorias` | Por aprobar |
| `Autob_Operar_Tesoreria` | Verificacion de pagos |
| `Autob_Auditar` | Auditoria |

Con varios permisos, se muestran todas las secciones que correspondan. Ocultar una seccion es
solo cortesia: el servidor vuelve a decidir en cada action y en cada pagina.

En movil la navegacion colapsa; el destino mas usado de cada rol queda accesible en un toque.

---

## 3. Pantallas de participante

### 3.1 `/convocatorias` — Listado

**Datos:** `ConvocatoriaListadoDTO[]` con gating triple aplicado en la consulta (R-01).

**Movil:** una tarjeta por convocatoria. **Escritorio:** `eden-table`.

Cada elemento muestra: titulo, `Badge` de tipo, cantidad de vehiculos, y el dato temporal mas
relevante segun el momento:

| Momento | Se muestra |
| --- | --- |
| Antes de `inicioVenta` | **"Abre en 2 d 4 h"** — cuenta regresiva |
| Venta abierta | **"Abierta · cierra el 12 sep, 18:00"** |
| Despues de `finVenta` | **"Cerrada"**, atenuada |

> Anteponer el tiempo restante al titulo es deliberado: durante la ventana entre publicacion y
> apertura (R-03), lo unico que el participante quiere saber es **cuando puede actuar**.

**Cuenta regresiva:** el valor inicial lo calcula el servidor y el cliente solo decrementa.
Jamas se compara contra `Date.now()` del navegador para decidir si la venta abrio (R-04) — un
reloj adelantado habilitaria el boton antes de tiempo. Al llegar a cero se **revalida contra el
servidor**, no se habilita nada localmente.

**Vacio:** "No hay convocatorias disponibles en este momento." Sin insinuar que existan otras
ocultas.

### 3.2 `/convocatorias/[id]` — Detalle

**Datos:** `ConvocatoriaDetalleDTO`. Si no pasa el gating triple → **404** (R-01).

Encabezado con titulo, tipo, descripcion de participacion, fechas y horas de liquidacion. Aviso
`Alert` con el estado de la venta.

Rejilla de lotes: fotografia principal, marca/version/modelo, kilometraje, precio, `Badge` de
estatus y `tamanoFila` (**"3 en fila"** — cantidad, jamas identidades).

Una columna en movil, dos o tres en escritorio.

### 3.3 `/convocatorias/[id]/lotes/[loteId]` — Detalle del lote

La pantalla mas importante para el participante.

**Datos:** `LoteDetalleDTO`, con `MiLugarDTO | null`.

**Estructura (movil, de arriba abajo):**

1. **Galeria** — `eden-media-thumbnail-gallery` con URLs firmadas en SSR (regla 13).
2. **Identificacion** — marca, version, modelo, precio destacado.
3. **Bloque de accion** — seccion 3.4. En escritorio queda fijo en columna derecha; en movil, en
   una barra inferior adherida, para que el boton este siempre al alcance del pulgar.
4. **Ficha tecnica** — `eden-accordion`: equipamiento, especificacion mecanica, condiciones
   mecanicas, detalles esteticos, kilometraje.

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
pierda un vehiculo por olvido.

### 3.6 Subir comprobante

`ToolModal` desde el bloque de accion. Arrastrar o seleccionar; JPG, PNG o PDF hasta 10 MB.
Vista previa antes de confirmar, con aviso de que el archivo sera revisado por tesoreria.

Validacion de tipo y tamano en cliente **y** en servidor. La del cliente es cortesia.

---

## 4. Pantallas de administracion

### 4.1 `/admin/vehiculos`

Tabla en escritorio, tarjetas en movil. Columnas: fotografia, marca/version/modelo,
kilometraje, `Badge` de estatus, convocatoria activa si la tiene.

Filtros por estatus y busqueda por marca o version. Acciones por fila en
`eden-contextual-menu`.

### 4.2 `/admin/vehiculos/nuevo` y `/[id]/editar`

Formulario con `eden-form-parts`, en secciones: identificacion, especificacion, condicion,
fotografias.

**Gestion de fotografias:** subida, reordenamiento, marcar principal, eliminar. La principal se
distingue con un `Badge`. **No se puede eliminar la ultima** — el boton se deshabilita con
explicacion, y el servidor lo vuelve a comprobar.

> **El reordenamiento tiene dos caminos, y el principal son los botones de mover arriba/abajo.**
> El arrastre solo funciona con raton: no es alcanzable con teclado ni con lector de pantalla, y
> en un telefono compite con el desplazamiento de la pagina. Los botones cubren los tres casos y
> pasan axe; el arrastre se implemento **encima** de ellos, como atajo para quien usa raton, y
> por eso los botones no se ocultan cuando hay arrastre disponible.
>
> El arrastre no lleva semantica ARIA —`aria-grabbed` esta obsoleto y ningun lector lo anuncia—,
> asi que solo aporta senal visual: opacidad en el que se mueve y contorno en el destino. Los dos
> caminos calculan el nuevo orden con la **misma** funcion, para que soltar en la cuarta posicion
> deje la galeria igual que pulsar "abajo" hasta llegar a ella.

Un vehiculo `RESERVADO` o `VENDIDO` se muestra en solo lectura, con aviso del motivo.

### 4.3 `/admin/convocatorias`

Listado con `eden-tabs` por estatus: Borrador · En aprobacion · Aprobadas · Publicadas ·
Concluidas · Ocultas.

`eden-progress-stepper` para el avance del ciclo: Borrador → En aprobacion → Aprobada →
Publicada → Concluida.

### 4.4 `/admin/convocatorias/nueva` y `/[id]/editar`

Formulario: tipo (`Radio`), titulo, descripcion (`TextArea` o editor enriquecido), y las tres
fechas con hora, **etiquetadas explicitamente en hora de Ciudad de Mexico**.

Validacion en vivo de R-14 (`publicadaEn <= inicioVenta < finVenta`), con el error junto al
campo culpable, no en un aviso general.

**Inclusion de vehiculos:** selector de vehiculos `DISPONIBLE` con precio por lote. Solo
editable en `BORRADOR`; en cualquier otro estatus, solo lectura con el motivo visible.

Si `incluirVehiculo` devuelve `conflicto_concurrencia`: "Este vehiculo fue incluido en otra
convocatoria." + recarga de la lista.

**Enviar a aprobacion** pide confirmacion e indica que la convocatoria dejara de ser editable.

### 4.5 `/admin/convocatorias/[id]/lotes/[loteId]/fila`

Vista administrativa del lote: estatus, adjudicacion vigente, `venceEn`, `tamanoFila`.

> **No muestra la fila completa ni identidades.** `fila:ver-completa` es exclusiva del auditor
> (`permission-matrix.md`, seccion 4). El administrador ve agregados; quien configura la venta
> no conoce el orden.

---

## 5. Aprobador — `/aprobaciones`

Bandeja de convocatorias en `EN_APROBACION`, con antiguedad de la solicitud.

Vista de dictamen: todos los datos, la lista de lotes con sus vehiculos y fotografias, y quien
la creo. Dos acciones: **Aprobar** (confirmacion) y **Rechazar** (motivo obligatorio,
`TextArea`; el boton permanece deshabilitado mientras este vacio).

Si es el creador, ambos botones se ocultan y se muestra: "No puedes aprobar una convocatoria que
tu creaste." La validacion real esta en el servidor (R-05).

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

## 7. Auditor — `/auditoria`

Solo lectura, sin un solo boton de mutacion.

- **Bitacora** — cronologica, filtrable por convocatoria, lote, participante, tipo de evento y
  rango de fechas. Cada evento: fecha en hora de negocio, tipo traducido, actor con sus roles de
  entonces, motivo y `correlacionId`. Los eventos de un mismo `correlacionId` se agrupan
  visualmente: hacen visible la causalidad.
- **Reconstruccion de fila** (`/auditoria/lotes/[loteId]`) — linea de tiempo con todas las
  solicitudes en orden de turno, sus estados y las adjudicaciones. **Aqui si se muestran
  identidades.** Todo salto de turno aparece con su `SOLICITUD_OMITIDA` y su razon.
- **Verificacion de integridad** — las seis comprobaciones de `trazabilidad-auditoria.md` 5.1,
  cada una con veredicto visible. Los huecos de turno se marcan **informativos**, no como
  incumplimiento, con nota explicativa.
- **Exportacion** — descarga con los filtros aplicados. Avisa que la exportacion queda
  registrada.

---

## 8. Estados transversales

| Estado | Tratamiento |
| --- | --- |
| Carga | `loading.tsx` con esqueleto de la forma real, no un giro centrado |
| Vacio | Mensaje concreto + accion sugerida si el rol la permite |
| Error | `error.tsx` con mensaje traducido y boton de reintento |
| 404 | Mensaje neutro. **Sin distinguir "no existe" de "no tienes acceso"** (R-01) |
| Sin sesion | Redireccion a Okta, conservando el destino |
| Sin permiso | Mensaje claro, sin revelar la existencia del recurso |
| Fuera de linea | Aviso; la accion no se encola ni se reintenta sola |

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
