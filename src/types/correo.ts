// Fuente: agent_files/arquitectura-tecnica-aws.md secciones 2.5 y 4.5, y
// trazabilidad-auditoria.md, catalogo "Correo".
//
// El outbox vive en `OUTBOX#<mensajeId> / META` (modelo-datos-dynamodb.md 2.1).
// Es deliberadamente el unico tipo de mensaje hoy: la unica notificacion que el
// proyecto exige es "correo de adjudicacion con los datos de pago y el plazo"
// (plan-ejecucion.md, Etapa 10). Agregar un tipo nuevo es agregar un valor a
// `TipoDeCorreo` y su plantilla, no reabrir el modelo del mensaje.

/**
 * `PENDIENTE` y `ENVIANDO` son los dos estatus que aparecen en GSI4
 * (dispersion, seccion 3): las claves se retiran al llegar a `ENVIADO` o
 * `FALLIDO`.
 *
 * **`ENVIANDO` es una adquisicion con plazo, no un estado de negocio.** El
 * barrido corre cada 5 minutos y puede tardar hasta 300 s, asi que dos corridas
 * se solapan; sin este estado las dos leian el mismo mensaje `PENDIENTE` y las
 * dos lo enviaban, porque la condicion del `Update` a `ENVIADO` se evalua
 * **despues** de que CES ya acepto. Con el, la corrida que gana la escritura
 * condicional es la unica que llama a CES.
 *
 * El plazo (`leaseHasta` de `MensajeDeCorreo`) es lo que impide que una corrida
 * muerta deje el mensaje atascado para siempre: vencido, otra corrida lo
 * retoma.
 */
/**
 * `CANCELADO` es "nunca se intento y no se va a intentar", distinto de
 * `FALLIDO` —"se intento y CES lo rechazo o estaba caido"—. Hoy tiene una sola
 * causa: el entorno no tiene configuracion de CES (riesgo R17, mientras el
 * servicio siga sin aprobar). Se distingue de `FALLIDO` porque la pregunta
 * operativa es distinta: un `FALLIDO` puede indicar un problema del mensaje o
 * del servicio, y un `CANCELADO` solo dice que el despliegue no podia enviar
 * correo. Reencolar uno u otro es R-3 en los dos casos.
 *
 * **Solo se cancela en un entorno declarado de pruebas** (`APP_ENV`, D-18): en
 * produccion, faltar la configuracion de CES es un defecto de despliegue que
 * tiene que verse, no un correo que se descarta.
 */
export type EstatusMensaje =
  "PENDIENTE" | "ENVIANDO" | "ENVIADO" | "FALLIDO" | "CANCELADO";

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
  /**
   * Hasta cuando vale la adquisicion de `ENVIANDO`, en ISO-8601 UTC.
   *
   * Solo existe mientras el mensaje esta adquirido. Pasado ese instante, otra
   * corrida puede retomarlo: es la unica salida para un mensaje cuya corrida
   * murio despues de adquirirlo.
   */
  leaseHasta?: string;
  datos: DatosCorreoAdjudicacion;
};
