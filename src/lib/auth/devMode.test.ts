// @vitest-environment node
vi.mock("server-only", () => ({}));

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exigirModoSeguro,
  obtenerEntornoApp,
  obtenerModoDevTools,
} from "./devMode";

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

  it("lanza en un despliegue si el modo no es OFF y no hay APP_ENV", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => exigirModoSeguro("MOCK_USERS")).toThrow(/APP_ENV/);
    expect(() => exigirModoSeguro("FULL")).toThrow(/APP_ENV/);
  });

  it("no lanza fuera de produccion aunque el modo no sea OFF", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(() => exigirModoSeguro("FULL")).not.toThrow();
  });
});

describe("obtenerEntornoApp", () => {
  it("sin variable, es produccion — el valor cerrado", () => {
    vi.stubEnv("APP_ENV", "");
    expect(obtenerEntornoApp()).toBe("produccion");
  });

  it("acepta produccion y pruebas", () => {
    vi.stubEnv("APP_ENV", "pruebas");
    expect(obtenerEntornoApp()).toBe("pruebas");
    vi.stubEnv("APP_ENV", "produccion");
    expect(obtenerEntornoApp()).toBe("produccion");
  });

  it("un valor invalido se asume produccion y avisa, en vez de lanzar", () => {
    // `production` en ingles es el error probable, y cae del lado seguro. El
    // aviso es lo que lo hace descubrible en el registro del despliegue.
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("APP_ENV", "production");

    expect(obtenerEntornoApp()).toBe("produccion");
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining("APP_ENV"));
    aviso.mockRestore();
  });
});

describe("un ambiente de pruebas desplegado", () => {
  // `NODE_ENV=production` no distingue produccion de un ambiente de pruebas:
  // Amplify Hosting compila y sirve **toda** rama en modo produccion. Lo que
  // distingue es `APP_ENV`, declarada por despliegue.
  const desplegado = () => {
    vi.stubEnv("NODE_ENV", "production");
  };

  it("con APP_ENV=pruebas admite los dos modos simulados", () => {
    desplegado();
    vi.stubEnv("APP_ENV", "pruebas");

    expect(() => exigirModoSeguro("FULL")).not.toThrow();
    expect(() => exigirModoSeguro("MOCK_USERS")).not.toThrow();
  });

  it("con APP_ENV=produccion lanza", () => {
    desplegado();
    vi.stubEnv("APP_ENV", "produccion");

    expect(() => exigirModoSeguro("FULL")).toThrow(/APP_ENV/);
  });

  it("sin APP_ENV falla cerrada: la omision no concede nada", () => {
    // La propiedad que importa (regla 18). Olvidar la variable en produccion
    // deja las herramientas bloqueadas, no abiertas.
    desplegado();
    vi.stubEnv("APP_ENV", "");

    expect(() => exigirModoSeguro("FULL")).toThrow(/APP_ENV/);
  });

  it("con un APP_ENV desconocido falla cerrada", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    desplegado();
    vi.stubEnv("APP_ENV", "staging");

    expect(() => exigirModoSeguro("FULL")).toThrow(/APP_ENV/);
    aviso.mockRestore();
  });

  it("APP_ENV=pruebas no enciende nada por si sola", () => {
    // Declarar el entorno solo deja de bloquear lo que `ENABLE_DEV_TOOLS` ya
    // pidio; no es un interruptor de las herramientas.
    desplegado();
    vi.stubEnv("APP_ENV", "pruebas");
    vi.stubEnv("ENABLE_DEV_TOOLS", "");

    expect(obtenerModoDevTools()).toBe("OFF");
  });
});
