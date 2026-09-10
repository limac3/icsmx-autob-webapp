// @vitest-environment node
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { agregarFotografia, MAXIMO_FOTOGRAFIAS } from "./agregarFotografia";
import type { ActorUsuario } from "./deps";
import { MAXIMO_BYTES_FOTOGRAFIA } from "@/lib/media/almacenamiento";
import {
  comandoDe,
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import type { Fotografia, VehiculoConFotografias } from "@/types/vehiculo";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-09-05T18:30:00.000Z");
const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

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
  fotografias: Fotografia[] = [],
  extras: Partial<VehiculoConFotografias> = {},
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
  fotografias,
  ...extras,
});

const archivo = {
  bytes: new Uint8Array([137, 80, 78, 71]),
  contentType: "image/png",
};

const escenario = () => {
  const dynamo = crearClienteFalso();
  const s3 = crearClienteFalso<S3Client>();
  return {
    dynamo,
    s3,
    deps: {
      cliente: dynamo.cliente,
      s3: s3.cliente,
      ahora: () => AHORA,
      nuevoId: () => ID,
    },
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

describe("subida correcta", () => {
  it("sube el objeto con la clave que arma el servidor", async () => {
    const { s3, deps } = escenario();
    await agregarFotografia({ actual: vehiculo(), archivo, actor }, deps);

    expect(s3.comandos[0]?.nombre).toBe("PutObjectCommand");
    expect(s3.comandos[0]?.input).toMatchObject({
      Key: `vehiculos/V1/${ID}.png`,
      ContentType: "image/png",
    });
  });

  it("escribe el item de fotografia con el orden en la clave", async () => {
    const { dynamo, deps } = escenario();
    await agregarFotografia(
      { actual: vehiculo([foto("F1", 1), foto("F2", 2)]), archivo, actor },
      deps,
    );

    expect(itemsDeTransaccion(dynamo)[0]?.Put?.Item).toMatchObject({
      PK: "VEH#V1",
      SK: `FOTO#0003#${ID}`,
      fotoId: ID,
      orden: 3,
      claveS3: `vehiculos/V1/${ID}.png`,
      contentType: "image/png",
      bytes: 4,
      subidaPor: "P1",
    });
  });

  it("sube a S3 antes de escribir en DynamoDB", async () => {
    // Al reves, un fallo de S3 dejaria un item apuntando a un objeto que no
    // existe y la galeria mostraria una imagen rota. Un objeto huerfano en S3
    // es invisible.
    const { s3, dynamo, deps } = escenario();
    await agregarFotografia({ actual: vehiculo(), archivo, actor }, deps);

    expect(s3.comandos).toHaveLength(1);
    expect(dynamo.comandos).toHaveLength(1);
  });

  it("escribe el evento en la misma transaccion", async () => {
    const { dynamo, deps } = escenario();
    await agregarFotografia({ actual: vehiculo(), archivo, actor }, deps);

    const items = itemsDeTransaccion(dynamo);
    expect(items).toHaveLength(3);
    expect(items[2]?.Put?.Item).toMatchObject({
      PK: "AUDIT#VEHICULO#V1",
      tipo: "VEHICULO_FOTOGRAFIA_AGREGADA",
      datos: { fotoId: ID, orden: 1, esPrincipal: true },
    });
  });

  it("recorta la descripcion", async () => {
    const { dynamo, deps } = escenario();
    await agregarFotografia(
      { actual: vehiculo(), archivo, descripcion: "  frente  ", actor },
      deps,
    );

    expect(itemsDeTransaccion(dynamo)[0]?.Put?.Item?.descripcion).toBe(
      "frente",
    );
  });
});

describe("fotografia principal", () => {
  it("la primera es principal aunque nadie lo pida", async () => {
    // Un vehiculo con galeria y sin principal no se puede representar en el
    // listado: la tarjeta saldria sin imagen.
    const { dynamo, deps } = escenario();
    await agregarFotografia({ actual: vehiculo(), archivo, actor }, deps);

    const update = itemsDeTransaccion(dynamo)[1]?.Update;
    expect(update?.ExpressionAttributeValues).toMatchObject({ ":fotoId": ID });
    expect(update?.ExpressionAttributeNames).toMatchObject({
      "#principal": "fotografiaPrincipalId",
    });
  });

  it("una posterior no cambia la principal si no se pide", async () => {
    const { dynamo, deps } = escenario();
    await agregarFotografia(
      {
        actual: vehiculo([foto("F1", 1)], { fotografiaPrincipalId: "F1" }),
        archivo,
        actor,
      },
      deps,
    );

    const update = itemsDeTransaccion(dynamo)[1]?.Update;
    expect(String(update?.UpdateExpression)).not.toContain("#principal");
  });

  it("la promueve cuando se pide explicitamente", async () => {
    const { dynamo, deps } = escenario();
    await agregarFotografia(
      {
        actual: vehiculo([foto("F1", 1)], { fotografiaPrincipalId: "F1" }),
        archivo,
        esPrincipal: true,
        actor,
      },
      deps,
    );

    expect(
      itemsDeTransaccion(dynamo)[1]?.Update?.ExpressionAttributeValues,
    ).toMatchObject({ ":fotoId": ID });
  });
});

describe("rechazos, sin tocar S3", () => {
  it.each([
    ["image/gif", { archivo: "tipo_no_admitido" }],
    ["application/pdf", { archivo: "tipo_no_admitido" }],
  ])("rechaza el tipo %s", async (contentType, detalles) => {
    const { s3, dynamo, deps } = escenario();
    const resultado = await agregarFotografia(
      { actual: vehiculo(), archivo: { ...archivo, contentType }, actor },
      deps,
    );

    expect(resultado).toEqual({
      ok: false,
      error: "validation_failed",
      detalles,
    });
    expect(s3.comandos).toHaveLength(0);
    expect(dynamo.comandos).toHaveLength(0);
  });

  it("rechaza un archivo vacio", async () => {
    const { s3, deps } = escenario();
    const resultado = await agregarFotografia(
      {
        actual: vehiculo(),
        archivo: { ...archivo, bytes: new Uint8Array() },
        actor,
      },
      deps,
    );

    expect(resultado).toMatchObject({ error: "validation_failed" });
    expect(s3.comandos).toHaveLength(0);
  });

  it("rechaza un archivo por encima del maximo", async () => {
    const { s3, deps } = escenario();
    const resultado = await agregarFotografia(
      {
        actual: vehiculo(),
        archivo: {
          ...archivo,
          bytes: new Uint8Array(MAXIMO_BYTES_FOTOGRAFIA + 1),
        },
        actor,
      },
      deps,
    );

    expect(resultado).toEqual({
      ok: false,
      error: "validation_failed",
      detalles: { archivo: "muy_grande" },
    });
    expect(s3.comandos).toHaveLength(0);
  });

  it("rechaza pasar del tope de fotografias", async () => {
    const llena = Array.from({ length: MAXIMO_FOTOGRAFIAS }, (_, i) =>
      foto(`F${String(i)}`, i + 1),
    );
    const { s3, deps } = escenario();
    const resultado = await agregarFotografia(
      { actual: vehiculo(llena), archivo, actor },
      deps,
    );

    expect(resultado).toEqual({
      ok: false,
      error: "validation_failed",
      detalles: { fotografias: "demasiadas" },
    });
    expect(s3.comandos).toHaveLength(0);
  });

  it("rechaza una descripcion demasiado larga", async () => {
    const { s3, deps } = escenario();
    const resultado = await agregarFotografia(
      { actual: vehiculo(), archivo, descripcion: "x".repeat(201), actor },
      deps,
    );

    expect(resultado).toMatchObject({
      error: "validation_failed",
      detalles: { descripcion: "muy_largo" },
    });
    expect(s3.comandos).toHaveLength(0);
  });
});

describe("compensacion", () => {
  it("borra el objeto de S3 si la transaccion se cancela", async () => {
    // Sin esto, cada fallo dejaria basura permanente en un bucket versionado.
    const dynamo = crearClienteFalso({
      lanza: new TransactionCanceledException({
        message: "cancelada",
        $metadata: {},
        CancellationReasons: [
          { Code: "None" },
          { Code: "ConditionalCheckFailed" },
        ],
      }),
    });
    const s3 = crearClienteFalso<S3Client>();

    const resultado = await agregarFotografia(
      { actual: vehiculo(), archivo, actor },
      {
        cliente: dynamo.cliente,
        s3: s3.cliente,
        ahora: () => AHORA,
        nuevoId: () => ID,
      },
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(s3.comandos.map((c) => c.nombre)).toEqual([
      "PutObjectCommand",
      "DeleteObjectCommand",
    ]);
    expect(s3.comandos[1]?.input).toMatchObject({
      Key: `vehiculos/V1/${ID}.png`,
    });
  });
});
