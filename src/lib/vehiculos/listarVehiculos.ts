import "server-only";

// PA-03 — vehiculos por estatus, para el catalogo administrativo.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { gsi2, NOMBRES_DE_INDICE } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { exito, type Resultado } from "@/types/resultado";
import {
  ESTATUS_VEHICULO,
  type EstatusVehiculo,
  type Vehiculo,
} from "@/types/vehiculo";
import { clienteDe, type DepsDeVehiculos } from "./deps";
import { aVehiculo } from "./mapeo";

export type FiltroDeVehiculos = {
  /** Estatus a incluir. Sin este campo, todos. */
  estatus?: readonly EstatusVehiculo[];
  /** Texto libre sobre marca y version. */
  busqueda?: string;
};

/**
 * Tope de items por estatus.
 *
 * El catalogo de una flotilla se cuenta en cientos, no en millones, y esta
 * pantalla es de trabajo: quien busca un vehiculo concreto usa el filtro. El
 * tope existe para que una tabla que crezca sin control no convierta la pagina
 * en una descarga; cuando haga falta paginar de verdad, se pagina.
 */
export const MAXIMO_POR_ESTATUS = 500;

/**
 * Lista vehiculos, filtrando por estatus.
 *
 * **Una `Query` por estatus, nunca un `Scan`.** El modelo no tiene una particion
 * de "todos los vehiculos" y fabricarla concentraria la escritura del catalogo
 * entero en una sola clave. Cinco consultas en paralelo sobre un indice son mas
 * baratas y mas predecibles que un `Scan` de la tabla, que ademas leeria
 * solicitudes, lotes y bitacora para descartarlos.
 */
export const listarVehiculos = async (
  filtro: FiltroDeVehiculos = {},
  deps: DepsDeVehiculos = {},
): Promise<Resultado<Vehiculo[]>> => {
  const cliente = clienteDe(deps);
  const estatus = filtro.estatus ?? ESTATUS_VEHICULO;

  const porEstatus = await Promise.all(
    estatus.map(async (uno) => {
      const salida = await cliente.send(
        new QueryCommand({
          TableName: nombreDeTabla(),
          IndexName: NOMBRES_DE_INDICE.porEstatus,
          KeyConditionExpression: "GSI2PK = :pk",
          ExpressionAttributeValues: {
            ":pk": gsi2.particionDeEstatus("VEH", uno).GSI2PK,
          },
          // Mas reciente primero: en una pantalla de trabajo, lo que se acaba
          // de dar de alta es lo que se va a tocar.
          ScanIndexForward: false,
          Limit: MAXIMO_POR_ESTATUS,
        }),
      );
      return salida.Items ?? [];
    }),
  );

  const vehiculos: Vehiculo[] = [];
  for (const item of porEstatus.flat()) {
    const vehiculo = aVehiculo(item);
    if (vehiculo) vehiculos.push(vehiculo);
  }

  const encontrados = coincidentes(vehiculos, filtro.busqueda);

  // Con varios estatus, cada `Query` trae su propio orden y concatenarlos no
  // produce ninguno. Se ordena aqui —en memoria, sobre un resultado acotado—
  // porque el orden de esta pantalla es de presentacion. No confundir con la
  // fila, cuyo orden es una garantia y por eso jamas se ordena en memoria.
  return exito(
    encontrados.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)),
  );
};

const coincidentes = (
  vehiculos: readonly Vehiculo[],
  busqueda: string | undefined,
): Vehiculo[] => {
  const termino = busqueda?.trim().toLocaleLowerCase();
  if (!termino) return [...vehiculos];

  // Se filtra en el servidor y despues de leer, no con `FilterExpression`: un
  // filtro de DynamoDB se aplica igual despues de consumir la lectura, asi que
  // no ahorra nada, y hacerlo aqui permite normalizar mayusculas y acentos, que
  // la expresion no sabe hacer.
  return vehiculos.filter((vehiculo) =>
    `${vehiculo.marca} ${vehiculo.version}`
      .toLocaleLowerCase()
      .includes(termino),
  );
};
