// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listarConvocatoriasVisibles } from "./listarConvocatoriasVisibles";
import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import type { TipoConvocatoria } from "@/types/convocatoria";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const convocatoria = (
  convocatoriaId: string,
  tipo: TipoConvocatoria,
  extras: Record<string, unknown> = {},
) => ({
  PK: `CONV#${convocatoriaId}`,
  SK: "META",
  convocatoriaId,
  folio: `CONV-${convocatoriaId}`,
  nombre: "Venta de octubre",
  tipo,
  estatus: "PUBLICADA",
  descripcionParticipacion: "<p>Descripcion</p>",
  publicadaEn: "2026-09-01T00:00:00.000Z",
  inicioVenta: "2026-09-05T00:00:00.000Z",
  finVenta: "2026-09-10T00:00:00.000Z",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  creadoEn: "2026-08-01T00:00:00.000Z",
  creadoPor: "P0",
  ...extras,
});

/** Responde segun el tipo de comando: la Query del GSI2, o la de PA-04. */
const responder =
  (items: unknown[], lotesPorConvocatoria: Record<string, unknown[]> = {}) =>
  (comando: ComandoEnviado) => {
    if (comando.nombre === "QueryCommand" && comando.input.IndexName) {
      return { Items: items };
    }
    // PA-04: obtenerConvocatoria consulta PK = CONV#<id>.
    const valores = comando.input.ExpressionAttributeValues as
      Record<string, string> | undefined;
    const pk = String(valores?.[":pk"] ?? "");
    const id = pk.replace("CONV#", "");
    const meta = items.find(
      (i) => (i as { convocatoriaId?: string }).convocatoriaId === id,
    );
    return { Items: [meta, ...(lotesPorConvocatoria[id] ?? [])] };
  };

describe("gating triple en la consulta", () => {
  it("consulta la particion PUBLICADA de GSI2 con la cota superior de ahora", async () => {
    const falso = crearClienteFalso({ responder: responder([]) });
    const ahora = new Date("2026-09-07T18:00:00.000Z");
    await listarConvocatoriasVisibles(["EMPLEADOS"], ahora, {
      cliente: falso.cliente,
    });

    const primera = falso.comandos[0];
    expect(primera?.nombre).toBe("QueryCommand");
    expect(primera?.input).toMatchObject({
      IndexName: "GSI2",
      KeyConditionExpression: "GSI2PK = :pk AND GSI2SK <= :cota",
      ExpressionAttributeValues: {
        ":pk": "CONV_ESTATUS#PUBLICADA",
        ":cota": `${ahora.toISOString()}#￿`,
      },
    });
  });

  it("sin tipos permitidos, el catalogo es vacio y no consulta nada", async () => {
    const falso = crearClienteFalso({ responder: responder([]) });
    const resultado = await listarConvocatoriasVisibles(
      [],
      new Date("2026-09-07T18:00:00.000Z"),
      { cliente: falso.cliente },
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data).toEqual([]);
    expect(falso.comandos).toHaveLength(0);
  });

  it("descarta las convocatorias de un tipo sin permiso", async () => {
    const falso = crearClienteFalso({
      responder: responder([
        convocatoria("C1", "EMPLEADOS"),
        convocatoria("C2", "PUBLICO_GENERAL"),
      ]),
    });

    const resultado = await listarConvocatoriasVisibles(
      ["EMPLEADOS"],
      new Date("2026-09-07T18:00:00.000Z"),
      { cliente: falso.cliente },
    );
    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.map((c) => c.convocatoriaId)).toEqual(["C1"]);
  });

  it("un empleado ve los dos tipos, por superconjunto de permisos", async () => {
    const falso = crearClienteFalso({
      responder: responder([
        convocatoria("C1", "EMPLEADOS"),
        convocatoria("C2", "PUBLICO_GENERAL"),
      ]),
    });

    const resultado = await listarConvocatoriasVisibles(
      ["EMPLEADOS", "PUBLICO_GENERAL"],
      new Date("2026-09-07T18:00:00.000Z"),
      { cliente: falso.cliente },
    );
    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.map((c) => c.convocatoriaId).sort()).toEqual([
      "C1",
      "C2",
    ]);
  });
});

