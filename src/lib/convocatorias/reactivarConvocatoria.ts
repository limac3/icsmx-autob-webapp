import "server-only";

import type { DepsDeServicio } from "@/lib/data/deps";
import type { ActorUsuario } from "@/types/auditoria";
import type { Convocatoria, EstatusConvocatoria } from "@/types/convocatoria";
import type { Resultado } from "@/types/resultado";
import { aplicarTransicion } from "./transicionDeConvocatoria";

export type EntradaReactivarConvocatoria = {
  actual: Convocatoria;
  actor: ActorUsuario;
};

/**
 * Devuelve una convocatoria oculta a `BORRADOR`.
 *
 * Vuelve al principio del ciclo y no al estatus que tenia: una convocatoria que
 * se oculto estando publicada llevaba fechas que ya pasaron, y reactivarla
 * directamente a `PUBLICADA` la haria visible con una ventana de venta muerta.
 * Desde borrador se corrigen las fechas y se vuelve a aprobar.
 *
 * `motivoOcultamiento` se **elimina**: describe por que estuvo oculta, y
 * dejarlo puesto haria pensar que sigue estandolo.
 */
export const reactivarConvocatoria = async (
  entrada: EntradaReactivarConvocatoria,
  deps: DepsDeServicio = {},
): Promise<Resultado<{ estatus: EstatusConvocatoria }>> =>
  aplicarTransicion(
    {
      actual: entrada.actual,
      evento: "REACTIVAR",
      tipoDeEvento: "CONVOCATORIA_REACTIVADA",
      actor: entrada.actor,
      eliminar: ["motivoOcultamiento"],
    },
    deps,
  );
