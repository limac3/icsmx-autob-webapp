import "server-only";

// Los dos conteos de la fila — `modelo-datos-dynamodb.md` 5.2.
//
//   tamanoFila  = solicitudes vivas del lote.
//   miPosicion  = cuantas vivas tienen turno menor que el mio, mas uno.
//
// **Se calculan con `Select: COUNT` sobre PA-07, sin traer los items.** Es lo
// que hace estructuralmente imposible filtrar identidades (R-12): los datos de
// terceros no salen de DynamoDB, asi que no hay nada que se pueda olvidar al
// serializar. Cambiar esto por una lectura que traiga los items y cuente en
// memoria funcionaria igual y romperia la garantia.
//
// Los dos viven juntos porque comparten el filtro de estados vivos y la misma
// promesa de privacidad; separarlos invitaria a que uno de los dos se escribiera
// algun dia trayendo items.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { clave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import { exito, type Resultado } from "@/types/resultado";
import { ESTADOS_VIVOS_SOLICITUD } from "@/types/solicitud";

/**
 * Marcas `:e1, :e2, ...` generadas del propio catalogo: un `IN (...)` con
 * marcas escritas a mano se desincronizaria en silencio si el catalogo de
 * estados vivos cambiara de tamano.
 */
const MARCAS_DE_ESTADO = ESTADOS_VIVOS_SOLICITUD.map(
  (_, indice) => `:e${String(indice + 1)}`,
);

const FILTRO_VIVAS = `estatus IN (${MARCAS_DE_ESTADO.join(", ")})`;

const VALORES_DE_ESTADO = Object.fromEntries(
  ESTADOS_VIVOS_SOLICITUD.map((estatus, indice) => [
    MARCAS_DE_ESTADO[indice],
    estatus,
  ]),
);

type Rango = { desde: string; hasta: string };

const contar = async (
  loteId: string,
  rango: Rango,
  deps: DepsDeServicio,
): Promise<number> => {
  const salida = await clienteDe(deps).send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :desde AND :hasta",
      FilterExpression: FILTRO_VIVAS,
      ExpressionAttributeValues: {
        ":pk": clave.solicitud(loteId, 0).PK,
        ":desde": rango.desde,
        ":hasta": rango.hasta,
        ...VALORES_DE_ESTADO,
      },
      Select: "COUNT",
    }),
  );

  return salida.Count ?? 0;
};

/**
 * Turno maximo representable en una `SK` de solicitud. Sirve de cota superior
 * del rango "todas las solicitudes del lote" sin tener que leer el contador.
 */
const TURNO_MAXIMO = 9_999_999_999;

/**
 * `tamanoFila`: solicitudes vivas del lote.
 *
 * Antes de que exista una sola solicitud devuelve cero, que es la respuesta
 * correcta de un lote sin fila y no un valor de relleno.
 */
export const consultarTamanoFila = async (
  loteId: string,
  deps: DepsDeServicio = {},
): Promise<Resultado<number>> =>
  exito(
    await contar(
      loteId,
      {
        desde: clave.solicitud(loteId, 0).SK,
        hasta: clave.solicitud(loteId, TURNO_MAXIMO).SK,
      },
      deps,
    ),
  );

/**
 * Cuantas solicitudes vivas tienen turno **estrictamente menor** que `turno`.
 *
 * `BETWEEN` es inclusivo en los dos extremos, asi que la cota superior es el
 * turno anterior: incluir el propio contaria a quien pregunta y devolveria una
 * posicion de mas. Con `turno = 1` los dos extremos coinciden en el turno 0,
 * que nunca existe —el contador entrega desde 1—, y el resultado es cero.
 */
export const contarVivasAntesDe = async (
  loteId: string,
  turno: number,
  deps: DepsDeServicio = {},
): Promise<Resultado<number>> => {
  if (turno <= 1) return exito(0);

  return exito(
    await contar(
      loteId,
      {
        desde: clave.solicitud(loteId, 0).SK,
        hasta: clave.solicitud(loteId, turno - 1).SK,
      },
      deps,
    ),
  );
};

export const __test__ = { FILTRO_VIVAS };
