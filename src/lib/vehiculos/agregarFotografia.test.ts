// @vitest-environment node
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  agregarFotografia,
  MAXIMO_FOTOGRAFIAS,
  type DepsAgregarFotografia,
} from "./agregarFotografia";
import type { ActorUsuario } from "./deps";
import { MAXIMO_BYTES_FOTOGRAFIA } from "@/lib/media/almacenamiento";
import type { Normalizador } from "@/lib/media/normalizarImagen";
import {
  comandoDe,
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import {
  ANCHOS_DE_VARIANTE,
  NOMBRES_DE_VARIANTE,
  type Fotografia,
  type VehiculoConFotografias,
} from "@/types/vehiculo";
import { clavesDePrueba, fotografiaDePrueba } from "@/utils/fotografiaDePrueba";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-09-05T18:30:00.000Z");
const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Administrar_Vehiculos"],
};

const foto = fotografiaDePrueba;

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

/**
 * Normalizador de doble.
 *
 * `archivo` son cuatro bytes —la firma de un PNG—, que **no** es una imagen
 * decodificable, y el normalizador de verdad la rechazaria. Este archivo prueba
 * la transaccion, el orden de los items, la principal y la compensacion; el
 * pipeline real se prueba con imagenes de verdad en `normalizarImagen.test.ts`.
 *
 * Devuelve anchos crecientes y bytes distintos por variante, que es lo que
 * permite afirmar que el item guarda los de la variante mayor.
 */
const normalizadorFalso: Normalizador = () =>
  Promise.resolve({
    ok: true,
    imagen: {
      formatoDetectado: "png",
      variantes: NOMBRES_DE_VARIANTE.map((nombre, indice) => ({
        nombre,
        cuerpo: new Uint8Array([indice + 1]),
        ancho: ANCHOS_DE_VARIANTE[nombre],
        alto: Math.round((ANCHOS_DE_VARIANTE[nombre] * 3) / 4),
        bytes: (indice + 1) * 1000,
      })),
    },
  });

const escenario = (
  normalizar: Normalizador = normalizadorFalso,
): {
  dynamo: ClienteFalso;
  s3: ClienteFalso<S3Client>;
  deps: DepsAgregarFotografia;
} => {
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
      normalizar,
    },
  };
};

