import "server-only";

// PA-12 — bitacora completa de un agregado. `modelo-datos-dynamodb.md`
// seccion 5 y `api-contracts.md` seccion 6.
//
// Una sola `Query` sobre `PK = AUDIT#<agregado>#<agregadoId>`, en orden
// cronologico (la `SK` es `<ocurridoEn>#<eventoId>`, asi que no hace falta
// ordenar en memoria). Es la consulta que el auditor hace mas veces
// (trazabilidad-auditoria.md 2.1).

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { clave, type TipoDeAgregado } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { codificarCursor, decodificarCursor } from "@/lib/data/cursor";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import type { EventoDTO, PaginaDeEventosDTO } from "@/types/auditoria";
import { exito, type Resultado } from "@/types/resultado";
import { aEventoDTO } from "./mapeo";

/**
 * Tamano de pagina de la bitacora general.
 *
 * `reconstruirFila` y `exportarBitacora` **no** usan esta constante: leen la
 * historia entera de un lote, que por volumen (una fila de un lote) es
 * estructuralmente mas chica que la de una convocatoria a lo largo de meses.
 */
export const TAMANO_DE_PAGINA_BITACORA = 50;

export const consultarBitacora = async (
  entrada: {
    agregado: TipoDeAgregado;
    agregadoId: string;
    cursor?: string;
  },
  deps: DepsDeServicio = {},
): Promise<Resultado<PaginaDeEventosDTO>> => {
  const salida = await clienteDe(deps).send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": clave.particionDeEvento(entrada.agregado, entrada.agregadoId).PK,
      },
      ScanIndexForward: true,
      Limit: TAMANO_DE_PAGINA_BITACORA,
      ExclusiveStartKey: decodificarCursor(entrada.cursor),
    }),
  );

  const eventos = (salida.Items ?? [])
    .map(aEventoDTO)
    .filter(
      (evento): evento is NonNullable<typeof evento> => evento !== undefined,
    );

  return exito({
    eventos,
    cursor: codificarCursor(salida.LastEvaluatedKey),
  });
};

/**
 * La bitacora **entera** de un agregado, sin devolver cursor: paginar hacia
 * afuera no tiene sentido cuando quien llama necesita la historia completa
 * para calcular algo —reconstruir una fila, verificar su integridad,
 * exportarla—, no para mostrarla en pantalla.
 *
 * Al volumen de un lote o una convocatoria (cientos de eventos en toda su
 * vida, no miles) unas pocas paginas de `TAMANO_DE_PAGINA_BITACORA` bastan.
 */
export const consultarBitacoraCompleta = async (
  entrada: { agregado: TipoDeAgregado; agregadoId: string },
  deps: DepsDeServicio = {},
): Promise<Resultado<EventoDTO[]>> => {
  const eventos: EventoDTO[] = [];
  let cursor: string | undefined;

  do {
    const pagina = await consultarBitacora({ ...entrada, cursor }, deps);
    if (!pagina.ok) return pagina;
    eventos.push(...pagina.data.eventos);
    cursor = pagina.data.cursor;
  } while (cursor);

  return exito(eventos);
};
