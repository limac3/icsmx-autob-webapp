// @vitest-environment node
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import type { Lote } from "@/types/lote";
import type { Solicitud } from "@/types/fila";
import { vencerYReasignar } from "./vencerYReasignar";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-10-08T15:00:01.000Z");
/** `AHORA + 48 h`, el plazo de liquidacion del nuevo adjudicado. */
const VENCE_NUEVO = "2026-10-10T15:00:01.000Z";

const lote: Lote = {
  loteId: "L1",
  convocatoriaId: "C1",
  vehiculoId: "V1",
  precio: 180_000,
  estatus: "ADJUDICADO",
  contadorTurnos: 3,
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
  adjudicacionActual: "L1-1",
  adjudicadoEn: "2026-10-06T15:00:00.000Z",
  venceEn: "2026-10-08T15:00:00.000Z",
  turnoAdjudicado: 1,
};

const solicitudVencida: Solicitud = {
  solicitudId: "L1-1",
  loteId: "L1",
  convocatoriaId: "C1",
  participanteId: "P1",
  turno: 1,
  estatus: "ADJUDICADA",
  solicitadoEn: "2026-10-05T15:30:00.000Z",
  adjudicadoEn: "2026-10-06T15:00:00.000Z",
  venceEn: "2026-10-08T15:00:00.000Z",
};

const deps = (cliente: unknown) => ({
  cliente: cliente as never,
  ahora: () => AHORA,
});

const solicitudEnFila = (
  turno: number,
  participanteId: string,
  extra: Record<string, unknown> = {},
) => ({
  PK: "LOTE#L1",
  SK: `SOL#${String(turno).padStart(10, "0")}`,
  turno,
  participanteId,
  estatus: "EN_FILA",
  solicitudId: `L1-${String(turno)}`,
  loteId: "L1",
  solicitadoEn: AHORA.toISOString(),
  ...extra,
});

/** Query de reservas vacia, fila con los candidatos dados. */
const conFila = (
  candidatos: Record<string, unknown>[],
  opciones: { reservas?: Record<string, unknown>[] } = {},
) => {
  return (comando: ComandoEnviado): unknown => {
    if (comando.nombre !== "QueryCommand") return {};
    const valores = comando.input.ExpressionAttributeValues as Record<
      string,
      string
    >;
    return valores[":prefijo"] === "RESERVA#"
      ? { Items: opciones.reservas ?? [] }
      : { Items: candidatos };
  };
};

const canceladaEn = (
  indice: number,
  total: number,
): TransactionCanceledException =>
  new TransactionCanceledException({
    message: "cancelada",
    $metadata: {},
    CancellationReasons: Array.from({ length: total }, (_, i) => ({
      Code: i === indice ? "ConditionalCheckFailed" : "None",
    })),
  });

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("comprobacion local antes de tocar la base de datos", () => {
  it("responde no_vigente sin ninguna escritura si ya no esta ADJUDICADA", async () => {
    const falso = crearClienteFalso();

    const resultado = await vencerYReasignar(
      {
        lote,
        solicitudVencida: { ...solicitudVencida, estatus: "EN_VERIFICACION" },
        detectadoPor: "BARRIDO",
      },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ estado: "no_vigente" });
    expect(falso.comandos).toHaveLength(0);
  });

  it("vencimiento exacto en la frontera: venceEn === ahora ya cuenta como vencido", async () => {
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(2, "P2")]),
    });

    const resultado = await vencerYReasignar(
      {
        lote,
        solicitudVencida: { ...solicitudVencida, venceEn: AHORA.toISOString() },
        detectadoPor: "BARRIDO",
      },
      deps(falso.cliente),
    );

    expect(resultado).toMatchObject({ estado: "reasignado" });
  });

  it("un milisegundo antes de la frontera todavia no cuenta como vencido", async () => {
    const falso = crearClienteFalso();

    const resultado = await vencerYReasignar(
      {
        lote,
        solicitudVencida: {
          ...solicitudVencida,
          venceEn: new Date(AHORA.getTime() + 1).toISOString(),
        },
        detectadoPor: "BARRIDO",
      },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ estado: "no_vigente" });
    expect(falso.comandos).toHaveLength(0);
  });

  it("responde no_vigente si venceEn todavia no paso", async () => {
    const falso = crearClienteFalso();

    const resultado = await vencerYReasignar(
      {
        lote,
        solicitudVencida: {
          ...solicitudVencida,
          venceEn: "2026-10-09T00:00:00.000Z",
        },
        detectadoPor: "BARRIDO",
      },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ estado: "no_vigente" });
    expect(falso.comandos).toHaveLength(0);
  });
});

