// @vitest-environment node
vi.mock("@/lib/auth/auth0", () => ({ auth: { middleware: vi.fn() } }));

import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth/auth0";
import { proxy } from "./proxy";

const authMiddleware = vi.mocked(auth.middleware);

const crearRequest = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${path}`, { headers });

beforeEach(() => {
  authMiddleware.mockReset();
  authMiddleware.mockImplementation(async () => NextResponse.next());
});

describe("proxy", () => {
  it("agrega un Content-Security-Policy con nonce en script-src", async () => {
    const respuesta = await proxy(crearRequest("/sesion"));
    const csp = respuesta.headers.get("Content-Security-Policy");
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  });

  it("autoriza el Font Foundry en style-src y en font-src", async () => {
    // `<Fonts>` de eden-fonts carga una hoja de estilo remota desde este
    // origen y desde ahi los woff2. Con la CSP anterior ('self' en ambas
    // directivas) el navegador bloqueaba las dos cosas y la aplicacion se
    // dibujaba con tipografia de respaldo. No lo detecta ni el build ni
    // jsdom: ninguno aplica CSP, por eso la regresion se vigila aqui.
    const csp =
      (await proxy(crearRequest("/sesion"))).headers.get(
        "Content-Security-Policy",
      ) ?? "";
    const foundry = "https://foundry.churchofjesuschrist.org";

    const directiva = (nombre: string) =>
      csp
        .split(";")
        .map((parte) => parte.trim())
        .find((parte) => parte.startsWith(`${nombre} `)) ?? "";

    expect(directiva("style-src")).toContain(foundry);
    expect(directiva("font-src")).toContain(foundry);
  });

  it("style-src conserva unsafe-inline, porque Eden no deja alternativa", async () => {
    // Etapa 12. No es un pendiente: es un limite comprobado en los paquetes
    // instalados, y esta prueba existe para que nadie lo "endurezca" creyendo
    // que era un descuido.
    //
    //   1. Eden no publica ningun .css. Cada componente monta su hoja con
    //      `<style href precedence>` (izado de React 19), que es un elemento
    //      `<style>` en linea sin nonce que podamos inyectar.
    //   2. Y hay atributos `style={{...}}` en TD, TH, TR de eden-table, en
    //      Hint, Select y FieldSet de eden-form-parts, y en Item de eden-grid.
    //
    // Quitarlo rompe la aplicacion visualmente sin que `next build` ni jsdom
    // lo detecten: ninguno de los dos aplica CSP.
    const csp =
      (await proxy(crearRequest("/sesion"))).headers.get(
        "Content-Security-Policy",
      ) ?? "";

    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    // Y script-src, que es la superficie que de verdad importa, sigue sin el.
    const scriptSrc = csp
      .split(";")
      .map((parte) => parte.trim())
      .find((parte) => parte.startsWith("script-src "));
    expect(scriptSrc).not.toContain("unsafe-inline");
  });

  it("cierra las directivas que no tienen uso legitimo en esta aplicacion", async () => {
    // Ninguna pantalla carga complementos, ni reescribe `<base>`, ni se deja
    // enmarcar. Explicitarlas evita depender de que `default-src` cubra cada
    // caso en cada version de navegador.
    const csp =
      (await proxy(crearRequest("/sesion"))).headers.get(
        "Content-Security-Policy",
      ) ?? "";

    for (const directiva of [
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ]) {
      expect(csp).toContain(directiva);
    }
  });

  it("genera un nonce distinto en cada peticion", async () => {
    const extraerNonce = (respuesta: NextResponse) =>
      respuesta.headers
        .get("Content-Security-Policy")
        ?.match(/nonce-([^']+)'/)?.[1];

    const nonce1 = extraerNonce(await proxy(crearRequest("/sesion")));
    const nonce2 = extraerNonce(await proxy(crearRequest("/sesion")));
    expect(nonce1).toBeTruthy();
    expect(nonce1).not.toBe(nonce2);
  });

  it("fija Cache-Control: no-store en rutas normales (ninguna ruta es publica)", async () => {
    const respuesta = await proxy(crearRequest("/sesion"));
    expect(respuesta.headers.get("Cache-Control")).toContain("no-store");
  });

  it("resuelve x-lang a es por defecto", async () => {
    const respuesta = await proxy(crearRequest("/"));
    expect(respuesta.headers.get("x-lang")).toBe("es");
  });

  it("resuelve x-lang a en cuando Accept-Language empieza con en", async () => {
    const respuesta = await proxy(
      crearRequest("/", { "accept-language": "en-US,en;q=0.9" }),
    );
    expect(respuesta.headers.get("x-lang")).toBe("en");
  });

  it("no envuelve las rutas /auth/*: la respuesta del SDK viaja tal cual", async () => {
    authMiddleware.mockResolvedValue(
      NextResponse.redirect("http://localhost:3000/auth/callback-destino"),
    );
    const respuesta = await proxy(crearRequest("/auth/login"));
    expect(respuesta.headers.get("Content-Security-Policy")).toBeNull();
    expect(respuesta.status).toBeGreaterThanOrEqual(300);
    expect(respuesta.status).toBeLessThan(400);
  });

  it("no envuelve una redireccion del SDK aunque la ruta no sea /auth/*", async () => {
    authMiddleware.mockResolvedValue(
      NextResponse.redirect("http://localhost:3000/auth/login"),
    );
    const respuesta = await proxy(crearRequest("/sesion"));
    expect(respuesta.headers.get("Content-Security-Policy")).toBeNull();
    expect(respuesta.status).toBeGreaterThanOrEqual(300);
    expect(respuesta.status).toBeLessThan(400);
  });

  it("preserva las cookies que establece el SDK de autenticacion", async () => {
    const conCookie = NextResponse.next();
    conCookie.cookies.set("appSession", "valor-cifrado");
    authMiddleware.mockResolvedValue(conCookie);

    const respuesta = await proxy(crearRequest("/sesion"));
    expect(respuesta.cookies.get("appSession")?.value).toBe("valor-cifrado");
  });
});
