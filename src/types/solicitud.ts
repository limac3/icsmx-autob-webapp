// Fuente: agent_files/proyecto.md seccion 5.4.

/**
 * Estatus de la solicitud de compra.
 *
 * No existe un `COMPROBANTE_CARGADO`: subir el comprobante y entrar en
 * verificacion son el mismo evento (proyecto.md 5.4).
 *
 * **`CONGELADA` ya no se escribe.** Hasta la Etapa 14 lo producia el
 * congelamiento de R-09 —"una sola adjudicacion activa en todo el sistema"—,
 * que se sustituyo por el cupo por convocatoria: a quien agota su cupo se le
 * **omite** dejando su evento, y sigue `EN_FILA` con su turno intacto, porque
 * el cupo se libera al vencer o al ser rechazado.
 *
 * Se conserva en el catalogo, con sus dos transiciones de salida, porque la
 * bitacora es append-only (R-20) y `reconstruirFila` y `verificarIntegridad`
 * tienen que seguir leyendo historias ya escritas. Borrarlo de aqui haria que
 * esas historias dejaran de tipar.
 *
 * `CANCELADA_POR_LIMITE` es su contrario en un sentido util: se escribe
 * **despues** de crear la solicitud, a proposito, para que quede constancia de
 * la participacion aunque exceda el tope (R-22).
 */
export type EstatusSolicitud =
  | "EN_FILA"
  | "CONGELADA"
  | "ADJUDICADA"
  | "EN_VERIFICACION"
  | "VENDIDA"
  | "CANCELADA_POR_VENCIMIENTO"
  | "RECHAZADA_POR_TESORERIA"
  | "CANCELADA_POR_PARTICIPANTE"
  | "CANCELADA_POR_LIMITE"
  | "NO_ADJUDICADA";

export const ESTATUS_SOLICITUD = [
  "EN_FILA",
  "CONGELADA",
  "ADJUDICADA",
  "EN_VERIFICACION",
  "VENDIDA",
  "CANCELADA_POR_VENCIMIENTO",
  "RECHAZADA_POR_TESORERIA",
  "CANCELADA_POR_PARTICIPANTE",
  "CANCELADA_POR_LIMITE",
  "NO_ADJUDICADA",
] as const satisfies readonly EstatusSolicitud[];

/**
 * Estados vivos (proyecto.md 5.4). Los demas son terminales.
 *
 * Importa en tres lugares: el centinela de fila se borra al salir de un estado
 * vivo para permitir volver a formarse con turno nuevo (R-07); `tamanoFila` y
 * `miPosicion` cuentan solo vivos (modelo-datos 5.2); y concluir la
 * convocatoria pasa los vivos que no estan adjudicados a `NO_ADJUDICADA`
 * (R-18).
 */
export const ESTADOS_VIVOS_SOLICITUD = [
  "EN_FILA",
  "CONGELADA",
  "ADJUDICADA",
  "EN_VERIFICACION",
] as const satisfies readonly EstatusSolicitud[];

export type EstatusSolicitudVivo = (typeof ESTADOS_VIVOS_SOLICITUD)[number];

const VIVOS = new Set<string>(ESTADOS_VIVOS_SOLICITUD);

export const esEstadoVivo = (
  estatus: EstatusSolicitud,
): estatus is EstatusSolicitudVivo => VIVOS.has(estatus);
