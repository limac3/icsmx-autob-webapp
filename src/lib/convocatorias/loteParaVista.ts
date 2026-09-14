import "server-only";

import type { FotografiaEnGaleria } from "@/components/GaleriaPublica";
import { consultarTamanoFila } from "@/lib/fila/conteosDeFila";
import { firmarFotografia } from "@/lib/media/cloudfrontSigner";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import type { Lote } from "@/types/lote";
import type { Vehiculo } from "@/types/vehiculo";

/**
 * Todo lo que el detalle de un lote necesita del vehiculo y de la fila.
 *
 * **Existe por la misma razon que `lotesParaCatalogo`**: la vista previa
 * administrativa (`/admin/convocatorias/[id]/vista-publica/lotes/[loteId]`)
 * tiene que leer **exactamente** lo mismo que el participante. Si cada pantalla
 * armara su lectura, la vista previa dejaria de serlo el dia que una de las dos
 * cambie —y ese dia nadie se entera, porque las dos siguen compilando—.
 *
 * **Las URLs se firman aqui, en cada peticion** (regla 13): nunca se persisten
 * ni se generan dentro de un bloque `"use cache"`.
 *
 * **Lo que no esta aqui, y no por olvido: `consultarMiLugar`.** Depende de
 * quien mira, no del lote, y la vista previa no lo pide: quien administra no
 * participa. Lo pide la pantalla del participante, que es la unica que tiene un
 * `participanteId` con el que la respuesta significa algo.
 */
export type DatosDeLoteParaVista = {
  vehiculo: Vehiculo;
  fotografias: FotografiaEnGaleria[];
  /** Una cantidad, jamas identidades (regla 7, R-12). */
  tamanoFila: number;
};

/**
 * `null` cuando el vehiculo no se puede leer.
 *
 * A diferencia del catalogo —donde un vehiculo ilegible sale con los campos en
 * blanco para no tumbar la rejilla entera— aqui **el vehiculo es la pantalla**:
 * sin el no queda nada que mostrar. Quien llama responde 404.
 */
export const loteParaVista = async (
  lote: Lote,
): Promise<DatosDeLoteParaVista | null> => {
  const [vehiculo, tamanoFila] = await Promise.all([
    obtenerVehiculo(lote.vehiculoId),
    consultarTamanoFila(lote.loteId),
  ]);
  if (!vehiculo.ok) return null;

  return {
    vehiculo: vehiculo.data,
    fotografias: vehiculo.data.fotografias.map((foto) => ({
      fotoId: foto.fotoId,
      url: firmarFotografia(foto.claveS3),
      descripcion: foto.descripcion,
    })),
    tamanoFila: tamanoFila.ok ? tamanoFila.data : 0,
  };
};
