# Contratos — Server Actions y Route Handlers

Firma de cada operacion: entrada, salida, permiso exigido, errores y eventos de auditoria que
emite.

Los permisos se validan contra `permission-matrix.md`; los eventos estan definidos en
`trazabilidad-auditoria.md`; las transacciones, en `modelo-datos-dynamodb.md`.

---

## 1. Convenciones

Todas las actions devuelven:

```ts
type Resultado<T> =
  | { ok: true; data: T }
  | { ok: false; error: CodigoError; detalles?: Record<string, string> };
```

**Nunca lanzan.** Todas ejecutan, en este orden: `getSession()` → `puedeEjecutar()` → servicio →
invalidacion de cache.

> **La invalidacion es `updateTag`, no `revalidateTag`.** En Next.js 16 `revalidateTag` exige un
> perfil de `cacheLife` y **programa** la expiracion; la que caduca de inmediato, con semantica de
> leer lo que uno acaba de escribir, es `updateTag`. Con la otra, quien guarda un cambio ve sus
> propios datos viejos al volver al listado. Ver `desafios-implementacion.md` seccion 18.
>
> Las etiquetas se construyen en `src/lib/cache.ts`, nunca a mano.

Reglas transversales:

- **El actor sale de la sesion, nunca del input.** Ninguna action acepta `participanteId` como
  parametro: permitiria actuar en nombre de otro.
- `validation_failed` acompana `detalles` con el error por campo.
- Las fechas entran y salen en **ISO-8601 UTC**.
- Errores omnipresentes: `unauthorized`, `forbidden`, `not_found`, `dependencia_no_disponible`.
  Las tablas listan solo los **especificos** de cada operacion.

---

## 2. `src/app/actions/vehiculos.ts`

| Action | Entrada | Salida | Permiso | Errores | Eventos |
| --- | --- | --- | --- | --- | --- |
| `crearVehiculo` | `DatosVehiculo` | `{ vehiculoId }` | `vehiculo:crear` | `validation_failed` | `VEHICULO_REGISTRADO` |
| `editarVehiculo` | `{ vehiculoId, cambios }` | `{ vehiculoId }` | `vehiculo:editar` | `validation_failed`, `invalid_state` | `VEHICULO_EDITADO` |
| `retirarVehiculo` | `{ vehiculoId, motivo }` | `{ vehiculoId }` | `vehiculo:retirar` | `invalid_state` | `VEHICULO_RETIRADO` |
| `agregarFotografia` | `{ vehiculoId, archivo, esPrincipal, descripcion }` | `{ fotoId }` | `vehiculo:subir-fotografia` | `validation_failed`, `invalid_state` | `VEHICULO_FOTOGRAFIA_AGREGADA` |
| `eliminarFotografia` | `{ vehiculoId, fotoId }` | `{ fotoId }` | `vehiculo:eliminar-fotografia` | `invalid_state` | `VEHICULO_FOTOGRAFIA_ELIMINADA` |
| `reordenarFotografias` | `{ vehiculoId, ordenFotoIds }` | `{ vehiculoId }` | `vehiculo:subir-fotografia` | `validation_failed`, `invalid_state` | `VEHICULO_EDITADO` |
| `editarDescripcionFotografia` | `{ vehiculoId, fotoId, descripcion? }` | `{ fotoId }` | `vehiculo:subir-fotografia` | `validation_failed`, `not_found`, `invalid_state` | `VEHICULO_EDITADO` |

`DatosVehiculo`: `numeroEconomico`, `numeroDeSerie`, `marca`, `version`, `modelo` (anio),
`nivelEquipamiento`, `especificacionMecanica`, `condicionesMecanicas`, `detallesEsteticos`,
`kilometraje`.

**Validaciones:** `modelo` entre 1950 y el anio siguiente al actual; `kilometraje >= 0`;
`marca` y `version` no vacias. `numeroEconomico` y `numeroDeSerie` no vacios, hasta 40 caracteres
y con alfabeto de **lista blanca** (`A-Z`, `0-9`, `-`, `_`, `/`) — el valor entra en la clave de su
centinela de unicidad, asi que un `#` desplazaria el separador. Se guardan recortados y en
mayusculas.

**Los dos son unicos, y la unicidad la decide DynamoDB.** `crearVehiculo` y `editarVehiculo`
devuelven `validation_failed` con `detalles: { numeroEconomico: "duplicado" }` —o `numeroDeSerie`—
segun cual de los dos centinelas cancelo la transaccion. No es `conflicto_concurrencia`: un numero
repetido **es** un dato mal capturado y hay que corregirlo, no reintentarlo con el mismo valor.

Fotografia: tipo `image/jpeg|png|webp|avif`, maximo 10 MB, **nombre de archivo generado en servidor** —
nunca el del cliente. `descripcion` opcional, hasta **120 caracteres** (`LIMITES` de
`src/lib/domain/vehiculos.ts`), recortada antes de medir.

**La entrada y la salida son cosas distintas.** Lo que se acepta es lo de arriba; lo que se guarda
son **tres variantes WebP** de 480 / 1280 / 2048 px de ancho, y el original se descarta (seccion
5.4 de `estrategia-aplicacion.md`). El `contentType` que llega —que viene de `File.type`, o sea del
navegador— se **compara** con el formato real que dice el decodificador, y la discrepancia se
rechaza; no basta confiar en lo detectado.

Dos rechazos nuevos, los dos `validation_failed` con `detalles`:

| `detalles` | Cuando | Que dice al operador |
| --- | --- | --- |
| `{ archivo: "no_decodificable" }` | El archivo no es una imagen que se pueda abrir, o esta corrupto | Incluye la instruccion concreta para HEIC de iPhone: Ajustes › Camara › Formatos › Mas compatible |
| `{ archivo: "tipo_no_coincide" }` | El tipo declarado no es el formato real | El archivo no es lo que dice ser |

