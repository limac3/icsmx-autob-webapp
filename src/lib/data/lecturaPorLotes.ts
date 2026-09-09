import "server-only";

// `BatchGetItem` con troceado y reintento de las claves sin procesar.
//
// Existe porque la pantalla de auditoria necesita resolver, de golpe, las
// etiquetas legibles de todo lo que aparece en una busqueda: los vehiculos, las
// convocatorias, los lotes, las solicitudes y los perfiles de quienes actuaron.
// Hacerlo con una lectura por identificador convertiria una consulta en cientos
// de idas y vueltas, y el troceado de 100 en 100 es del protocolo, no de esta
// aplicacion: no tiene por que recordarlo cada quien que lo necesite.

import { BatchGetCommand } from "@aws-sdk/lib-dynamodb";

import type { Clave } from "./claves";
import { nombreDeTabla } from "./cliente";
import { clienteDe, type DepsDeServicio } from "./deps";

/** Tope de `BatchGetItem` en DynamoDB. No es una eleccion nuestra. */
export const CLAVES_POR_LOTE = 100;

/**
 * Pasadas maximas para las claves que DynamoDB devuelve sin procesar.
 *
 * Tres y no un reintento indefinido. Quien llama es siempre una lectura de
 * presentacion —etiquetas—, y lo que se pierde si una clave se queda fuera es
 * el nombre bonito, no el hecho: el identificador crudo sigue estando. Un
 * reintento sin cota, en cambio, dejaria una pantalla colgada.
 */
export const PASADAS_MAXIMAS = 3;

const texto = (valor: unknown): string | undefined =>
  typeof valor === "string" && valor.length > 0 ? valor : undefined;

const trocear = (claves: readonly Clave[]): Clave[][] => {
  const lotes: Clave[][] = [];
  for (let i = 0; i < claves.length; i += CLAVES_POR_LOTE) {
    lotes.push(claves.slice(i, i + CLAVES_POR_LOTE));
  }
  return lotes;
};

/**
 * Items de las claves pedidas, en orden indefinido y **sin garantia de
 * completitud**: `BatchGetItem` omite lo que no existe, y esta funcion omite
 * ademas lo que no alcanzo a procesar en `PASADAS_MAXIMAS`. Quien llama tiene
 * que tolerar la ausencia.
 *
 * Los lotes se piden en paralelo: son independientes y el orden del resultado
 * no significa nada.
 */
export const leerPorClaves = async (
  claves: readonly Clave[],
  deps: DepsDeServicio = {},
): Promise<Record<string, unknown>[]> => {
  if (claves.length === 0) return [];

  const tabla = nombreDeTabla();
  const cliente = clienteDe(deps);

  const porLote = await Promise.all(
    trocear(claves).map(async (lote) => {
      const items: Record<string, unknown>[] = [];
      let pendientes: Clave[] = [...lote];

      for (
        let pasada = 0;
        pasada < PASADAS_MAXIMAS && pendientes.length > 0;
        pasada++
      ) {
        const salida = await cliente.send(
          new BatchGetCommand({
            RequestItems: { [tabla]: { Keys: pendientes } },
          }),
        );

        items.push(...(salida.Responses?.[tabla] ?? []));

        pendientes = (salida.UnprocessedKeys?.[tabla]?.Keys ?? []).flatMap(
          (pendiente) => {
            const PK = texto(pendiente.PK);
            const SK = texto(pendiente.SK);
            return PK && SK ? [{ PK, SK }] : [];
          },
        );
      }

      return items;
    }),
  );

  return porLote.flat();
};
