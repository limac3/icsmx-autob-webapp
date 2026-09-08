import "server-only";

// Lee una solicitud a partir de su identificador de negocio.
//
// Ningun patron de acceso lee una solicitud sin conocer antes su `loteId`
// (modelo-datos-dynamodb.md seccion 5), y las actions de tesoreria
// (`api-contracts.md` seccion 5) solo reciben `solicitudId`. En vez de un
// indice nuevo, se recupera `loteId` y `turno` del identificador mismo con
// `loteYTurnoDesdeIdentificador` — es la garantia que ya documenta
// `identificadorDeSolicitud`: los dos componentes identifican la solicitud
// sin ambiguedad.

import { GetCommand } from "@aws-sdk/lib-dynamodb";

import { clave, loteYTurnoDesdeIdentificador } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import type { Solicitud } from "@/types/fila";
import { exito, fallo, type Resultado } from "@/types/resultado";
import { aSolicitud } from "./mapeo";

/**
 * `ConsistentRead`: quien acaba de subir el comprobante o de dictaminar tiene
 * que ver su propio cambio en la siguiente lectura.
 */
export const leerSolicitudPorId = async (
  solicitudId: string,
  deps: DepsDeServicio = {},
): Promise<Resultado<Solicitud>> => {
  const partes = loteYTurnoDesdeIdentificador(solicitudId);
  if (!partes) return fallo("not_found");

  const salida = await clienteDe(deps).send(
    new GetCommand({
      TableName: nombreDeTabla(),
      Key: clave.solicitud(partes.loteId, partes.turno),
      ConsistentRead: true,
    }),
  );
  if (!salida.Item) return fallo("not_found");

  const solicitud = aSolicitud(salida.Item);
  if (!solicitud) return fallo("not_found");

  return exito(solicitud);
};