**AVIF si, HEIC no**, y la diferencia no es arbitraria. `sharp.format.heif.input.fileSuffix` es
`[".avif"]`: el lector HEIF de esta libvips **decodifica AVIF** —comprobado ejecutandolo, y hay
prueba— pero no HEIC, porque no trae decodificador HEVC. Aceptar HEIC exigiria compilar libvips a
mano con libde265, con las implicaciones de patentes que los propios typings de sharp senalan. En
la practica puede que HEIC no llegue nunca: iOS Safari lo convierte a JPEG cuando el `accept`
lista `image/jpeg`, que ya es el caso.

> **AVIF se agrego despues de la Etapa 17**, cuando una tanda entera se rechazo por un `.avif` que
> el operador ni sabia que lo era. Estaba fuera porque nadie lo habia pedido, no porque no se
> pudiera. Detalle que importa a quien toque `normalizarImagen`: un AVIF se **detecta** como
> `heif`, no como `avif`, asi que en `FORMATO_ESPERADO` la equivalencia es
> `"image/avif" -> "heif"`. Con `"avif"` ahi, todos los AVIF se rechazarian con `tipo_no_coincide`
> (`desafios-implementacion.md` 89).

La lista blanca vive en `src/lib/domain/vehiculos.ts` y no en el modulo de almacenamiento, que es
`server-only`: **la pantalla aplica la misma lista antes de subir nada**. Es una comodidad, no una
frontera —el servidor sigue validando cada archivo— pero evita que una tanda se detenga a la mitad
con las anteriores ya escritas.

`editarDescripcionFotografia` **se agrego con el tope de 120**. La fotografia en si no es editable
—se borra, no se reemplaza (regla de inmutabilidad de la seccion 5.4)—, pero el pie si: hasta
ahora solo se podia fijar al subir, y corregir una errata obligaba a borrar la foto y volver a
subirla. Tres comportamientos que no se deducen de la tabla:

- **Sin evento si no hubo cambio.** Descripcion nueva igual a la vigente devuelve exito y no
  escribe nada. Mismo criterio que `marcarFotografiaPrincipal`: una bitacora que registra actos sin
  efecto entrena a quien la lee a ignorarla.
- **Vaciarla quita el atributo**, no guarda cadena vacia, y en el evento el valor nuevo queda en
  `null` — `null` dice "se quito"; un campo ausente diria "no se sabe".
- **`not_found` se decide contra la galeria leida**, antes de escribir: un `fotoId` que no es de
  este vehiculo no llega a DynamoDB.

Exige el permiso de subida y **no uno nuevo**: editar el pie es gestion de galeria, igual que
reordenar o marcar la principal. Un permiso propio para "cambiar un pie de foto" fragmentaria una
capacidad que en la practica se concede junta (regla 17).

`eliminarFotografia` rechaza con `invalid_state` si dejaria al vehiculo sin fotografia
principal. En la practica eso significa **la ultima**: al borrar la principal teniendo otras, la
siguiente por orden hereda la condicion dentro de la misma transaccion.

`agregarFotografia` marca como principal la **primera** fotografia aunque no se pida: un vehiculo
con galeria y sin principal no se puede representar en el listado. Siempre la coloca **al final**;
poner una fotografia nueva en otra posicion es subirla y reordenar, dos mutaciones desde la
pantalla.

**Recibe un archivo por llamada, y eso no cambia con la subida multiple.** La pantalla permite
elegir varias fotografias de un tiro, y las manda en **una peticion por fotografia, en serie**. No
hay action de lote y es deliberado:

- el tope de `bodySizeLimit` se aplica **por fotografia**, que es para lo que se dimensiono — una
  sola peticion con varias no cabria: dos archivos de 8 MB ya son 16 MB;
- cada alta conserva su propia transaccion y su propio evento (regla 4), en vez de un evento de
  lote que habria que inventar;
- un fallo a la mitad deja las anteriores subidas y visibles, no todo perdido; el proceso se
  detiene ahi y no reordena.

Lo que la pantalla agrega encima, y **no** es una frontera del servidor: el tope de 10 MB aplicado
a la **suma** de la tanda, y el aviso cuando la tanda pasaria del maximo de 20 por vehiculo. Las
dos son guardas de interfaz para no empezar un trabajo que fallaria a la mitad; el servidor sigue
validando lo suyo por archivo y por llamada.

**`reordenarFotografias` designa la principal**, y por eso gana `invalid_state`: actualiza
`fotografiaPrincipalId` a la fotografia que quede **primera**, en la misma transaccion, con la
condicion de estatus del vehiculo. Solo escribe el item del vehiculo si la cabeza cambia.

> **`marcarFotografiaPrincipal` existio y se retiro.** Se agrego en la Etapa 5 porque el contrato
> solo permitia fijar la principal al subirla. La Etapa 17 la elimino al cambiar la pantalla 4.2 a
> un solo campo de posicion: con "la 1 es la principal", una action que apunte el puntero a otra
> fotografia es **la unica forma de romper ese invariante** — dejaria el listado mostrando una que
> no esta primero, hasta el siguiente reordenamiento, que la devolveria a su sitio sin que nadie
> entienda por que. Designar es ahora mover al frente. **Sin cambios en `permission-matrix.md`**:
> usaba el permiso de subida, que sigue existiendo para las demas operaciones de galeria.

### 2.1 Adaptador de formulario

Ademas de las actions tipadas, el modulo exporta **una** envoltura con la firma
`(estadoPrevio, formData)` que exige `useActionState`:

