// @vitest-environment node
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  borrarObjeto,
  claveDeFotografia,
  esTipoDeImagen,
  guardarObjeto,
  MAXIMO_BYTES_FOTOGRAFIA,
  nombreDeBucket,
  obtenerClienteS3,
  TIPOS_DE_IMAGEN,
  __test__,
} from "./almacenamiento";
import { crearClienteFalso } from "@/utils/clienteDynamoFalso";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  __test__.reiniciar();
  vi.stubEnv("AUTOB_MEDIA_BUCKET", "bucket-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
  __test__.reiniciar();
});

describe("tipos admitidos", () => {
  it.each(Object.keys(TIPOS_DE_IMAGEN))("acepta %s", (tipo) => {
    expect(esTipoDeImagen(tipo)).toBe(true);
  });

  it.each(["image/gif", "application/pdf", "text/html", "", "image/svg+xml"])(
    "rechaza %j",
    (tipo) => {
      // `image/svg+xml` merece mencion: un SVG es un documento con script, y
      // servirlo desde el mismo origen que la aplicacion seria una via de XSS.
      expect(esTipoDeImagen(tipo)).toBe(false);
    },
  );

  it("el maximo por fotografia son 10 MB", () => {
    expect(MAXIMO_BYTES_FOTOGRAFIA).toBe(10 * 1024 * 1024);
  });
});

describe("claveDeFotografia", () => {
  it("la arma el servidor con los identificadores que genero", () => {
    expect(claveDeFotografia("V1", "F1", "image/jpeg")).toBe(
      "vehiculos/V1/F1.jpg",
    );
  });

  it.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ] as const)("deriva la extension de %s", (tipo, extension) => {
    // La extension sale del tipo declarado, no del nombre del archivo: un
    // `.jpg` en el nombre no dice nada del contenido, y un nombre con `../`
    // fabricaria una clave que no corresponde.
    expect(claveDeFotografia("V1", "F1", tipo)).toBe(
      `vehiculos/V1/F1.${extension}`,
    );
  });

  it("queda bajo el prefijo que sirve CloudFront", () => {
    expect(
      claveDeFotografia("V1", "F1", "image/png").startsWith("vehiculos/"),
    ).toBe(true);
  });
});

describe("nombreDeBucket", () => {
  it("devuelve el del entorno", () => {
    expect(nombreDeBucket()).toBe("bucket-de-prueba");
  });

  it("falla diciendo de donde sale si no esta", () => {
    vi.stubEnv("AUTOB_MEDIA_BUCKET", "");
    expect(() => nombreDeBucket()).toThrow(/ampx sandbox/);
  });
});

describe("escritura y borrado", () => {
  it("guarda con el tipo declarado y la clave del servidor", async () => {
    const falso = crearClienteFalso<S3Client>();
    await guardarObjeto(
      {
        clave: "vehiculos/V1/F1.jpg",
        cuerpo: new Uint8Array([1, 2, 3]),
        contentType: "image/jpeg",
      },
      { cliente: falso.cliente },
    );

    expect(falso.comandos[0]?.nombre).toBe("PutObjectCommand");
    expect(falso.comandos[0]?.input).toMatchObject({
      Bucket: "bucket-de-prueba",
      Key: "vehiculos/V1/F1.jpg",
      ContentType: "image/jpeg",
    });
  });

  it("borra por clave", async () => {
    const falso = crearClienteFalso<S3Client>();
    await borrarObjeto("vehiculos/V1/F1.jpg", { cliente: falso.cliente });

    expect(falso.comandos[0]?.nombre).toBe("DeleteObjectCommand");
    expect(falso.comandos[0]?.input).toMatchObject({
      Bucket: "bucket-de-prueba",
      Key: "vehiculos/V1/F1.jpg",
    });
  });

  it("no manda una URL prefirmada de subida", async () => {
    // El archivo pasa por la Server Action a proposito: con una prefirmada el
    // cliente elegiria la clave del objeto.
    const falso = crearClienteFalso<S3Client>();
    await guardarObjeto(
      {
        clave: "vehiculos/V1/F1.jpg",
        cuerpo: new Uint8Array([1]),
        contentType: "image/jpeg",
      },
      { cliente: falso.cliente },
    );
    expect(falso.comandos.map((c) => c.nombre)).toEqual(["PutObjectCommand"]);
  });
});

describe("cliente diferido", () => {
  it("no se construye al importar el modulo", () => {
    // `next build` evalua los modulos al recolectar rutas, y la compuerta tiene
    // que correr en una maquina sin credenciales de AWS.
    expect(() => obtenerClienteS3()).not.toThrow();
  });

  it("reutiliza la misma instancia", () => {
    expect(obtenerClienteS3()).toBe(obtenerClienteS3());
  });
});
