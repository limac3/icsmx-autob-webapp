// El recorrido de paginas de una `Query`, en un solo lugar.
//
// DynamoDB corta cada `Query` en 1 MB de datos **leidos** y entrega el resto
// tras un `LastEvaluatedKey`. Quien no lo recorre no recibe un error: recibe una
// respuesta corta que parece completa. Es la clase de defecto que este proyecto
// ya pago tres veces en la bitacora (D-14), y la que la auditoria externa
// encontro despues en cinco lecturas de `src/lib/fila`.
//
// **`Limit` no sustituye este recorrido, y con `FilterExpression` lo empeora.**
// `Limit` acota items **leidos**, no items que pasan el filtro, asi que una
// pagina puede volver corta o vacia con datos de sobra detras. La regla ya
// estaba escrita en tres archivos del repo —`barridoDeVencimientos.ts`,
// `consultarBitacoraGlobal.ts` y `consultarActividadDeParticipante.ts`— y el
// patron resuelto cuatro veces en `src/lib/auditoria/`, siempre a mano. Aqui
// vive una vez.
//
// **Sin tope de paginas, a proposito.** Un tope convertiria este helper en el
// defecto que viene a arreglar: cortar en silencio es exactamente lo que hacia
// `adjudicarLote` cuando declaraba `FILA_AGOTADA` con candidatos vivos detras.
// El recorrido termina por contrato de DynamoDB —`LastEvaluatedKey` avanza
// siempre— y quien necesite acotar el trabajo debe acotar **resultados**, no
// paginas: eso lo hace quien llama, que es el unico que sabe que cuenta como
// resultado.
//
// **Sin `import "server-only"`, y no es un olvido.** El Lambda del barrido
// alcanza `adjudicarLote.ts` y este modulo con el; ese paquete resuelve a su
// rama de `throw` bajo el empaquetado `esbuild` de `defineFunction` y tumbaba
// el barrido en el 100% de sus invocaciones (`desafios-implementacion.md` 53).

import type { QueryCommand, QueryCommandOutput } from "@aws-sdk/lib-dynamodb";

import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";

/**
 * Construye el comando de cada pagina.
 *
 * Recibe la clave donde continuar y no un numero de pagina: es lo unico que
 * DynamoDB entiende, y pasarlo asi impide que quien llama invente un salto.
 */
export type ComandoPorPagina = (
  desde: Record<string, unknown> | undefined,
) => QueryCommand;

/**
 * Las paginas de una `Query`, una por una, hasta agotar la particion.
 *
 * Es un generador y no una funcion que acumula porque los tres usos que tiene
 * son distintos y solo quien llama sabe cual es el suyo: juntar items, sumar
 * `Count`, o parar en cuanto reune los resultados que necesita. Un `break` en
 * el `for await` cierra el recorrido sin leer la pagina siguiente.
 */
export async function* paginasDeQuery(
  crearComando: ComandoPorPagina,
  deps: DepsDeServicio,
): AsyncGenerator<QueryCommandOutput> {
  let desde: Record<string, unknown> | undefined;

  do {
    const salida = await clienteDe(deps).send(crearComando(desde));
    yield salida;
    desde = salida.LastEvaluatedKey;
  } while (desde);
}

/** Todos los items de la particion, ya sin paginas. */
export const itemsDeQuery = async (
  crearComando: ComandoPorPagina,
  deps: DepsDeServicio,
): Promise<Record<string, unknown>[]> => {
  const items: Record<string, unknown>[] = [];

  for await (const pagina of paginasDeQuery(crearComando, deps)) {
    items.push(...(pagina.Items ?? []));
  }

  return items;
};

/**
 * La suma de `Count` de todas las paginas.
 *
 * Con `Select: "COUNT"` DynamoDB **igual lee hasta 1 MB por pagina** y devuelve
 * solo lo que paso el filtro de esa pagina, asi que un conteo de una sola
 * consulta se queda corto exactamente igual que una lectura de items. Y
 * paginarlo no trae items, asi que no toca la garantia de R-12: los datos de
 * terceros siguen sin salir de DynamoDB.
 */
export const contarConQuery = async (
  crearComando: ComandoPorPagina,
  deps: DepsDeServicio,
): Promise<number> => {
  let total = 0;

  for await (const pagina of paginasDeQuery(crearComando, deps)) {
    total += pagina.Count ?? 0;
  }

  return total;
};
