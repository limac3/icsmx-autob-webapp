// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crearClienteFalso } from "@/utils/clienteDynamoFalso";
import {
  consultarBitacora,
  consultarBitacoraCompleta,
} from "./consultarBitacora";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const eventoCrudo = (extras: Partial<Record<string, unknown>> = {}) => ({
  PK: "AUDIT#LOTE#L1",
  SK: "2026-10-06T10:00:00.000Z#E1",
  eventoId: "E1",
  tipo: "SOLICITUD_CREADA",
  ocurridoEn: "2026-10-06T10:00:00.000Z",
  actorTipo: "USUARIO",
  actorId: "P1",
  correlacionId: "COR1",
  loteId: "L1",
  ...extras,
});

describe("consultarBitacora — PA-12", () => {
  it("consulta la particion del agregado, cronologica", async () => {
    const falso = crearClienteFalso({ respuestas: [{ Items: [] }] });

    await consultarBitacora(
      { agregado: "LOTE", agregadoId: "L1" },
      { cliente: falso.cliente as never },
    );

    expect(falso.comandos[0]?.nombre).toBe("QueryCommand");
    expect(falso.comandos[0]?.input).toMatchObject({
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": "AUDIT#LOTE#L1" },
      ScanIndexForward: true,
    });
  });

  it("traduce los items a EventoDTO", async () => {
    const falso = crearClienteFalso({
      respuestas: [{ Items: [eventoCrudo()] }],
    });

    const resultado = await consultarBitacora(
      { agregado: "LOTE", agregadoId: "L1" },
      { cliente: falso.cliente as never },
    );

    expect(resultado).toEqual({
      ok: true,
      data: {
        eventos: [
          {
            eventoId: "E1",
            tipo: "SOLICITUD_CREADA",
            ocurridoEn: "2026-10-06T10:00:00.000Z",
            // De la clave de particion: redundante en PA-12 —quien pregunta ya
            // sabe de que agregado pregunto— e indispensable en PA-13.
            agregado: "LOTE",
            agregadoId: "L1",
            actorTipo: "USUARIO",
            actorId: "P1",
            correlacionId: "COR1",
            loteId: "L1",
          },
        ],
        cursor: undefined,
      },
    });
  });

  it("omite un item ilegible en vez de fabricarlo a medias", async () => {
    const falso = crearClienteFalso({
      respuestas: [{ Items: [eventoCrudo({ eventoId: undefined })] }],
    });

    const resultado = await consultarBitacora(
      { agregado: "LOTE", agregadoId: "L1" },
      { cliente: falso.cliente as never },
    );

    expect(resultado).toEqual({
      ok: true,
      data: { eventos: [], cursor: undefined },
    });
  });

  it("sin cursor de entrada no manda ExclusiveStartKey", async () => {
    const falso = crearClienteFalso({ respuestas: [{ Items: [] }] });

    await consultarBitacora(
      { agregado: "LOTE", agregadoId: "L1" },
      { cliente: falso.cliente as never },
    );

    expect(falso.comandos[0]?.input.ExclusiveStartKey).toBeUndefined();
  });

  it("decodifica el cursor de entrada y codifica el de salida", async () => {
    const falso = crearClienteFalso({
      respuestas: [
        {
          Items: [],
          LastEvaluatedKey: {
            PK: "AUDIT#LOTE#L1",
            SK: "2026-10-06T11:00:00.000Z#E9",
          },
        },
      ],
    });

    const cursorDeEntrada = Buffer.from(
      JSON.stringify({
        PK: "AUDIT#LOTE#L1",
        SK: "2026-10-06T10:00:00.000Z#E1",
      }),
      "utf8",
    ).toString("base64url");

    const resultado = await consultarBitacora(
      { agregado: "LOTE", agregadoId: "L1", cursor: cursorDeEntrada },
      { cliente: falso.cliente as never },
    );

    expect(falso.comandos[0]?.input.ExclusiveStartKey).toEqual({
      PK: "AUDIT#LOTE#L1",
      SK: "2026-10-06T10:00:00.000Z#E1",
    });
    expect(resultado.ok && resultado.data.cursor).toBeDefined();
  });
});

describe("consultarBitacoraCompleta", () => {
  it("recorre todas las paginas y no devuelve cursor", async () => {
    let llamadas = 0;
    const falso = crearClienteFalso({
      responder: () => {
        llamadas += 1;
        return llamadas === 1
          ? {
              Items: [eventoCrudo()],
              LastEvaluatedKey: { PK: "AUDIT#LOTE#L1", SK: "x" },
            }
          : { Items: [eventoCrudo({ eventoId: "E2", SK: "y" })] };
      },
    });

    const resultado = await consultarBitacoraCompleta(
      { agregado: "LOTE", agregadoId: "L1" },
      { cliente: falso.cliente as never },
    );

    expect(llamadas).toBe(2);
    expect(resultado.ok && resultado.data.map((e) => e.eventoId)).toEqual([
      "E1",
      "E2",
    ]);
  });

  it("propaga un fallo de la pagina en curso", async () => {
    const falso = crearClienteFalso({ lanza: new Error("boom") });

    await expect(
      consultarBitacoraCompleta(
        { agregado: "LOTE", agregadoId: "L1" },
        { cliente: falso.cliente as never },
      ),
    ).rejects.toThrow("boom");
  });
});
