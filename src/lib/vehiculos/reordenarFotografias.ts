import "server-only";

// Reordenamiento de la galeria.
//
// El orden vive en la **clave** (`FOTO#<orden:04d>#<fotoId>`), que es lo que
// permite leer la galeria ya ordenada. La contrapartida es que cambiar el orden
// no es una actualizacion sino una reubicacion: hay que borrar el item de la
// posicion vieja y escribirlo en la nueva.
//
// Se hace en **una sola transaccion** porque un reordenamiento a medias dejaria
// dos fotografias en la misma posicion o una desaparecida.

import { clave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  ejecutarTransaccion,
  MAXIMO_ITEMS_POR_TRANSACCION,
  type ItemDeTransaccion,
} from "@/lib/data/transacciones";
import { exito, fallo, type Resultado } from "@/types/resultado";
import type { Fotografia, VehiculoConFotografias } from "@/types/vehiculo";
import { resolver, type ActorUsuario, type DepsDeVehiculos } from "./deps";

export type EntradaReordenarFotografias = {
  actual: VehiculoConFotografias;
  /** Identificadores en el orden deseado. Debe ser la galeria completa. */
  ordenFotoIds: readonly string[];
  actor: ActorUsuario;
};

/**
 * Cada movimiento cuesta dos items —el `Delete` de la posicion vieja y el `Put`
 * de la nueva— mas el evento. Con el limite de 100 de `TransactWriteItems`, el
 * tope efectivo es menor que `MAXIMO_FOTOGRAFIAS`, asi que en la practica nunca
 * se alcanza; la comprobacion existe para que, si alguien sube ese maximo, el
 * fallo sea un mensaje claro y no una excepcion del SDK.
 */
export const MAXIMO_MOVIMIENTOS = Math.floor(
  (MAXIMO_ITEMS_POR_TRANSACCION - 1) / 2,
);

/**
 * Comprueba que la lista sea **la misma galeria, reordenada**.
 *
 * Ni un subconjunto ni una lista con repetidos: una permutacion parcial dejaria
 * fotografias fuera del nuevo orden, con su posicion vieja intacta y por tanto
 * intercalada donde nadie la puso.
 */
export const esPermutacion = (
  fotografias: readonly Fotografia[],
  ordenFotoIds: readonly string[],
): boolean => {
  if (ordenFotoIds.length !== fotografias.length) return false;
  const pedidos = new Set(ordenFotoIds);
  if (pedidos.size !== ordenFotoIds.length) return false;
  return fotografias.every((foto) => pedidos.has(foto.fotoId));
};

export const reordenarFotografias = async (
  entrada: EntradaReordenarFotografias,
  deps: DepsDeVehiculos = {},
): Promise<Resultado<{ vehiculoId: string }>> => {
  const { cliente, ahora } = resolver(deps);
  const { actual, ordenFotoIds } = entrada;

  if (!esPermutacion(actual.fotografias, ordenFotoIds)) {
    return fallo("validation_failed", { ordenFotoIds: "no_es_permutacion" });
  }

  const porId = new Map(
    actual.fotografias.map((foto) => [foto.fotoId, foto] as const),
  );

  // Solo se mueve lo que cambia de posicion. Ademas de ahorrar escrituras, es
  // necesario: un `Delete` y un `Put` sobre la **misma** clave son dos
  // operaciones sobre un mismo item, y DynamoDB rechaza la transaccion entera.
  const movimientos = ordenFotoIds
    .map((fotoId, indice) => ({ foto: porId.get(fotoId), destino: indice + 1 }))
    .filter(
      (movimiento): movimiento is { foto: Fotografia; destino: number } =>
        movimiento.foto !== undefined &&
        movimiento.foto.orden !== movimiento.destino,
    );

  if (movimientos.length === 0) {
    return exito({ vehiculoId: actual.vehiculoId });
  }
  if (movimientos.length > MAXIMO_MOVIMIENTOS) {
    return fallo("validation_failed", { ordenFotoIds: "demasiados_cambios" });
  }

  const tabla = nombreDeTabla();
  const items: ItemDeTransaccion[] = [];

  for (const { foto, destino } of movimientos) {
    items.push({
      item: {
        Delete: {
          TableName: tabla,
          Key: clave.fotografia(actual.vehiculoId, foto.orden, foto.fotoId),
          ConditionExpression: "attribute_exists(SK)",
        },
      },
      siFalla: "conflicto_concurrencia",
      descripcion: `retiro de ${foto.fotoId} de la posicion ${String(foto.orden)}`,
    });
    items.push({
      item: {
        Put: {
          TableName: tabla,
          Item: {
            ...clave.fotografia(actual.vehiculoId, destino, foto.fotoId),
            ...foto,
            orden: destino,
          },
          ConditionExpression: "attribute_not_exists(SK)",
        },
      },
      siFalla: "conflicto_concurrencia",
      descripcion: `colocacion de ${foto.fotoId} en la posicion ${String(destino)}`,
    });
  }

  items.push(
    eventoParaTransaccion({
      tipo: "VEHICULO_EDITADO",
      agregado: "VEHICULO",
      agregadoId: actual.vehiculoId,
      actor: entrada.actor,
      ocurridoEn: ahora,
      correlacionId: nuevaCorrelacion(ahora),
      vehiculoId: actual.vehiculoId,
      estadoAnterior: actual.estatus,
      estadoNuevo: actual.estatus,
      datos: { campos: ["ordenFotografias"], ordenFotoIds: [...ordenFotoIds] },
    }),
  );

  const resultado = await ejecutarTransaccion(items, { cliente });
  if (!resultado.ok) return fallo(resultado.error);
  return exito({ vehiculoId: actual.vehiculoId });
};
