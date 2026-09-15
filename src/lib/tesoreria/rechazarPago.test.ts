// @vitest-environment node
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crearClienteFalso } from "@/utils/clienteDynamoFalso";
import { adjudicarLote } from "@/lib/fila/adjudicarLote";
import type { ActorUsuario } from "@/types/auditoria";
import type { Solicitud } from "@/types/fila";
import type { Lote } from "@/types/lote";
import { rechazarPago } from "./rechazarPago";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/fila/adjudicarLote", () => ({ adjudicarLote: vi.fn() }));

const adjudicacion = vi.mocked(adjudicarLote);

const AHORA = new Date("2026-10-07T15:00:00.000Z");

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
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
  adjudicacionActual: "L1-2",
  adjudicadoEn: "2026-10-06T15:00:00.000Z",
  venceEn: "2026-10-08T15:00:00.000Z",
  turnoAdjudicado: 2,
};

const solicitud: Solicitud = {
  solicitudId: "L1-2",
  loteId: "L1",
  convocatoriaId: "C1",
  participanteId: "P1",
  turno: 2,
  estatus: "EN_VERIFICACION",
  solicitadoEn: "2026-10-06T14:00:00.000Z",
  adjudicadoEn: "2026-10-06T15:00:00.000Z",
  venceEn: "2026-10-08T15:00:00.000Z",
  comprobanteClaveS3: "comprobantes/L1-2/A1.jpg",
  comprobanteSubidoEn: "2026-10-06T16:00:00.000Z",
};

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "OP1",
  permisos: ["Autob_Operar_Tesoreria"],
};

const deps = (cliente: unknown) => ({
  cliente: cliente as never,
  ahora: () => AHORA,
});

const itemsDe = (falso: ReturnType<typeof crearClienteFalso>) =>
  falso.comandos.find((c) => c.nombre === "TransactWriteCommand")?.input
    .TransactItems as Record<string, Record<string, unknown>>[];

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
  adjudicacion.mockResolvedValue({
    estado: "fila_agotada",
    turnosRevisados: 0,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("rechazarPago — R-16", () => {
  it("exige motivo no vacio antes de tocar la base de datos", async () => {
    const falso = crearClienteFalso();

    const resultado = await rechazarPago(
      { lote, solicitud, motivo: "   ", actor },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "validation_failed" });
    expect(falso.comandos).toHaveLength(0);
    expect(adjudicacion).not.toHaveBeenCalled();
  });

  it("desde un estado que no es EN_VERIFICACION responde invalid_state", async () => {
    const falso = crearClienteFalso();

    const resultado = await rechazarPago(
      {
        lote,
        solicitud: { ...solicitud, estatus: "ADJUDICADA" },
        motivo: "no pago",
        actor,
      },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
  });

  it("rechaza con motivo, retira las claves de GSI2 y libera lote y vehiculo", async () => {
    const falso = crearClienteFalso();

    const resultado = await rechazarPago(
      {
        lote,
        solicitud,
        motivo: "El comprobante no corresponde al monto",
        actor,
      },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.estatus).toBe("RECHAZADA_POR_TESORERIA");

    const items = itemsDe(falso);
    expect(items[0]?.Update).toMatchObject({
      Key: { PK: "LOTE#L1", SK: "SOL#0000000002" },
      ConditionExpression: "#estatus = :enVerificacion",
    });
    expect(String(items[0]?.Update?.UpdateExpression)).toContain(
      "REMOVE GSI2PK, GSI2SK",
    );
    expect(items[0]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":motivo": "El comprobante no corresponde al monto",
    });

    // Rechazar libera el cupo, igual que vencer. Solo la venta lo consume
    // definitivamente (R-09).
    expect(items[1]?.Update).toMatchObject({
      Key: { PK: "PART#P1", SK: "CUPO#C1" },
      UpdateExpression: "ADD cupoConsumido :menosUno",
    });
    expect(items[2]?.Update).toMatchObject({
      Key: { PK: "CONV#C1", SK: "LOTE#L1" },
      ConditionExpression: "adjudicacionActual = :solicitudId",
    });
    expect(items[3]?.Update).toMatchObject({
      Key: { PK: "VEH#V1", SK: "META" },
      ConditionExpression: "#estatus = :reservado",
    });

    const evento = items[4]?.Put?.Item as Record<string, unknown>;
    expect(evento).toMatchObject({
      tipo: "PAGO_RECHAZADO",
      motivo: "El comprobante no corresponde al monto",
      solicitudId: "L1-2",
    });
  });

  it("no retira el centinela de fila — RECHAZADA_POR_TESORERIA sigue visible en MiLugarDTO", async () => {
    const falso = crearClienteFalso();

    await rechazarPago(
      { lote, solicitud, motivo: "sin evidencia de pago", actor },
      deps(falso.cliente),
    );

    const items = itemsDe(falso);
    const borraCentinelaDeFila = items.some(
      (item) =>
        item.Delete?.Key &&
        (item.Delete.Key as Record<string, unknown>).SK === "PART#P1" &&
        (item.Delete.Key as Record<string, unknown>).PK === "LOTE#L1",
    );
    expect(borraCentinelaDeFila).toBe(false);
  });

  it("reasigna con el motivo correcto, sobre el lote ya liberado", async () => {
    adjudicacion.mockResolvedValue({
      estado: "adjudicado",
      turno: 3,
      solicitudId: "L1-3",
      participanteId: "P3",
      venceEn: "2026-10-09T15:00:00.000Z",
    });
    const falso = crearClienteFalso();

    const resultado = await rechazarPago(
      { lote, solicitud, motivo: "monto insuficiente", actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.reasignacion).toMatchObject({
      estado: "adjudicado",
      turno: 3,
    });
    expect(adjudicacion.mock.calls[0]?.[0]).toMatchObject({
      motivo: "REASIGNACION_POR_RECHAZO",
      lote: expect.objectContaining({ estatus: "EN_OFERTA" }),
    });
    expect(
      adjudicacion.mock.calls[0]?.[0].lote.adjudicacionActual,
    ).toBeUndefined();
  });

  it("si otro proceso ya reasigno el lote, el rechazo falla entero", async () => {
    const falso = crearClienteFalso({
      lanza: new TransactionCanceledException({
        message: "cancelada",
        $metadata: {},
        CancellationReasons: [
          { Code: "None" },
          { Code: "None" },
          { Code: "ConditionalCheckFailed" },
          { Code: "None" },
          { Code: "None" },
        ],
      }),
    });

    const resultado = await rechazarPago(
      { lote, solicitud, motivo: "sin evidencia", actor },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "conflicto_concurrencia" });
    expect(adjudicacion).not.toHaveBeenCalled();
  });
});
