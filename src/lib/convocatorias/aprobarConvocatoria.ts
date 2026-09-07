import "server-only";

import type { DepsDeServicio } from "@/lib/data/deps";
import type { ActorUsuario } from "@/types/auditoria";
import type { Convocatoria, EstatusConvocatoria } from "@/types/convocatoria";
import { fallo, type Resultado } from "@/types/resultado";
import { aplicarTransicion } from "./transicionDeConvocatoria";

export type EntradaAprobarConvocatoria = {
  actual: Convocatoria;
  actor: ActorUsuario;
};

/**
 * Aprueba una convocatoria en dictamen.
 *
 * **R-05, separacion de funciones: quien la creo no puede aprobarla**, aunque
 * tenga el permiso. La guarda equivalente ya vive en `permisos.ts`, y esta no
 * es redundante: la de alla decide si se muestra el boton y si la action deja
 * pasar; esta impide que un servicio invocado desde otro sitio —un guion de
 * operacion, una etapa futura— se salte la regla sin darse cuenta.
 *
 * Se devuelve `forbidden` y no `invalid_state` a proposito: el estado de la
 * convocatoria es correcto, quien actua no.
 */
export const aprobarConvocatoria = async (
  entrada: EntradaAprobarConvocatoria,
  deps: DepsDeServicio = {},
): Promise<Resultado<{ estatus: EstatusConvocatoria }>> => {
  if (entrada.actual.creadoPor === entrada.actor.id) {
    return fallo("forbidden");
  }

  return aplicarTransicion(
    {
      actual: entrada.actual,
      evento: "APROBAR",
      tipoDeEvento: "CONVOCATORIA_APROBADA",
      actor: entrada.actor,
    },
    deps,
  );
};