describe("abstencion por reservas vigentes — R18", () => {
  it("no reasigna mientras haya un turno en vuelo", async () => {
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(2, "P2")], {
        reservas: [
          {
            SK: "RESERVA#R1",
            anotadaEn: new Date(AHORA.getTime() - 500).toISOString(),
          },
        ],
      }),
    });

    const resultado = await vencerYReasignar(
      { lote, solicitudVencida, detectadoPor: "BARRIDO" },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ estado: "abstenido", reservasVigentes: 1 });
    expect(
      falso.comandos.some((c) => c.nombre === "TransactWriteCommand"),
    ).toBe(false);
  });
});

describe("reasigna al siguiente turno vivo", () => {
  const items = (falso: ReturnType<typeof crearClienteFalso>) =>
    falso.comandos.find((c) => c.nombre === "TransactWriteCommand")?.input
      .TransactItems as Record<string, Record<string, unknown>>[];

  it("cierra al vencido y adjudica al turno 2, en una sola transaccion", async () => {
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(2, "P2")]),
    });

    const resultado = await vencerYReasignar(
      { lote, solicitudVencida, detectadoPor: "BARRIDO" },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({
      estado: "reasignado",
      turno: 2,
      solicitudId: "L1-2",
      participanteId: "P2",
      venceEn: VENCE_NUEVO,
    });

    const transaccion = items(falso);
    expect(transaccion).toHaveLength(7);

    expect(transaccion[0]?.Update).toMatchObject({
      Key: { PK: "LOTE#L1", SK: "SOL#0000000001" },
      ConditionExpression: "#estatus = :adjudicada AND venceEn <= :ahora",
    });
    expect(String(transaccion[0]?.Update?.UpdateExpression)).toContain(
      "REMOVE GSI4PK, GSI4SK",
    );

    expect(transaccion[1]?.Delete).toMatchObject({
      Key: { PK: "PART#P1", SK: "ADJUDICACION_ACTIVA" },
      ConditionExpression: "attribute_exists(SK)",
    });

    expect(transaccion[2]?.Update).toMatchObject({
      Key: { PK: "CONV#C1", SK: "LOTE#L1" },
      ConditionExpression: "adjudicacionActual = :vencida",
    });
    expect(transaccion[2]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":nueva": "L1-2",
      ":vencida": "L1-1",
    });

    expect(transaccion[3]?.Update).toMatchObject({
      Key: { PK: "LOTE#L1", SK: "SOL#0000000002" },
      ConditionExpression: "#estatus = :enFila",
    });

    expect(transaccion[4]?.Put).toMatchObject({
      Item: { PK: "PART#P2", SK: "ADJUDICACION_ACTIVA", solicitudId: "L1-2" },
      ConditionExpression: "attribute_not_exists(SK)",
    });

    const eventoVencido = transaccion[5]?.Put?.Item as Record<string, unknown>;
    expect(eventoVencido).toMatchObject({
      tipo: "SOLICITUD_VENCIDA",
      solicitudId: "L1-1",
      datos: { turno: 1, detectadoPor: "BARRIDO" },
    });

    const eventoAdjudicacion = transaccion[6]?.Put?.Item as Record<
      string,
      unknown
    >;
    // Los dos eventos comparten correlacionId: son la misma transaccion
    // (trazabilidad-auditoria 2.2).
    expect(eventoAdjudicacion).toMatchObject({
      tipo: "LOTE_ADJUDICADO",
      solicitudId: "L1-2",
      correlacionId: eventoVencido.correlacionId,
      datos: { motivoAdjudicacion: "REASIGNACION_POR_VENCIMIENTO" },
    });

    // Sin `correoTitular` no se encola nada (D-6): solo 7 items.
    expect(transaccion[7]).toBeUndefined();
  });

  it("el vehiculo no se toca: sigue RESERVADO, el lote solo cambia de dueno", async () => {
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(2, "P2")]),
    });

    await vencerYReasignar(
      { lote, solicitudVencida, detectadoPor: "BARRIDO" },
      deps(falso.cliente),
    );

    const tocaVehiculo = items(falso).some(
      (item) =>
        item.Update?.Key && (item.Update.Key as { PK: string }).PK === "VEH#V1",
    );
    expect(tocaVehiculo).toBe(false);
  });

  it("encola el correo de adjudicacion cuando el candidato tiene correoTitular", async () => {
    const falso = crearClienteFalso({
      responder: conFila([
        solicitudEnFila(2, "P2", { correoTitular: "p2@example.org" }),
      ]),
    });

    await vencerYReasignar(
      { lote, solicitudVencida, detectadoPor: "BARRIDO" },
      deps(falso.cliente),
    );

    const transaccion = items(falso);
    expect(transaccion).toHaveLength(9);
    expect(transaccion[7]?.Put).toMatchObject({
      Item: { destinatario: "p2@example.org", estatus: "PENDIENTE" },
    });
    expect(transaccion[8]?.Put?.Item).toMatchObject({
      tipo: "CORREO_ENCOLADO",
    });
  });

  it("detectadoPor viaja tal cual al evento (verificacion perezosa)", async () => {
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(2, "P2")]),
    });

    await vencerYReasignar(
      { lote, solicitudVencida, detectadoPor: "VERIFICACION_PEREZOSA" },
      deps(falso.cliente),
    );

    const evento = items(falso)[5]?.Put?.Item as Record<string, unknown>;
    expect(evento).toMatchObject({
      tipo: "SOLICITUD_VENCIDA",
      datos: { detectadoPor: "VERIFICACION_PEREZOSA" },
    });
  });

  it("si el candidato ya tiene adjudicacion activa, lo congela y sigue (R-09)", async () => {
    // El primer intento (turno 2) falla en el item 4 (centinela, R-09); el
    // segundo intento (turno 3) tiene que tener exito.
    let intentosDeAdjudicacion = 0;
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "GetCommand") {
          return { Item: { loteId: "OTRO-LOTE" } };
        }
        if (comando.nombre === "TransactWriteCommand") {
          const transaccion = comando.input.TransactItems as unknown[];
          // La transaccion de congelamiento tiene tres items; la de
          // reasignacion, seis.
          if (transaccion.length === 3) return {};
          intentosDeAdjudicacion += 1;
          if (intentosDeAdjudicacion === 1) throw canceladaEn(4, 6);
          return {};
        }
        return conFila([solicitudEnFila(2, "P2"), solicitudEnFila(3, "P3")])(
          comando,
        );
      },
    });

    const resultado = await vencerYReasignar(
      { lote, solicitudVencida, detectadoPor: "BARRIDO" },
      deps(falso.cliente),
    );

    expect(resultado).toMatchObject({ estado: "reasignado", turno: 3 });

    const congelamiento = falso.comandos
      .filter((c) => c.nombre === "TransactWriteCommand")
      .map(
        (c) =>
          c.input.TransactItems as Record<string, Record<string, unknown>>[],
      )
      .find((transaccion) => transaccion.length === 3);
    expect(congelamiento?.[0]?.Update).toMatchObject({
      Key: { PK: "LOTE#L1", SK: "SOL#0000000002" },
      ConditionExpression: "#estatus = :enFila",
    });
    expect(congelamiento?.[1]?.Put?.Item).toMatchObject({
      tipo: "SOLICITUD_CONGELADA",
      datos: { turno: 2, loteQueGano: "OTRO-LOTE" },
    });
  });
});

