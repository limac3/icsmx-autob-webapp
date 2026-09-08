import type { EventoDTO } from "@/types/auditoria";

/**
 * El turno de un evento de fila o de pago, o `undefined` si no pertenece a
 * ninguno (`FILA_AGOTADA` es del lote entero).
 *
 * Puro y sin conocer la capa de datos: `datos.turno` ya llega completo por
 * `src/lib/auditoria/mapeo.ts`, que es quien sabe derivarlo de `solicitudId`
 * para `COMPROBANTE_CARGADO`, `PAGO_AVALADO` y `PAGO_RECHAZADO` (tesoreria no
 * conoce el turno). Que el dominio no tenga que saber eso es el punto:
 * `src/lib/domain` no importa nada de `src/lib/data`
 * (`estrategia-aplicacion.md` seccion 2, principio P-2).
 *
 * Comparten esta funcion `verificacionDeAuditoria.ts` y
 * `reconstruccionDeFila.ts`: las dos agrupan la misma bitacora por turno, y
 * que difirieran seria un bug que solo aparece con datos reales.
 */
export const turnoDelEvento = (evento: EventoDTO): number | undefined =>
  typeof evento.datos?.turno === "number" ? evento.datos.turno : undefined;
