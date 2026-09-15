import { describe, expect, it } from "vitest";
import type { EventoDTO } from "@/types/auditoria";
import { verificarIntegridadDeLote } from "./verificacionDeAuditoria";

let contador = 0;
const evento = (
  parcial: Partial<EventoDTO> & { tipo: EventoDTO["tipo"] },
): EventoDTO => {
  contador += 1;
  return {
    eventoId: `E${String(contador)}`,
    ocurridoEn: `2026-10-06T10:00:${String(contador).padStart(2, "0")}.000Z`,
    actorTipo: "SISTEMA",
    actorId: "SISTEMA",
    correlacionId: `COR${String(contador)}`,
    loteId: "L1",
    ...parcial,
  };
};

const creada = (turno: number, correlacionId: string) =>
  evento({
    tipo: "SOLICITUD_CREADA",
    correlacionId,
    actorTipo: "USUARIO",
    actorId: `P${String(turno)}`,
    solicitudId: `L1-${String(turno)}`,
    estadoNuevo: "EN_FILA",
    datos: { turno },
  });

const adjudicado = (turno: number, correlacionId: string) =>
  evento({
    tipo: "LOTE_ADJUDICADO",
    correlacionId,
    solicitudId: `L1-${String(turno)}`,
    estadoAnterior: "EN_FILA",
    estadoNuevo: "ADJUDICADA",
    datos: { turno, motivoAdjudicacion: "PRIMERA_ADJUDICACION" },
  });

const vencida = (
  turno: number,
  correlacionId: string,
  venceEn = "2026-10-05T00:00:00.000Z",
  detectadoEn = "2026-10-06T00:00:00.000Z",
) =>
  evento({
    tipo: "SOLICITUD_VENCIDA",
    correlacionId,
    solicitudId: `L1-${String(turno)}`,
    estadoAnterior: "ADJUDICADA",
    estadoNuevo: "CANCELADA_POR_VENCIMIENTO",
    datos: { turno, venceEn, detectadoEn, detectadoPor: "BARRIDO" },
  });

const congelada = (turno: number, correlacionId: string) =>
  evento({
    tipo: "SOLICITUD_CONGELADA",
    correlacionId,
    solicitudId: `L1-${String(turno)}`,
    estadoAnterior: "EN_FILA",
    estadoNuevo: "CONGELADA",
    datos: { turno, loteQueGano: "OTRO-LOTE" },
  });

/** La omision de antes de la Etapa 14: siempre venia con un congelamiento. */
const omitida = (turno: number, correlacionId: string) =>
  evento({
    tipo: "SOLICITUD_OMITIDA",
    correlacionId,
    solicitudId: `L1-${String(turno)}`,
    datos: { turno, razonOmision: "ADJUDICACION_ACTIVA" },
  });

/** La omision de hoy: el saltado se queda `EN_FILA` y no hay nada mas. */
const omitidaPorCupo = (turno: number, correlacionId: string) =>
  evento({
    tipo: "SOLICITUD_OMITIDA",
    correlacionId,
    solicitudId: `L1-${String(turno)}`,
    datos: { turno, razonOmision: "LIMITE_ALCANZADO", limiteAdjudicaciones: 1 },
  });

/** La decision del adjudicador: firmada por una persona y con su motivo (R-23). */
const adjudicadoAMano = (
  turno: number,
  correlacionId: string,
  motivo: string,
) =>
  evento({
    tipo: "LOTE_ADJUDICADO",
    correlacionId,
    actorTipo: "USUARIO",
    actorId: "ADJ1",
    solicitudId: `L1-${String(turno)}`,
    estadoAnterior: "EN_FILA",
    estadoNuevo: "ADJUDICADA",
    motivo,
    datos: { turno, motivoAdjudicacion: "DECISION_MANUAL" },
  });

