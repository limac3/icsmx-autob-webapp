import "server-only";

import type { DepsDeServicio } from "@/lib/data/deps";
import type { ActorUsuario } from "@/types/auditoria";
import type { Convocatoria, EstatusConvocatoria } from "@/types/convocatoria";
import { fallo, type Resultado } from "@/types/resultado";
import { aplicarTransicion } from "./transicionDeConvocatoria";

export type EntradaRechazarConvocatoria = {
  actual: Convocatoria;
  motivo: string;
  actor: ActorUsuario;
};

/**
 * Rechaza una convocatoria en dictamen y la devuelve a `BORRADOR`.
 *
 * No hay estatus `RECHAZADA`: el rechazo vuelve al borrador con el motivo en la
 * bitacora (proyecto.md seccion 8). Un estatus terminal de rechazo obligaria a
 * duplicar la convocatoria para corregirla, y el historial quedaria partido.
 *
 * Le aplica la **misma guarda de auto-aprobacion** que aprobar: si quien la
 * creo pudiera rechazarla, tendria una via para retirarla del dictamen sin que
 * el aprobador se entere.
 */
export const rechazarConvocatoria = async (
  entrada: EntradaRechazarConvocatoria,
  deps: DepsDeServicio = {},
): Promise<Resultado<{ estatus: EstatusConvocatoria }>> => {
  if (entrada.actual.creadoPor === entrada.actor.id) {
    return fallo("forbidden");
  }

  const motivo = entrada.motivo.trim();
  if (motivo.length === 0) {
    // `CONVOCATORIA_RECHAZADA` esta marcado con **M** en el catalogo: sin
    // motivo, la bitacora no podria responder por que volvio a borrador.
    return fallo("validation_failed", { motivo: "requerido" });
  }

  return aplicarTransicion(
    {
      actual: entrada.actual,
      evento: "RECHAZAR",
      tipoDeEvento: "CONVOCATORIA_RECHAZADA",
      actor: entrada.actor,
      motivo,
    },
    deps,
  );
};
