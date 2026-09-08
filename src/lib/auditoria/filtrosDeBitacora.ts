// Filtros de la pantalla de bitacora (`ui-ux-requerimientos.md` 7) y de
// `exportarBitacora`. Puro: la unica lectura de DynamoDB para un agregado es
// PA-12 (`consultarBitacora.ts`); todo lo demas —tipo de evento, rango de
// fechas, participante— se aplica en memoria sobre lo que esa consulta ya
// trajo. Al volumen de la bitacora de un lote o de una convocatoria (cientos
// de eventos en toda su vida, nunca miles), filtrar despues de leer no pierde
// nada y evita una expresion dinamica para dos o tres condiciones opcionales
// — el mismo argumento que `listarVehiculos` aplica a su busqueda de texto.

import type { TipoDeAgregado } from "@/lib/data/claves";
import type { EventoDTO, TipoDeEvento } from "@/types/auditoria";

export type FiltrosDeBitacora = {
  agregado: TipoDeAgregado;
  agregadoId: string;
  tipo?: TipoDeEvento;
  /** ISO-8601 UTC, inclusivo. */
  desde?: string;
  /** ISO-8601 UTC, inclusivo. */
  hasta?: string;
  /** Compara contra `actorId`: quien participo, no solo quien administro. */
  participanteId?: string;
};

/**
 * `hasta` puede llegar como una fecha sin hora (`<input type="date">`, sin
 * JavaScript de cliente). Comparar esa cadena a secas excluiria por error
 * los eventos del propio dia: `"...T10:00Z" > "2026-10-06"` es cierto, porque
 * la cadena mas larga ordena despues que su propio prefijo — el mismo defecto
 * que `gsi2.cotaSuperiorPorFecha` corrige en `claves.ts`
 * (`desafios-implementacion.md` 29). Aqui basta extender al final del dia.
 */
const finDeRango = (fecha: string): string =>
  fecha.length === 10 ? `${fecha}T23:59:59.999Z` : fecha;

export const eventoCoincideConFiltros = (
  evento: EventoDTO,
  filtros: Pick<
    FiltrosDeBitacora,
    "tipo" | "desde" | "hasta" | "participanteId"
  >,
): boolean => {
  if (filtros.tipo && evento.tipo !== filtros.tipo) return false;
  // Comparacion lexicografica de ISO-8601 UTC de formato fijo: ordena igual
  // que el tiempo que representa (regla 9 de CLAUDE.md).
  if (filtros.desde && evento.ocurridoEn < filtros.desde) return false;
  if (filtros.hasta && evento.ocurridoEn > finDeRango(filtros.hasta))
    return false;
  if (filtros.participanteId && evento.actorId !== filtros.participanteId) {
    return false;
  }
  return true;
};
