// Las seis comprobaciones de `trazabilidad-auditoria.md` 5.1, recalculadas
// desde el evento crudo — nunca desde lo que la aplicacion cree que paso.
//
// Modulo puro: sin I/O, sin reloj propio. Todo lo que necesita —la historia
// completa del lote y su estado vigente en la tabla— ya llego resuelto por
// quien invoca (`src/lib/auditoria/verificarIntegridad.ts`), igual que
// `gating.ts` recibe sus fechas ya evaluadas en vez de llamar a `Date.now()`.
//
// **Por que se agrupa por `correlacionId` y no se recorre evento por evento.**
// Los eventos de una misma transaccion comparten el mismo `ocurridoEn` al
// milisegundo (trazabilidad-auditoria 2.2), y su orden relativo en la `SK` lo
// desempata `eventoId` — un ULID con una parte aleatoria. Una reasignacion
// por vencimiento escribe `SOLICITUD_VENCIDA` (turno que libera) y
// `LOTE_ADJUDICADO` (turno que gana) **en la misma transaccion**, y nada
// garantiza que la `Query` los devuelva en ese orden. Replay evento-por-evento
// podria ver primero la adjudicacion nueva y marcar, por un instante que nunca
// existio de verdad, dos adjudicaciones vigentes. Agrupar por transaccion y
// aplicar sus efectos juntos elimina esa falsa alarma.

import type {
  ComprobacionDeIntegridad,
  EventoDTO,
  ResultadoVerificacion,
} from "@/types/auditoria";
import { exigeMotivo } from "@/types/auditoria";
import { turnoDelEvento } from "./turnoDeEvento";

/** Estados que sostienen la adjudicacion vigente de un lote. */
const ESTADOS_VIGENTES = new Set(["ADJUDICADA", "EN_VERIFICACION"]);

type Replay = {
  /** Ultimo `estadoNuevo` conocido de cada turno, al final de la historia. */
  estadoFinalPorTurno: Map<number, string>;
  saltosSinJustificar: { turnoSaltado: number; turnoAdjudicado: number }[];
  conflictos: { turnoVigente: number; turnoNuevo: number }[];
  turnosCreados: number[];
  duplicados: number[];
};

/**
 * Reproduce la historia agrupada por transaccion y calcula, en el mismo
 * recorrido, todo lo que las comprobaciones 2, 3 y 5 necesitan.
 */
const reproducir = (eventos: readonly EventoDTO[]): Replay => {
  const grupos = new Map<string, EventoDTO[]>();
  for (const evento of eventos) {
    const grupo = grupos.get(evento.correlacionId) ?? [];
    grupo.push(evento);
    grupos.set(evento.correlacionId, grupo);
  }

  const estadoPorTurno = new Map<number, string>();
  const omitidoPorTurno = new Set<number>();
  const turnosVistos = new Set<number>();
  const turnosCreados: number[] = [];
  const duplicados: number[] = [];
  const saltosSinJustificar: Replay["saltosSinJustificar"] = [];
  const conflictos: Replay["conflictos"] = [];
  let vigente: number | undefined;

  for (const grupo of grupos.values()) {
    // Pase 1: todo lo que no es la adjudicacion misma. Incluye la creacion
    // del turno, sus cambios de estado, y el registro de sus omisiones.
    for (const evento of grupo) {
      const turno = turnoDelEvento(evento);
      if (turno === undefined) continue;

      if (evento.tipo === "SOLICITUD_CREADA") {
        if (turnosVistos.has(turno)) duplicados.push(turno);
        turnosVistos.add(turno);
        turnosCreados.push(turno);
      }
      if (evento.tipo === "SOLICITUD_OMITIDA") omitidoPorTurno.add(turno);

      if (evento.tipo !== "LOTE_ADJUDICADO" && evento.estadoNuevo) {
        estadoPorTurno.set(turno, evento.estadoNuevo);
        if (turno === vigente && !ESTADOS_VIGENTES.has(evento.estadoNuevo)) {
          vigente = undefined;
        }
      }
    }

    // Pase 2: la adjudicacion, contra el estado que dejo el pase 1.
    for (const evento of grupo) {
      if (evento.tipo !== "LOTE_ADJUDICADO") continue;
      const turno = turnoDelEvento(evento);
      if (turno === undefined) continue;

      for (const [otro, estado] of estadoPorTurno) {
        if (otro >= turno) continue;
        const explicado = estado !== "EN_FILA" && omitidoPorTurno.has(otro);
        if (!explicado && (estado === "EN_FILA" || estado === "CONGELADA")) {
          saltosSinJustificar.push({
            turnoSaltado: otro,
            turnoAdjudicado: turno,
          });
        }
      }

      if (vigente !== undefined && vigente !== turno) {
        conflictos.push({ turnoVigente: vigente, turnoNuevo: turno });
      }

      estadoPorTurno.set(turno, "ADJUDICADA");
      vigente = turno;
    }
  }

  return {
    estadoFinalPorTurno: estadoPorTurno,
    saltosSinJustificar,
    conflictos,
    turnosCreados,
    duplicados,
  };
};

