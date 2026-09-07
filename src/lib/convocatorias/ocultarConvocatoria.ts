import "server-only";

// T8 al reves — ocultar. El mismo par de pasos que publicar, en orden inverso.

import type { DepsDeServicio } from "@/lib/data/deps";
import type { ActorUsuario } from "@/types/auditoria";
import type {
  ConvocatoriaConLotes,
  EstatusConvocatoria,
} from "@/types/convocatoria";
import { fallo, type Resultado } from "@/types/resultado";
import { propagarALotes } from "./propagarALotes";
import { aplicarTransicion } from "./transicionDeConvocatoria";

export type EntradaOcultarConvocatoria = {
  actual: ConvocatoriaConLotes;
  motivo: string;
  /**
   * Si existe **alguna** solicitud sobre los lotes de esta convocatoria.
   *
   * Llega desde afuera, ya consultado, por la misma razon que el resto del
   * contexto: el servicio no lee para decidir. Es opcional en el tipo porque el
   * dato solo hace falta viniendo de `PUBLICADA`, pero se trata **cerrado por
   * omision** (regla 18): sin el, ocultar una publicada se deniega.
   */
  existeAlgunaSolicitud?: boolean;
  actor: ActorUsuario;
};

/**
 * Oculta una convocatoria.
 *
 * **R-06: no se puede ocultar una publicada que tenga solicitudes.** Dejaria a
 * participantes en una fila invisible, sin manera de saber en que lugar van ni
 * de cancelar. Desde `BORRADOR`, `EN_APROBACION` o `APROBADA` es libre: ahi no
 * hay fila que dejar a oscuras.
 *
 * **Primero los lotes, despues la convocatoria** — al reves que publicar. Una
 * interrupcion deja lotes ya cerrados bajo una convocatoria todavia visible:
 * quien entre no podra comprar, que es el lado seguro. Marcar primero la
 * convocatoria dejaria lotes aun comprables bajo una convocatoria oculta.
 */
export const ocultarConvocatoria = async (
  entrada: EntradaOcultarConvocatoria,
  deps: DepsDeServicio = {},
): Promise<Resultado<{ estatus: EstatusConvocatoria }>> => {
  const { actual } = entrada;

  const motivo = entrada.motivo.trim();
  if (motivo.length === 0) {
    // `CONVOCATORIA_OCULTA` esta marcado con **M** en el catalogo.
    return fallo("validation_failed", { motivo: "requerido" });
  }

  const vieneDePublicada = actual.estatus === "PUBLICADA";

  // Cerrado por omision: `!== false` y no `=== true`, para que un `undefined`
  // —el dato que quien invoca olvido pasar— deniegue en vez de conceder.
  if (vieneDePublicada && entrada.existeAlgunaSolicitud !== false) {
    return fallo("invalid_state");
  }

  if (vieneDePublicada) {
    const propagacion = await propagarALotes(
      {
        convocatoria: actual,
        lotes: actual.lotes,
        estatusConvocatoria: "OCULTA",
      },
      deps,
    );
    // Aqui si se corta ante un fallo, al reves que al publicar: la convocatoria
    // sigue publicada y sus lotes comprables, que es el estado de partida. No
    // se dejo nada a medias hacia el lado peligroso.
    if (!propagacion.ok) return fallo(propagacion.error);
  }

  return aplicarTransicion(
    {
      actual,
      evento: "OCULTAR",
      tipoDeEvento: "CONVOCATORIA_OCULTA",
      actor: entrada.actor,
      motivo,
      extras: { motivoOcultamiento: motivo },
    },
    deps,
  );
};