| Adaptador | Delega en |
| --- | --- |
| `guardarVehiculoDesdeFormulario` | `crearVehiculo` o `editarVehiculo`, segun venga `vehiculoId` |

Existe para que el formulario **funcione sin JavaScript**. Se mantiene separado de las actions
tipadas a proposito: un `FormData` es un saco de cadenas sin tipo, y dejarlo llegar hasta el
servicio convertiria cada conversion en una oportunidad de equivocarse en silencio. Un campo
numerico vacio se convierte en `NaN` y no en `0` — `Number("")` vale cero, y un kilometraje sin
capturar se guardaria como cero kilometros, que es un dato falso y plausible.

> **Eran dos, y `retirarVehiculoDesdeFormulario` se retiro.** El operador pidio que el retiro se
> confirme en un modal con el motivo dentro (`ui-ux-requerimientos.md` 4.2), y un modal es un
> control del cliente: no hay forma de exigir la confirmacion y a la vez conservar el envio por
> `<form>` puro. `RetirarVehiculo` llama directo a `retirarVehiculo`. **El retiro pasa a depender
> de JavaScript**, y lo que se pierde es solo el camino degradado: permiso, estado y motivo se
> siguen comprobando en el servidor. Una prueba fija la decision, para que nadie reintroduzca dos
> caminos para la misma mutacion sin darse cuenta.

---

## 3. `src/app/actions/convocatorias.ts`

| Action | Entrada | Salida | Permiso | Errores | Eventos |
| --- | --- | --- | --- | --- | --- |
| `crearConvocatoria` | `DatosConvocatoria` | `{ convocatoriaId }` | `convocatoria:crear` | `validation_failed` | `CONVOCATORIA_CREADA` |
| `editarConvocatoria` | `{ convocatoriaId, cambios }` | `{ convocatoriaId }` | `convocatoria:editar` | `validation_failed`, `invalid_state` | `CONVOCATORIA_EDITADA` |
| `incluirVehiculo` | `{ convocatoriaId, vehiculoId, precio }` | `{ loteId }` | `convocatoria:incluir-vehiculo` | `validation_failed`, `invalid_state` | `VEHICULO_INCLUIDO` |
| `retirarVehiculoDeConvocatoria` | `{ convocatoriaId, loteId, motivo }` | `{ loteId }` | `convocatoria:retirar-vehiculo` | `invalid_state` | `VEHICULO_RETIRADO_DE_CONVOCATORIA` |
| `enviarAAprobacion` | `{ convocatoriaId }` | `{ estatus }` | `convocatoria:enviar-a-aprobacion` | `invalid_state`, `validation_failed` | `CONVOCATORIA_ENVIADA_A_APROBACION` |
| `aprobarConvocatoria` | `{ convocatoriaId }` | `{ estatus }` | `convocatoria:aprobar` | `invalid_state`, `forbidden` (auto-aprobacion) | `CONVOCATORIA_APROBADA` |
| `rechazarConvocatoria` | `{ convocatoriaId, motivo }` | `{ estatus }` | `convocatoria:rechazar` | `invalid_state`, `validation_failed` | `CONVOCATORIA_RECHAZADA` |
| `publicarConvocatoria` | `{ convocatoriaId }` | `{ estatus }` | `convocatoria:publicar` | `invalid_state` | `CONVOCATORIA_PUBLICADA` |
| `ocultarConvocatoria` | `{ convocatoriaId, motivo }` | `{ estatus }` | `convocatoria:ocultar` | `invalid_state` | `CONVOCATORIA_OCULTA` |
| `reactivarConvocatoria` | `{ convocatoriaId }` | `{ estatus }` | `convocatoria:reactivar` | `invalid_state` | `CONVOCATORIA_REACTIVADA` |
| `concluirConvocatoria` | `{ convocatoriaId }` | `{ estatus, vendidos, noVendidos, filasCerradas, comprometidos }` | `convocatoria:concluir` | `invalid_state` | `CONVOCATORIA_CONCLUIDA` |

`DatosConvocatoria`: `folio`, `nombre`, `tipo` (`EMPLEADOS` \| `PUBLICO_GENERAL`),
`descripcionParticipacion`, `publicadaEn`, `inicioVenta`, `finVenta`, `horasLiquidacion`.

> **Corregido en la Etapa 11.2.** Este contrato prometia `titulo` y `descripcion` desde la Etapa 0
> y el codigo nunca tuvo ninguno de los dos: tenia `descripcionParticipacion`. La divergencia se
> cierra aqui y no renombrando el campo del codigo — `descripcionParticipacion` dice de que habla
> ese texto, que es HTML del editor enriquecido y lo lee todo participante. Lo que si hacia falta
> de `titulo` es `nombre`: una cadena corta con la que reconocerla en pantalla.

**Validaciones (R-14):** `publicadaEn <= inicioVenta < finVenta` y `horasLiquidacion > 0`. Se
comprueban al crear, al editar y de nuevo al enviar a aprobacion.

`folio` sigue las mismas reglas que los numeros del vehiculo —no vacio, hasta 40 caracteres, lista
blanca, mayusculas— y es **unico**: un repetido vuelve como `validation_failed` con
`detalles: { folio: "duplicado" }`. `nombre` es obligatorio, hasta 80 caracteres, y **no** unico.

**Notas de contrato:**

- `incluirVehiculo` devuelve `invalid_state` cuando el vehiculo ya esta en otra convocatoria
  activa (falla el centinela de R-10), con `detalles: { vehiculo: "en_otra_convocatoria" }`. El
  detalle hace falta porque tres de las cinco condiciones de la transaccion devuelven el mismo
  codigo, y la UI no podria distinguir "elige otro vehiculo" de "la convocatoria dejo de ser
  editable". Se identifica por la **posicion del item que cancelo**: el centinela es el primero.
  El precio invalido llega como `validation_failed` con `detalles.precio`.
