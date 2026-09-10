// @vitest-environment node
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  configuracionDeFirma,
  desfasesConElSandbox,
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

  it("sobrevive un PEM generado en Windows, con CRLF", () => {
    // `openssl` en Windows escribe CRLF. Al escapar solo los saltos de linea
    // quedan los retornos de carro **dentro** de la llave, y el decodificador
    // la rechaza con ERR_OSSL_UNSUPPORTED — un error que no menciona ni la
    // variable ni el salto de linea. Paso de verdad al armar un .env.local.
    const conCrlf = llavePrivada.replaceAll("\n", "\r\n");
    const escapada = conCrlf.replaceAll("\n", "\\n");

    const normalizada = normalizarLlave(escapada);

    expect(normalizada).not.toContain("\r");
    expect(() => createPrivateKey(normalizada)).not.toThrow();
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

// El desfase entre `.env.local` y el sandbox desplegado. Es la unica falla de
// configuracion de este modulo que **no produce ningun error**: la URL se firma
// bien, contra un host que ya no existe, y la pantalla queda sin fotografias
// con la consola limpia. Paso de verdad al recrear el sandbox en la Etapa 11.2.
describe("desfasesConElSandbox", () => {
  const entorno = { dominio: "d1.cloudfront.net", keyPairId: "K1" };

  it("no reporta nada cuando el entorno coincide", () => {
    expect(
      desfasesConElSandbox(entorno, {
        distribucion: "d1.cloudfront.net",
        llavePublicaCloudFront: "K1",
      }),
    ).toEqual([]);
  });

  it("no reporta nada sin salidas: quien no tiene sandbox no ve un error", () => {
    expect(desfasesConElSandbox(entorno, undefined)).toEqual([]);
  });

  it("nombra la variable, el valor local y el desplegado", () => {
    // Los tres datos importan: sin el valor desplegado, el mensaje obliga a ir
    // a buscarlo, que es justo el paso que nadie da cuando cree que el defecto
    // esta en el codigo.
    const [mensaje, ...resto] = desfasesConElSandbox(entorno, {
      distribucion: "d2.cloudfront.net",
      llavePublicaCloudFront: "K1",
    });

    expect(resto).toEqual([]);
    expect(mensaje).toContain("CLOUDFRONT_DOMAIN");
    expect(mensaje).toContain("d1.cloudfront.net");
    expect(mensaje).toContain("d2.cloudfront.net");
  });

  it("reporta los dos desfases a la vez", () => {
    expect(
      desfasesConElSandbox(entorno, {
        distribucion: "d2.cloudfront.net",
        llavePublicaCloudFront: "K2",
      }),
    ).toHaveLength(2);
  });

  it("ignora un valor que el sandbox no publica", () => {
    // Una salida incompleta es un despliegue a medias, no una contradiccion:
    // tratarla como desfase apagaria la aplicacion por un dato ausente.
    expect(desfasesConElSandbox(entorno, { distribucion: undefined })).toEqual(
      [],
    );
  });
});
