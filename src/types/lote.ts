// Fuente: agent_files/proyecto.md secciones 4.3 y 5.3.

/**
 * Estatus del lote — *un vehiculo dentro de una convocatoria concreta*.
 *
 * El lote, no el vehiculo, es la entidad de la fila: el contador de turnos, la
 * adjudicacion y el precio viven aqui. Es lo que permite reofertar un vehiculo
 * en otra convocatoria con una fila nueva, sin arrastrar la historia anterior
 * pero conservandola para el auditor (decision D-3).
 *
 * `EN_OFERTA` es reentrante: un vencimiento o un rechazo de tesoreria
 * devuelven el lote aqui para el siguiente de la fila (R-15, R-16), y tambien
 * llega aqui un lote cuya fila se agoto (R-17).
 */
export type EstatusLote =
  "EN_OFERTA" | "ADJUDICADO" | "VENDIDO" | "NO_VENDIDO" | "RETIRADO";

export const ESTATUS_LOTE = [
  "EN_OFERTA",
  "ADJUDICADO",
  "VENDIDO",
  "NO_VENDIDO",
  "RETIRADO",
] as const satisfies readonly EstatusLote[];