- `aprobarConvocatoria` devuelve `forbidden` si el aprobador es el creador (R-05), **incluso
  teniendo ambos permisos**.
- `ocultarConvocatoria` devuelve `invalid_state` si existe cualquier solicitud (R-06).
- `concluirConvocatoria` pasa las solicitudes `EN_FILA` y `CONGELADA` a `NO_ADJUDICADA`, pero
  **respeta las adjudicaciones vigentes** con su plazo intacto (R-18). Esas quedan contadas en
  `comprometidos` e inscritas como trabajo pendiente: si su compromiso se cae despues, el barrido
  cierra el lote y devuelve el vehiculo al catalogo (R-11b). **No hay accion para eso ni la
  necesita** — no es una decision de nadie, es la conclusion terminando de aplicarse.

### 3.1 Adaptadores de formulario

| Adaptador | Delega en |
| --- | --- |
| `guardarConvocatoriaDesdeFormulario` | `crearConvocatoria` o `editarConvocatoria`, segun venga `convocatoriaId` |
| `incluirVehiculoDesdeFormulario` | `incluirVehiculo` |
| `retirarLoteDesdeFormulario` | `retirarVehiculoDeConvocatoria` |

Mismo motivo que en vehiculos: los formularios funcionan sin JavaScript y la conversion de
cadenas ocurre en un solo sitio. Dos conversiones cargan con una trampa concreta:

- Cada instante son **dos campos**, `<campo>Fecha` y `<campo>Hora`, porque Eden no tiene un
  control combinado. Se unen y se interpretan en **hora de negocio** (regla 9): sin eso, capturar
  "08:00" desde Tijuana y desde Ciudad de Mexico guardaria dos instantes distintos.
- El precio y las horas de liquidacion vacios se convierten en `NaN` y no en `0`: `Number("")`
  vale cero, y un lote de cero pesos o un plazo de cero horas son datos falsos y plausibles.

---

## 4. `src/app/actions/fila.ts` — el nucleo

| Action | Entrada | Salida | Permiso | Errores | Eventos |
| --- | --- | --- | --- | --- | --- |
| `solicitarCompra` | `{ convocatoriaId, loteId }` | `MiLugarDTO` | `solicitud:crear` | `invalid_state`, `already_in_queue`, `lote_no_disponible`, `conflicto_concurrencia`, `not_found` | `SOLICITUD_CREADA` (+ `LOTE_ADJUDICADO` si adjudica) |
| `cancelarSolicitud` | `{ convocatoriaId, loteId, motivo? }` | `{ estatus }` | `solicitud:cancelar` | `invalid_state`, `not_found` | `SOLICITUD_CANCELADA_POR_PARTICIPANTE` (+ reasignacion) |

> **Dos ajustes de firma al implementar la Etapa 8, y los dos por seguridad.**
>
> **Entra `convocatoriaId`.** La clave de un lote es `CONV#<convocatoriaId> / LOTE#<loteId>`, y
> no hay indice que resuelva un lote suelto. Aceptar el par no abre nada: el servidor lee esa
> pareja y **gatea contra la convocatoria que leyo**, asi que un par inventado no encuentra nada.
>
> **`cancelarSolicitud` no recibe `solicitudId`.** Se parte del centinela de fila
> `LOTE#<loteId> / PART#<participanteId>`, indexado por el participante **de la sesion**: alcanzar
> la solicitud de otro deja de ser una guarda que alguien pueda olvidar y pasa a ser una clave que
> no se puede construir. La guarda `esPropio` se aplica igual, como segunda linea.

**Las lecturas no son actions.** `consultarMiLugar` y `listarMisSolicitudes` viven en
`src/lib/fila/` y las invocan los Server Components directamente, como el resto de las lecturas
de la aplicacion: una action de lectura seria un viaje de ida y vuelta para algo que el servidor
ya tiene en la mano. El permiso se comprueba igual, en la pagina.

| Lectura | Entrada | Salida | Permiso |
| --- | --- | --- | --- |
| `consultarMiLugar` | `{ loteId, participanteId }` | `MiLugarDTO \| null` | `solicitud:ver-mi-lugar` |
| `consultarTamanoFila` | `{ loteId }` | `number` | el de la pantalla que lo muestra |
| `listarMisSolicitudes` | `participanteId` | `{ solicitudes: MiSolicitudDTO[], truncada }` | `solicitud:ver-mis-solicitudes` |

### 4.0 `listarMisSolicitudes` — PA-09, la pantalla 3.5

`participanteId` **lo pasa la pagina desde la sesion**, nunca un parametro de ruta: no hay donde
escribir el identificador de otro.

```ts
type MiSolicitudDTO = {
  solicitudId: string;
  loteId: string;
  convocatoriaId: string;
  convocatoriaFolio: string;
  convocatoriaNombre: string;
  marca: string;            // del vehiculo; vacio si no se pudo leer
  version: string;
  modelo: number;
  precio: number;
  estatus: EstatusSolicitud;
  miTurno: number;          // sin `miPosicion`: costaria dos COUNT por fila
  solicitadoEn: string;
  venceEn?: string;
  plazoVencido?: boolean;   // el plazo paso, la transicion aun no se escribio
  grupo: "REQUIERE_ATENCION" | "ACTIVA" | "HISTORICA";
};
```

> **No lleva `participanteId`, ni el propio.** Todo lo demas es del titular, asi que R-12 no
> restringe nada —la regla protege la identidad de *terceros*—; el identificador se omite para
> que a nadie se le ocurra pasarlo como parametro.

