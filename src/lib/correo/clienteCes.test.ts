// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enviarCorreo } from "./clienteCes";

vi.mock("server-only", () => ({}));

const mensaje = {
  destinatario: "p1@example.org",
  asunto: "Ganaste la adjudicacion",
  cuerpoHtml: "<p>hola</p>",
};

beforeEach(() => {
  vi.stubEnv("CES_URL", "https://ces.example.org/enviar");
  vi.stubEnv("CES_USER", "usuario");
  vi.stubEnv("CES_PASSWORD", "secreto");
  vi.stubEnv("CES_FROM_ADDRESS", "no-responder@example.org");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("configuracion", () => {
  it("lanza si falta una variable de CES — sin fallback silencioso (regla 15)", async () => {
    vi.stubEnv("CES_URL", undefined);
    await expect(enviarCorreo(mensaje)).rejects.toThrow(/CES_URL/);
  });
});

describe("enviarCorreo", () => {
  it("autentica con Basic y postea el JSON esperado", async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "MSG-1" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchFalso);

    const resultado = await enviarCorreo(mensaje);

    expect(resultado).toEqual({ ok: true, idExterno: "MSG-1" });
    const [url, opciones] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ces.example.org/enviar");
    expect(opciones.method).toBe("POST");
    const encabezados = opciones.headers as Record<string, string>;
    expect(encabezados.Authorization).toBe(
      `Basic ${Buffer.from("usuario:secreto").toString("base64")}`,
    );
    expect(JSON.parse(String(opciones.body))).toMatchObject({
      from: "no-responder@example.org",
      to: "p1@example.org",
      subject: "Ganaste la adjudicacion",
    });
  });

  it("un 401 no es reintentable — es un problema de credenciales", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("no autorizado", { status: 401 })),
    );

    const resultado = await enviarCorreo(mensaje);

    expect(resultado).toMatchObject({ ok: false, reintentable: false });
  });

  it("un 500 es reintentable — indisponibilidad transitoria (runbooks R-2)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("caido", { status: 500 })),
    );

    const resultado = await enviarCorreo(mensaje);

    expect(resultado).toMatchObject({ ok: false, reintentable: true });
  });

  it("un error de red se trata como reintentable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const resultado = await enviarCorreo(mensaje);

    expect(resultado).toEqual({
      ok: false,
      error: "ECONNRESET",
      reintentable: true,
    });
  });
});
