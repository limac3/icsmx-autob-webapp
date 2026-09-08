import "server-only";

// api-contracts.md seccion 6 — `verificarIntegridad`.
//
// A diferencia de `reconstruirFila`, esta lectura **si** necesita el estado
// vigente de la tabla (PA-07 completo, `leerFilaCompleta`): la comprobacion 5
// de `trazabilidad-auditoria.md` 5.1 —"toda transicion de estado tiene su
// evento"— es precisamente la pregunta de si el estado de la tabla base **y**
// el de la bitacora cuentan la misma historia. Si solo se leyera la bitacora,
// una mutacion que rompiera la regla 4 (escribir sin su evento) seria
// invisible: no habria nada con que contrastarla.

import { leerFilaCompleta } from "@/lib/fila/leerFilaCompleta";
import { verificarIntegridadDeLote } from "@/lib/domain/verificacionDeAuditoria";
import type { DepsDeServicio } from "@/lib/data/deps";
import type { ResultadoVerificacion } from "@/types/auditoria";
import { exito, type Resultado } from "@/types/resultado";
import { consultarBitacoraCompleta } from "./consultarBitacora";

export const verificarIntegridad = async (
  loteId: string,
  deps: DepsDeServicio = {},
): Promise<Resultado<ResultadoVerificacion>> => {
  const [eventos, fila] = await Promise.all([
    consultarBitacoraCompleta({ agregado: "LOTE", agregadoId: loteId }, deps),
    leerFilaCompleta(loteId, deps),
  ]);
  if (!eventos.ok) return eventos;
  if (!fila.ok) return fila;

  const estatusActual = new Map(fila.data.map((s) => [s.turno, s.estatus]));

  return exito(
    verificarIntegridadDeLote({ loteId, eventos: eventos.data, estatusActual }),
  );
};