**Esta lectura no resuelve vencimientos, al contrario que `consultarMiLugar`.** Aquella aplica la
verificacion perezosa de D-7 sobre **un** lote; aqui serian N escrituras condicionales
disparadas por una lista, y un tercer camino de escritura del vencimiento donde D-7 define dos.
Lo que hace es comparar `venceEn` contra el reloj del servidor y reportarlo en `plazoVencido`,
sin afirmar que la solicitud ya esta cancelada.

**`ScanIndexForward: false` es de correccion, no de presentacion.** `GSI3SK` es
`SOL#<solicitadoEn>#<loteId>`: ascendente con `Limit` devolveria las mas viejas y dejaria fuera
justo las que pueden tener un plazo corriendo. `truncada` avisa cuando se alcanzo el tope.

### 4.1 `MiLugarDTO` — la proyeccion mas delicada del sistema

```ts
type MiLugarDTO = {
  solicitudId: string;
  loteId: string;
  miTurno: number;       // asignado por el servidor, inmutable
  miPosicion: number;    // cuantos vivos tienen turno menor, mas uno
  tamanoFila: number;    // solicitudes vivas del lote
  estatus: EstatusSolicitud;
  venceEn?: string;      // solo si esta ADJUDICADA
};
```

> **Este tipo es exhaustivo, no ilustrativo.** No contiene `participanteId` ni ningun dato de
> terceros, y no debe crecer con ninguno (R-12). Debe existir un test que falle si la
> serializacion incluye `participanteId`, `correo` o `nombre`.
>
> `tamanoFila` y `miPosicion` se calculan con `Select: COUNT` — los items de otros participantes
> nunca salen de DynamoDB. La privacidad es estructural, no una omision al serializar.

`consultarMiLugar` devuelve `null` si el participante no esta en esa fila. **No es un error**:
es la respuesta normal para quien todavia no ha solicitado.

> **Desde la Etapa 10, `consultarMiLugar` puede mutar.** Es la verificacion perezosa del
> vencimiento (D-7, `arquitectura-tecnica-aws.md` 4.4): si la solicitud propia esta `ADJUDICADA`
> y su `venceEn` ya paso, aplica T5 (`vencerYReasignar`) antes de construir el DTO y devuelve el
> estado **posterior** a esa resolucion. Sigue siendo una lectura en el sentido de la seccion —no
> hay una Server Action que la dispare, y el permiso que la protege no cambia—, pero puede
> escribir `SOLICITUD_VENCIDA`, `LOTE_ADJUDICADO` y el encolado del correo como efecto de
> consultar el propio lugar. Es inofensivo si compite con el barrido: la transaccion es
> condicional y quien llega segundo no hace nada.

### 4.2 Comportamiento de `solicitarCompra`

0. **Cuenta el intento contra la limitacion de tasa del participante** y lo rechaza con
   `limite_de_tasa` si excede el umbral (Etapa 16). Va antes de leer la convocatoria: un intento
   estrangulado no cuesta ni una lectura ni un turno.
1. Verifica el gating triple y que la venta este abierta.
2. Escribe la **reserva del turno**, antes de consumirlo (R18).
3. Consume un turno del contador atomico del lote.
4. Escribe solicitud, centinela y evento en una transaccion, que ademas borra la reserva.
5. **Intenta adjudicar siempre** (T2), no solo si el lote parecia libre. La adjudicacion se
   abstiene por si sola mientras haya turnos en vuelo, y quien aterrice ultimo cierra la ronda.
   El primero de la fila recibe su `MiLugarDTO` ya en estado `ADJUDICADA`, sin esperar a ningun
   proceso.

**Un lote `ADJUDICADO` sigue aceptando solicitudes** mientras la venta este abierta: quien se
forma despues ocupa su lugar en la fila y recibe el vehiculo si al adjudicado se le vence el
plazo (R-15, R-17).

Errores especificos:

| Codigo | Cuando |
| --- | --- |
| `already_in_queue` | Ya tiene una solicitud viva en el lote (R-07) |
| `lote_no_disponible` | El lote esta `VENDIDO`, `NO_VENDIDO` o `RETIRADO` |
| `invalid_state` | La venta no ha abierto o ya cerro |
| `not_found` | El lote no existe **o** no pasa el gating triple (R-01) |
| `conflicto_concurrencia` | La reserva del turno se dio por muerta antes de completarse. Es reintentable: la UI vuelve a solicitar y obtiene un turno nuevo |
| `limite_de_tasa` | Mas de `INTENTOS_POR_VENTANA` intentos del mismo participante en la misma convocatoria dentro de una ventana de diez segundos (Etapa 16). Reintentable como el anterior, y **no consumio turno**: el rechazo ocurre antes del contador |

**`limite_de_tasa` no lo puede producir la pantalla.** `BloqueDeAccionDeLote` deshabilita el boton
antes de la apertura y mientras hay una peticion en vuelo, asi que por la interfaz no cabe mas de
un intento por viaje de red. Quien lo reciba esta llamando a la action por fuera.

### 4.3 `cancelarSolicitud`

Si la solicitud estaba `ADJUDICADA`, cancelar **libera el lote y dispara la reasignacion al
siguiente turno vivo** en el mismo acto. Si estaba `CONGELADA` o `EN_FILA`, solo la retira.

En modalidad `MANUAL` la liberacion ocurre igual pero **no hay reasignacion**: el lote vuelve a la
bandeja del adjudicador (R-23).

---

## 4.4 `src/app/actions/adjudicacion.ts` — modalidad manual

