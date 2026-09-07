import "server-only";

// T8 — publicar. Dos pasos, y **el orden es la garantia**.

import type { DepsDeServicio } from "@/lib/data/deps";
import type { ActorUsuario } from "@/types/auditoria";
import type {
  ConvocatoriaConLotes,
  EstatusConvocatoria,
} from "@/types/convocatoria";
import { exito, type Resultado } from "@/types/resultado";
import { propagarALotes } from "./propagarALotes";
import { aplicarTransicion } from "./transicionDeConvocatoria";

export type EntradaPublicarConvocatoria = {
  /** La convocatoria con sus lotes: hay que propagarles el estatus nuevo. */
  actual: ConvocatoriaConLotes;
  actor: ActorUsuario;
};

export type ResultadoDePublicacion = {
  estatus: EstatusConvocatoria;
  lotesPropagados: number;
  /**
   * `false` si la propagacion quedo a medias. La convocatoria **si** quedo
   * publicada; lo que falta es que los lotes se enteren, y hasta que se
   * complete no son comprables.
   */
  propagacionCompleta: boolean;
};

/**
 * Publica una convocatoria aprobada.
 *
 * **Primero la convocatoria, despues los lotes.** Una interrupcion entre los
 * dos pasos deja la convocatoria publicada con lotes que todavia dicen
 * `APROBADA`: el paso 1 de T1 exige `estatusConvocatoria = PUBLICADA` en el
 * lote, asi que esos lotes **no se pueden comprar**. Es el lado seguro, y al
 * reanudar aparecen.
 *
 * Al reves seria peligroso: lotes ya marcados `PUBLICADA` bajo una convocatoria
 * sin publicar serian comprables, que es exactamente el defecto que este orden
 * cierra (desafios-implementacion.md seccion 17).
 *
 * **Publicar no es hacer visible.** `publicadaEn` puede estar en el futuro; el
 * gating triple de R-01 lo comprueba al leer. Esta operacion solo cambia el
 * estatus.
 */
export const publicarConvocatoria = async (
  entrada: EntradaPublicarConvocatoria,
  deps: DepsDeServicio = {},
): Promise<Resultado<ResultadoDePublicacion>> => {
  const { actual } = entrada;

  const transicion = await aplicarTransicion(
    {
      actual,
      evento: "PUBLICAR",
      tipoDeEvento: "CONVOCATORIA_PUBLICADA",
      actor: entrada.actor,
    },
    deps,
  );
  if (!transicion.ok) return transicion;

  const propagacion = await propagarALotes(
    {
      convocatoria: { ...actual, estatus: transicion.data.estatus },
      lotes: actual.lotes,
      estatusConvocatoria: transicion.data.estatus,
    },
    deps,
  );

  // Una propagacion incompleta **no** es un fallo de la operacion: la
  // convocatoria quedo publicada y el evento escrito. Devolver error aqui haria
  // que la interfaz dijera "no se publico" sobre algo que si se publico, y
  // quien reintentara veria `invalid_state` porque ya no esta en `APROBADA`.
  return exito({
    estatus: transicion.data.estatus,
    lotesPropagados: propagacion.ok ? propagacion.data.lotesPropagados : 0,
    propagacionCompleta: propagacion.ok,
  });
};
