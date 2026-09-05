// Fuente: agent_files/proyecto.md seccion 5.4.

/**
 * Estatus de la solicitud de compra.
 *
 * No existe un `COMPROBANTE_CARGADO`: subir el comprobante y entrar en
 * verificacion son el mismo evento (proyecto.md 5.4).
 *
 * `CONGELADA` es un estado **derivado y de presentacion**: le explica al
 * participante por que no avanza. La garantia de "una sola adjudicacion
 * activa" (R-09) no la sostiene este estado sino el centinela
 * `PART#<id> / ADJUDICACION_ACTIVA` (modelo-datos 4.3) — congelar las demas
 * solicitudes de un ganador exigiria actualizar una cantidad no acotada de
 * items, y `TransactWriteItems` admite 100.
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