| Action | Entrada | Salida | Permiso | Errores | Eventos |
| --- | --- | --- | --- | --- | --- |
| `adjudicarManualmente` | `{ convocatoriaId, loteId, turno, motivo }` | `AdjudicacionManual` | `Autob_Adjudicar_Convocatorias` | `unauthorized`, `not_found`, `forbidden`, `invalid_state`, `validation_failed`, `lote_no_disponible`, **`limite_alcanzado`**, `conflicto_concurrencia` | `LOTE_ADJUDICADO` con `motivoAdjudicacion = DECISION_MANUAL` |

**`turno` viene del cliente, y eso es correcto aqui**, al contrario que el identificador del actor:
es la eleccion del adjudicador, el dato que esta action existe para recibir. Lo que jamas viene del
cliente es **quien** eligio.

**No reusa el `conLote` de `fila.ts`.** Aquel resuelve el gating triple porque sirve a un
participante; el adjudicador no participa, asi que exigirle un permiso de venta lo dejaria fuera
de las convocatorias que tiene que dictaminar.

**`limite_alcanzado` es un desenlace normal, no un fallo del sistema**: el elegido agoto su cupo
(R-09). La accion falla y la pantalla lo explica; el servidor **no** elige a otro por su cuenta.

Lecturas asociadas, en Server Components y no como actions: `leerFilaParaAdjudicar`, que devuelve
la fila **con identidades** mas el cruce de las otras solicitudes del participante en esa
convocatoria.

---

## 5. `src/app/actions/tesoreria.ts`

| Action | Entrada | Salida | Permiso | Errores | Eventos |
| --- | --- | --- | --- | --- | --- |
| `subirComprobante` | `{ solicitudId, archivo }` | `{ estatus }` | `comprobante:subir` | `validation_failed`, `invalid_state`, `plazo_vencido`, `not_owner` | `COMPROBANTE_CARGADO` |
| `avalarPago` | `{ solicitudId, nota? }` | `{ estatus }` | `pago:avalar` | `invalid_state` | `PAGO_AVALADO` |
| `rechazarPago` | `{ solicitudId, motivo }` | `{ estatus }` | `pago:rechazar` | `invalid_state`, `validation_failed` | `PAGO_RECHAZADO` (+ reasignacion) |
| `listarPendientesVerificacion` | `{}` | `PendienteDTO[]` | `tesoreria:ver-bandeja` | — | — |

**`subirComprobante`:** solo el titular, solo desde `ADJUDICADA`, solo dentro del plazo. Archivo
`image/jpeg|png` o `application/pdf`, maximo 10 MB. Devuelve `plazo_vencido` — distinto de
`invalid_state` — para poder explicarle al participante exactamente que paso.

Al tener exito, **se detiene el reloj**: se retiran las claves GSI4 y tesoreria ya no puede
vencerlo por demora propia.

**`rechazarPago`** exige motivo no vacio (R-16) y libera el lote como un vencimiento.

**`avalarPago` separa el desenlace de la venta del desenlace del cierre de fila.** La action
devuelve `{ estatus }`, pero el servicio devuelve ademas
`cierre: { ok: true, cerradas } | { ok: false, error }`. La venta se confirma en su propia
transaccion y el cierre de las solicitudes restantes ocurre **fuera** de ella (son una cantidad no
acotada, T4), asi que puede fallar con la venta ya firme.

En ese caso la venta **no se revierte** —es correcto que no se revierta— y pasan tres cosas: el
resultado lo delata en `cierre.ok`, queda una linea de registro operativo
(`operacion: "cerrarFilaDelLote"`, nivel `warn`) y **el barrido lo repara en la corrida siguiente**.
Antes el error se convertia en `cerradas: 0` y salia como exito, indistinguible de "no habia fila que
cerrar" (`desafios-implementacion.md` 56).

**`listarPendientesVerificacion` no acepta `cursor` todavia.** El documento original lo
preveia para paginar; al volumen de hoy (decenas de solicitudes en verificacion a la vez) PA-11
lee la particion entera, igual que la bandeja del aprobador. Se agrega cuando haga falta.

---

## 6. `src/app/actions/auditoria.ts`

| Action | Entrada | Salida | Permiso |
| --- | --- | --- | --- |
| `consultarBitacora` | `{ agregado, agregadoId, cursor? }` | `PaginaDeEventosDTO` | `auditoria:ver-bitacora` |
| `reconstruirFila` | `{ loteId }` | `FilaHistoricaDTO` | `auditoria:ver-fila-historica` |
| `verificarIntegridad` | `{ loteId }` | `ResultadoVerificacion` | `auditoria:ver-bitacora` |
| `exportarBitacora` | `{ filtros }` | `{ urlDescarga }` | `auditoria:exportar` |

> **`consultarBitacora` devuelve `PaginaDeEventosDTO` (`{ eventos, cursor? }`), no `EventoDTO[]`
> a secas** (correccion de la Etapa 11). El contrato original aceptaba `cursor` como entrada sin
> decir de donde salia el siguiente; sin un cursor de salida la paginacion no se puede completar.
> La pantalla `/auditoria` no lo ejercita — lee la historia completa de un agregado con
> `consultarBitacoraCompleta`, que agota internamente todas las paginas, por el mismo argumento de
> volumen que `listarPendientesVerificacion` (seccion 5) — pero la action si respeta el contrato
> para quien la invoque directamente.

`FilaHistoricaDTO` **si incluye identidades** — es el unico contrato del sistema que lo hace, y
esta reservado a `Autob_Auditar`. Agrupa la bitacora de un lote por turno; `participanteId` sale
del `actorId` de su propio `SOLICITUD_CREADA`, sin ninguna lectura adicional.

