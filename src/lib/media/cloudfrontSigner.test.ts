// @vitest-environment node
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  configuracionDeFirma,
  CUBETA_DE_FIRMA_MS,
  desfasesConElSandbox,
  firmarFotografia,
  GRACIA_DE_FIRMA_MS,
  normalizarLlave,
  rutaPublica,
  vencimientoDeFirma,
} from "./cloudfrontSigner";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-09-05T18:00:00.000Z");

// `AHORA` cae justo en el inicio de una cubeta de una hora, que es el borde. Lo
// que hay que ejercitar casi siempre es el interior, asi que se desplaza a
// proposito.
const DENTRO_DE_LA_CUBETA = new Date(AHORA.getTime() + 7 * 60 * 1000);

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

  it("caduca al final de la cubeta en curso, mas la gracia", () => {
    const url = new URL(
      firmarFotografia("vehiculos/V1/F1.jpg", {
        ahora: () => DENTRO_DE_LA_CUBETA,
        configuracion: configuracion(),
      }),
    );

    const expira = Number(url.searchParams.get("Expires")) * 1000;
    expect(expira).toBe(
      AHORA.getTime() + CUBETA_DE_FIRMA_MS + GRACIA_DE_FIRMA_MS,
    );
  });

  it("dos renders de la misma cubeta producen la misma URL, byte a byte", () => {
    // **Esta es la invariante que hace que el cache del navegador acierte**, y
    // la razon de ser de la cubeta: con un `Expires` calculado desde el instante
    // exacto, cada render cambiaba la URL y volver al catalogo volvia a
    // descargar todas las fotografias.
    const primera = firmarFotografia("vehiculos/V1/F1.jpg", {
      ahora: () => DENTRO_DE_LA_CUBETA,
      configuracion: configuracion(),
    });
    const segunda = firmarFotografia("vehiculos/V1/F1.jpg", {
      ahora: () => new Date(DENTRO_DE_LA_CUBETA.getTime() + 60_000),
      configuracion: configuracion(),
    });
    expect(primera).toBe(segunda);
  });

  it("dos peticiones en cubetas distintas producen firmas distintas", () => {
    // Es lo que hace inutil persistir una URL firmada: la de ayer ya no sirve.
    const primera = firmarFotografia("vehiculos/V1/F1.jpg", {
      ahora: () => AHORA,
      configuracion: configuracion(),
    });
    const segunda = firmarFotografia("vehiculos/V1/F1.jpg", {
      ahora: () => new Date(AHORA.getTime() + CUBETA_DE_FIRMA_MS),
      configuracion: configuracion(),
    });
    expect(primera).not.toBe(segunda);
  });
});

describe("vencimientoDeFirma", () => {
  it("toda peticion de la cubeta conserva al menos la gracia", () => {
    // Lo que fija la vigencia **minima**. Sin la gracia, quien pide en el ultimo
    // segundo de la cubeta recibe una URL que vence en un segundo, que es
    // exactamente el 403 que esta cubeta existe para evitar.
    for (let minuto = 0; minuto < 60; minuto += 1) {
      const instante = new Date(AHORA.getTime() + minuto * 60 * 1000);
      const restante =
        vencimientoDeFirma(instante).getTime() - instante.getTime();

      expect(restante).toBeGreaterThanOrEqual(GRACIA_DE_FIRMA_MS);
    }
  });

  it("la validez nunca pasa de cubeta mas gracia", () => {
    for (let minuto = 0; minuto < 60; minuto += 1) {
      const instante = new Date(AHORA.getTime() + minuto * 60 * 1000);
      const restante =
        vencimientoDeFirma(instante).getTime() - instante.getTime();

      expect(restante).toBeLessThanOrEqual(
        CUBETA_DE_FIRMA_MS + GRACIA_DE_FIRMA_MS,
      );
    }
  });

  it("el instante exacto de inicio de cubeta ya cuenta como dentro", () => {
    // Y el milisegundo anterior pertenece a la cubeta previa: son vencimientos
    // distintos separados por 1 ms de reloj.
    const antes = new Date(AHORA.getTime() - 1);

    expect(vencimientoDeFirma(AHORA).getTime()).toBe(
      AHORA.getTime() + CUBETA_DE_FIRMA_MS + GRACIA_DE_FIRMA_MS,
    );
    expect(vencimientoDeFirma(antes).getTime()).toBe(
      AHORA.getTime() + GRACIA_DE_FIRMA_MS,
    );
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
