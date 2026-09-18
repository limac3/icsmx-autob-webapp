import "server-only";

// PA-02 — vehiculo con sus fotografias, en una sola lectura.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { clave, PREFIJO } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { exito, fallo, type Resultado } from "@/types/resultado";
import type { Fotografia, VehiculoConFotografias } from "@/types/vehiculo";
import { clienteDe, type DepsDeVehiculos } from "./deps";
import { aFotografia, aVehiculo } from "./mapeo";

export type OpcionesDeLectura = {
  /**
   * `true` cuando lo leido va a **decidir una escritura**.
   *
   * Cuesta el doble de RCU y no se sirve desde replica, asi que no se enciende
   * para mostrar: lo enciende `conVehiculo`, que es por donde pasan todas las
   * mutaciones.
   */
  consistente?: boolean;
};

/**
 * Lee el vehiculo y su galeria con una sola `Query` sobre la particion.
 *
 * Una `Query` y no un `GetItem` mas otra `Query`: el modelo pone las fotografias
 * bajo `VEH#<id>` justamente para que la pantalla de detalle sea una lectura, y
 * partirla en dos reintroduciria la posibilidad de mostrar un vehiculo con la
 * galeria de un instante distinto.
 *
 * **`ConsistentRead` solo cuando la lectura alimenta una escritura, y hace
 * falta de verdad.** Una `Query` de DynamoDB es eventualmente consistente por
 * omision, y esta alimenta tres calculos de leer-y-decidir: el `orden` de una
 * fotografia nueva (`maximo + 1`), si es la primera y por tanto la principal, y
 * la comprobacion de permutacion al reordenar. Con dos mutaciones seguidas
 * sobre el mismo vehiculo —la subida de varias fotografias de un tiro—, la
 * segunda lectura podia no ver lo que acababa de escribir la primera: dos
 * fotografias con el mismo `orden`, dos reclamando ser la principal, y un
 * reordenamiento rechazado con `no_es_permutacion` porque la lista enviada
 * tenia mas identificadores que la galeria leida. Es el mismo motivo por el que
 * `leerFila` lo lleva desde la Etapa 8 (`modelo-datos-dynamodb.md` 8).
 *
 * **Apagado por omision y no al reves**: `obtenerVehiculo` lo llaman once
 * lugares y casi todos son de presentacion —el catalogo lo invoca una vez por
 * lote, que es la lectura mas caliente de la aplicacion—. Encenderlo para todos
 * duplicaria el consumo ahi para resolver un problema que solo tiene el camino
 * de escritura.
 */
export const obtenerVehiculo = async (
  vehiculoId: string,
  deps: DepsDeVehiculos = {},
  opciones: OpcionesDeLectura = {},
): Promise<Resultado<VehiculoConFotografias>> => {
  const { PK, SK } = clave.vehiculo(vehiculoId);

  const salida = await clienteDe(deps).send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": PK },
      ...(opciones.consistente === true ? { ConsistentRead: true } : {}),
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
