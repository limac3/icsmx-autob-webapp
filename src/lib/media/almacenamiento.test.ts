// @vitest-environment node
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  borrarObjeto,
  CACHE_DE_FOTOGRAFIA,
  claveDeFotografia,
  guardarObjeto,
  MAXIMO_BYTES_FOTOGRAFIA,
  nombreDeBucket,
  obtenerClienteS3,
  __test__,
} from "./almacenamiento";
import { NOMBRES_DE_VARIANTE } from "@/types/vehiculo";
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

describe("tope por fotografia", () => {
  it("son 10 MB, derivados del dominio", () => {
    // La lista blanca de tipos ya no vive aqui: se movio a
    // `src/lib/domain/vehiculos.ts` para que la pantalla pueda aplicarla antes
    // de subir. Sus pruebas se fueron con ella.
    expect(MAXIMO_BYTES_FOTOGRAFIA).toBe(10 * 1024 * 1024);
  });
});

describe("claveDeFotografia", () => {
  it("la arma el servidor con los identificadores que genero", () => {
    expect(claveDeFotografia("V1", "F1", "max")).toBe(
      "vehiculos/V1/F1-max.webp",
    );
  });

  it.each(NOMBRES_DE_VARIANTE)("distingue la variante %s", (variante) => {
    // Una fotografia son tres objetos, y el borrado tiene que alcanzar los
    // tres: las claves se deducen del nombre de la variante.
    expect(claveDeFotografia("V1", "F1", variante)).toBe(
      `vehiculos/V1/F1-${variante}.webp`,
    );
  });

  it("la extension no la decide el cliente: la salida siempre es WebP", () => {
    // Antes salia del tipo declarado por el navegador. Ahora ni eso: el
    // servidor recodifica, asi que la extension refleja lo que de verdad hay en
    // el objeto. Un `.jpg` en el nombre del archivo nunca dijo nada del
    // contenido, y un nombre con `../` fabricaria una clave que no corresponde.
    for (const variante of NOMBRES_DE_VARIANTE) {
      expect(claveDeFotografia("V1", "F1", variante).endsWith(".webp")).toBe(
        true,
      );
    }
  });

  it("las tres claves de una fotografia son distintas", () => {
    // Si coincidieran, una variante sobrescribiria a otra y el objeto
    // inmutable dejaria de serlo.
    const claves = NOMBRES_DE_VARIANTE.map((v) =>
      claveDeFotografia("V1", "F1", v),
    );
    expect(new Set(claves).size).toBe(NOMBRES_DE_VARIANTE.length);
  });

  it("queda bajo el prefijo que sirve CloudFront", () => {
    expect(claveDeFotografia("V1", "F1", "min").startsWith("vehiculos/")).toBe(
      true,
    );
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

  it("una fotografia se guarda como inmutable, para que el navegador la reuse", async () => {
    const falso = crearClienteFalso<S3Client>();
    await guardarObjeto(
      {
        clave: "vehiculos/V1/F1.webp",
        cuerpo: new Uint8Array([1]),
        contentType: "image/webp",
        cacheControl: CACHE_DE_FOTOGRAFIA,
      },
      { cliente: falso.cliente },
    );

    expect(falso.comandos[0]?.input).toMatchObject({
      CacheControl: "public, max-age=31536000, immutable",
    });
  });

  it("un comprobante no hereda la cache publica de las fotografias", async () => {
    // Comparten `guardarObjeto`, y es la razon por la que el encabezado es un
    // parametro: un comprobante de pago no puede salir con `public`.
    const falso = crearClienteFalso<S3Client>();
    await guardarObjeto(
      {
        clave: "comprobantes/S1/C1.pdf",
        cuerpo: new Uint8Array([1]),
        contentType: "application/pdf",
      },
      { cliente: falso.cliente },
    );

    expect(falso.comandos[0]?.input).toMatchObject({
      CacheControl: undefined,
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
