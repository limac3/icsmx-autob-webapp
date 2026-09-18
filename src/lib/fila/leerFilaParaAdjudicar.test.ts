// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import type { Lote } from "@/types/lote";
import { leerFilaParaAdjudicar } from "./leerFilaParaAdjudicar";

vi.mock("server-only", () => ({}));

const AHORA = "2026-10-06T15:00:00.000Z";

const lote = (loteId: string, cambios: Partial<Lote> = {}): Lote => ({
  loteId,
  convocatoriaId: "C1",
  vehiculoId: `V-${loteId}`,
  precio: 180_000,
  estatus: "EN_OFERTA",
  contadorTurnos: 3,
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 2,
  limiteSolicitudes: 5,
  modalidadAdjudicacion: "MANUAL",
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
  ...cambios,
});

const solicitud = (
  loteId: string,
  turno: number,
  participanteId: string,
  extras: Record<string, unknown> = {},
) => ({
  PK: `LOTE#${loteId}`,
  SK: `SOL#${String(turno).padStart(10, "0")}`,
  solicitudId: `${loteId}-${String(turno)}`,
  loteId,
  participanteId,
  turno,
  estatus: "EN_FILA",
  solicitadoEn: AHORA,
  ...extras,
});

/** Responde cada `Query` con la fila del lote pedido, y cada cupo con su valor. */
const responder =
  (
    filas: Record<string, Record<string, unknown>[]>,
    cupos: Record<string, number> = {},
  ) =>
  (comando: ComandoEnviado): unknown => {
    if (comando.nombre === "GetCommand") {
      const key = comando.input.Key as { PK: string };
      const id = key.PK.replace("PART#", "");
      return cupos[id] === undefined
        ? {}
        : { Item: { cupoConsumido: cupos[id] } };
    }
    const valores = comando.input.ExpressionAttributeValues as Record<
      string,
      string
    >;
    const loteId = String(valores[":pk"]).replace("LOTE#", "");
    return { Items: filas[loteId] ?? [] };
  };

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lo que el adjudicador necesita ver", () => {
  it("expone identidad, hora exacta y ordinal de cada candidato (R-23)", async () => {
    // **Es la excepcion deliberada a R-12**, y el requerimiento entero: quien
    // decide no puede hacerlo a ciegas.
    const falso = crearClienteFalso({
      responder: responder({
        L1: [
          solicitud("L1", 1, "P1", {
            correoTitular: "ana@ejemplo.invalid",
            ordenEnConvocatoria: 2,
          }),
        ],
      }),
    });

    const resultado = await leerFilaParaAdjudicar(
      { lote: lote("L1"), lotesDeLaConvocatoria: [lote("L1")] },
      { cliente: falso.cliente as never },
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.candidatos[0]).toMatchObject({
      turno: 1,
      participanteId: "P1",
      correoTitular: "ana@ejemplo.invalid",
      solicitadoEn: AHORA,
      ordenEnConvocatoria: 2,
    });
  });

  it("cruza sus otras solicitudes de la misma convocatoria, ordenadas por ordinal", async () => {
    // "si hay otras solicitudes del mismo usuario dentro de la misma
    // convocatoria y en que orden estan", literal del requerimiento. El orden
    // lo da el ordinal y no el turno: los turnos son por lote y no se comparan
    // entre si.
    const falso = crearClienteFalso({
      responder: responder({
        L1: [solicitud("L1", 5, "P1", { ordenEnConvocatoria: 3 })],
        L2: [solicitud("L2", 1, "P1", { ordenEnConvocatoria: 1 })],
        L3: [solicitud("L3", 9, "P1", { ordenEnConvocatoria: 2 })],
      }),
    });

    const resultado = await leerFilaParaAdjudicar(
      {
        lote: lote("L1"),
        lotesDeLaConvocatoria: [lote("L1"), lote("L2"), lote("L3")],
      },
      { cliente: falso.cliente as never },
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(
      resultado.data.candidatos[0]?.otrasParticipaciones.map(
        (o) => o.ordenEnConvocatoria,
      ),
    ).toEqual([1, 2]);
  });

  it("dice cuantos siguen EN_FILA en cada otro lote, no el total historico", async () => {
    // "turno 3 de 8" necesita el tamano **vigente** de la fila del otro lote:
    // una solicitud terminal (cancelada, vencida) ya no cuenta.
    const falso = crearClienteFalso({
      responder: responder({
        L1: [solicitud("L1", 1, "P1")],
        L2: [
          solicitud("L2", 1, "P1"),
          solicitud("L2", 2, "P2"),
          solicitud("L2", 3, "P3", { estatus: "CANCELADA_POR_PARTICIPANTE" }),
        ],
      }),
    });

    const resultado = await leerFilaParaAdjudicar(
      { lote: lote("L1"), lotesDeLaConvocatoria: [lote("L1"), lote("L2")] },
      { cliente: falso.cliente as never },
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.candidatos[0]?.otrasParticipaciones).toMatchObject([
      { loteId: "L2", tamanoFila: 2 },
    ]);
  });

  it("no mezcla las solicitudes de otras personas en el cruce", async () => {
    const falso = crearClienteFalso({
      responder: responder({
        L1: [solicitud("L1", 1, "P1")],
        L2: [solicitud("L2", 1, "P2")],
      }),
    });

    const resultado = await leerFilaParaAdjudicar(
      { lote: lote("L1"), lotesDeLaConvocatoria: [lote("L1"), lote("L2")] },
      { cliente: falso.cliente as never },
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.candidatos[0]?.otrasParticipaciones).toEqual([]);
  });

  it("dice cuantas adjudicaciones lleva y marca a quien agoto su cupo", async () => {
    const falso = crearClienteFalso({
      responder: responder(
        {
          L1: [solicitud("L1", 1, "P1"), solicitud("L1", 2, "P2")],
        },
        { P1: 2, P2: 0 },
      ),
    });

    const resultado = await leerFilaParaAdjudicar(
      { lote: lote("L1"), lotesDeLaConvocatoria: [lote("L1")] },
      { cliente: falso.cliente as never },
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    // `limiteAdjudicaciones` del lote es 2.
    expect(resultado.data.candidatos[0]).toMatchObject({
      adjudicacionesEnConvocatoria: 2,
      sinCupo: true,
    });
    expect(resultado.data.candidatos[1]).toMatchObject({
      adjudicacionesEnConvocatoria: 0,
      sinCupo: false,
    });
  });

  it("no ofrece candidatos que dejaron de estar EN_FILA", async () => {
    // Las terminales siguen en la particion para siempre; ofrecerlas invitaria
    // a elegir a alguien que ya no esta.
    const falso = crearClienteFalso({
      responder: responder({
        L1: [
          solicitud("L1", 1, "P1", { estatus: "CANCELADA_POR_PARTICIPANTE" }),
          solicitud("L1", 2, "P2"),
        ],
      }),
    });

    const resultado = await leerFilaParaAdjudicar(
      { lote: lote("L1"), lotesDeLaConvocatoria: [lote("L1")] },
      { cliente: falso.cliente as never },
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.candidatos.map((c) => c.turno)).toEqual([2]);
  });

  it("con la fila vacia no consulta cupos ni cruza nada", async () => {
    const falso = crearClienteFalso({
      responder: responder({ L1: [] }),
    });

    const resultado = await leerFilaParaAdjudicar(
      { lote: lote("L1"), lotesDeLaConvocatoria: [lote("L1"), lote("L2")] },
      { cliente: falso.cliente as never },
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.candidatos).toEqual([]);
    expect(
      falso.comandos.filter((c) => c.nombre === "GetCommand"),
    ).toHaveLength(0);
  });
});
