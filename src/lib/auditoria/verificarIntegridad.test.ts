// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crearClienteFalso } from "@/utils/clienteDynamoFalso";
import { verificarIntegridad } from "./verificarIntegridad";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const eventoCrudo = (extras: Partial<Record<string, unknown>> = {}) => ({
  eventoId: "E1",
  tipo: "SOLICITUD_CREADA",
  ocurridoEn: "2026-10-06T10:00:00.000Z",
  actorTipo: "USUARIO",
  actorId: "P1",
  correlacionId: "COR1",
  loteId: "L1",
  solicitudId: "L1-1",
  estadoNuevo: "EN_FILA",
  datos: { turno: 1 },
  ...extras,
});

const solicitudCruda = (extras: Partial<Record<string, unknown>> = {}) => ({
  PK: "LOTE#L1",
  SK: "SOL#0000000001",
  solicitudId: "L1-1",
  loteId: "L1",
  participanteId: "P1",
  turno: 1,
  estatus: "EN_FILA",
  solicitadoEn: "2026-10-06T10:00:00.000Z",
  ...extras,
});

describe("verificarIntegridad", () => {
  it("combina la bitacora del lote con su fila vigente", async () => {
    const falso = crearClienteFalso({
      responder: (comando) =>
        comando.input.KeyConditionExpression === "PK = :pk"
          ? { Items: [eventoCrudo()] }
          : { Items: [solicitudCruda()] },
    });

    const resultado = await verificarIntegridad("L1", {
      cliente: falso.cliente as never,
    });

    expect(resultado.ok).toBe(true);
    expect(resultado.ok && resultado.data.loteId).toBe("L1");
    expect(
      resultado.ok &&
        resultado.data.comprobaciones.find(
          (c) => c.clave === "transicionesConEvento",
        ),
    ).toMatchObject({ veredicto: "cumple" });
  });

  it("detecta un estatus vigente que la bitacora no explica", async () => {
    const falso = crearClienteFalso({
      responder: (comando) =>
        comando.input.KeyConditionExpression === "PK = :pk"
          ? { Items: [eventoCrudo()] }
          : // La tabla dice VENDIDA; la bitacora se quedo en EN_FILA.
            { Items: [solicitudCruda({ estatus: "VENDIDA" })] },
    });

    const resultado = await verificarIntegridad("L1", {
      cliente: falso.cliente as never,
    });

    expect(
      resultado.ok &&
        resultado.data.comprobaciones.find(
          (c) => c.clave === "transicionesConEvento",
        ),
    ).toMatchObject({ veredicto: "incumple", turnosSinExplicar: [1] });
  });

  it("propaga el error si la lectura de la fila vigente falla", async () => {
    const falso = crearClienteFalso({ lanza: new Error("boom") });

    await expect(
      verificarIntegridad("L1", { cliente: falso.cliente as never }),
    ).rejects.toThrow("boom");
  });
});
