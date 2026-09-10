// @vitest-environment node
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActorUsuario } from "./deps";
import { eliminarFotografia, sucesoraPrincipal } from "./eliminarFotografia";
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

const vehiculo = (
  fotografias: Fotografia[],
  principal?: string,
): VehiculoConFotografias => ({
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
  fotografiaPrincipalId: principal,
  fotografias,
});

const escenario = () => {
  const dynamo = crearClienteFalso();
  const s3 = crearClienteFalso<S3Client>();
  return {
    dynamo,
    s3,
    deps: { cliente: dynamo.cliente, s3: s3.cliente, ahora: () => AHORA },
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
  vi.stubEnv("AUTOB_MEDIA_BUCKET", "bucket-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sucesoraPrincipal", () => {
  it("elige la de menor orden entre las que quedan", () => {
    // Es la que el administrador ya coloco primero: promoverla no altera la
    // galeria que compuso.
    expect(
      sucesoraPrincipal([foto("F1", 1), foto("F2", 2), foto("F3", 3)], "F1")
        ?.fotoId,
    ).toBe("F2");
  });

  it("no se elige a si misma", () => {
    expect(
      sucesoraPrincipal([foto("F1", 1), foto("F2", 2)], "F1")?.fotoId,
    ).not.toBe("F1");
  });

  it("devuelve undefined si no queda ninguna", () => {
    expect(sucesoraPrincipal([foto("F1", 1)], "F1")).toBeUndefined();
  });
});

describe("baja correcta", () => {
  it("borra el item por su clave con el orden que tenia", async () => {
    const { dynamo, deps } = escenario();
    await eliminarFotografia(
      {
        actual: vehiculo([foto("F1", 1), foto("F2", 2)], "F1"),
        fotoId: "F2",
        actor,
      },
      deps,
    );

    expect(itemsDeTransaccion(dynamo)[0]?.Delete).toMatchObject({
      Key: { PK: "VEH#V1", SK: "FOTO#0002#F2" },
      ConditionExpression: "attribute_exists(SK)",
    });
  });

  it("borra en DynamoDB antes que en S3", async () => {
    // Al reves, un fallo de la transaccion dejaria un item apuntando a un
    // objeto ya borrado: imagen rota. Asi lo peor que queda es un objeto sin
    // referencia, inalcanzable porque su URL nunca se vuelve a firmar.
    const { dynamo, s3, deps } = escenario();
    await eliminarFotografia(
      {
        actual: vehiculo([foto("F1", 1), foto("F2", 2)], "F1"),
        fotoId: "F2",
        actor,
      },
      deps,
    );

    expect(dynamo.comandos).toHaveLength(1);
    expect(s3.comandos[0]?.input).toMatchObject({ Key: "vehiculos/V1/F2.jpg" });
  });

  it("escribe el evento en la misma transaccion", async () => {
    const { dynamo, deps } = escenario();
    await eliminarFotografia(
      {
        actual: vehiculo([foto("F1", 1), foto("F2", 2)], "F1"),
        fotoId: "F2",
        actor,
      },
      deps,
    );

    const items = itemsDeTransaccion(dynamo);
    expect(items).toHaveLength(3);
    expect(items[2]?.Put?.Item).toMatchObject({
      tipo: "VEHICULO_FOTOGRAFIA_ELIMINADA",
      datos: { fotoId: "F2", eraPrincipal: false },
    });
  });
});

describe("la principal se hereda", () => {
  it("promueve la siguiente cuando se borra la principal", async () => {
    const { dynamo, deps } = escenario();
    await eliminarFotografia(
      {
        actual: vehiculo([foto("F1", 1), foto("F2", 2)], "F1"),
        fotoId: "F1",
        actor,
      },
      deps,
    );

    expect(
      itemsDeTransaccion(dynamo)[1]?.Update?.ExpressionAttributeValues,
    ).toMatchObject({ ":sucesora": "F2" });
  });

  it("no toca la principal cuando se borra otra", async () => {
    const { dynamo, deps } = escenario();
    await eliminarFotografia(
      {
        actual: vehiculo([foto("F1", 1), foto("F2", 2)], "F1"),
        fotoId: "F2",
        actor,
      },
      deps,
    );

    expect(
      String(itemsDeTransaccion(dynamo)[1]?.Update?.UpdateExpression),
    ).not.toContain("#principal");
  });

  it("registra el relevo en el evento", async () => {
    const { dynamo, deps } = escenario();
    await eliminarFotografia(
      {
        actual: vehiculo([foto("F1", 1), foto("F2", 2)], "F1"),
        fotoId: "F1",
        actor,
      },
      deps,
    );

    expect(itemsDeTransaccion(dynamo)[2]?.Put?.Item).toMatchObject({
      datos: { eraPrincipal: true, nuevaPrincipal: "F2" },
    });
  });
});

describe("rechazos", () => {
  it("no deja al vehiculo sin galeria", async () => {
    // `api-contracts.md` y la pantalla coinciden: no se puede eliminar la
    // ultima. Borrar la principal teniendo otras si se puede, porque arriba se
    // promueve la siguiente.
    const { dynamo, s3, deps } = escenario();
    const resultado = await eliminarFotografia(
      { actual: vehiculo([foto("F1", 1)], "F1"), fotoId: "F1", actor },
      deps,
    );

    expect(resultado).toEqual({
      ok: false,
      error: "invalid_state",
      detalles: { fotografias: "es_la_ultima" },
    });
    expect(dynamo.comandos).toHaveLength(0);
    expect(s3.comandos).toHaveLength(0);
  });

  it("devuelve not_found si la fotografia no es de este vehiculo", async () => {
    const { dynamo, deps } = escenario();
    const resultado = await eliminarFotografia(
      {
        actual: vehiculo([foto("F1", 1), foto("F2", 2)], "F1"),
        fotoId: "F9",
        actor,
      },
      deps,
    );

    expect(resultado).toEqual({ ok: false, error: "not_found" });
    expect(dynamo.comandos).toHaveLength(0);
  });

  it("no borra de S3 si la transaccion se cancela", async () => {
    // Es la mitad que importa del orden: el objeto solo se borra cuando ya no
    // queda ninguna referencia a el.
    const dynamo = crearClienteFalso({
      lanza: new TransactionCanceledException({
        message: "cancelada",
        $metadata: {},
        CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
      }),
    });
    const s3 = crearClienteFalso<S3Client>();

    const resultado = await eliminarFotografia(
      {
        actual: vehiculo([foto("F1", 1), foto("F2", 2)], "F1"),
        fotoId: "F2",
        actor,
      },
      { cliente: dynamo.cliente, s3: s3.cliente, ahora: () => AHORA },
    );

    expect(resultado).toEqual({ ok: false, error: "not_found" });
    expect(s3.comandos).toHaveLength(0);
  });
});