`ResultadoVerificacion` devuelve las seis comprobaciones de la seccion 5.1 de
`trazabilidad-auditoria.md`, cada una con veredicto y los datos crudos del hallazgo (turnos,
pares de turnos), no una frase compuesta — la pantalla la traduce contra el diccionario (regla 11
de `CLAUDE.md`). Los huecos de turno se reportan como **informativos**, no como incumplimiento.
La comprobacion 5 (`transicionesConEvento`) contrasta la bitacora contra el estado **vigente** de
la tabla base (`leerFilaCompleta`, PA-07 sin filtrar por estatus) — es la unica de las seis que
necesita algo mas que la bitacora misma.

> **`exportarBitacora` no lee la bitacora ni escribe `BITACORA_EXPORTADA`.** Solo verifica el
> permiso y devuelve la URL del Route Handler de descarga
> (`src/app/api/auditoria/exportar`), que es quien hace las dos cosas **al momento de entregar el
> archivo** — el mismo criterio que `COMPROBANTE_DESCARGADO` en la seccion 7. Registrar el evento
> en la action dejaria un hueco: cualquiera con `Autob_Auditar` podria construir esa misma URL a
> mano y exportar sin dejar rastro (`desafios-implementacion.md` 36).
>
> **Exige un agregado, y por eso no cubre el modo global de la pantalla.** `BITACORA_EXPORTADA` es
> un evento y todo evento se ancla a un agregado (`trazabilidad-auditoria.md` 2.1): una
> exportacion del rango completo no tendria a que anclarse y saldria sin registrarse, que es el
> hueco que la seccion 36 cerro. La pantalla oculta el boton en ese modo.

### 6.2 Servicios de lectura de la bitacora

No son Server Actions: los invoca la pagina `/auditoria` directamente, que es un Server Component
(regla 2 — solo las mutaciones pasan por action).

| Servicio | Entrada | Salida | Patron |
| --- | --- | --- | --- |
| `consultarBitacoraCompleta` | `{ agregado, agregadoId }` | `EventoDTO[]` | PA-12, agota las paginas |
| `consultarBitacoraGlobal` | `{ desde, hasta }` **y al menos uno de** `tipo`, `actorId`, `agregado` | `{ eventos, truncada }` | PA-13, el criterio elige el indice |
| `consultarActividadDeParticipante` | `{ participanteId, desde, hasta, tipo? }` | `{ eventos, truncada }` | PA-13 + PA-09 + particiones de lote |
| `identificadoresConActividad` | `{ desde, hasta, agregado }` | `ValorConActividad[]` | PA-15 sobre GSI7 |
| `participantesConActividad` | `{ desde, hasta }` | `ValorConActividad[]` | PA-15 sobre GSI8 |
| `construirOpciones` | `{ desde, hasta, agregado?, diccionario }` | `{ identificadores, participantes, nombresDeActor }` | PA-15 + lecturas por lote |
| `construirEtiquetador` | `{ referencias, actorIds, diccionario }` | `{ deAgregado, deParticipante, nombresDeActor }` | lecturas por lote |
| `leerPerfiles` | `participanteId[]` | `Map<id, PerfilDeParticipante>` | `BatchGetItem` |
| `registrarPerfil` | `{ participanteId, oktaSub, nombre, correo }` | `PerfilDeParticipante` | `PutItem` sin condicion |

`desde` y `hasta` son **dias de negocio `yyyy-mm-dd`**, inclusivos, no instantes ISO. El rango es
la llave de PA-13 y sus fronteras son las medianoches de Mexico
(`modelo-datos-dynamodb.md` 5.3).

> **`consultarActividadDeParticipante` son dos preguntas, no una.** Lo que la persona **hizo** son
> sus eventos firmados (`actorId`), y para un administrador o un operador de tesoreria es casi todo
> lo que hay. Lo que **le ocurrio** son los eventos de sus solicitudes, y esos los firma `SISTEMA`
> —un vencimiento, una omision, un descongelamiento—, asi que buscar por `actorId` no los
> encuentra. Son justo los que explican por que alguien perdio una adjudicacion. Los resultados se
> desduplican por `eventoId` (`SOLICITUD_CREADA` aparece en las dos lecturas) y se ordenan por
> `ocurridoEn` con desempate por `eventoId`, que es el orden de la `SK` de la bitacora.
>
> **La segunda mitad estaba muerta hasta la Etapa 11.2.** Leia particiones
> `AUDIT#SOLICITUD#<id>`, que **ningun escritor escribe**: los 19 eventos de fila anclan a `LOTE`,
> porque la fila es del lote y la solicitud es un lugar dentro de ella. Devolvia cero siempre y
> nadie lo noto, porque cero es una respuesta plausible. Ahora lee las particiones de lote, con el
> rango en la clave y las solicitudes como filtro.

> **`EventoDTO` gano `agregado` y `agregadoId`.** Salen de la clave de particion, no de los
> atributos, y son opcionales por eso. Quien lee PA-12 ya sabe de que agregado pregunto; quien lee
> PA-13 recibe eventos de todo el sistema mezclados y sin ellos no puede decir de que habla cada
> renglon.

> **El criterio es obligatorio en el tipo de `consultarBitacoraGlobal`.** Es una union de tres
> ramas, cada una exigiendo uno de los tres criterios, asi que un rango sin criterio no se puede
> construir. No es una duplicacion de la validacion de la pantalla: es lo que impide que una action
> nueva pida algo que ningun indice puede responder.

---

## 6.1 `src/app/actions/devTools.ts` — solo desarrollo

| Action | Entrada | Salida | Permiso |
| --- | --- | --- | --- |
| `cambiarPersonaSimulada` | `FormData` con `persona` (id del roster, o vacio) | `void` | **ninguno** |

**La unica action del sistema que no pasa por `puedeEjecutar`,** y a proposito: no hay permiso
que cubra "elegir con quien navego", y crearlo seria pedirle a EAS que configure una herramienta
de desarrollo (regla 17). Su compuerta son tres condiciones que se exigen **las tres**:

