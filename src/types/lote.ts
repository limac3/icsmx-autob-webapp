// Fuente: agent_files/proyecto.md secciones 4.3 y 5.3.

import type { EstatusConvocatoria, TipoConvocatoria } from "./convocatoria";

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

/**
 * El lote tal como vive en `CONV#<convocatoriaId> / LOTE#<loteId>`.
 *
 * Los cinco atributos de la convocatoria estan **desnormalizados** aqui para
 * que el paso 1 de T1 condicione barato sobre un solo item. Pueden quedarse
 * atras de la convocatoria —nunca adelantarse—, asi que **no son autoritativos**:
 * el `estatusConvocatoria` que se le pasa a `puedeEjecutar` sale de la
 * convocatoria, no de esta copia (modelo-datos-dynamodb.md, T8).
 */
export type Lote = {
  loteId: string;
  convocatoriaId: string;
  vehiculoId: string;
  precio: number;
  estatus: EstatusLote;
  /** Entero que solo crece; objetivo del `ADD` atomico que reparte turnos. */
  contadorTurnos: number;
  inicioVenta: string;
  finVenta: string;
  tipoConvocatoria: TipoConvocatoria;
  estatusConvocatoria: EstatusConvocatoria;
  horasLiquidacion: number;
  creadoEn: string;
  creadoPor: string;
  /** Presente solo si se retiro de la convocatoria. */
  motivoRetiro?: string;
};
