// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActorUsuario } from "./deps";
import { editarDescripcionFotografia } from "./editarDescripcionFotografia";
import { LIMITES } from "@/lib/domain/vehiculos";
import {
  comandoDe,
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import type { Fotografia, VehiculoConFotografias } from "@/types/vehiculo";
import { fotografiaDePrueba } from "@/utils/fotografiaDePrueba";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-09-18T18:30:00.000Z");

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Administrar_Vehiculos"],
};

const conPie = (fotoId: string, orden: number, pie?: string): Fotografia => ({
  ...fotografiaDePrueba(fotoId, orden),
  descripcion: pie,
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
  fotografiaPrincipalId: fotografias[0]?.fotoId,
  fotografias,
});

const escenario = () => {
  const dynamo = crearClienteFalso();
  return {
    dynamo,
    deps: { cliente: dynamo.cliente, ahora: () => AHORA },
  };
};

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

describe("edicion correcta", () => {
  it("escribe el pie nuevo en el item de la fotografia, con su orden en la clave", async () => {
    const { dynamo, deps } = escenario();
    const resultado = await editarDescripcionFotografia(
      {
        actual: vehiculo([conPie("F1", 1, "Frente"), conPie("F2", 2)]),
        fotoId: "F2",
        descripcion: "Costado izquierdo",
        actor,
      },
      deps,
    );

    expect(resultado).toEqual({ ok: true, data: { fotoId: "F2" } });
    expect(itemsDeTransaccion(dynamo)[0]?.Update).toMatchObject({
      Key: { PK: "VEH#V1", SK: "FOTO#0002#F2" },
      UpdateExpression: "SET #descripcion = :descripcion",
      ConditionExpression: "attribute_exists(SK)",
      ExpressionAttributeValues: { ":descripcion": "Costado izquierdo" },
    });
  });

  it("recorta espacios antes de guardar", async () => {
    const { dynamo, deps } = escenario();
    await editarDescripcionFotografia(
      {
        actual: vehiculo([conPie("F1", 1)]),
        fotoId: "F1",
        descripcion: "   Motor   ",
        actor,
      },
      deps,
    );

    expect(
      itemsDeTransaccion(dynamo)[0]?.Update?.ExpressionAttributeValues,
    ).toMatchObject({ ":descripcion": "Motor" });
  });

  it("no toca el item del vehiculo", async () => {
    // `actualizadoEn` describe el registro del vehiculo, y el pie de una
    // fotografia no lo cambia. Meterlo en la transaccion la haria competir con
    // otras escrituras del mismo vehiculo sin ganar nada.
    const { dynamo, deps } = escenario();
    await editarDescripcionFotografia(
      {
        actual: vehiculo([conPie("F1", 1)]),
        fotoId: "F1",
        descripcion: "Motor",
        actor,
      },
      deps,
    );

    const items = itemsDeTransaccion(dynamo);
    // Solo el `Update` de la fotografia y el evento.
    expect(items).toHaveLength(2);
    expect(JSON.stringify(items)).not.toContain('"SK":"META"');
  });
});

describe("vaciar el pie", () => {
  it("quita el atributo en vez de guardar cadena vacia", async () => {
    // `descripcion` es opcional en el tipo: guardar `""` deja un dato que se
    // comporta como ausente sin serlo, y que alguien tendria que explicar.
    const { dynamo, deps } = escenario();
    await editarDescripcionFotografia(
      {
        actual: vehiculo([conPie("F1", 1, "Frente")]),
        fotoId: "F1",
        descripcion: "",
        actor,
      },
      deps,
    );

    const update = itemsDeTransaccion(dynamo)[0]?.Update;
    expect(update?.UpdateExpression).toBe("REMOVE #descripcion");
    expect(update?.ExpressionAttributeValues).toBeUndefined();
  });

  it("solo espacios cuenta como vaciar", async () => {
    const { dynamo, deps } = escenario();
    await editarDescripcionFotografia(
      {
        actual: vehiculo([conPie("F1", 1, "Frente")]),
        fotoId: "F1",
        descripcion: "    ",
        actor,
      },
      deps,
    );

    expect(itemsDeTransaccion(dynamo)[0]?.Update?.UpdateExpression).toBe(
      "REMOVE #descripcion",
    );
  });
});

