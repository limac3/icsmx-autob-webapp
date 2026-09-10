// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActorUsuario } from "./deps";
import {
  esPermutacion,
  MAXIMO_MOVIMIENTOS,
  reordenarFotografias,
} from "./reordenarFotografias";
import {
  comandoDe,
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import type { Fotografia, VehiculoConFotografias } from "@/types/vehiculo";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-09-05T18:30:00.000Z");

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Administrar_Vehiculos"],
};

const foto = (fotoId: string, orden: number): Fotografia => ({
  fotoId,
  vehiculoId: "V1",
  orden,
  claveS3: `vehiculos/V1/${fotoId}.jpg`,
  contentType: "image/jpeg",
  bytes: 1000,
  subidaEn: "2026-01-10T10:00:00.000Z",
  subidaPor: "P0",
});

const vehiculo = (fotografias: Fotografia[]): VehiculoConFotografias => ({
  numeroEconomico: "VEH-001",
  numeroDeSerie: "3N6AD33A9KK870001",
  vehiculoId: "V1",
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 100_000,
  estatus: "DISPONIBLE",
  creadoEn: "2026-01-10T10:00:00.000Z",
  creadoPor: "P0",
  actualizadoEn: "2026-01-10T10:00:00.000Z",
  actualizadoPor: "P0",
  fotografias,
});

const tres = [foto("F1", 1), foto("F2", 2), foto("F3", 3)];

const deps = (falso: ClienteFalso) => ({
  cliente: falso.cliente,
  ahora: () => AHORA,
});

const itemsDeTransaccion = (
  falso: ClienteFalso,
): Record<string, Record<string, Record<string, unknown>>>[] =>
  (comandoDe(falso, "TransactWriteCommand")?.TransactItems ?? []) as Record<
    string,
    Record<string, Record<string, unknown>>
  >[];

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("esPermutacion", () => {
  it("acepta la galeria completa reordenada", () => {
    expect(esPermutacion(tres, ["F3", "F1", "F2"])).toBe(true);
  });

  it("rechaza un subconjunto", () => {
    // Una permutacion parcial dejaria fotografias fuera del nuevo orden, con su
    // posicion vieja intacta e intercaladas donde nadie las puso.
    expect(esPermutacion(tres, ["F1", "F2"])).toBe(false);
  });

  it("rechaza repetidos", () => {
    expect(esPermutacion(tres, ["F1", "F1", "F2"])).toBe(false);
  });

  it("rechaza un identificador ajeno", () => {
    expect(esPermutacion(tres, ["F1", "F2", "F9"])).toBe(false);
  });

  it("acepta la galeria vacia con lista vacia", () => {
    expect(esPermutacion([], [])).toBe(true);
  });
});

