import "server-only";

// PA-02 — vehiculo con sus fotografias, en una sola lectura.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { clave, PREFIJO } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { exito, fallo, type Resultado } from "@/types/resultado";
import type { Fotografia, VehiculoConFotografias } from "@/types/vehiculo";
import { clienteDe, type DepsDeVehiculos } from "./deps";
import { aFotografia, aVehiculo } from "./mapeo";

/**
 * Lee el vehiculo y su galeria con una sola `Query` sobre la particion.
 *
 * Una `Query` y no un `GetItem` mas otra `Query`: el modelo pone las fotografias
 * bajo `VEH#<id>` justamente para que la pantalla de detalle sea una lectura, y
 * partirla en dos reintroduciria la posibilidad de mostrar un vehiculo con la
 * galeria de un instante distinto.
 */
export const obtenerVehiculo = async (
  vehiculoId: string,
  deps: DepsDeVehiculos = {},
): Promise<Resultado<VehiculoConFotografias>> => {
  const { PK, SK } = clave.vehiculo(vehiculoId);

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

  const vehiculo = aVehiculo(meta);
  if (!vehiculo) return fallo("not_found");

  const fotografias: Fotografia[] = [];
  for (const item of items) {
    if (!String(item.SK).startsWith(PREFIJO.fotografia)) continue;
    const foto = aFotografia(item);
    // Las fotografias llegan ya ordenadas: el orden va con ceros a la izquierda
    // en la clave, igual que el turno de la fila. No se ordena en memoria.
    if (foto) fotografias.push(foto);
  }

  return exito({ ...vehiculo, fotografias });
};
