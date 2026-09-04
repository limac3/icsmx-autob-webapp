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
