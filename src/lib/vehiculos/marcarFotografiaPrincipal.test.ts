// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActorUsuario } from "./deps";
import { marcarFotografiaPrincipal } from "./marcarFotografiaPrincipal";
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

const vehiculo = (principal?: string): VehiculoConFotografias => ({
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
  fotografiaPrincipalId: principal,
  fotografias: [foto("F1", 1), foto("F2", 2)],
});

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

describe("cambio correcto", () => {
  it("apunta la principal a la fotografia pedida", async () => {
    const falso = crearClienteFalso();
    const resultado = await marcarFotografiaPrincipal(
      { actual: vehiculo("F1"), fotoId: "F2", actor },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: true, data: { fotoId: "F2" } });
    expect(
      itemsDeTransaccion(falso)[0]?.Update?.ExpressionAttributeValues,
    ).toMatchObject({ ":fotoId": "F2", ":estatusEsperado": "DISPONIBLE" });
  });

  it("registra el cambio con su valor anterior", async () => {
    const falso = crearClienteFalso();
    await marcarFotografiaPrincipal(
      { actual: vehiculo("F1"), fotoId: "F2", actor },
      deps(falso),
    );

    expect(itemsDeTransaccion(falso)[1]?.Put?.Item).toMatchObject({
      tipo: "VEHICULO_EDITADO",
      datos: {
        campos: ["fotografiaPrincipalId"],
        anterior: "F1",
        nueva: "F2",
      },
    });
  });

  it("funciona cuando el vehiculo aun no tenia principal", async () => {
    const falso = crearClienteFalso();
    await marcarFotografiaPrincipal(
      { actual: vehiculo(undefined), fotoId: "F1", actor },
      deps(falso),
    );

    expect(itemsDeTransaccion(falso)[1]?.Put?.Item).toMatchObject({
      datos: { anterior: null, nueva: "F1" },
    });
  });
});

describe("sin efecto", () => {
  it("no escribe si ya era la principal", async () => {
    const falso = crearClienteFalso();
    const resultado = await marcarFotografiaPrincipal(
      { actual: vehiculo("F1"), fotoId: "F1", actor },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: true, data: { fotoId: "F1" } });
    expect(falso.comandos).toHaveLength(0);
  });
});

describe("rechazos", () => {
  it("no apunta la principal a una fotografia que no existe", async () => {
    // Apuntarla a algo inexistente dejaria el listado sin imagen y sin error
    // visible.
    const falso = crearClienteFalso();
    const resultado = await marcarFotografiaPrincipal(
      { actual: vehiculo("F1"), fotoId: "F9", actor },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: false, error: "not_found" });
    expect(falso.comandos).toHaveLength(0);
  });
});