/** Las tres claves que produce una subida, del mas chico al mas grande. */
const clavesEsperadas = clavesDePrueba(ID);

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
  it("sube las tres variantes, con las claves que arma el servidor", async () => {
    const { s3, deps } = escenario();
    await agregarFotografia({ actual: vehiculo(), archivo, actor }, deps);

    expect(s3.comandos.map((c) => c.nombre)).toEqual([
      "PutObjectCommand",
      "PutObjectCommand",
      "PutObjectCommand",
    ]);
    expect(s3.comandos.map((c) => (c.input as { Key: string }).Key)).toEqual(
      clavesEsperadas,
    );
  });

  it("cada variante se guarda como WebP inmutable", async () => {
    const { s3, deps } = escenario();
    await agregarFotografia({ actual: vehiculo(), archivo, actor }, deps);

    for (const comando of s3.comandos) {
      expect(comando.input).toMatchObject({
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      });
    }
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
      // `claveS3` y `bytes` del item son los de la variante **mayor**: lo que
      // firma, borra y audita el resto del codigo no sabe de variantes.
      claveS3: `vehiculos/V1/${ID}-max.webp`,
      contentType: "image/webp",
      bytes: 3000,
      subidaPor: "P1",
    });
  });

  it("guarda las tres variantes con su ancho medido", async () => {
    const { dynamo, deps } = escenario();
    await agregarFotografia({ actual: vehiculo(), archivo, actor }, deps);

    expect(itemsDeTransaccion(dynamo)[0]?.Put?.Item?.variantes).toEqual({
      min: {
        claveS3: `vehiculos/V1/${ID}-min.webp`,
        ancho: 480,
        alto: 360,
        bytes: 1000,
      },
      med: {
        claveS3: `vehiculos/V1/${ID}-med.webp`,
        ancho: 1280,
        alto: 960,
        bytes: 2000,
      },
      max: {
        claveS3: `vehiculos/V1/${ID}-max.webp`,
        ancho: 2048,
        alto: 1536,
        bytes: 3000,
      },
    });
  });

  it("sube a S3 antes de escribir en DynamoDB", async () => {
    // Al reves, un fallo de S3 dejaria un item apuntando a un objeto que no
    // existe y la galeria mostraria una imagen rota. Un objeto huerfano en S3
    // es invisible.
    const { s3, dynamo, deps } = escenario();
    await agregarFotografia({ actual: vehiculo(), archivo, actor }, deps);

    expect(s3.comandos).toHaveLength(3);
    expect(dynamo.comandos).toHaveLength(1);
  });

  it("normaliza antes de tocar S3: lo que no es imagen no escribe nada", async () => {
    // El fallo mas probable de este camino, y por eso va primero: ocurriendo
    // antes del primer `PutObject` no hay nada que compensar.
    const { s3, dynamo, deps } = escenario(() =>
      Promise.resolve({ ok: false, motivo: "no_decodificable" }),
    );

    const resultado = await agregarFotografia(
      { actual: vehiculo(), archivo, actor },
      deps,
    );

    expect(resultado).toEqual({
      ok: false,
      error: "validation_failed",
      detalles: { archivo: "no_decodificable" },
    });
    expect(s3.comandos).toHaveLength(0);
    expect(dynamo.comandos).toHaveLength(0);
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

  it("la clave de la miniatura viaja con el identificador, en la misma escritura", async () => {
    // Si divergieran, el listado de la pantalla 4.1 mostraria la miniatura de
    // una fotografia que ya no es la principal. Son una sola desnormalizacion,
    // y por eso se compara contra la variante que el propio `Put` acaba de
    // escribir, no contra una cadena copiada a mano.
    const { dynamo, deps } = escenario();
    await agregarFotografia({ actual: vehiculo(), archivo, actor }, deps);

    const items = itemsDeTransaccion(dynamo);
    const variantes = items[0]?.Put?.Item?.variantes as
      Record<string, { claveS3: string }> | undefined;
    const update = items[1]?.Update;

    expect(update?.ExpressionAttributeNames).toMatchObject({
      "#principalClave": "fotografiaPrincipalClave",
    });
    expect(update?.ExpressionAttributeValues).toMatchObject({
      ":claveMin": variantes?.min.claveS3,
    });
    // `min` y no `max`: la unica superficie que la consume es una miniatura.
    expect(update?.ExpressionAttributeValues).not.toMatchObject({
      ":claveMin": variantes?.max.claveS3,
    });
  });

  it("si no cambia la principal, tampoco toca su clave", async () => {
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
    expect(String(update?.UpdateExpression)).not.toContain("#principalClave");
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

describe("variantes que salen identicas", () => {
  /**
   * Normalizador de un original de 1000 px: por encima de `min` (480) y por
   * debajo de `med` (1280).
   *
   * `withoutEnlargement` deja entonces `med` y `max` en 1000, o sea el mismo
   * archivo codificado dos veces. Es el caso corriente de una fotografia que
   * paso por mensajeria, no una rareza de laboratorio.
   */
  const sinAgrandar: Normalizador = () =>
    Promise.resolve({
      ok: true,
      imagen: {
        formatoDetectado: "jpeg",
        variantes: NOMBRES_DE_VARIANTE.map((nombre) => {
          const ancho = Math.min(ANCHOS_DE_VARIANTE[nombre], 1000);
          return {
            nombre,
            cuerpo: new Uint8Array([ancho === 1000 ? 9 : 1]),
            ancho,
            alto: Math.round((ancho * 3) / 4),
            bytes: ancho * 10,
          };
        }),
      },
    });

  const claveMin = `vehiculos/V1/${ID}-min.webp`;
  const claveMed = `vehiculos/V1/${ID}-med.webp`;

  it("sube un solo objeto por las dos variantes que coinciden", async () => {
    const { s3, deps } = escenario(sinAgrandar);
    await agregarFotografia({ actual: vehiculo(), archivo, actor }, deps);

    expect(s3.comandos.map((c) => (c.input as { Key: string }).Key)).toEqual([
      claveMin,
      claveMed,
    ]);
  });

  it("las dos entradas del Record apuntan al mismo objeto", async () => {
    // `variantes` sigue teniendo las tres: es un Record completo a proposito,
    // para que no se pueda representar "tengo min y max pero no med". Lo que
    // cambia es que dos comparten clave.
    const { dynamo, deps } = escenario(sinAgrandar);
    await agregarFotografia({ actual: vehiculo(), archivo, actor }, deps);

    expect(itemsDeTransaccion(dynamo)[0]?.Put?.Item?.variantes).toEqual({
      min: { claveS3: claveMin, ancho: 480, alto: 360, bytes: 4800 },
      med: { claveS3: claveMed, ancho: 1000, alto: 750, bytes: 10000 },
      max: { claveS3: claveMed, ancho: 1000, alto: 750, bytes: 10000 },
    });
  });

  it("el `claveS3` del item apunta a un objeto que existe", async () => {
    // El del item es el de la variante mayor. Si conservara `-max.webp` seria
    // una referencia colgante: ese objeto nunca se subio. Es el unico error de
    // este cambio que la galeria mostraria como imagen rota.
    const { dynamo, deps } = escenario(sinAgrandar);
    await agregarFotografia({ actual: vehiculo(), archivo, actor }, deps);

    expect(itemsDeTransaccion(dynamo)[0]?.Put?.Item).toMatchObject({
      claveS3: claveMed,
      bytes: 10000,
    });
  });

  it("el evento registra solo las claves realmente escritas", async () => {
    // La bitacora es lo unico que dice que objetos habia que borrar si el
    // borrado de S3 falla. Una clave que nunca se escribio ahi manda a buscar
    // un objeto inexistente.
    const { dynamo, deps } = escenario(sinAgrandar);
    await agregarFotografia({ actual: vehiculo(), archivo, actor }, deps);

    expect(itemsDeTransaccion(dynamo)[2]?.Put?.Item?.datos).toMatchObject({
      clavesDeVariantes: [claveMin, claveMed],
    });
  });

  it("la compensacion borra dos objetos, no tres", async () => {
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

    await agregarFotografia(
      { actual: vehiculo(), archivo, actor },
      {
        cliente: dynamo.cliente,
        s3: s3.cliente,
        ahora: () => AHORA,
        nuevoId: () => ID,
        normalizar: sinAgrandar,
      },
    );

    const borrados = s3.comandos
      .filter((c) => c.nombre === "DeleteObjectCommand")
      .map((c) => (c.input as { Key: string }).Key);
    expect(borrados).toEqual([claveMin, claveMed]);
  });
});

describe("compensacion", () => {
  it("borra las tres variantes si la transaccion se cancela", async () => {
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
        normalizar: normalizadorFalso,
      },
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(s3.comandos.map((c) => c.nombre)).toEqual([
      "PutObjectCommand",
      "PutObjectCommand",
      "PutObjectCommand",
      "DeleteObjectCommand",
      "DeleteObjectCommand",
      "DeleteObjectCommand",
    ]);
    expect(
      s3.comandos.slice(3).map((c) => (c.input as { Key: string }).Key),
    ).toEqual(clavesEsperadas);
  });

  it("un fallo parcial de S3 borra solo lo que alcanzo a escribir", async () => {
    // Caso nuevo desde que una fotografia son tres objetos: si la tercera
    // subida falla, quedan dos huerfanos. La lista de claves a borrar se
    // acumula con lo escrito, no se deriva de las variantes.
    const dynamo = crearClienteFalso();
    const s3 = crearClienteFalso<S3Client>();

    let subidas = 0;
    const original = s3.cliente.send.bind(s3.cliente);
    s3.cliente.send = ((comando: unknown) => {
      const nombre = (comando as { constructor: { name: string } }).constructor
        .name;
      if (nombre === "PutObjectCommand") {
        subidas += 1;
        if (subidas === 3) return Promise.reject(new Error("S3 caido"));
      }
      return original(comando as never);
    }) as typeof s3.cliente.send;

    const resultado = await agregarFotografia(
      { actual: vehiculo(), archivo, actor },
      {
        cliente: dynamo.cliente,
        s3: s3.cliente,
        ahora: () => AHORA,
        nuevoId: () => ID,
        normalizar: normalizadorFalso,
      },
    );

    expect(resultado).toEqual({
      ok: false,
      error: "dependencia_no_disponible",
    });
    // Dos borrados, no tres: la que fallo nunca se escribio.
    const borrados = s3.comandos
      .filter((c) => c.nombre === "DeleteObjectCommand")
      .map((c) => (c.input as { Key: string }).Key);
    expect(borrados).toEqual(clavesEsperadas.slice(0, 2));
    // Y nada en DynamoDB: no hay item que apunte a objetos a medias.
    expect(dynamo.comandos).toHaveLength(0);
  });
});
