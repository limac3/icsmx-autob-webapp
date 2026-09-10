// @vitest-environment node
vi.mock("server-only", () => ({}));
vi.mock("./easAdapter", () => ({ consultarPermisosEas: vi.fn() }));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consultarPermisosEas } from "./easAdapter";
import { obtenerPermisos } from "./eas";
import { PERMISOS_POR_ROL } from "./rolesSimulados";

const consultarMock = vi.mocked(consultarPermisosEas);

beforeEach(() => {
  consultarMock.mockReset();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("obtenerPermisos — conmutacion de adaptador", () => {
  it("con ENABLE_DEV_TOOLS ausente usa EAS real", async () => {
    consultarMock.mockResolvedValue(new Set(["Autob_Auditar"]));

    expect(await obtenerPermisos("okta|1")).toEqual(new Set(["Autob_Auditar"]));
    expect(consultarMock).toHaveBeenCalledWith("okta|1");
  });

  it("con OFF explicito usa EAS real", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "OFF");
    consultarMock.mockResolvedValue(new Set());

    await obtenerPermisos("okta|1");
    expect(consultarMock).toHaveBeenCalled();
  });

  it("con un valor invalido cae a OFF y usa EAS real", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "SI_PORFA");
    consultarMock.mockResolvedValue(new Set());

    await obtenerPermisos("okta|1");
    expect(consultarMock).toHaveBeenCalled();
  });

  it("con MOCK_USERS no toca EAS", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "MOCK_USERS");

    await obtenerPermisos("okta|1");
    expect(consultarMock).not.toHaveBeenCalled();
  });

  it("MOCK_USERS en un despliegue sin habilitar lanza — salvaguarda de la regla 15", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "MOCK_USERS");
    vi.stubEnv("NODE_ENV", "production");

    await expect(obtenerPermisos("okta|1")).rejects.toThrow(/APP_ENV/);
    expect(consultarMock).not.toHaveBeenCalled();
  });

  it("en un ambiente de pruebas habilitado devuelve permisos simulados y no toca EAS", async () => {
    // Es la consecuencia que hay que tener presente al habilitarlo: con
    // cualquier modo distinto de OFF, **EAS no se consulta**. Quien se autentica
    // recibe los permisos simulados, no los suyos.
    vi.stubEnv("ENABLE_DEV_TOOLS", "MOCK_USERS");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "pruebas");

    expect((await obtenerPermisos("okta|1")).size).toBeGreaterThan(0);
    expect(consultarMock).not.toHaveBeenCalled();
  });
});

describe("obtenerPermisos — simulacion de desarrollo", () => {
  beforeEach(() => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "MOCK_USERS");
  });

  it("traduce el rol simulado a sus permisos", async () => {
    vi.stubEnv("DEV_TOOLS_MOCK_ROLES", "AUDITOR_CUMPLIMIENTO");

    expect(await obtenerPermisos("okta|1")).toEqual(new Set(["Autob_Auditar"]));
  });

  it("un EMPLEADO simulado recibe los dos permisos de venta", async () => {
    vi.stubEnv("DEV_TOOLS_MOCK_ROLES", "EMPLEADO");

    // Es la relacion de superconjunto que antes era un caso especial del
    // codigo y ahora es solo configuracion.
    expect(await obtenerPermisos("okta|1")).toEqual(
      new Set(["Autob_Venta_a_empleados", "Autob_Venta_en_general"]),
    );
  });

  it("varios roles simulados acumulan sus permisos", async () => {
    vi.stubEnv(
      "DEV_TOOLS_MOCK_ROLES",
      "OPERADOR_TESORERIA, AUDITOR_CUMPLIMIENTO",
    );

    expect(await obtenerPermisos("okta|1")).toEqual(
      new Set(["Autob_Operar_Tesoreria", "Autob_Auditar"]),
    );
  });

  it("un ADMINISTRADOR simulado no recibe permisos de venta", async () => {
    vi.stubEnv("DEV_TOOLS_MOCK_ROLES", "ADMINISTRADOR");

    // Imita la configuracion vigente de EAS. No es una regla programada: si la
    // organizacion decide lo contrario, se cambia en EAS y aqui solo se ajusta
    // esta tabla de simulacion.
    const permisos = await obtenerPermisos("okta|1");
    expect(permisos.has("Autob_Venta_en_general")).toBe(false);
    expect(permisos.has("Autob_Venta_a_empleados")).toBe(false);
  });

  it("un rol desconocido se ignora y quedan los validos", async () => {
    vi.stubEnv("DEV_TOOLS_MOCK_ROLES", "INVENTADO, AUDITOR_CUMPLIMIENTO");

    expect(await obtenerPermisos("okta|1")).toEqual(new Set(["Autob_Auditar"]));
  });

  it("sin variable alguna cae a ADMINISTRADOR", async () => {
    expect(await obtenerPermisos("okta|1")).toEqual(
      new Set(PERMISOS_POR_ROL.ADMINISTRADOR),
    );
  });

  it("DEV_TOOLS_MOCK_PERMISOS tiene precedencia sobre los roles", async () => {
    vi.stubEnv("DEV_TOOLS_MOCK_ROLES", "ADMINISTRADOR");
    vi.stubEnv("DEV_TOOLS_MOCK_PERMISOS", "Autob_Operar_Tesoreria");

    // Existe para armar combinaciones que ningun rol representa.
    expect(await obtenerPermisos("okta|1")).toEqual(
      new Set(["Autob_Operar_Tesoreria"]),
    );
  });

  it("DEV_TOOLS_MOCK_PERMISOS con basura cae a los roles, no a un conjunto vacio", async () => {
    vi.stubEnv("DEV_TOOLS_MOCK_ROLES", "AUDITOR_CUMPLIMIENTO");
    vi.stubEnv("DEV_TOOLS_MOCK_PERMISOS", "Permiso_Inexistente");

    expect(await obtenerPermisos("okta|1")).toEqual(new Set(["Autob_Auditar"]));
  });
});