const pagoAvalado = (turno: number, correlacionId: string) =>
  evento({
    tipo: "PAGO_AVALADO",
    correlacionId,
    // `datos.turno` ya llega completado por `mapeo.ts` (que lo deriva del
    // `solicitudId` para los eventos de tesoreria) antes de que un evento
    // real alcance esta capa; se declara aqui explicito porque esta prueba
    // construye el DTO a mano, sin pasar por el mapeo.
    solicitudId: `L1-${String(turno)}`,
    estadoAnterior: "EN_VERIFICACION",
    estadoNuevo: "VENDIDA",
    datos: { turno },
  });

describe("verificarIntegridadDeLote", () => {
  it("una fila sin incidentes cumple las seis comprobaciones", () => {
    const eventos = [creada(1, "A"), adjudicado(1, "B"), pagoAvalado(1, "C")];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map([[1, "VENDIDA"]]),
    });

    expect(resultado.comprobaciones.map((c) => c.veredicto)).toEqual([
      "cumple",
      "cumple",
      "cumple",
      "cumple",
      "cumple",
      "cumple",
    ]);
  });

  it("turnosContiguos: un hueco es informativo, no un defecto", () => {
    const eventos = [creada(1, "A"), creada(3, "B")];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map(),
    });

    const comprobacion = resultado.comprobaciones.find(
      (c) => c.clave === "turnosContiguos",
    );
    expect(comprobacion).toMatchObject({
      veredicto: "informativo",
      huecos: [2],
    });
  });

  it("turnosContiguos: un turno creado dos veces incumple", () => {
    const eventos = [creada(1, "A"), creada(1, "B")];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map(),
    });

    expect(
      resultado.comprobaciones.find((c) => c.clave === "turnosContiguos"),
    ).toMatchObject({ veredicto: "incumple", duplicados: [1] });
  });

  it("ordenDeAdjudicacion: un turno congelado con SOLICITUD_OMITIDA no es un salto sospechoso", () => {
    const eventos = [
      creada(1, "A"),
      creada(2, "B"),
      congelada(1, "C"),
      omitida(1, "C"),
      adjudicado(2, "D"),
    ];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map([
        [1, "CONGELADA"],
        [2, "ADJUDICADA"],
      ]),
    });

    expect(
      resultado.comprobaciones.find((c) => c.clave === "ordenDeAdjudicacion"),
    ).toMatchObject({ veredicto: "cumple", saltosSinJustificar: [] });
  });

  it("ordenDeAdjudicacion: un salto por cupo agotado se justifica con el evento solo", () => {
    // **El caso que la Etapa 14 introdujo y que estuvo a punto de romper esta
    // comprobacion.** Al sustituir R-09 por el cupo por convocatoria, a quien
    // agota su cupo ya no se le congela: se le **omite** y se queda `EN_FILA`
    // con su turno, para recuperar su lugar si el cupo se libera.
    //
    // La condicion original exigia ademas que el turno saltado hubiera cambiado
    // de estado — una redundancia valida mientras omitir implicara congelar.
    // Con ella puesta, **cada salto legitimo por cupo apareceria como
    // `saltosSinJustificar`**: la pantalla de auditoria acusaria de fraude al
    // comportamiento que el negocio pidio.
    const eventos = [
      creada(1, "A"),
      creada(2, "B"),
      omitidaPorCupo(1, "C"),
      adjudicado(2, "D"),
    ];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map([
        [1, "EN_FILA"],
        [2, "ADJUDICADA"],
      ]),
    });

    expect(
      resultado.comprobaciones.find((c) => c.clave === "ordenDeAdjudicacion"),
    ).toMatchObject({ veredicto: "cumple", saltosSinJustificar: [] });
  });

  it("ordenDeAdjudicacion: se adjudica el turno 2 con el turno 1 todavia vivo, sin explicacion", () => {
    const eventos = [creada(1, "A"), creada(2, "B"), adjudicado(2, "C")];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map([
        [1, "EN_FILA"],
        [2, "ADJUDICADA"],
      ]),
    });

    expect(
      resultado.comprobaciones.find((c) => c.clave === "ordenDeAdjudicacion"),
    ).toMatchObject({
      veredicto: "incumple",
      saltosSinJustificar: [{ turnoSaltado: 1, turnoAdjudicado: 2 }],
    });
  });

  it("ordenDeAdjudicacion: una CONGELADA sin su SOLICITUD_OMITIDA tambien incumple", () => {
    // Simula un defecto de codigo: el turno se congelo pero nadie escribio
    // por que se le salto. "Un salto sin registro es indistinguible de un
    // fraude" (trazabilidad-auditoria.md 3).
    const eventos = [
      creada(1, "A"),
      creada(2, "B"),
      congelada(1, "C"),
      adjudicado(2, "D"),
    ];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map(),
    });

    expect(
      resultado.comprobaciones.find((c) => c.clave === "ordenDeAdjudicacion"),
    ).toMatchObject({ veredicto: "incumple" });
  });

  it("unaAdjudicacionVigente: una reasignacion por vencimiento en la misma transaccion no marca conflicto", () => {
    // SOLICITUD_VENCIDA (turno 1) y LOTE_ADJUDICADO (turno 2) comparten
    // correlacionId, y el orden entre ambos en el arreglo no deberia importar
    // (es lo que agrupar por transaccion garantiza).
    const eventos = [
      creada(1, "A"),
      creada(2, "B"),
      adjudicado(1, "A2"),
      adjudicado(2, "C"),
      vencida(1, "C"),
    ];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map([
        [1, "CANCELADA_POR_VENCIMIENTO"],
        [2, "ADJUDICADA"],
      ]),
    });

    expect(
      resultado.comprobaciones.find(
        (c) => c.clave === "unaAdjudicacionVigente",
      ),
    ).toMatchObject({ veredicto: "cumple", conflictos: [] });
  });

  it("unaAdjudicacionVigente: dos adjudicaciones vigentes al mismo tiempo incumple", () => {
    // Turno 1 se adjudica y nunca se libera; turno 2 se adjudica en una
    // transaccion aparte, sin ninguna evento que cierre la del turno 1.
    const eventos = [
      creada(1, "A"),
      creada(2, "B"),
      adjudicado(1, "C"),
      adjudicado(2, "D"),
    ];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map(),
    });

    expect(
      resultado.comprobaciones.find(
        (c) => c.clave === "unaAdjudicacionVigente",
      ),
    ).toMatchObject({
      veredicto: "incumple",
      conflictos: [{ turnoVigente: 1, turnoNuevo: 2 }],
    });
  });

  it("vencimientosConTiempo: detectadoEn anterior a venceEn incumple", () => {
    const eventos = [
      creada(1, "A"),
      vencida(1, "B", "2026-10-06T00:00:00.000Z", "2026-10-05T00:00:00.000Z"),
    ];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map(),
    });

    expect(
      resultado.comprobaciones.find((c) => c.clave === "vencimientosConTiempo"),
    ).toMatchObject({
      veredicto: "incumple",
      turnosConFechaInconsistente: [1],
    });
  });

  it("transicionesConEvento: el estatus vigente coincide con eventos que no llevan turno en datos (PAGO_AVALADO por solicitudId)", () => {
    const eventos = [creada(1, "A"), adjudicado(1, "B"), pagoAvalado(1, "C")];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map([[1, "VENDIDA"]]),
    });

    expect(
      resultado.comprobaciones.find((c) => c.clave === "transicionesConEvento"),
    ).toMatchObject({ veredicto: "cumple", turnosSinExplicar: [] });
  });

  it("transicionesConEvento: un estatus vigente sin historia que lo explique incumple", () => {
    // La tabla dice VENDIDA pero la bitacora se quedo en ADJUDICADA: una
    // mutacion que no escribio su evento (regla 4 rota).
    const eventos = [creada(1, "A"), adjudicado(1, "B")];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map([[1, "VENDIDA"]]),
    });

    expect(
      resultado.comprobaciones.find((c) => c.clave === "transicionesConEvento"),
    ).toMatchObject({ veredicto: "incumple", turnosSinExplicar: [1] });
  });

  it("motivosObligatorios: un PAGO_RECHAZADO sin motivo incumple", () => {
    const eventos = [
      creada(1, "A"),
      evento({
        tipo: "PAGO_RECHAZADO",
        correlacionId: "B",
        solicitudId: "L1-1",
        estadoAnterior: "EN_VERIFICACION",
        estadoNuevo: "CANCELADA_POR_VENCIMIENTO",
        motivo: undefined,
      }),
    ];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map(),
    });

    expect(
      resultado.comprobaciones.find((c) => c.clave === "motivosObligatorios"),
    ).toMatchObject({ veredicto: "incumple" });
  });

  it("motivosObligatorios: con motivo presente cumple", () => {
    const eventos = [
      evento({
        tipo: "PAGO_RECHAZADO",
        correlacionId: "A",
        solicitudId: "L1-1",
        motivo: "Comprobante ilegible",
      }),
    ];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map(),
    });

    expect(
      resultado.comprobaciones.find((c) => c.clave === "motivosObligatorios"),
    ).toMatchObject({ veredicto: "cumple", eventosSinMotivo: [] });
  });

  it("ordenDeAdjudicacion: una decision manual firmada no produce saltos (R-23)", () => {
    // **Saltarse turnos menores es el proposito de la modalidad, no una
    // anomalia.** Exigir el orden FIFO aqui marcaria `incumple` en cada
    // decision humana legitima — el mismo error que la clausula de estado
    // producia con los cupos.
    const eventos = [
      creada(1, "A"),
      creada(2, "B"),
      creada(3, "C"),
      adjudicadoAMano(3, "D", "mejor documentacion"),
    ];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map([
        [1, "EN_FILA"],
        [2, "EN_FILA"],
        [3, "ADJUDICADA"],
      ]),
    });

    expect(
      resultado.comprobaciones.find((c) => c.clave === "ordenDeAdjudicacion"),
    ).toMatchObject({
      veredicto: "cumple",
      saltosSinJustificar: [],
      decisionesManualesSinFirma: [],
    });
  });

  it("ordenDeAdjudicacion: una decision manual SIN actor humano si incumple", () => {
    // Lo contrario de lo que dice ser: un automatismo que decidio donde debia
    // decidir alguien. Es la senal que la modalidad manual necesita que exista.
    const eventos = [
      creada(1, "A"),
      creada(2, "B"),
      evento({
        tipo: "LOTE_ADJUDICADO",
        correlacionId: "C",
        solicitudId: "L1-2",
        estadoAnterior: "EN_FILA",
        estadoNuevo: "ADJUDICADA",
        motivo: "criterio",
        datos: { turno: 2, motivoAdjudicacion: "DECISION_MANUAL" },
      }),
    ];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map([
        [1, "EN_FILA"],
        [2, "ADJUDICADA"],
      ]),
    });

    expect(
      resultado.comprobaciones.find((c) => c.clave === "ordenDeAdjudicacion"),
    ).toMatchObject({
      veredicto: "incumple",
      decisionesManualesSinFirma: [2],
    });
  });

  it("ordenDeAdjudicacion: una decision manual SIN motivo tambien incumple", () => {
    // Una decision humana sin razon escrita es tan opaca para el auditor como
    // un salto de turno sin evento.
    const eventos = [
      creada(1, "A"),
      creada(2, "B"),
      adjudicadoAMano(2, "C", "   "),
    ];

    const resultado = verificarIntegridadDeLote({
      loteId: "L1",
      eventos,
      estatusActual: new Map([
        [1, "EN_FILA"],
        [2, "ADJUDICADA"],
      ]),
    });

    expect(
      resultado.comprobaciones.find((c) => c.clave === "ordenDeAdjudicacion"),
    ).toMatchObject({
      veredicto: "incumple",
      decisionesManualesSinFirma: [2],
    });
  });
});
