// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  configuracionDeFirma,
  firmarFotografia,
  normalizarLlave,
  rutaPublica,
  VIGENCIA_DE_FIRMA_MS,
} from "./cloudfrontSigner";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-09-05T18:00:00.000Z");

let llavePrivada: string;

beforeAll(() => {
  // Una llave de verdad, generada aqui: firmar con una cadena de mentira no
  // probaria que el PEM que se arma a partir del entorno es utilizable, que es
  // justamente donde se rompe esto en produccion.
  llavePrivada = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const configuracion = () => ({
  dominio: "d1derewdnk9ye1.cloudfront.net",
  keyPairId: "K2JCJMDEHXQW5F",
  llavePrivada,
});

describe("firma", () => {
  it("produce una URL del dominio de la distribucion", () => {
    const url = new URL(
      firmarFotografia("vehiculos/V1/F1.jpg", {
        ahora: () => AHORA,
        configuracion: configuracion(),
      }),
    );

    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("d1derewdnk9ye1.cloudfront.net");
  });

  it("quita el prefijo que ya aporta originPath", () => {
    // La distribucion apunta al origen con `originPath: /vehiculos`, asi que
    // dejar el prefijo en la ruta pediria `vehiculos/vehiculos/...`.
    const url = new URL(
      firmarFotografia("vehiculos/V1/F1.jpg", {
        ahora: () => AHORA,
        configuracion: configuracion(),
      }),
    );
    expect(url.pathname).toBe("/V1/F1.jpg");
  });

  it("lleva los tres parametros que CloudFront exige", () => {
    const url = new URL(
      firmarFotografia("vehiculos/V1/F1.jpg", {
        ahora: () => AHORA,
        configuracion: configuracion(),
      }),
    );

    expect(url.searchParams.get("Key-Pair-Id")).toBe("K2JCJMDEHXQW5F");
    expect(url.searchParams.get("Signature")).toBeTruthy();
    expect(url.searchParams.get("Expires")).toBeTruthy();
  });

  it("caduca a los diez minutos del instante dado", () => {
    // Corta porque una URL firmada es una credencial portatil: quien la copia
    // entra sin sesion.
    const url = new URL(
      firmarFotografia("vehiculos/V1/F1.jpg", {
        ahora: () => AHORA,
        configuracion: configuracion(),
      }),
    );

    const expira = Number(url.searchParams.get("Expires")) * 1000;
    expect(expira).toBe(AHORA.getTime() + VIGENCIA_DE_FIRMA_MS);
    expect(VIGENCIA_DE_FIRMA_MS).toBe(600_000);
  });

  it("dos peticiones en instantes distintos producen firmas distintas", () => {
    // Es lo que hace inutil persistir una URL firmada: la de ayer ya no sirve.
    const primera = firmarFotografia("vehiculos/V1/F1.jpg", {
      ahora: () => AHORA,
      configuracion: configuracion(),
    });
    const segunda = firmarFotografia("vehiculos/V1/F1.jpg", {
      ahora: () => new Date(AHORA.getTime() + 60_000),
      configuracion: configuracion(),
    });
    expect(primera).not.toBe(segunda);
  });
});

describe("rutaPublica", () => {
  it("acepta una clave de fotografia", () => {
    expect(rutaPublica("vehiculos/V1/F1.jpg")).toBe("V1/F1.jpg");
  });

  it("rechaza una clave de comprobante", () => {
    // Los comprobantes de pago **jamas** se sirven por CloudFront: van por el
    // Route Handler de descarga, que verifica permiso y audita el acceso. Esta
    // es la ultima defensa de esa separacion.
    expect(() => rutaPublica("comprobantes/S1/C1.pdf")).toThrow(
      /Solo se firman claves/,
    );
  });

  it.each(["", "V1/F1.jpg", "/vehiculos/V1/F1.jpg", "otros/vehiculos/F1.jpg"])(
    "rechaza la clave %j",
    (claveS3) => {
      expect(() => rutaPublica(claveS3)).toThrow();
    },
  );
});

describe("normalizarLlave", () => {
  it("deshace los saltos escapados de una variable de entorno", () => {
    const escapada = llavePrivada.replaceAll("\n", "\\n");
    expect(normalizarLlave(escapada)).toBe(llavePrivada);
  });

  it("acepta una llave con saltos reales, como la entrega un gestor de secretos", () => {
    expect(normalizarLlave(llavePrivada)).toBe(llavePrivada);
  });

  it("rechaza algo que no es un PEM", () => {
    // Sin esta comprobacion, el error aparece dentro del firmador como un fallo
    // de criptografia que no dice que la variable esta mal puesta.
    expect(() => normalizarLlave("no-es-una-llave")).toThrow(/PEM/);
  });
});

describe("configuracionDeFirma", () => {
  it("nombra todas las variables que faltan", () => {
    // Fallar fuerte y visible (regla 15): una firma sin configuracion no debe
    // degradarse a una URL sin firmar.
    expect(() => configuracionDeFirma()).toThrow(
      /CLOUDFRONT_DOMAIN, CLOUDFRONT_KEY_PAIR_ID, CLOUDFRONT_PRIVATE_KEY/,
    );
  });

  it("nombra solo la que falta", () => {
    vi.stubEnv("CLOUDFRONT_DOMAIN", "d1.cloudfront.net");
    vi.stubEnv("CLOUDFRONT_KEY_PAIR_ID", "K1");
    expect(() => configuracionDeFirma()).toThrow(
      /Falta CLOUDFRONT_PRIVATE_KEY/,
    );
  });

  it("dice de donde salen los valores", () => {
    expect(() => configuracionDeFirma()).toThrow(/amplify_outputs\.json/);
  });

  it("arma la configuracion cuando estan las tres", () => {
    vi.stubEnv("CLOUDFRONT_DOMAIN", "d1.cloudfront.net");
    vi.stubEnv("CLOUDFRONT_KEY_PAIR_ID", "K1");
    vi.stubEnv("CLOUDFRONT_PRIVATE_KEY", llavePrivada.replaceAll("\n", "\\n"));

    expect(configuracionDeFirma()).toEqual({
      dominio: "d1.cloudfront.net",
      keyPairId: "K1",
      llavePrivada,
    });
  });
});
