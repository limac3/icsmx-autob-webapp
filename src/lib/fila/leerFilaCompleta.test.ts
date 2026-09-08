// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crearClienteFalso } from "@/utils/clienteDynamoFalso";
import { leerFilaCompleta } from "./leerFilaCompleta";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const item = (
  turno: number,
  extras: Partial<Record<string, unknown>> = {},
) => ({
  PK: "LOTE#L1",
  SK: `SOL#${String(turno).padStart(10, "0")}`,
  solicitudId: `L1-${String(turno)}`,
  loteId: "L1",
  participanteId: `P${String(turno)}`,
  turno,
  estatus: "EN_FILA",
  solicitadoEn: "2026-10-06T10:00:00.000Z",
  ...extras,
});

describe("leerFilaCompleta — PA-07 sin filtrar por estatus", () => {
  it("consulta la particion del lote con el prefijo de solicitud", async () => {
    const falso = crearClienteFalso({ respuestas: [{ Items: [] }] });

    await leerFilaCompleta("L1", { cliente: falso.cliente as never });

    expect(falso.comandos[0]?.input).toMatchObject({
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefijo)",
      ExpressionAttributeValues: { ":pk": "LOTE#L1", ":prefijo": "SOL#" },
      ScanIndexForward: true,
    });
  });

  it("devuelve solicitudes de cualquier estatus, no solo EN_FILA", async () => {
    const falso = crearClienteFalso({
      respuestas: [
        {
          Items: [
            item(1, { estatus: "VENDIDA" }),
            item(2, { estatus: "CONGELADA" }),
            item(3, { estatus: "CANCELADA_POR_PARTICIPANTE" }),
          ],
        },
      ],
    });

    const resultado = await leerFilaCompleta("L1", {
      cliente: falso.cliente as never,
    });

    expect(resultado.ok && resultado.data.map((s) => s.estatus)).toEqual([
      "VENDIDA",
      "CONGELADA",
      "CANCELADA_POR_PARTICIPANTE",
    ]);
  });

  it("mantiene el orden de turno de la Query, sin reordenar", async () => {
    const falso = crearClienteFalso({
      respuestas: [{ Items: [item(1), item(2), item(3)] }],
    });

    const resultado = await leerFilaCompleta("L1", {
      cliente: falso.cliente as never,
    });

    expect(resultado.ok && resultado.data.map((s) => s.turno)).toEqual([
      1, 2, 3,
    ]);
  });

  it("expone participanteId — es la capacidad de fila:ver-completa", async () => {
    const falso = crearClienteFalso({ respuestas: [{ Items: [item(1)] }] });

    const resultado = await leerFilaCompleta("L1", {
      cliente: falso.cliente as never,
    });

    expect(resultado.ok && resultado.data[0]?.participanteId).toBe("P1");
  });

  it("sin fila devuelve una lista vacia, no un error", async () => {
    const falso = crearClienteFalso({ respuestas: [{}] });

    const resultado = await leerFilaCompleta("L1", {
      cliente: falso.cliente as never,
    });

    expect(resultado).toEqual({ ok: true, data: [] });
  });
});
