import "server-only";

import type { LoteEnCatalogo } from "@/components/RejillaDeLotes";
import { consultarTamanoFila } from "@/lib/fila/conteosDeFila";
import { firmarFotografia } from "@/lib/media/cloudfrontSigner";
import {
  fuentesDeImagen,
  type FirmadorDeFotografia,
} from "@/lib/media/fuentesDeImagen";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import type { Lote } from "@/types/lote";
import { ANCHOS_DE_VARIANTE } from "@/types/vehiculo";

/**
 * Los lotes de una convocatoria, resueltos para la rejilla del catalogo.
 *
 * **Existe para que la vista previa administrativa lea exactamente lo mismo que
 * el participante.** Si cada pantalla armara su lista por su cuenta, la vista
 * previa dejaria de ser una vista previa el dia que una de las dos cambie —y ese
 * dia nadie se entera, porque las dos siguen compilando.
 *
 * **Las URLs se firman aqui, en cada peticion** (regla 13): nunca se persisten
 * ni se generan dentro de un bloque `"use cache"`.
 *
 * Un vehiculo que no se puede leer no rompe la pantalla: su lote sale con los
 * campos en blanco y el precio y el estatus, que vienen del propio lote. Es la
 * misma tolerancia que tenia la pagina publica antes de extraer esto.
 */
export const lotesParaCatalogo = async (
  lotes: readonly Lote[],
  deps: { firmar?: FirmadorDeFotografia } = {},
): Promise<LoteEnCatalogo[]> => {
  const firmar = deps.firmar ?? firmarFotografia;

  return Promise.all(
    lotes.map(async (lote): Promise<LoteEnCatalogo> => {
      const [vehiculo, tamanoFila] = await Promise.all([
        obtenerVehiculo(lote.vehiculoId),
        consultarTamanoFila(lote.loteId),
      ]);

      const foto =
        vehiculo.ok && vehiculo.data.fotografiaPrincipalId
          ? vehiculo.data.fotografias.find(
              (f) => f.fotoId === vehiculo.data.fotografiaPrincipalId,
            )
          : undefined;

      return {
        loteId: lote.loteId,
        marca: vehiculo.ok ? vehiculo.data.marca : "",
        version: vehiculo.ok ? vehiculo.data.version : "",
        modelo: vehiculo.ok ? vehiculo.data.modelo : 0,
        kilometraje: vehiculo.ok ? vehiculo.data.kilometraje : 0,
        precio: lote.precio,
        estatus: lote.estatus,
        tamanoFila: tamanoFila.ok ? tamanoFila.data : 0,
        ...(foto
          ? {
              fotografiaPrincipal: fuentesDeImagen(foto, {
                // **Sin la variante de 2048.** La tarjeta de esta rejilla nunca
                // pasa de unos 485 px CSS (la cuenta esta en
                // `RejillaDeLotes.tsx`), asi que solo la pediria una pantalla
                // de densidad mayor que 4. Ofrecerla seria peso que nadie
                // necesita, en la pantalla con mas imagenes de la aplicacion.
                anchoMaximo: ANCHOS_DE_VARIANTE.med,
                firmar,
              }),
            }
          : {}),
      };
    }),
  );
};
