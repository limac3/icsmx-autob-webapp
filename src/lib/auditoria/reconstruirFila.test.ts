// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crearClienteFalso } from "@/utils/clienteDynamoFalso";
import { reconstruirFila } from "./reconstruirFila";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const eventoCrudo = (extras: Partial<Record<string, unknown>> = {}) => ({
  PK: "AUDIT#LOTE#L1",
  eventoId: "E1",
  tipo: "SOLICITUD_CREADA",
  ocurridoEn: "2026-10-06T10:00:00.000Z",
  actorTipo: "USUARIO",
  actorId: "P1",
  correlacionId: "COR1",
  loteId: "L1",
  solicitudId: "L1-1",
  datos: { turno: 1 },
  ...extras,
});

describe("reconstruirFila", () => {
  it("consulta la bitacora del lote y la agrupa por turno", async () => {
    const falso = crearClienteFalso({
      respuestas: [{ Items: [eventoCrudo()] }],
    });

    const resultado = await reconstruirFila("L1", {
      cliente: falso.cliente as never,
    });

    expect(falso.comandos[0]?.input).toMatchObject({
      ExpressionAttributeValues: { ":pk": "AUDIT#LOTE#L1" },
    });
    expect(resultado.ok && resultado.data.solicitudes).toEqual([
      { turno: 1, participanteId: "P1", eventos: expect.any(Array) },
    ]);
  });

  it("recorre todas las paginas antes de reconstruir", async () => {
    let llamadas = 0;
    const falso = crearClienteFalso({
      responder: () => {
        llamadas += 1;
        return llamadas === 1
          ? {
              Items: [eventoCrudo()],
              LastEvaluatedKey: { PK: "AUDIT#LOTE#L1", SK: "x" },
            }
          : {
              Items: [
                eventoCrudo({
                  eventoId: "E2",
                  tipo: "LOTE_ADJUDICADO",
                  actorTipo: "SISTEMA",
                  actorId: "SISTEMA",
                }),
              ],
            };
      },
    });

    const resultado = await reconstruirFila("L1", {
      cliente: falso.cliente as never,
    });

    expect(llamadas).toBe(2);
    expect(resultado.ok && resultado.data.solicitudes[0]?.eventos).toHaveLength(
      2,
    );
  });

  it("propaga el error si la lectura falla", async () => {
    const falso = crearClienteFalso({ lanza: new Error("boom") });

    await expect(
      reconstruirFila("L1", { cliente: falso.cliente as never }),
    ).rejects.toThrow("boom");
  });
});
