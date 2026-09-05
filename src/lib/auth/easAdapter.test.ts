// @vitest-environment node
vi.mock("server-only", () => ({}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISOS } from "@/types/identidad";
import { consultarPermisosEas, ErrorConsultaEas } from "./easAdapter";

// Faltaba por completo: el adaptador de EAS no tenia ninguna prueba, aunque es
// el unico punto donde una respuesta inesperada del proveedor de identidad se
// convierte en una decision de autorizacion.

const respuestaCompleta = (concedidos: readonly string[] = []) =>
  Object.fromEntries(PERMISOS.map((p) => [p, concedidos.includes(p)]));

const responder = (cuerpo: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    json: async () => cuerpo,
  }) as Response;

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("EAS_PROFILE_URL", "https://eas.example.test/permisos");
  vi.stubEnv("EAS_API_KEY", "llave-de-prueba");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("consultarPermisosEas", () => {
  it("devuelve solo los permisos concedidos", async () => {
    fetchMock.mockResolvedValue(
      responder(respuestaCompleta(["Autob_Auditar", "Autob_Venta_en_general"])),
    );

    const permisos = await consultarPermisosEas("okta|1");

    expect([...permisos].sort()).toEqual([
      "Autob_Auditar",
      "Autob_Venta_en_general",
    ]);
  });

  it("pregunta por el catalogo completo en una sola llamada", async () => {
    fetchMock.mockResolvedValue(responder(respuestaCompleta()));

    await consultarPermisosEas("okta|1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opciones] = fetchMock.mock.calls[0];
    expect(JSON.parse(opciones.body)).toEqual({
      oktaSub: "okta|1",
      permisos: [...PERMISOS],
    });
    expect(opciones.headers.Authorization).toBe("Bearer llave-de-prueba");
  });

  it("un permiso solicitado que no viene en la respuesta es error, no un false", async () => {
    // La distincion importa: tratarlo como `false` haria que un cambio de
    // contrato de EAS se viera igual que una cuenta sin privilegios, y nadie
    // podria depurarlo desde los sintomas.
    const parcial = respuestaCompleta(["Autob_Auditar"]);
    delete parcial.Autob_Operar_Tesoreria;
    fetchMock.mockResolvedValue(responder(parcial));

    await expect(consultarPermisosEas("okta|1")).rejects.toMatchObject({
      name: "ErrorConsultaEas",
      causa: "respuesta_invalida",
    });
    await expect(consultarPermisosEas("okta|1")).rejects.toThrow(
      /Autob_Operar_Tesoreria/,
    );
  });

  it("un permiso con valor no booleano tambien es violacion de contrato", async () => {
    const raro = { ...respuestaCompleta(), Autob_Auditar: "si" };
    fetchMock.mockResolvedValue(responder(raro));

    await expect(consultarPermisosEas("okta|1")).rejects.toMatchObject({
      causa: "respuesta_invalida",
    });
  });

  it("falta de configuracion lanza sin llamar a la red", async () => {
    vi.stubEnv("EAS_API_KEY", "");

    await expect(consultarPermisosEas("okta|1")).rejects.toMatchObject({
      causa: "configuracion",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un timeout se distingue de un fallo de red", async () => {
    const abort = new Error("abortado");
    abort.name = "AbortError";
    fetchMock.mockRejectedValue(abort);

    await expect(consultarPermisosEas("okta|1")).rejects.toMatchObject({
      causa: "timeout",
    });
  });

  it("un fallo de red se reporta como red", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(consultarPermisosEas("okta|1")).rejects.toMatchObject({
      causa: "red",
    });
  });

  it("un estatus no-2xx es respuesta invalida y lleva el codigo", async () => {
    fetchMock.mockResolvedValue(responder(null, false, 503));

    await expect(consultarPermisosEas("okta|1")).rejects.toThrow(/503/);
  });

  it("un cuerpo que no es JSON es respuesta invalida", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    } as unknown as Response);

    await expect(consultarPermisosEas("okta|1")).rejects.toMatchObject({
      causa: "respuesta_invalida",
    });
  });

  it("un arreglo en lugar de un mapa de permisos es respuesta invalida", async () => {
    // Es la forma que tenia el contrato anterior, cuando EAS devolvia roles.
    fetchMock.mockResolvedValue(responder(["ADMINISTRADOR"]));

    await expect(consultarPermisosEas("okta|1")).rejects.toMatchObject({
      causa: "respuesta_invalida",
    });
  });

  it("nunca devuelve un conjunto vacio como sustituto de un error (regla 15)", async () => {
    fetchMock.mockRejectedValue(new Error("caido"));

    const resultado = await consultarPermisosEas("okta|1").catch((e) => e);
    expect(resultado).toBeInstanceOf(ErrorConsultaEas);
  });

  it("una respuesta valida con todo en false devuelve un conjunto vacio, sin lanzar", async () => {
    fetchMock.mockResolvedValue(responder(respuestaCompleta()));

    // El caso legitimo de "usuario sin permisos": distinto de EAS caido.
    await expect(consultarPermisosEas("okta|1")).resolves.toEqual(new Set());
  });
});
