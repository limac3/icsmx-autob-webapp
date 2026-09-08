import "server-only";

// api-contracts.md seccion 6 — `reconstruirFila`.
//
// La historia de un lote es solo su bitacora (PA-12): los nueve eventos de la
// fila se anclan siempre al lote (trazabilidad-auditoria.md 2.1), asi que no
// hace falta leer el estado vigente de la tabla para contar esta historia —a
// diferencia de `verificarIntegridad`, que si lo necesita para contrastar.

import { reconstruirHistoriaDeFila } from "@/lib/domain/reconstruccionDeFila";
import type { DepsDeServicio } from "@/lib/data/deps";
import type { FilaHistoricaDTO } from "@/types/auditoria";
import { exito, type Resultado } from "@/types/resultado";
import { consultarBitacoraCompleta } from "./consultarBitacora";

export const reconstruirFila = async (
  loteId: string,
  deps: DepsDeServicio = {},
): Promise<Resultado<FilaHistoricaDTO>> => {
  const eventos = await consultarBitacoraCompleta(
    { agregado: "LOTE", agregadoId: loteId },
    deps,
  );
  if (!eventos.ok) return eventos;

  return exito(reconstruirHistoriaDeFila(loteId, eventos.data));
};
