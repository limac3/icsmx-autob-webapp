// Traduccion de `EventoDTO` a `FilaDeBitacora` — la vista que pintan
// `BitacoraDeEventos` y `ReconstruccionDeFila`.
//
// Puro y sin I/O: solo resuelve el diccionario (regla 11) y formatea la
// fecha. Vive fuera de las dos paginas que lo usan (`/auditoria` y
// `/auditoria/lotes/[loteId]`) porque las dos necesitan exactamente la misma
// traduccion, y que difirieran seria un bug silencioso entre pantallas.

import type { Diccionario } from "@/dictionaries";
import { desdeIso, formatearFechaHora } from "@/lib/domain/fechas";
import type { EventoDTO } from "@/types/auditoria";
import type { FilaDeBitacora } from "@/components/BitacoraDeEventos";

export const aFilaDeBitacora = (
  evento: EventoDTO,
  diccionario: Diccionario,
): FilaDeBitacora => {
  const instante = desdeIso(evento.ocurridoEn);

  return {
    eventoId: evento.eventoId,
    fecha: instante ? formatearFechaHora(instante) : evento.ocurridoEn,
    tipo: diccionario.tiposDeEvento[evento.tipo],
    actor:
      evento.actorTipo === "SISTEMA"
        ? diccionario.tiposDeActor.SISTEMA
        : `${diccionario.tiposDeActor.USUARIO} (${evento.actorId})`,
    correlacionId: evento.correlacionId,
    ...(evento.motivo ? { motivo: evento.motivo } : {}),
  };
};
