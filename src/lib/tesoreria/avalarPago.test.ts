// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crearClienteFalso } from "@/utils/clienteDynamoFalso";
import { cerrarFilaDelLote } from "@/lib/fila/cerrarFilaDelLote";
import type { ActorUsuario } from "@/types/auditoria";
import type { Solicitud } from "@/types/fila";
import type { Lote } from "@/types/lote";
import { avalarPago } from "./avalarPago";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/fila/cerrarFilaDelLote", () => ({
  cerrarFilaDelLote: vi.fn(),
}));

const cierre = vi.mocked(cerrarFilaDelLote);

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
  cierre.mockResolvedValue({ ok: true, data: 0 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("avalarPago — T4", () => {
  it("vende la solicitud, el lote y el vehiculo, y retira los dos centinelas", async () => {
    const falso = crearClienteFalso();

    const resultado = await avalarPago(
      { lote, solicitud, actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.estatus).toBe("VENDIDA");

    const items = itemsDe(falso);
    expect(items).toHaveLength(6);
    expect(items[0]?.Update).toMatchObject({
      Key: { PK: "LOTE#L1", SK: "SOL#0000000002" },
      ConditionExpression: "#estatus = :enVerificacion",
    });
    expect(String(items[0]?.Update?.UpdateExpression)).toContain(
      "REMOVE GSI2PK, GSI2SK",
    );
    expect(items[1]?.Update).toMatchObject({
      Key: { PK: "CONV#C1", SK: "LOTE#L1" },
      ConditionExpression:
        "#estatus = :adjudicado AND adjudicacionActual = :solicitudId",
    });
    expect(items[2]?.Update).toMatchObject({
      Key: { PK: "VEH#V1", SK: "META" },
      ConditionExpression: "#estatus = :reservado",
    });
    expect(items[3]?.Delete?.Key).toEqual({
      PK: "PART#P1",
      SK: "ADJUDICACION_ACTIVA",
    });
    expect(items[4]?.Delete?.Key).toEqual({ PK: "VEH#V1", SK: "ACTIVO" });

    const evento = items[5]?.Put?.Item as Record<string, unknown>;
    expect(evento).toMatchObject({
      tipo: "PAGO_AVALADO",
      solicitudId: "L1-2",
      estadoAnterior: "EN_VERIFICACION",
      estadoNuevo: "VENDIDA",
    });
  });

  it("guarda la nota opcional en el evento, sin exigirla", async () => {
    const falso = crearClienteFalso();

    await avalarPago(
      { lote, solicitud, nota: "Transferencia verificada por SPEI", actor },
      deps(falso.cliente),
    );

    const evento = itemsDe(falso)[5]?.Put?.Item as Record<string, unknown>;
    expect(evento.datos).toEqual({ nota: "Transferencia verificada por SPEI" });
  });

  it("desde un estado que no es EN_VERIFICACION responde invalid_state", async () => {
    const falso = crearClienteFalso();

    const resultado = await avalarPago(
      { lote, solicitud: { ...solicitud, estatus: "ADJUDICADA" }, actor },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(cierre).not.toHaveBeenCalled();
  });

  it("cierra la fila restante del lote fuera de la transaccion", async () => {
    cierre.mockResolvedValue({ ok: true, data: 3 });
    const falso = crearClienteFalso();

    const resultado = await avalarPago(
      { lote, solicitud, actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.cerradas).toBe(3);
    expect(cierre).toHaveBeenCalledWith(
      { lote: expect.objectContaining({ estatus: "VENDIDO" }), actor },
      expect.anything(),
    );
  });

  it("no cierra la fila si la transaccion de venta fallo", async () => {
    const falso = crearClienteFalso();

    await avalarPago(
      { lote, solicitud: { ...solicitud, estatus: "ADJUDICADA" }, actor },
      deps(falso.cliente),
    );

    expect(cierre).not.toHaveBeenCalled();
  });
});