describe("reordenamiento", () => {
  it("mueve cada fotografia con un Delete y un Put", async () => {
    // El orden vive en la clave, asi que cambiarlo es reubicar el item, no
    // actualizarlo.
    const falso = crearClienteFalso();
    await reordenarFotografias(
      { actual: vehiculo(tres), ordenFotoIds: ["F3", "F2", "F1"], actor },
      deps(falso),
    );

    const items = itemsDeTransaccion(falso);
    expect(items[0]?.Delete?.Key).toMatchObject({ SK: "FOTO#0003#F3" });
    expect(items[1]?.Put?.Item).toMatchObject({ SK: "FOTO#0001#F3", orden: 1 });
    expect(items[2]?.Delete?.Key).toMatchObject({ SK: "FOTO#0001#F1" });
    expect(items[3]?.Put?.Item).toMatchObject({ SK: "FOTO#0003#F1", orden: 3 });
  });

  it("no toca las que se quedan en su lugar", async () => {
    // Un `Delete` y un `Put` sobre la misma clave son dos operaciones sobre un
    // mismo item, y DynamoDB rechaza la transaccion entera.
    const falso = crearClienteFalso();
    await reordenarFotografias(
      { actual: vehiculo(tres), ordenFotoIds: ["F3", "F2", "F1"], actor },
      deps(falso),
    );

    const claves = itemsDeTransaccion(falso).flatMap((item) => [
      item.Delete?.Key?.SK,
      item.Put?.Item?.SK,
    ]);
    expect(claves).not.toContain("FOTO#0002#F2");
  });

  it("conserva los demas atributos de la fotografia", async () => {
    const falso = crearClienteFalso();
    await reordenarFotografias(
      { actual: vehiculo(tres), ordenFotoIds: ["F3", "F2", "F1"], actor },
      deps(falso),
    );

    expect(itemsDeTransaccion(falso)[1]?.Put?.Item).toMatchObject({
      fotoId: "F3",
      claveS3: "vehiculos/V1/F3.jpg",
      contentType: "image/jpeg",
      subidaPor: "P0",
    });
  });

  it("va todo en una sola transaccion", async () => {
    // Un reordenamiento a medias dejaria dos fotografias en la misma posicion
    // o una desaparecida.
    const falso = crearClienteFalso();
    await reordenarFotografias(
      { actual: vehiculo(tres), ordenFotoIds: ["F3", "F2", "F1"], actor },
      deps(falso),
    );

    expect(falso.comandos.map((c) => c.nombre)).toEqual([
      "TransactWriteCommand",
    ]);
  });

  it("escribe el evento al final de la transaccion", async () => {
    const falso = crearClienteFalso();
    await reordenarFotografias(
      { actual: vehiculo(tres), ordenFotoIds: ["F3", "F2", "F1"], actor },
      deps(falso),
    );

    const items = itemsDeTransaccion(falso);
    expect(items[items.length - 1]?.Put?.Item).toMatchObject({
      PK: "AUDIT#VEHICULO#V1",
      tipo: "VEHICULO_EDITADO",
      datos: { ordenFotoIds: ["F3", "F2", "F1"] },
    });
  });

  it("compacta los huecos de orden", async () => {
    // Tras varias bajas, los ordenes pueden ser 1, 5 y 9. Reordenar los vuelve
    // 1, 2 y 3 sin que nadie tenga que pedirlo.
    const falso = crearClienteFalso();
    await reordenarFotografias(
      {
        actual: vehiculo([foto("F1", 1), foto("F2", 5), foto("F3", 9)]),
        ordenFotoIds: ["F1", "F2", "F3"],
        actor,
      },
      deps(falso),
    );

    const puestos = itemsDeTransaccion(falso)
      .map((item) => item.Put?.Item)
      .filter((item) => item?.fotoId !== undefined);
    expect(puestos.map((item) => item?.orden)).toEqual([2, 3]);
  });
});

describe("sin trabajo", () => {
  it("no escribe nada si el orden ya es el pedido", async () => {
    const falso = crearClienteFalso();
    const resultado = await reordenarFotografias(
      { actual: vehiculo(tres), ordenFotoIds: ["F1", "F2", "F3"], actor },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: true, data: { vehiculoId: "V1" } });
    expect(falso.comandos).toHaveLength(0);
  });
});

describe("rechazos", () => {
  it.each([
    [["F1", "F2"], "lista incompleta"],
    [["F1", "F1", "F2"], "con repetidos"],
    [["F1", "F2", "F9"], "con un ajeno"],
  ])("rechaza una %s", async (ordenFotoIds) => {
    const falso = crearClienteFalso();
    const resultado = await reordenarFotografias(
      { actual: vehiculo(tres), ordenFotoIds, actor },
      deps(falso),
    );

    expect(resultado).toEqual({
      ok: false,
      error: "validation_failed",
      detalles: { ordenFotoIds: "no_es_permutacion" },
    });
    expect(falso.comandos).toHaveLength(0);
  });

  it("el tope de movimientos cabe en una transaccion", () => {
    // Cada movimiento son dos items, mas el evento. Si el calculo se
    // desincronizara del limite real, el fallo seria una excepcion del SDK en
    // vez de un error de dominio.
    expect(MAXIMO_MOVIMIENTOS * 2 + 1).toBeLessThanOrEqual(100);
  });
});
