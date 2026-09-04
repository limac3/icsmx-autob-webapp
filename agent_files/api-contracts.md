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
`revalidateTag()`.

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
| `reordenarFotografias` | `{ vehiculoId, ordenFotoIds }` | `{ vehiculoId }` | `vehiculo:subir-fotografia` | `validation_failed` | `VEHICULO_EDITADO` |

`DatosVehiculo`: `marca`, `version`, `modelo` (anio), `nivelEquipamiento`,
`especificacionMecanica`, `condicionesMecanicas`, `detallesEsteticos`, `kilometraje`.

**Validaciones:** `modelo` entre 1950 y el anio siguiente al actual; `kilometraje >= 0`;
`marca` y `version` no vacias. Fotografia: tipo `image/jpeg|png|webp`, maximo 10 MB,
**nombre de archivo generado en servidor** — nunca el del cliente.

`eliminarFotografia` rechaza con `invalid_state` si dejaria al vehiculo sin fotografia
principal.

---

## 3. `src/app/actions/convocatorias.ts`

| Action | Entrada | Salida | Permiso | Errores | Eventos |
| --- | --- | --- | --- | --- | --- |
| `crearConvocatoria` | `DatosConvocatoria` | `{ convocatoriaId }` | `convocatoria:crear` | `validation_failed` | `CONVOCATORIA_CREADA` |
| `editarConvocatoria` | `{ convocatoriaId, cambios }` | `{ convocatoriaId }` | `convocatoria:editar` | `validation_failed`, `invalid_state` | `CONVOCATORIA_EDITADA` |
| `incluirVehiculo` | `{ convocatoriaId, vehiculoId, precio }` | `{ loteId }` | `convocatoria:incluir-vehiculo` | `invalid_state`, `conflicto_concurrencia` | `VEHICULO_INCLUIDO` |
| `retirarVehiculoDeConvocatoria` | `{ convocatoriaId, loteId, motivo }` | `{ loteId }` | `convocatoria:retirar-vehiculo` | `invalid_state` | `VEHICULO_RETIRADO_DE_CONVOCATORIA` |
| `enviarAAprobacion` | `{ convocatoriaId }` | `{ estatus }` | `convocatoria:enviar-a-aprobacion` | `invalid_state`, `validation_failed` | `CONVOCATORIA_ENVIADA_A_APROBACION` |
| `aprobarConvocatoria` | `{ convocatoriaId }` | `{ estatus }` | `convocatoria:aprobar` | `invalid_state`, `forbidden` (auto-aprobacion) | `CONVOCATORIA_APROBADA` |
| `rechazarConvocatoria` | `{ convocatoriaId, motivo }` | `{ estatus }` | `convocatoria:rechazar` | `invalid_state`, `validation_failed` | `CONVOCATORIA_RECHAZADA` |
| `publicarConvocatoria` | `{ convocatoriaId }` | `{ estatus }` | `convocatoria:publicar` | `invalid_state` | `CONVOCATORIA_PUBLICADA` |
| `ocultarConvocatoria` | `{ convocatoriaId, motivo }` | `{ estatus }` | `convocatoria:ocultar` | `invalid_state` | `CONVOCATORIA_OCULTA` |
| `reactivarConvocatoria` | `{ convocatoriaId }` | `{ estatus }` | `convocatoria:reactivar` | `invalid_state` | `CONVOCATORIA_REACTIVADA` |
| `concluirConvocatoria` | `{ convocatoriaId }` | `{ estatus, vendidos, noVendidos }` | `convocatoria:concluir` | `invalid_state` | `CONVOCATORIA_CONCLUIDA` |

`DatosConvocatoria`: `tipo` (`EMPLEADOS` \| `PUBLICO_GENERAL`), `titulo`, `descripcion`,
`publicadaEn`, `inicioVenta`, `finVenta`, `horasLiquidacion`.

**Validaciones (R-14):** `publicadaEn <= inicioVenta < finVenta` y `horasLiquidacion > 0`. Se
comprueban al crear, al editar y de nuevo al enviar a aprobacion.

**Notas de contrato:**

- `incluirVehiculo` devuelve `conflicto_concurrencia` cuando el vehiculo ya esta en otra
  convocatoria activa (falla el centinela de R-10). No es error del usuario: la UI relee.
- `aprobarConvocatoria` devuelve `forbidden` si el aprobador es el creador (R-05), **incluso
  teniendo ambos roles**.
- `ocultarConvocatoria` devuelve `invalid_state` si existe cualquier solicitud (R-06).
- `concluirConvocatoria` pasa las solicitudes `EN_FILA` y `CONGELADA` a `NO_ADJUDICADA`, pero
  **respeta las adjudicaciones vigentes** con su plazo intacto (R-18).

---

## 4. `src/app/actions/fila.ts` — el nucleo

| Action | Entrada | Salida | Permiso | Errores | Eventos |
| --- | --- | --- | --- | --- | --- |
| `solicitarCompra` | `{ loteId }` | `MiLugarDTO` | `solicitud:crear` | `invalid_state`, `already_in_queue`, `lote_no_disponible`, `conflicto_concurrencia` | `SOLICITUD_CREADA` (+ `LOTE_ADJUDICADO` si adjudica) |
| `cancelarSolicitud` | `{ solicitudId, motivo? }` | `{ estatus }` | `solicitud:cancelar` | `invalid_state`, `not_owner` | `SOLICITUD_CANCELADA_POR_PARTICIPANTE` (+ reasignacion) |
| `consultarMiLugar` | `{ loteId }` | `MiLugarDTO \| null` | `solicitud:ver-mi-lugar` | — | — |
| `listarMisSolicitudes` | — | `MiSolicitudDTO[]` | `solicitud:ver-mis-solicitudes` | — | — |

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

