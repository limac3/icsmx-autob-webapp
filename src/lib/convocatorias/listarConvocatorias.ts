// PA-05 — convocatorias por estatus, para la pantalla de administracion y para
// la bandeja del aprobador.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { gsi2, NOMBRES_DE_INDICE } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import {
  ESTATUS_CONVOCATORIA,
  type Convocatoria,
  type EstatusConvocatoria,
} from "@/types/convocatoria";
import { exito, type Resultado } from "@/types/resultado";
import { aConvocatoria } from "./mapeo";

export type FiltroDeConvocatorias = {
  /** Estatus a incluir. Sin este campo, todos. */
  estatus?: readonly EstatusConvocatoria[];
};

/**
 * Tope por estatus. Una convocatoria agrupa vehiculos, asi que se cuentan por
 * decenas al ano; el tope existe para que un crecimiento inesperado no
 * convierta la pantalla en una descarga.
 */
export const MAXIMO_POR_ESTATUS = 500;

/**
 * Lista convocatorias, filtrando por estatus.
 *
 * **Una `Query` por estatus, nunca un `Scan`.** El modelo no tiene una
 * particion de "todas las convocatorias", y fabricarla concentraria toda la
 * escritura en una sola clave.
 */
export const listarConvocatorias = async (
  filtro: FiltroDeConvocatorias = {},
  deps: DepsDeServicio = {},
): Promise<Resultado<Convocatoria[]>> => {
  const cliente = clienteDe(deps);
  const estatus = filtro.estatus ?? ESTATUS_CONVOCATORIA;

  const porEstatus = await Promise.all(
    estatus.map(async (uno) => {
      const salida = await cliente.send(
        new QueryCommand({
          TableName: nombreDeTabla(),
          IndexName: NOMBRES_DE_INDICE.porEstatus,
          KeyConditionExpression: "GSI2PK = :pk",
          ExpressionAttributeValues: {
            ":pk": gsi2.particionDeEstatus("CONV", uno).GSI2PK,
          },
          Limit: MAXIMO_POR_ESTATUS,
        }),
      );
      return salida.Items ?? [];
    }),
  );

  const convocatorias = porEstatus
    .flat()
    .map((item) => aConvocatoria(item))
    .filter((una): una is Convocatoria => una !== undefined);

  // Mas reciente primero: quien administra trabaja sobre lo ultimo que creo.
  convocatorias.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));

  return exito(convocatorias);
};
