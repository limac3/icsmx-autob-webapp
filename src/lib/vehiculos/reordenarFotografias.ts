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
//
// **La principal es la primera, y se actualiza aqui.** Desde que la pantalla
// 4.2 cambio el orden y la designacion por un solo campo —"la posicion 1 es la
// principal"—, mover una fotografia al frente **es** designarla. Si el puntero
// se actualizara aparte, habria dos fuentes de verdad para lo mismo y un
// reordenamiento a medias dejaria el listado mostrando una fotografia que ya no
// esta primero. Por eso el `Update` del vehiculo viaja en esta transaccion y no
// en otra llamada.
//
// Es la misma regla que `eliminarFotografia` ya aplicaba al promover la de menor
// orden cuando se borra la principal.

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
 * de la nueva— mas el evento **y** el posible `Update` de la principal. Con el
 * limite de 100 de `TransactWriteItems`, el tope efectivo es menor que
 * `MAXIMO_FOTOGRAFIAS`, asi que en la practica nunca se alcanza; la comprobacion
 * existe para que, si alguien sube ese maximo, el fallo sea un mensaje claro y
 * no una excepcion del SDK.
 *
 * Se descuentan **dos** items fijos y no uno, aunque el de la principal sea
 * condicional: reservar el sitio siempre es lo que evita que el tope dependa de
 * si la primera fotografia cambio o no.
 */
export const MAXIMO_MOVIMIENTOS = Math.floor(
  (MAXIMO_ITEMS_POR_TRANSACCION - 2) / 2,
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

  // La que queda primera es la principal. Solo se escribe si cambia: un
  // reordenamiento que no toca la cabeza no tiene por que mover
  // `actualizadoEn` del vehiculo ni competir con otras escrituras suyas.
  const primera = ordenFotoIds[0];
  const cambiaLaPrincipal =
    primera !== undefined && primera !== actual.fotografiaPrincipalId;

  if (cambiaLaPrincipal) {
    // La clave de la miniatura viaja con el identificador, en la misma
    // escritura: las dos describen la misma fotografia y separarlas dejaria al
    // listado de la pantalla 4.1 mostrando la anterior.
    const nueva = actual.fotografias.find((foto) => foto.fotoId === primera);

    items.push({
      item: {
        Update: {
          TableName: tabla,
          Key: clave.vehiculo(actual.vehiculoId),
          UpdateExpression:
            "SET #principal = :fotoId, #principalClave = :claveMin," +
            " #actualizadoEn = :momento, #actualizadoPor = :actor",
          ConditionExpression:
            "attribute_exists(PK) AND #estatus = :estatusEsperado",
          ExpressionAttributeNames: {
            "#principal": "fotografiaPrincipalId",
            "#principalClave": "fotografiaPrincipalClave",
            "#estatus": "estatus",
            "#actualizadoEn": "actualizadoEn",
            "#actualizadoPor": "actualizadoPor",
          },
          ExpressionAttributeValues: {
            ":fotoId": primera,
            // `nueva` sale de `actual.fotografias`, que es de donde salio
            // `primera` tras validarse como permutacion de la galeria: si
            // faltara, la lista enviada no seria una permutacion y el
            // reordenamiento ya se habria rechazado antes de llegar aqui.
            ":claveMin": nueva?.variantes.min.claveS3 ?? "",
            ":estatusEsperado": actual.estatus,
            ":momento": ahora.toISOString(),
            ":actor": entrada.actor.id,
          },
        },
      },
      siFalla: "invalid_state",
      descripcion: `vehiculo ${actual.vehiculoId} en ${actual.estatus}`,
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
      datos: {
        campos: cambiaLaPrincipal
          ? ["ordenFotografias", "fotografiaPrincipalId"]
          : ["ordenFotografias"],
        ordenFotoIds: [...ordenFotoIds],
        // La bitacora dice **que** quedo primera, no solo que el orden cambio:
        // sin esto, reconstruir quien era la principal en una fecha exigiria
        // replicar la regla de "la primera de la lista" al leer.
        ...(cambiaLaPrincipal
          ? {
              anterior: actual.fotografiaPrincipalId ?? null,
              nueva: primera,
            }
          : {}),
      },
    }),
  );

  const resultado = await ejecutarTransaccion(items, { cliente });
  if (!resultado.ok) return fallo(resultado.error);
  return exito({ vehiculoId: actual.vehiculoId });
};
