// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crearClienteFalso } from "@/utils/clienteDynamoFalso";
import { listarPendientesVerificacion } from "./listarPendientesVerificacion";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const itemDeSolicitud = (
  extras: Partial<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  PK: "LOTE#L1",
  SK: "SOL#0000000002",
  solicitudId: "L1-2",
  loteId: "L1",
  convocatoriaId: "C1",
  participanteId: "P1",
  turno: 2,
  estatus: "EN_VERIFICACION",
  solicitadoEn: "2026-10-06T14:00:00.000Z",
  adjudicadoEn: "2026-10-06T15:00:00.000Z",
  venceEn: "2026-10-09T15:00:00.000Z",
  comprobanteClaveS3: "comprobantes/L1-2/A1.jpg",
  comprobanteSubidoEn: "2026-10-06T16:00:00.000Z",
  correoTitular: "p1@example.org",
  GSI2PK: "SOL_ESTATUS#EN_VERIFICACION",
  GSI2SK: "2026-10-06T16:00:00.000Z#L1-2",
  ...extras,
});

describe("listarPendientesVerificacion — PA-11", () => {
  it("consulta la particion de EN_VERIFICACION, mas antiguas primero", async () => {
    const falso = crearClienteFalso({ respuestas: [{ Items: [] }] });

    await listarPendientesVerificacion({ cliente: falso.cliente as never });

    expect(falso.comandos[0]?.nombre).toBe("QueryCommand");
    expect(falso.comandos[0]?.input).toMatchObject({
      IndexName: "GSI2",
      KeyConditionExpression: "GSI2PK = :pk",
      ExpressionAttributeValues: { ":pk": "SOL_ESTATUS#EN_VERIFICACION" },
      ScanIndexForward: true,
    });
  });

  it("proyecta PendienteDTO con el correo del titular — excepcion deliberada a R-12", async () => {
    const falso = crearClienteFalso({
      respuestas: [{ Items: [itemDeSolicitud()] }],
    });

    const resultado = await listarPendientesVerificacion({
      cliente: falso.cliente as never,
    });

    expect(resultado).toEqual({
      ok: true,
      data: [
        {
          solicitudId: "L1-2",
          loteId: "L1",
          convocatoriaId: "C1",
          correoTitular: "p1@example.org",
          adjudicadoEn: "2026-10-06T15:00:00.000Z",
          comprobanteSubidoEn: "2026-10-06T16:00:00.000Z",
        },
      ],
    });
  });

  it("omite un item sin los campos indispensables, en vez de fabricar una fila a medias", async () => {
    const falso = crearClienteFalso({
      respuestas: [
        {
          Items: [
            itemDeSolicitud({ convocatoriaId: undefined }),
            itemDeSolicitud({
              SK: "SOL#0000000003",
              solicitudId: "L1-3",
              comprobanteSubidoEn: undefined,
            }),
          ],
        },
      ],
    });

    const resultado = await listarPendientesVerificacion({
      cliente: falso.cliente as never,
    });

    expect(resultado).toEqual({ ok: true, data: [] });
  });

  it("omite un item que ya no esta EN_VERIFICACION (defensivo)", async () => {
    const falso = crearClienteFalso({
      respuestas: [{ Items: [itemDeSolicitud({ estatus: "VENDIDA" })] }],
    });

    const resultado = await listarPendientesVerificacion({
      cliente: falso.cliente as never,
    });

    expect(resultado).toEqual({ ok: true, data: [] });
  });

  it("sin trabajo pendiente devuelve una lista vacia, no un error", async () => {
    const falso = crearClienteFalso({ respuestas: [{}] });

    const resultado = await listarPendientesVerificacion({
      cliente: falso.cliente as never,
    });

    expect(resultado).toEqual({ ok: true, data: [] });
  });
});