1. `ENABLE_DEV_TOOLS=FULL`.
2. O `NODE_ENV` distinto de `production`, o un despliegue con `APP_ENV=pruebas` — lo exige
   `exigirModoSeguro()`. La matriz completa esta en `identidad-autorizacion.md` 4.1.2.
3. Una sesion real de Okta: la impersonacion sustituye permisos e identidad, nunca la
   autenticacion.

**Lanza** si alguna falla, o si el id no esta en el roster de `src/lib/auth/personasSimuladas.ts`
— no devuelve `Resultado`. Un conmutador de desarrollo que falla en silencio manda a depurar la
pantalla equivocada (regla 15). Recibe `FormData` porque la barra es un unico `<form>` con un
boton de envio por persona, sin JavaScript de cliente.

Invalida `convocatorias:visibles`, `convocatorias` y `vehiculos`: los tres listados dependen de
los permisos de quien mira. Ver seccion 4.1.1 de `identidad-autorizacion.md`.

---

## 7. Route Handlers

Las **unicas** tres excepciones a "todas las mutaciones por Server Action" (regla 2).

### `GET /api/comprobantes/[solicitudId]`

Descarga del comprobante. Es Route Handler porque devuelve un flujo binario con cabeceras
propias.

Permiso `comprobante:descargar`. Devuelve la URL firmada de S3 o el flujo directo, con
`Content-Disposition: attachment`. Emite `COMPROBANTE_DESCARGADO`.

> **Un Route Handler no hereda ninguna proteccion.** Debe verificar sesion y permiso por su
> cuenta. Sin la guarda `titularId === participanteId`, cualquier participante autenticado
> podria descargar el comprobante de otro cambiando el identificador de la URL.

Respuestas: `200`, `401` sin sesion, `404` si no existe o no le corresponde (nunca `403`, que
confirmaria su existencia).

### `GET /api/auditoria/exportar`

Exportacion de bitacora a CSV (Etapa 11). Route Handler por la misma razon que el anterior:
entrega un archivo con `Content-Disposition: attachment`.

Permiso `auditoria:exportar`, verificado por su cuenta — la Server Action `exportarBitacora`
solo devuelve esta URL, sin leer nada. Recibe los filtros por *query string*
(`agregado`, `agregadoId`, `tipo?`, `desde?`, `hasta?`, `participanteId?`), lee la bitacora
completa del agregado (`consultarBitacoraCompleta`), filtra en memoria y **emite
`BITACORA_EXPORTADA` antes de responder** — no en la action, para que nadie pueda construir esta
URL a mano y exportar sin dejar rastro (`desafios-implementacion.md` 36).

Respuestas: `200` con el CSV, `400` con un agregado o `agregadoId` invalidos, `403` sin el
permiso — no hay nada que ocultar aqui, a diferencia del comprobante, asi que un `403` no
delata nada.

### `GET /api/health`

Sin autenticacion. Devuelve `{ estado, version, tiempo }`. **No consulta DynamoDB**: un health
check que depende de la base de datos reporta caida la aplicacion cuando el problema esta en
otra capa.

### `/auth/*`

Los atiende el middleware de `@auth0/nextjs-auth0`. **No se escribe codigo** — crear archivos
propios duplicaria el flujo y lo romperia.

---

## 8. DTOs de lectura

| DTO | Contiene | Nunca contiene |
| --- | --- | --- |
| `ConvocatoriaListadoDTO` | id, `folio`, `nombre`, tipo, `inicioVenta`, `finVenta`, conteo de lotes | Datos de participantes |
| `ConvocatoriaDetalleDTO` | Lo anterior + `descripcionParticipacion` + `LoteResumenDTO[]` | Datos de participantes |
| `LoteResumenDTO` | id, vehiculo resumido, precio, estatus, `tamanoFila` | Turnos ni identidades ajenas |
| `LoteDetalleDTO` | Vehiculo completo, fotografias firmadas, `MiLugarDTO \| null` | Fila de terceros |
| `MiLugarDTO` | Seccion 4.1 | `participanteId`, correo, nombre |
| `PendienteDTO` | solicitudId, lote, vehiculo, `adjudicadoEn`, correo del titular | — |
| `EventoDTO` | Evento completo con actor | — |
| `PaginaDeEventosDTO` | `EventoDTO[]` + `cursor?` de PA-12 | — |
| `FilaHistoricaDTO` | `SolicitudHistoricaDTO[]` (turno, `participanteId`, eventos) + eventos del lote | — |
| `ResultadoVerificacion` | Las seis comprobaciones de integridad, con veredicto y datos crudos | — |

`PendienteDTO` **si** expone el correo del titular: tesoreria necesita identificar a quien
pago. Es una excepcion deliberada a R-12, acotada a `Autob_Operar_Tesoreria`.

---

## 9. Invalidacion de cache

| Action | Etiquetas |
| --- | --- |
| `publicarConvocatoria` | `convocatorias:visibles`, `convocatoria:<id>` |
| `concluirConvocatoria` | `convocatorias:visibles`, `convocatoria:<id>` |
| `incluirVehiculo`, `retirarVehiculoDeConvocatoria` | `convocatoria:<id>` |
| `editarVehiculo`, fotografias | `vehiculo:<id>` |
| `solicitarCompra`, `cancelarSolicitud`, `subirComprobante` | `lote:<loteId>` |
| `avalarPago`, `rechazarPago` | `lote:<loteId>`, `convocatoria:<id>` |

Recordatorio del riesgo R4: **la publicacion programada no la cubre ninguna etiqueta**. Ver
seccion 3.2 de `arquitectura-tecnica-aws.md`.
