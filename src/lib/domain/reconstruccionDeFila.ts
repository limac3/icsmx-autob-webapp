// Agrupa la bitacora **plana** de un lote (PA-12) en la forma que pide la
// pantalla 7 de `ui-ux-requerimientos.md`: una linea de tiempo por turno.
//
// Modulo puro: solo reordena datos que ya llegaron resueltos. La consulta
// vive en `src/lib/auditoria/reconstruirFila.ts`.

import type { EventoDTO, FilaHistoricaDTO } from "@/types/auditoria";
import { turnoDelEvento } from "./turnoDeEvento";

/**
 * `participanteId` de un turno sale del `actorId` de su propio
 * `SOLICITUD_CREADA`: quien pide entrar a la fila firma esa entrada
 * (`src/lib/fila/solicitarCompra.ts`), asi que no hace falta ninguna lectura
 * adicional para saber de quien es el turno.
 */
const participanteDelTurno = (eventos: readonly EventoDTO[]): string =>
  eventos.find((evento) => evento.tipo === "SOLICITUD_CREADA")?.actorId ?? "";

export const reconstruirHistoriaDeFila = (
  loteId: string,
  eventos: readonly EventoDTO[],
): FilaHistoricaDTO => {
  const porTurno = new Map<number, EventoDTO[]>();
  const eventosDelLote: EventoDTO[] = [];

  for (const evento of eventos) {
    const turno = turnoDelEvento(evento);
    if (turno === undefined) {
      eventosDelLote.push(evento);
      continue;
    }
    const lista = porTurno.get(turno) ?? [];
    lista.push(evento);
    porTurno.set(turno, lista);
  }

  const solicitudes = [...porTurno.entries()]
    .sort(([a], [b]) => a - b)
    .map(([turno, eventosDelTurno]) => ({
      turno,
      participanteId: participanteDelTurno(eventosDelTurno),
      eventos: eventosDelTurno,
    }));

  return { loteId, solicitudes, eventosDelLote };
};
