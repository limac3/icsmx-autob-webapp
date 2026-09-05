// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listarVehiculos, MAXIMO_POR_ESTATUS } from "./listarVehiculos";
import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import { ESTATUS_VEHICULO, type EstatusVehiculo } from "@/types/vehiculo";

vi.mock("server-only", () => ({}));

const vehiculo = (
  vehiculoId: string,
  estatus: EstatusVehiculo,
  extras: Record<string, unknown> = {},
) => ({
  PK: `VEH#${vehiculoId}`,
  SK: "META",
  vehiculoId,
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 100_000,
  estatus,
  creadoEn: "2026-01-10T10:00:00.000Z",
  creadoPor: "P0",
  actualizadoEn: "2026-01-10T10:00:00.000Z",
  actualizadoPor: "P0",
  ...extras,
});

/** Responde segun la particion de GSI2 que pide cada consulta. */
const porParticion =
  (mapa: Partial<Record<EstatusVehiculo, unknown[]>>) =>
  (comando: ComandoEnviado) => {
    const valores = comando.input.ExpressionAttributeValues as
      Record<string, string> | undefined;
    const estatus = String(valores?.[":pk"]).replace(
      "VEH_ESTATUS#",
      "",
    ) as EstatusVehiculo;
    return { Items: mapa[estatus] ?? [] };
  };

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("consulta", () => {
  it("usa el indice por estatus y nunca un Scan", async () => {
    // Un `Scan` leeria solicitudes, lotes y bitacora para descartarlos, y
    // crecer con la tabla entera. El modelo tiene GSI2 justamente para esto.
    const falso = crearClienteFalso({ responder: porParticion({}) });
    await listarVehiculos(
      { estatus: ["DISPONIBLE"] },
      { cliente: falso.cliente },
    );

    expect(falso.comandos.map((c) => c.nombre)).toEqual(["QueryCommand"]);
    expect(falso.comandos[0]?.input).toMatchObject({
      IndexName: "GSI2",
      KeyConditionExpression: "GSI2PK = :pk",
      ExpressionAttributeValues: { ":pk": "VEH_ESTATUS#DISPONIBLE" },
      ScanIndexForward: false,
      Limit: MAXIMO_POR_ESTATUS,
    });
  });

  it("sin filtro consulta cada estatus del catalogo", async () => {
    const falso = crearClienteFalso({ responder: porParticion({}) });
    await listarVehiculos({}, { cliente: falso.cliente });

    const particiones = falso.comandos.map(
      (c) =>
        (c.input.ExpressionAttributeValues as Record<string, string>)[":pk"],
    );
    expect(new Set(particiones)).toEqual(
      new Set(ESTATUS_VEHICULO.map((e) => `VEH_ESTATUS#${e}`)),
    );
  });

  it("solo consulta los estatus pedidos", async () => {
    const falso = crearClienteFalso({ responder: porParticion({}) });
    await listarVehiculos(
      { estatus: ["DISPONIBLE", "EN_CONVOCATORIA"] },
      { cliente: falso.cliente },
    );
    expect(falso.comandos).toHaveLength(2);
  });
});

describe("resultado", () => {
  it("junta los vehiculos de varios estatus", async () => {
    const falso = crearClienteFalso({
      responder: porParticion({
        DISPONIBLE: [vehiculo("V1", "DISPONIBLE")],
        EN_CONVOCATORIA: [vehiculo("V2", "EN_CONVOCATORIA")],
      }),
    });

    const resultado = await listarVehiculos({}, { cliente: falso.cliente });
    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.map((v) => v.vehiculoId).sort()).toEqual([
      "V1",
      "V2",
    ]);
  });

  it("ordena de mas reciente a mas antiguo", async () => {
    // Cada `Query` trae su propio orden; concatenarlas no produce ninguno. Aqui
    // el orden es de presentacion sobre un resultado acotado, no una garantia
    // como la de la fila.
    const falso = crearClienteFalso({
      responder: porParticion({
        DISPONIBLE: [
          vehiculo("VIEJO", "DISPONIBLE", {
            creadoEn: "2026-01-01T00:00:00.000Z",
          }),
        ],
        RETIRADO: [
          vehiculo("NUEVO", "RETIRADO", {
            creadoEn: "2026-08-01T00:00:00.000Z",
          }),
        ],
      }),
    });

    const resultado = await listarVehiculos({}, { cliente: falso.cliente });
    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.map((v) => v.vehiculoId)).toEqual(["NUEVO", "VIEJO"]);
  });

  it("descarta items corruptos sin perder los demas", async () => {
    const falso = crearClienteFalso({
      responder: porParticion({
        DISPONIBLE: [
          { ...vehiculo("ROTO", "DISPONIBLE"), marca: undefined },
          vehiculo("SANO", "DISPONIBLE"),
        ],
      }),
    });

    const resultado = await listarVehiculos(
      { estatus: ["DISPONIBLE"] },
      { cliente: falso.cliente },
    );
    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.map((v) => v.vehiculoId)).toEqual(["SANO"]);
  });
});

describe("busqueda", () => {
  const conCatalogo = () =>
    crearClienteFalso({
      responder: porParticion({
        DISPONIBLE: [
          vehiculo("V1", "DISPONIBLE", { marca: "Nissan", version: "NP300" }),
          vehiculo("V2", "DISPONIBLE", { marca: "Ford", version: "Ranger XL" }),
        ],
      }),
    });

  const buscar = async (busqueda: string) => {
    const falso = conCatalogo();
    const resultado = await listarVehiculos(
      { estatus: ["DISPONIBLE"], busqueda },
      { cliente: falso.cliente },
    );
    if (!resultado.ok) throw new Error("se esperaba exito");
    return resultado.data.map((v) => v.vehiculoId);
  };

  it("busca en la marca", async () => {
    await expect(buscar("ford")).resolves.toEqual(["V2"]);
  });

  it("busca en la version", async () => {
    await expect(buscar("np300")).resolves.toEqual(["V1"]);
  });

  it("no distingue mayusculas", async () => {
    await expect(buscar("NISSAN")).resolves.toEqual(["V1"]);
  });

  it("acepta una coincidencia parcial", async () => {
    await expect(buscar("rang")).resolves.toEqual(["V2"]);
  });

  it("una busqueda en blanco no filtra nada", async () => {
    await expect(buscar("   ")).resolves.toEqual(["V1", "V2"]);
  });

  it("sin coincidencias devuelve la lista vacia, no un error", async () => {
    await expect(buscar("submarino")).resolves.toEqual([]);
  });
});
