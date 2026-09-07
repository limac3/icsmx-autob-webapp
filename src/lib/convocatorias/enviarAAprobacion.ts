import "server-only";

import type { DepsDeServicio } from "@/lib/data/deps";
import { revisarEnvioAAprobacion } from "@/lib/domain/convocatorias";
import type { ActorUsuario } from "@/types/auditoria";
import type {
  ConvocatoriaConLotes,
  EstatusConvocatoria,
} from "@/types/convocatoria";
import { fallo, type Resultado } from "@/types/resultado";
import { aplicarTransicion } from "./transicionDeConvocatoria";

export type EntradaEnviarAAprobacion = {
  /**
   * La convocatoria **con sus lotes**: la precondicion de "al menos un lote" no
   * se puede comprobar sin ellos, y volver a leerlos aqui abriria una ventana
   * entre la comprobacion y la escritura.
   */
  actual: ConvocatoriaConLotes;
  actor: ActorUsuario;
};

/**
 * Manda una convocatoria a dictamen.
 *
 * Es la ultima puerta antes de que otra persona tenga que revisarla, asi que
 * revalida **todo**: los datos y la existencia de al menos un lote vivo. Un
 * borrador incompleto se puede guardar; lo que no se puede es pedir que alguien
 * lo apruebe.
 */
export const enviarAAprobacion = async (
  entrada: EntradaEnviarAAprobacion,
  deps: DepsDeServicio = {},
): Promise<Resultado<{ estatus: EstatusConvocatoria }>> => {
  const { actual } = entrada;

  // Los lotes retirados no cuentan: siguen en la particion para el auditor,
  // pero una convocatoria cuyos lotes se retiraron todos esta vacia.
  const vivos = actual.lotes.filter((lote) => lote.estatus !== "RETIRADO");

  const errores = revisarEnvioAAprobacion({
    datos: actual,
    cantidadDeLotes: vivos.length,
  });
  if (Object.keys(errores).length > 0) {
    return fallo("validation_failed", errores);
  }

  return aplicarTransicion(
    {
      actual,
      evento: "ENVIAR_A_APROBACION",
      tipoDeEvento: "CONVOCATORIA_ENVIADA_A_APROBACION",
      actor: entrada.actor,
    },
    deps,
  );
};
