// @vitest-environment node
vi.mock("server-only", () => ({}));

import { afterEach, describe, expect, it, vi } from "vitest";
import { exigirModoSeguro, obtenerModoDevTools } from "./devMode";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("obtenerModoDevTools", () => {
  it("sin variable de entorno, es OFF", () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "");
    expect(obtenerModoDevTools()).toBe("OFF");
  });

  it("acepta MOCK_USERS y FULL", () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "MOCK_USERS");
    expect(obtenerModoDevTools()).toBe("MOCK_USERS");
    vi.stubEnv("ENABLE_DEV_TOOLS", "FULL");
    expect(obtenerModoDevTools()).toBe("FULL");
  });

  it("un valor invalido cae a OFF en vez de lanzar", () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "ALGO_RARO");
    expect(obtenerModoDevTools()).toBe("OFF");
  });
});

describe("exigirModoSeguro — salvaguarda de la regla 15", () => {
  it("no lanza en produccion si el modo es OFF", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => exigirModoSeguro("OFF")).not.toThrow();
  });

  it("lanza en produccion si el modo no es OFF", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => exigirModoSeguro("MOCK_USERS")).toThrow(/no esta permitido/);
    expect(() => exigirModoSeguro("FULL")).toThrow(/no esta permitido/);
  });

  it("no lanza fuera de produccion aunque el modo no sea OFF", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(() => exigirModoSeguro("FULL")).not.toThrow();
  });
});