describe("fila agotada — variante reducida", () => {
  const items = (falso: ReturnType<typeof crearClienteFalso>) =>
    falso.comandos.find((c) => c.nombre === "TransactWriteCommand")?.input
      .TransactItems as Record<string, Record<string, unknown>>[];

  it("sin candidatos vivos, cierra al vencido y libera lote y vehiculo", async () => {
    const falso = crearClienteFalso({ responder: conFila([]) });

    const resultado = await vencerYReasignar(
      { lote, solicitudVencida, detectadoPor: "BARRIDO" },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ estado: "fila_agotada" });

    const transaccion = items(falso);
    expect(transaccion).toHaveLength(5);
    expect(transaccion[0]?.Update).toMatchObject({
      Key: { PK: "LOTE#L1", SK: "SOL#0000000001" },
    });
    expect(transaccion[1]?.Delete).toMatchObject({
      Key: { PK: "PART#P1", SK: "ADJUDICACION_ACTIVA" },
    });
    expect(transaccion[2]?.Update).toMatchObject({
      Key: { PK: "CONV#C1", SK: "LOTE#L1" },
      ConditionExpression: "adjudicacionActual = :vencida",
    });
    expect(String(transaccion[2]?.Update?.UpdateExpression)).toContain(
      "REMOVE adjudicacionActual, adjudicadoEn, venceEn, turnoAdjudicado",
    );
    // La correccion: sin este item, el vehiculo se queda RESERVADO y el lote
    // vuelto a EN_OFERTA queda huerfano para siempre (Etapa 10).
    expect(transaccion[3]?.Update).toMatchObject({
      Key: { PK: "VEH#V1", SK: "META" },
      ConditionExpression: "#estatus = :reservado",
    });
    expect(transaccion[3]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":enConvocatoria": "EN_CONVOCATORIA",
    });

    // No hay LOTE_ADJUDICADO: nadie recibio el lote.
    const tipos = transaccion
      .filter((item) => item.Put?.Item !== undefined)
      .map((item) => (item.Put?.Item as { tipo?: string }).tipo);
    expect(tipos).toEqual(["SOLICITUD_VENCIDA"]);
  });

  it("solo cuenta candidatos EN_FILA: CONGELADA no cuenta como fila viva", async () => {
    const congelada = { ...solicitudEnFila(2, "P2"), estatus: "CONGELADA" };
    const falso = crearClienteFalso({ responder: conFila([congelada]) });

    const resultado = await vencerYReasignar(
      { lote, solicitudVencida, detectadoPor: "BARRIDO" },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ estado: "fila_agotada" });
  });
});