describe("bitacora", () => {
  it("registra el cambio como VEHICULO_EDITADO, con el anterior y el nuevo", async () => {
    // Sin tipo de evento nuevo: `marcarFotografiaPrincipal` ya establecio que un
    // cambio de campo sobre la galeria es un `VEHICULO_EDITADO`. Se agrega el
    // `fotoId` para que la bitacora diga de que fotografia se habla.
    const { dynamo, deps } = escenario();
    await editarDescripcionFotografia(
      {
        actual: vehiculo([conPie("F1", 1, "Frente")]),
        fotoId: "F1",
        descripcion: "Frente con rayon",
        actor,
      },
      deps,
    );

    expect(itemsDeTransaccion(dynamo)[1]?.Put?.Item).toMatchObject({
      PK: "AUDIT#VEHICULO#V1",
      tipo: "VEHICULO_EDITADO",
      datos: {
        campos: ["fotografia.descripcion"],
        fotoId: "F1",
        anterior: "Frente",
        nueva: "Frente con rayon",
      },
    });
  });

  it("al vaciar, el nuevo valor queda en null y no ausente", async () => {
    // `null` dice "se quito"; un campo ausente dice "no se sabe".
    const { dynamo, deps } = escenario();
    await editarDescripcionFotografia(
      {
        actual: vehiculo([conPie("F1", 1, "Frente")]),
        fotoId: "F1",
        descripcion: "",
        actor,
      },
      deps,
    );

    expect(itemsDeTransaccion(dynamo)[1]?.Put?.Item?.datos).toMatchObject({
      anterior: "Frente",
      nueva: null,
    });
  });

  it("no escribe nada si el pie no cambio", async () => {
    // Una bitacora que registra actos sin efecto entrena a quien la lee a
    // ignorarla. Mismo criterio que `marcarFotografiaPrincipal`.
    const { dynamo, deps } = escenario();
    const resultado = await editarDescripcionFotografia(
      {
        actual: vehiculo([conPie("F1", 1, "Frente")]),
        fotoId: "F1",
        descripcion: "  Frente  ",
        actor,
      },
      deps,
    );

    expect(resultado).toEqual({ ok: true, data: { fotoId: "F1" } });
    expect(dynamo.comandos).toHaveLength(0);
  });

  it("vaciar un pie que ya estaba vacio tampoco escribe", async () => {
    const { dynamo, deps } = escenario();
    await editarDescripcionFotografia(
      { actual: vehiculo([conPie("F1", 1)]), fotoId: "F1", actor },
      deps,
    );

    expect(dynamo.comandos).toHaveLength(0);
  });
});

describe("rechazos", () => {
  it("rechaza un pie mas largo que el tope, sin escribir", async () => {
    const { dynamo, deps } = escenario();
    const resultado = await editarDescripcionFotografia(
      {
        actual: vehiculo([conPie("F1", 1)]),
        fotoId: "F1",
        descripcion: "x".repeat(LIMITES.descripcionFotografia + 1),
        actor,
      },
      deps,
    );

    expect(resultado).toEqual({
      ok: false,
      error: "validation_failed",
      detalles: { descripcion: "muy_largo" },
    });
    expect(dynamo.comandos).toHaveLength(0);
  });

  it("acepta un pie de exactamente el tope", async () => {
    const { dynamo, deps } = escenario();
    const resultado = await editarDescripcionFotografia(
      {
        actual: vehiculo([conPie("F1", 1)]),
        fotoId: "F1",
        descripcion: "x".repeat(LIMITES.descripcionFotografia),
        actor,
      },
      deps,
    );

    expect(resultado.ok).toBe(true);
    expect(dynamo.comandos).toHaveLength(1);
  });

  it("devuelve not_found si la fotografia no es de este vehiculo", async () => {
    const { dynamo, deps } = escenario();
    const resultado = await editarDescripcionFotografia(
      {
        actual: vehiculo([conPie("F1", 1)]),
        fotoId: "F9",
        descripcion: "Motor",
        actor,
      },
      deps,
    );

    expect(resultado).toEqual({ ok: false, error: "not_found" });
    expect(dynamo.comandos).toHaveLength(0);
  });
});