### 4.2 Comportamiento de `solicitarCompra`

1. Verifica el gating triple y que la venta este abierta.
2. Consume un turno del contador atomico del lote.
3. Escribe solicitud, centinela y evento en una transaccion.
4. **Si el lote esta libre, intenta adjudicar de inmediato** (T2). El primero en llegar recibe
   su `MiLugarDTO` ya en estado `ADJUDICADA`, sin esperar a ningun proceso.

Errores especificos:

| Codigo | Cuando |
| --- | --- |
| `already_in_queue` | Ya tiene una solicitud viva en el lote (R-07) |
| `lote_no_disponible` | El lote esta `VENDIDO`, `NO_VENDIDO` o `RETIRADO` |
| `invalid_state` | La venta no ha abierto o ya cerro |
| `not_found` | El lote no existe **o** no pasa el gating triple (R-01) |

### 4.3 `cancelarSolicitud`

Si la solicitud estaba `ADJUDICADA`, cancelar **libera el lote y dispara la reasignacion al
siguiente turno vivo** en el mismo acto. Si estaba `CONGELADA` o `EN_FILA`, solo la retira.

---

## 5. `src/app/actions/tesoreria.ts`

| Action | Entrada | Salida | Permiso | Errores | Eventos |
| --- | --- | --- | --- | --- | --- |
| `subirComprobante` | `{ solicitudId, archivo }` | `{ estatus }` | `comprobante:subir` | `validation_failed`, `invalid_state`, `plazo_vencido`, `not_owner` | `COMPROBANTE_CARGADO` |
| `avalarPago` | `{ solicitudId, nota? }` | `{ estatus }` | `pago:avalar` | `invalid_state` | `PAGO_AVALADO` |
| `rechazarPago` | `{ solicitudId, motivo }` | `{ estatus }` | `pago:rechazar` | `invalid_state`, `validation_failed` | `PAGO_RECHAZADO` (+ reasignacion) |
| `listarPendientesVerificacion` | `{ cursor? }` | `PendienteDTO[]` | `tesoreria:ver-bandeja` | — | — |

**`subirComprobante`:** solo el titular, solo desde `ADJUDICADA`, solo dentro del plazo. Archivo
`image/jpeg|png` o `application/pdf`, maximo 10 MB. Devuelve `plazo_vencido` — distinto de
`invalid_state` — para poder explicarle al participante exactamente que paso.

Al tener exito, **se detiene el reloj**: se retiran las claves GSI4 y tesoreria ya no puede
vencerlo por demora propia.

**`rechazarPago`** exige motivo no vacio (R-16) y libera el lote como un vencimiento.

---

## 6. `src/app/actions/auditoria.ts`

| Action | Entrada | Salida | Permiso |
| --- | --- | --- | --- |
| `consultarBitacora` | `{ agregado, agregadoId, cursor? }` | `EventoDTO[]` | `auditoria:ver-bitacora` |
| `reconstruirFila` | `{ loteId }` | `FilaHistoricaDTO` | `auditoria:ver-fila-historica` |
| `verificarIntegridad` | `{ loteId }` | `ResultadoVerificacion` | `auditoria:ver-bitacora` |
| `exportarBitacora` | `{ filtros }` | `{ urlDescarga }` | `auditoria:exportar` |

`FilaHistoricaDTO` **si incluye identidades** — es el unico contrato del sistema que lo hace, y
esta reservado a `AUDITOR_CUMPLIMIENTO`.

`ResultadoVerificacion` devuelve las seis comprobaciones de la seccion 5.1 de
`trazabilidad-auditoria.md`, cada una con veredicto y detalle. Los huecos de turno se reportan
como **informativos**, no como incumplimiento.

`exportarBitacora` emite `BITACORA_EXPORTADA`: mirar los datos sensibles tambien deja rastro.

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
| `ConvocatoriaListadoDTO` | id, titulo, tipo, `inicioVenta`, `finVenta`, conteo de lotes | Datos de participantes |
| `ConvocatoriaDetalleDTO` | Lo anterior + descripcion + `LoteResumenDTO[]` | Datos de participantes |
| `LoteResumenDTO` | id, vehiculo resumido, precio, estatus, `tamanoFila` | Turnos ni identidades ajenas |
| `LoteDetalleDTO` | Vehiculo completo, fotografias firmadas, `MiLugarDTO \| null` | Fila de terceros |
| `MiLugarDTO` | Seccion 4.1 | `participanteId`, correo, nombre |
| `PendienteDTO` | solicitudId, lote, vehiculo, `adjudicadoEn`, correo del titular | — |
| `EventoDTO` | Evento completo con actor | — |

`PendienteDTO` **si** expone el correo del titular: tesoreria necesita identificar a quien
pago. Es una excepcion deliberada a R-12, acotada al rol `OPERADOR_TESORERIA`.

---

## 9. Invalidacion de cache

| Action | Etiquetas |
| --- | --- |
| `publicarConvocatoria` | `convocatorias:visibles`, `convocatoria:<id>` |
| `concluirConvocatoria` | `convocatorias:visibles`, `convocatoria:<id>` |
| `incluirVehiculo`, `retirarVehiculoDeConvocatoria` | `convocatoria:<id>` |
| `editarVehiculo`, fotografias | `vehiculo:<id>` |
| `solicitarCompra`, `cancelarSolicitud` | `lote:<loteId>` |
| `avalarPago`, `rechazarPago` | `lote:<loteId>`, `convocatoria:<id>` |

Recordatorio del riesgo R4: **la publicacion programada no la cubre ninguna etiqueta**. Ver
seccion 3.2 de `arquitectura-tecnica-aws.md`.
