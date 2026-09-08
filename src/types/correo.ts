// Fuente: agent_files/arquitectura-tecnica-aws.md secciones 2.5 y 4.5, y
// trazabilidad-auditoria.md, catalogo "Correo".
//
// El outbox vive en `OUTBOX#<mensajeId> / META` (modelo-datos-dynamodb.md 2.1).
// Es deliberadamente el unico tipo de mensaje hoy: la unica notificacion que el
// proyecto exige es "correo de adjudicacion con los datos de pago y el plazo"
// (plan-ejecucion.md, Etapa 10). Agregar un tipo nuevo es agregar un valor a
// `TipoDeCorreo` y su plantilla, no reabrir el modelo del mensaje.

/** `PENDIENTE` es el unico estatus que aparece en GSI4 (dispersion, seccion 3). */
export type EstatusMensaje = "PENDIENTE" | "ENVIADO" | "FALLIDO";

export type TipoDeCorreo = "ADJUDICACION";

/**
 * Datos de plantilla del correo de adjudicacion (R-15: "con los datos de pago
 * y el plazo"). `precio` es el dato de pago — la aplicacion no modela
 * instrucciones bancarias, el cobro ocurre fuera de este sistema
 * (`proyecto.md` seccion 2) — y `venceEn`, el plazo.
 */
export type DatosCorreoAdjudicacion = {
  solicitudId: string;
  loteId: string;
  convocatoriaId?: string;
  vehiculoId: string;
  precio: number;
  venceEn: string;
};

/**
 * El mensaje tal como vive en `OUTBOX#<mensajeId> / META`.
 *
 * `intentos` y `ultimoError` son datos operativos, no de auditoria: un fallo
 * transitorio de CES no se escribe en la bitacora (trazabilidad-auditoria.md
 * seccion 6, "errores tecnicos... pertenecen a observabilidad"). Solo el fallo
 * **permanente** —agotados los reintentos— tiene evento propio (`CORREO_FALLIDO`).
 */
export type MensajeDeCorreo = {
  mensajeId: string;
  tipo: TipoDeCorreo;
  destinatario: string;
  creadoEn: string;
  estatus: EstatusMensaje;
  intentos: number;
  ultimoIntentoEn?: string;
  ultimoError?: string;
  datos: DatosCorreoAdjudicacion;
};
