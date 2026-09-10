// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActorUsuario } from "./deps";
import { retirarVehiculo } from "./retirarVehiculo";
import {
  comandoDe,
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import { ESTATUS_VEHICULO, type Vehiculo } from "@/types/vehiculo";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-09-05T18:30:00.000Z");

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Administrar_Vehiculos"],
};

const disponible: Vehiculo = {
  numeroEconomico: "VEH-001",
  numeroDeSerie: "3N6AD33A9KK870001",
  vehiculoId: "V1",
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 148_320,
  estatus: "DISPONIBLE",
  creadoEn: "2026-01-10T10:00:00.000Z",
  creadoPor: "P0",
  actualizadoEn: "2026-01-10T10:00:00.000Z",
  actualizadoPor: "P0",
};

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

describe("retiro correcto", () => {
  it("mueve el vehiculo a RETIRADO y guarda el motivo", async () => {
    const falso = crearClienteFalso();
    const resultado = await retirarVehiculo(
      { actual: disponible, motivo: "  siniestro total  ", actor },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: true, data: { vehiculoId: "V1" } });
    expect(
      itemsDeTransaccion(falso)[0]?.Update?.ExpressionAttributeValues,
    ).toMatchObject({
      ":destino": "RETIRADO",
      ":motivo": "siniestro total",
      ":estatusEsperado": "DISPONIBLE",
    });
  });

  it("reescribe las claves de GSI2 para que salga del listado de DISPONIBLE", async () => {
    // Sin esto el vehiculo retirado seguiria apareciendo en PA-03 como
    // disponible, y alguien lo incluiria en una convocatoria.
    const falso = crearClienteFalso();
    await retirarVehiculo(
      { actual: disponible, motivo: "siniestro", actor },
      deps(falso),
    );

    expect(
      itemsDeTransaccion(falso)[0]?.Update?.ExpressionAttributeValues,
    ).toMatchObject({
      ":gsi2pk": "VEH_ESTATUS#RETIRADO",
      // La fecha del indice sigue siendo la de creacion: el orden del
      // catalogo no depende de cuando se retiro.
      ":gsi2sk": "2026-01-10T10:00:00.000Z#V1",
    });
  });

  it("condiciona al estatus leido", async () => {
    const falso = crearClienteFalso();
    await retirarVehiculo(
      { actual: disponible, motivo: "siniestro", actor },
      deps(falso),
    );

    expect(itemsDeTransaccion(falso)[0]?.Update?.ConditionExpression).toBe(
      "attribute_exists(PK) AND #estatus = :estatusEsperado",
    );
  });

  it("escribe el evento con motivo en la misma transaccion", async () => {
    const falso = crearClienteFalso();
    await retirarVehiculo(
      { actual: disponible, motivo: "siniestro total", actor },
      deps(falso),
    );

    const items = itemsDeTransaccion(falso);
    expect(items).toHaveLength(2);
    expect(items[1]?.Put?.Item).toMatchObject({
      PK: "AUDIT#VEHICULO#V1",
      tipo: "VEHICULO_RETIRADO",
      motivo: "siniestro total",
      estadoAnterior: "DISPONIBLE",
      estadoNuevo: "RETIRADO",
    });
  });
});

describe("motivo obligatorio", () => {
  it.each(["", "   ", "\t"])(
    "rechaza el motivo %j sin escribir nada",
    async (motivo) => {
      const falso = crearClienteFalso();
      const resultado = await retirarVehiculo(
        { actual: disponible, motivo, actor },
        deps(falso),
      );

      expect(resultado).toEqual({
        ok: false,
        error: "validation_failed",
        detalles: { motivo: "requerido" },
      });
      expect(falso.comandos).toHaveLength(0);
    },
  );
});

describe("la maquina de estados manda", () => {
  const noRetirables = ESTATUS_VEHICULO.filter(
    (estatus) => estatus !== "DISPONIBLE",
  );

  it.each(noRetirables)("rechaza retirar un vehiculo %s", async (estatus) => {
    // La guarda de `vehiculo:retirar` ya exige DISPONIBLE, pero esa es politica
    // de permisos: si manana la organizacion concede el permiso mas ampliamente,
    // la maquina de estados sigue siendo la que decide que transiciones existen.
    const falso = crearClienteFalso();
    const resultado = await retirarVehiculo(
      { actual: { ...disponible, estatus }, motivo: "lo que sea", actor },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(falso.comandos).toHaveLength(0);
  });

  it("no depende del permiso para negarse", async () => {
    const falso = crearClienteFalso();
    const resultado = await retirarVehiculo(
      {
        actual: { ...disponible, estatus: "VENDIDO" },
        motivo: "lo que sea",
        actor: { ...actor, permisos: [...actor.permisos, "Autob_Auditar"] },
      },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
  });
});