const comprobarTurnosContiguos = (replay: Replay): ComprobacionDeIntegridad => {
  const distintos = [...new Set(replay.turnosCreados)].sort((a, b) => a - b);
  const huecos: number[] = [];
  for (let i = 1; i < distintos.length; i += 1) {
    const anterior = distintos[i - 1];
    const actual = distintos[i];
    if (anterior === undefined || actual === undefined) continue;
    for (let hueco = anterior + 1; hueco < actual; hueco += 1)
      huecos.push(hueco);
  }

  return {
    clave: "turnosContiguos",
    veredicto:
      replay.duplicados.length > 0
        ? "incumple"
        : huecos.length > 0
          ? "informativo"
          : "cumple",
    huecos,
    duplicados: [...new Set(replay.duplicados)],
  };
};

const comprobarOrdenDeAdjudicacion = (
  replay: Replay,
): ComprobacionDeIntegridad => ({
  clave: "ordenDeAdjudicacion",
  veredicto: replay.saltosSinJustificar.length > 0 ? "incumple" : "cumple",
  saltosSinJustificar: replay.saltosSinJustificar,
});

const comprobarUnaAdjudicacionVigente = (
  replay: Replay,
): ComprobacionDeIntegridad => ({
  clave: "unaAdjudicacionVigente",
  veredicto: replay.conflictos.length > 0 ? "incumple" : "cumple",
  conflictos: replay.conflictos,
});

const comprobarVencimientosConTiempo = (
  eventos: readonly EventoDTO[],
): ComprobacionDeIntegridad => {
  const turnosConFechaInconsistente: number[] = [];
  for (const evento of eventos) {
    if (evento.tipo !== "SOLICITUD_VENCIDA") continue;
    const turno = turnoDelEvento(evento);
    const venceEn = evento.datos?.venceEn;
    const detectadoEn = evento.datos?.detectadoEn;
    if (
      turno === undefined ||
      typeof venceEn !== "string" ||
      typeof detectadoEn !== "string"
    ) {
      continue;
    }
    // Comparacion lexicografica: ambas son ISO-8601 UTC de formato fijo
    // (regla 9 de CLAUDE.md), que ordena igual que el tiempo que representa.
    if (detectadoEn < venceEn) turnosConFechaInconsistente.push(turno);
  }

  return {
    clave: "vencimientosConTiempo",
    veredicto: turnosConFechaInconsistente.length > 0 ? "incumple" : "cumple",
    turnosConFechaInconsistente,
  };
};

const comprobarTransicionesConEvento = (
  replay: Replay,
  estatusActual: ReadonlyMap<number, string>,
): ComprobacionDeIntegridad => {
  const turnosSinExplicar: number[] = [];
  for (const [turno, estatus] of estatusActual) {
    if (replay.estadoFinalPorTurno.get(turno) !== estatus) {
      turnosSinExplicar.push(turno);
    }
  }

  return {
    clave: "transicionesConEvento",
    veredicto: turnosSinExplicar.length > 0 ? "incumple" : "cumple",
    turnosSinExplicar: turnosSinExplicar.sort((a, b) => a - b),
  };
};

const comprobarMotivosObligatorios = (
  eventos: readonly EventoDTO[],
): ComprobacionDeIntegridad => {
  const eventosSinMotivo = eventos
    .filter((evento) => exigeMotivo(evento.tipo) && !evento.motivo?.trim())
    .map((evento) => evento.eventoId);

  return {
    clave: "motivosObligatorios",
    veredicto: eventosSinMotivo.length > 0 ? "incumple" : "cumple",
    eventosSinMotivo,
  };
};

export const verificarIntegridadDeLote = ({
  loteId,
  eventos,
  estatusActual,
}: {
  loteId: string;
  eventos: readonly EventoDTO[];
  /** Turno -> estatus vigente en la tabla base (PA-07, cualquier estatus). */
  estatusActual: ReadonlyMap<number, string>;
}): ResultadoVerificacion => {
  const replay = reproducir(eventos);

  return {
    loteId,
    comprobaciones: [
      comprobarTurnosContiguos(replay),
      comprobarOrdenDeAdjudicacion(replay),
      comprobarUnaAdjudicacionVigente(replay),
      comprobarVencimientosConTiempo(eventos),
      comprobarTransicionesConEvento(replay, estatusActual),
      comprobarMotivosObligatorios(eventos),
    ],
  };
};
