// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  MAXIMO_BYTES_COMPROBANTE,
  MAXIMO_BYTES_FOTOGRAFIA,
} from "@/lib/media/almacenamiento";
import config from "./next.config";

// `almacenamiento.ts` lleva `import "server-only"`, que fuera del build de Next
// resuelve a su rama de `throw`. Mismo modismo que el resto de las pruebas que
// tocan esa capa (`almacenamiento.test.ts`, `agregarFotografia.test.ts`).
vi.mock("server-only", () => ({}));

// Etapa 12 — "cabeceras de seguridad y CSP".
//
// Se prueban aqui y no en `src/proxy.test.ts` porque son dos mecanismos
// distintos con dos alcances distintos: la CSP la calcula el proxy por peticion
// (necesita un nonce nuevo cada vez) y estas son fijas, declaradas en la
// configuracion para que alcancen tambien a lo que el `matcher` del proxy deja
// fuera — `_next/static`, `favicon.ico`, `robots.txt` y `sitemap.xml`.
//
// Ninguna de estas cabeceras la aplica `next build` ni jsdom, asi que sin una
// prueba la unica forma de notar que se cayo una es un escaneo de seguridad
// despues del despliegue.

const cabeceras = async (): Promise<Map<string, string>> => {
  const grupos = await config.headers!();
  const paraTodo = grupos.find((grupo) => grupo.source === "/(.*)");
  expect(paraTodo, "falta el grupo que aplica a todas las rutas").toBeDefined();

  return new Map(
    paraTodo!.headers.map((cabecera) => [cabecera.key, cabecera.value]),
  );
};

describe("cabeceras de seguridad", () => {
  it("no revela el marco: sin X-Powered-By", () => {
    expect(config.poweredByHeader).toBe(false);
  });

  it("impide adivinar el tipo de contenido", async () => {
    // Sin `nosniff`, un comprobante subido con `Content-Type` de imagen pero
    // contenido HTML podria ejecutarse como documento.
    expect((await cabeceras()).get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("no filtra la URL de origen al navegar afuera", async () => {
    // Las rutas de esta aplicacion llevan identificadores de convocatoria, de
    // lote y de solicitud. `no-referrer` evita que viajen en la cabecera
    // `Referer` a cualquier destino externo.
    expect((await cabeceras()).get("Referrer-Policy")).toBe("no-referrer");
  });

  it("exige HTTPS por dos anios, con subdominios y con preload", async () => {
    const hsts = (await cabeceras()).get("Strict-Transport-Security") ?? "";
    expect(hsts).toContain("max-age=63072000");
    expect(hsts).toContain("includeSubDomains");
    expect(hsts).toContain("preload");
  });

  it("niega el enmarcado por las dos vias", async () => {
    // `frame-ancestors 'none'` de la CSP es la moderna; `X-Frame-Options` es la
    // que reconocen los escaneres corporativos y los navegadores sin CSP
    // nivel 2. Redundante a proposito.
    expect((await cabeceras()).get("X-Frame-Options")).toBe("DENY");
  });

  it("cierra las capacidades del navegador que ninguna pantalla usa", async () => {
    const politica = (await cabeceras()).get("Permissions-Policy") ?? "";
    for (const capacidad of [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
    ]) {
      expect(politica).toContain(capacidad);
    }
  });

  it("aisla la ventana de quien la abrio", async () => {
    // Sin esto, una pagina que abra la aplicacion conserva un `window.opener`
    // utilizable para husmear la navegacion.
    expect((await cabeceras()).get("Cross-Origin-Opener-Policy")).toBe(
      "same-origin",
    );
  });

  it("no deja que otro sitio cargue las respuestas de la aplicacion", async () => {
    // No afecta a las fotografias: las sirve CloudFront con sus propias
    // cabeceras, y quien autoriza al navegador a pedirlas es `img-src`.
    expect((await cabeceras()).get("Cross-Origin-Resource-Policy")).toBe(
      "same-origin",
    );
  });
});

// --- Tope del cuerpo de las Server Actions --------------------------------
//
// El defecto que estas pruebas existen para que no vuelva: el tope por omision
// de las Server Actions es 1 MB, la aplicacion prometia 10, y **ninguna prueba
// lo veia** porque todas llaman al servicio en proceso y ninguna cruza la
// frontera HTTP. El resultado era que cualquier fotografia de celular se
// rechazaba antes de entrar a la action.
//
// No se prueba subiendo un archivo de verdad —montar un cliente RSC en Vitest
// seria mas fragil que el defecto que atraparia—; se prueba la **relacion**
// entre el limite del framework y el limite del dominio, que es lo que se
// rompio y lo que puede volver a romperse solo.

const SOBRECOSTO_MULTIPART = 20 * 1024;

const topeDeServerActions = (): number => {
  const tope = config.experimental?.serverActions?.bodySizeLimit;
  expect(
    typeof tope,
    "bodySizeLimit debe estar declarado como numero de bytes",
  ).toBe("number");
  return tope as number;
};

describe("tope del cuerpo de las Server Actions", () => {
  it("esta declarado: sin el, el tope real es 1 MB", () => {
    // Es la asercion que faltaba. `undefined` aqui significa que la aplicacion
    // vuelve a prometer 10 MB y a entregar 1.
    expect(topeDeServerActions()).toBeGreaterThan(1024 * 1024);
  });

  it("alcanza para el mayor archivo que el dominio admite, con el sobrecosto multipart", () => {
    // El tope se aplica al cuerpo HTTP crudo, no al archivo: `multipart/form-data`
    // agrega fronteras y cabeceras de parte. Un tope igual al maximo del dominio
    // dejaria fuera un archivo de exactamente ese tamano.
    const mayor = Math.max(MAXIMO_BYTES_FOTOGRAFIA, MAXIMO_BYTES_COMPROBANTE);

    expect(
      topeDeServerActions(),
      "subir MAXIMO_BYTES_* sin subir bodySizeLimit deja al framework rechazando en silencio",
    ).toBeGreaterThanOrEqual(mayor + SOBRECOSTO_MULTIPART);
  });

  it("deja que el archivo demasiado grande lo rechace el dominio y no el framework", () => {
    // Con margen, un archivo que se pasa del limite del dominio **llega** y
    // recibe el mensaje de `agregarFotografia`/`subirComprobante`. Sin margen,
    // muere en el framework con un error que no dice cual es el limite.
    const mayor = Math.max(MAXIMO_BYTES_FOTOGRAFIA, MAXIMO_BYTES_COMPROBANTE);

    expect(topeDeServerActions()).toBeGreaterThan(mayor + SOBRECOSTO_MULTIPART);
  });
});