describe("carreras e idempotencia (D-7)", () => {
  it("si otro proceso ya resolvio la vencida, responde no_vigente sin reintentar", async () => {
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "TransactWriteCommand") {
          throw canceladaEn(0, 6);
        }
        return conFila([solicitudEnFila(2, "P2")])(comando);
      },
    });

    const resultado = await vencerYReasignar(
      { lote, solicitudVencida, detectadoPor: "BARRIDO" },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ estado: "no_vigente" });
    expect(
      falso.comandos.filter((c) => c.nombre === "TransactWriteCommand"),
    ).toHaveLength(1);
  });

  it("un TransactionConflict se reintenta en vez de decidir quien gano", async () => {
    let intentos = 0;
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "TransactWriteCommand") {
          intentos += 1;
          if (intentos === 1) {
            throw new TransactionCanceledException({
              message: "conflicto",
              $metadata: {},
              CancellationReasons: [{ Code: "TransactionConflict" }],
            });
          }
          return {};
        }
        return conFila([solicitudEnFila(2, "P2")])(comando);
      },
    });

    const resultado = await vencerYReasignar(
      { lote, solicitudVencida, detectadoPor: "BARRIDO", intentos: 3 },
      deps(falso.cliente),
    );

    expect(resultado).toMatchObject({ estado: "reasignado", turno: 2 });
    expect(intentos).toBe(2);
  });
});
