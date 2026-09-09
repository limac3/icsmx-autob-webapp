// Traduccion de `EventoDTO` a `FilaDeBitacora` — la vista que pintan
// `BitacoraDeEventos` y `ReconstruccionDeFila`.
//
// Puro y sin I/O: solo resuelve el diccionario (regla 11) y formatea la
// fecha. Vive fuera de las dos paginas que lo usan (`/auditoria` y
// `/auditoria/lotes/[loteId]`) porque las dos necesitan exactamente la misma
// traduccion, y que difirieran seria un bug silencioso entre pantallas.

import type { Diccionario } from "@/dictionaries";
import { desdeIso, formatearFechaHoraPrecisa } from "@/lib/domain/fechas";
import type { EventoDTO } from "@/types/auditoria";
import type { FilaDeBitacora } from "@/components/BitacoraDeEventos";

/**
 * Datos que esta funcion no puede resolver por si misma porque exigen I/O, y
 * que aporta quien ya leyo las entidades para armar los selects.
 */
export type ContextoDeFila = {
  /** Etiqueta legible del registro al que pertenece el evento. */
  registro?: string;
  /** Nombre o correo del actor, de su perfil (`leerPerfiles`). */
  nombreDeActor?: string;
};

export const aFilaDeBitacora = (
  evento: EventoDTO,
  diccionario: Diccionario,
  contexto: ContextoDeFila = {},
): FilaDeBitacora => {
  const instante = desdeIso(evento.ocurridoEn);

  return {
    eventoId: evento.eventoId,
    // Con milisegundos, que es toda la resolucion que `ocurridoEn` tiene. Dos
    // eventos del mismo milisegundo los distingue `eventoId`, que la tabla
    // muestra en su propia columna.
    fecha: instante ? formatearFechaHoraPrecisa(instante) : evento.ocurridoEn,
    tipo: diccionario.tiposDeEvento[evento.tipo],
    // El identificador acompana al nombre y no lo sustituye: el nombre viene de
    // un perfil que se sobrescribe en cada acceso, y lo que la bitacora
    // registro fue el identificador. Quien audita necesita ver el dato que
    // quedo escrito, no solo su version amable de hoy.
    actor:
      evento.actorTipo === "SISTEMA"
        ? diccionario.tiposDeActor.SISTEMA
        : `${contexto.nombreDeActor ?? diccionario.tiposDeActor.USUARIO} (${evento.actorId})`,
    correlacionId: evento.correlacionId,
    ...(evento.motivo ? { motivo: evento.motivo } : {}),
    ...(contexto.registro ? { registro: contexto.registro } : {}),
  };
};
