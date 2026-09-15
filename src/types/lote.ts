// Fuente: agent_files/proyecto.md secciones 4.3 y 5.3.

import type {
  EstatusConvocatoria,
  ModalidadAdjudicacion,
  TipoConvocatoria,
} from "./convocatoria";

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
  /**
   * Cupo de adjudicaciones de la convocatoria (R-09), desnormalizado por la
   * misma razon que los otros cinco: T2 lo necesita como **literal de la
   * condicion** del item de cupo y ya tiene el lote en la mano, asi que leer la
   * convocatoria seria una lectura de mas en el camino caliente.
   *
   * **Obligatorio, y esa decision tiene una razon precisa.** Como toda copia,
   * puede quedarse atras de la convocatoria; pero el invariante de la
   * desnormalizacion es que "atras" signifique siempre *menos permisivo*
   * (`propagarALotes.ts`). Un limite opcional lo rompe: la unica lectura
   * sensata de su ausencia seria "sin tope", que es la direccion **mas**
   * permisiva — media propagacion interrumpida repartiria vehiculos sin
   * limite, en silencio. Exigirlo convierte ese caso en un lote ilegible, que
   * es ruidoso y detectable.
   */
  limiteAdjudicaciones: number;
  /** Tope de solicitudes de la convocatoria (R-22). Misma nota que el anterior. */
  limiteSolicitudes: number;
  /**
   * Modalidad de adjudicacion de la convocatoria (R-23), desnormalizada porque
   * **el motor decide a partir del lote que ya tiene en la mano**: los cinco
   * disparadores automaticos se bifurcan leyendo este atributo, sin una lectura
   * extra de la convocatoria.
   *
   * Obligatoria por la misma razon que los dos limites: su ausencia solo podria
   * leerse como `AUTOMATICA`, y eso haria que una propagacion a medias
   * adjudicara sola los lotes que esperaban una decision humana.
   */
  modalidadAdjudicacion: ModalidadAdjudicacion;
  creadoEn: string;
  creadoPor: string;
  /** Presente solo si se retiro de la convocatoria. */
  motivoRetiro?: string;

  /**
   * Adjudicacion vigente. Los escribe el motor de fila en la Etapa 8; aqui van
   * declarados para que el tipo describa el item completo y no solo la parte
   * que hoy se escribe.
   *
   * **`adjudicacionActual` se elimina con `REMOVE`, nunca se pone en `null`.**
   * Toda la exclusion mutua depende de `attribute_not_exists(adjudicacionActual)`,
   * y un `null` es un atributo que existe: pasaria la condicion y adjudicaria
   * el mismo lote dos veces. De ahi que sea opcional y no `string | null`.
   */
  adjudicacionActual?: string;
  adjudicadoEn?: string;
  venceEn?: string;
  turnoAdjudicado?: number;
};
