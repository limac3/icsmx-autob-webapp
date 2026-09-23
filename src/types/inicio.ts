// Fuente: ui-ux-requerimientos.md, pantalla de inicio.
//
// Lo que el home muestra ademas de la guia. Vive en `src/types/` y no junto al
// servicio porque lo consume tambien un componente, y el servicio es
// `server-only`: un tipo compartido no tiene por que arrastrar esa marca.

import type { SiguientePaso } from "@/lib/domain/siguientePaso";

export type IdDeBandeja = "aprobaciones" | "adjudicacion" | "tesoreria";

export type PendienteDeBandeja = {
  readonly id: IdDeBandeja;
  readonly href: string;
  /**
   * Cuantos esperan. **Ausente cuando el conteo exacto no se puede pagar en
   * esta pantalla** — hoy solo en adjudicacion; la razon esta en
   * `src/lib/inicio/resumenDeInicio.ts`.
   */
  readonly cantidad?: number;
};

export type ResumenDeInicio = {
  /** Ausente cuando no hay nada que hacer, o cuando quien mira no compra. */
  readonly siguientePaso?: SiguientePaso;
  /** Solo las bandejas con trabajo pendiente. Una bandeja vacia no se menciona. */
  readonly pendientes: readonly PendienteDeBandeja[];
};