describe("proyeccion", () => {
  it("nunca incluye datos de participantes", async () => {
    const falso = crearClienteFalso({
      responder: responder([convocatoria("C1", "EMPLEADOS")]),
    });

    const resultado = await listarConvocatoriasVisibles(
      ["EMPLEADOS"],
      new Date("2026-09-07T18:00:00.000Z"),
      { cliente: falso.cliente },
    );
    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(Object.keys(resultado.data[0] ?? {}).sort()).toEqual(
      [
        "convocatoriaId",
        "folio",
        "nombre",
        "tipo",
        "publicadaEn",
        "inicioVenta",
        "finVenta",
        "cantidadDeLotes",
      ].sort(),
    );
  });

  it("no arrastra la descripcion: el listado no la muestra", async () => {
    // Es lo que dice `api-contracts.md` 8: la descripcion es de
    // `ConvocatoriaDetalleDTO`, no del listado. El listado la traia y la
    // pantalla la resumia a 160 caracteres; ese resumen se repetia casi igual
    // en cada renglon y ocupaba el lugar del folio.
    const falso = crearClienteFalso({
      responder: responder([convocatoria("C1", "EMPLEADOS")]),
    });

    const resultado = await listarConvocatoriasVisibles(
      ["EMPLEADOS"],
      new Date("2026-09-07T18:00:00.000Z"),
      { cliente: falso.cliente },
    );
    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data[0]).not.toHaveProperty("descripcionParticipacion");
  });

  const lote = (loteId: string, convocatoriaId: string) => ({
    PK: `CONV#${convocatoriaId}`,
    SK: `LOTE#${loteId}`,
    loteId,
    convocatoriaId,
    vehiculoId: `V${loteId}`,
    precio: 100_000,
    estatus: "EN_OFERTA",
    contadorTurnos: 0,
    inicioVenta: "2026-09-05T00:00:00.000Z",
    finVenta: "2026-09-10T00:00:00.000Z",
    tipoConvocatoria: "EMPLEADOS",
    estatusConvocatoria: "PUBLICADA",
    horasLiquidacion: 48,
    limiteAdjudicaciones: 1,
    limiteSolicitudes: 3,
    modalidadAdjudicacion: "AUTOMATICA",
    creadoEn: "2026-08-01T00:00:00.000Z",
    creadoPor: "P0",
  });

  it("cuenta los lotes de cada convocatoria", async () => {
    const falso = crearClienteFalso({
      responder: responder([convocatoria("C1", "EMPLEADOS")], {
        C1: [lote("L1", "C1"), lote("L2", "C1")],
      }),
    });

    const resultado = await listarConvocatoriasVisibles(
      ["EMPLEADOS"],
      new Date("2026-09-07T18:00:00.000Z"),
      { cliente: falso.cliente },
    );
    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data[0]?.cantidadDeLotes).toBe(2);
  });

  it("ordena por inicio de venta, la mas proxima primero", async () => {
    const falso = crearClienteFalso({
      responder: responder([
        convocatoria("TARDE", "EMPLEADOS", {
          inicioVenta: "2026-09-20T00:00:00.000Z",
        }),
        convocatoria("PRONTO", "EMPLEADOS", {
          inicioVenta: "2026-09-05T00:00:00.000Z",
        }),
      ]),
    });

    const resultado = await listarConvocatoriasVisibles(
      ["EMPLEADOS"],
      new Date("2026-09-01T00:00:00.000Z"),
      { cliente: falso.cliente },
    );
    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.map((c) => c.convocatoriaId)).toEqual([
      "PRONTO",
      "TARDE",
    ]);
  });
});
