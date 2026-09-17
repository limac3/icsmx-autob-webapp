// PA-04 — la convocatoria con todos sus lotes, en una sola lectura.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { clave, PREFIJO } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import type { ConvocatoriaConLotes } from "@/types/convocatoria";
import type { Lote } from "@/types/lote";
import { exito, fallo, type Resultado } from "@/types/resultado";
import { registrar } from "@/lib/observabilidad/registro";
import {
  aConvocatoria,
  aLote,
  camposFaltantesDeConvocatoria,
  camposFaltantesDeLote,
} from "./mapeo";

/**
 * Lee la convocatoria y sus lotes con una sola `Query` sobre la particion.
 *
 * Los lotes cuelgan de `CONV#<id>` justamente para esto. Partir la lectura en
 * dos permitiria mostrar una convocatoria con los lotes de otro instante —por
 * ejemplo, el estatus de antes de publicar junto a lotes ya propagados.
 */
export const obtenerConvocatoria = async (
  convocatoriaId: string,
  deps: DepsDeServicio = {},
): Promise<Resultado<ConvocatoriaConLotes>> => {
  const { PK, SK } = clave.convocatoria(convocatoriaId);

  const salida = await clienteDe(deps).send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": PK },
    }),
  );

  const items = salida.Items ?? [];
  const meta = items.find((item) => item.SK === SK);
  if (!meta) return fallo("not_found");

  const convocatoria = aConvocatoria(meta);
  if (!convocatoria) {
    // **`not_found` sobre un item que si existe.** Es la respuesta correcta
    // para quien llama —no hay convocatoria utilizable—, pero indistinguible de
    // "nunca existio" para quien depura. Esta linea es la diferencia entre las
    // dos, y es lo unico que separa un identificador mal tecleado de una
    // convocatoria real que la aplicacion ya no sabe leer
    // (`desafios-implementacion.md` 78).
    registrar("warn", "obtenerConvocatoria", {
      convocatoriaId,
      desenlace: "rechazado",
      error: "item_no_mapeable",
      camposFaltantes: camposFaltantesDeConvocatoria(meta).join(","),
    });
    return fallo("not_found");
  }

  const lotes: Lote[] = [];
  for (const item of items) {
    if (!String(item.SK).startsWith(PREFIJO.lote)) continue;
    const lote = aLote(item);
    if (lote) {
      lotes.push(lote);
      continue;
    }

    // Un lote descartado es peor que una convocatoria descartada: la
    // convocatoria se abre igual, con un vehiculo menos y sin nada que lo diga.
    registrar("warn", "obtenerConvocatoria", {
      convocatoriaId,
      loteId: typeof item.loteId === "string" ? item.loteId : "(ilegible)",
      desenlace: "rechazado",
      error: "lote_no_mapeable",
      camposFaltantes: camposFaltantesDeLote(item).join(","),
    });
  }

  return exito({ ...convocatoria, lotes });
};
