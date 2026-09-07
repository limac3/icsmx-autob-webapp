import "server-only";

// PA-04 — la convocatoria con todos sus lotes, en una sola lectura.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { clave, PREFIJO } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import type { ConvocatoriaConLotes } from "@/types/convocatoria";
import type { Lote } from "@/types/lote";
import { exito, fallo, type Resultado } from "@/types/resultado";
import { aConvocatoria, aLote } from "./mapeo";

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
  if (!convocatoria) return fallo("not_found");

  const lotes: Lote[] = [];
  for (const item of items) {
    if (!String(item.SK).startsWith(PREFIJO.lote)) continue;
    const lote = aLote(item);
    if (lote) lotes.push(lote);
  }

  return exito({ ...convocatoria, lotes });
};
