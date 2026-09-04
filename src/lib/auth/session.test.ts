// @vitest-environment node
vi.mock("server-only", () => ({}));
vi.mock("./auth0", () => ({ auth: { getSession: vi.fn() } }));
vi.mock("./eas", () => ({ obtenerRoles: vi.fn() }));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "./auth0";
import { obtenerRoles } from "./eas";
import { getSession } from "./session";

const authGetSession = vi.mocked(auth.getSession);
const obtenerRolesMock = vi.mocked(obtenerRoles);

beforeEach(() => {
  authGetSession.mockReset();
  obtenerRolesMock.mockReset();
});

describe("getSession", () => {
  it("devuelve null si no hay sesion de Okta", async () => {
    authGetSession.mockResolvedValue(null);
    expect(await getSession()).toBeNull();
    expect(obtenerRolesMock).not.toHaveBeenCalled();
  });

  it("devuelve null si la sesion de Okta no trae sub", async () => {
    authGetSession.mockResolvedValue({ user: {} } as never);
    expect(await getSession()).toBeNull();
  });

  it("resuelve tipoParticipante EMPLEADO cuando EAS incluye ese rol", async () => {
    authGetSession.mockResolvedValue({
      user: { sub: "okta|1", email: "ana@example.com", name: "Ana" },
    } as never);
    obtenerRolesMock.mockResolvedValue(["EMPLEADO", "ADMINISTRADOR"]);

    expect(await getSession()).toEqual({
      participanteId: "okta|1",
      oktaSub: "okta|1",
      correo: "ana@example.com",
      nombre: "Ana",
      roles: ["EMPLEADO", "ADMINISTRADOR"],
      tipoParticipante: "EMPLEADO",
    });
  });

  it("resuelve tipoParticipante OTRO_USUARIO cuando EAS no incluye EMPLEADO", async () => {
    authGetSession.mockResolvedValue({ user: { sub: "okta|2" } } as never);
    obtenerRolesMock.mockResolvedValue(["OTRO_USUARIO"]);
    expect((await getSession())?.tipoParticipante).toBe("OTRO_USUARIO");
  });

  it("una sesion autenticada sin roles no lanza y cae a OTRO_USUARIO", async () => {
    authGetSession.mockResolvedValue({ user: { sub: "okta|3" } } as never);
    obtenerRolesMock.mockResolvedValue([]);
    const sesion = await getSession();
    expect(sesion?.roles).toEqual([]);
    expect(sesion?.tipoParticipante).toBe("OTRO_USUARIO");
  });

  it("propaga el error si EAS falla — sin fallback silencioso (regla 15)", async () => {
    authGetSession.mockResolvedValue({ user: { sub: "okta|4" } } as never);
    obtenerRolesMock.mockRejectedValue(new Error("EAS no responde"));
    await expect(getSession()).rejects.toThrow("EAS no responde");
  });

  it("usa el correo como nombre de respaldo si Okta no envia name", async () => {
    authGetSession.mockResolvedValue({
      user: { sub: "okta|5", email: "x@example.com" },
    } as never);
    obtenerRolesMock.mockResolvedValue([]);
    expect((await getSession())?.nombre).toBe("x@example.com");
  });
});
