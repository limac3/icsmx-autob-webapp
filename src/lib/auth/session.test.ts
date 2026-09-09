// @vitest-environment node
vi.mock("server-only", () => ({}));
vi.mock("./auth0", () => ({ auth: { getSession: vi.fn() } }));
vi.mock("./eas", () => ({ obtenerPermisos: vi.fn() }));
vi.mock("./impersonacion", () => ({ leerPersonaSimulada: vi.fn() }));
vi.mock("@/lib/participantes/registrarPerfil", () => ({
  registrarPerfil: vi.fn(),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { registrarPerfil } from "@/lib/participantes/registrarPerfil";
import type { Permiso } from "@/types/identidad";
import { auth } from "./auth0";
import { obtenerPermisos } from "./eas";
import { leerPersonaSimulada } from "./impersonacion";
import type { PersonaSimulada } from "./personasSimuladas";
import { getSession } from "./session";

const authGetSession = vi.mocked(auth.getSession);
const obtenerPermisosMock = vi.mocked(obtenerPermisos);
const leerPersonaMock = vi.mocked(leerPersonaSimulada);
const registrarPerfilMock = vi.mocked(registrarPerfil);

const permisos = (...valores: Permiso[]) => new Set(valores);

beforeEach(() => {
  authGetSession.mockReset();
  obtenerPermisosMock.mockReset();
  leerPersonaMock.mockReset();
  registrarPerfilMock.mockReset();
  registrarPerfilMock.mockResolvedValue({
    ok: true,
    data: {
      participanteId: "x",
      nombre: "x",
      correo: "x",
      actualizadoEn: "2026-09-08T00:00:00.000Z",
    },
  });
  // Sin impersonacion salvo que la prueba diga lo contrario: es lo que ocurre
  // en produccion y en MOCK_USERS.
  leerPersonaMock.mockResolvedValue(null);
});

describe("getSession", () => {
  it("devuelve null si no hay sesion de Okta", async () => {
    authGetSession.mockResolvedValue(null);
    expect(await getSession()).toBeNull();
    expect(obtenerPermisosMock).not.toHaveBeenCalled();
  });

  it("devuelve null si la sesion de Okta no trae sub", async () => {
    authGetSession.mockResolvedValue({ user: {} } as never);
    expect(await getSession()).toBeNull();
  });

  it("consolida la sesion con los permisos que devuelve EAS", async () => {
    authGetSession.mockResolvedValue({
      user: { sub: "okta|1", email: "ana@example.com", name: "Ana" },
    } as never);
    obtenerPermisosMock.mockResolvedValue(
      permisos("Autob_Venta_a_empleados", "Autob_Venta_en_general"),
    );

    expect(await getSession()).toEqual({
      participanteId: "okta|1",
      oktaSub: "okta|1",
      correo: "ana@example.com",
      nombre: "Ana",
      permisos: permisos("Autob_Venta_a_empleados", "Autob_Venta_en_general"),
      tiposDeConvocatoriaPermitidos: ["EMPLEADOS", "PUBLICO_GENERAL"],
    });
  });

  it("con solo Autob_Venta_en_general no alcanza las convocatorias de empleados", async () => {
    authGetSession.mockResolvedValue({ user: { sub: "okta|2" } } as never);
    obtenerPermisosMock.mockResolvedValue(permisos("Autob_Venta_en_general"));
    expect((await getSession())?.tiposDeConvocatoriaPermitidos).toEqual([
      "PUBLICO_GENERAL",
    ]);
  });

  it("un permiso administrativo no da acceso a ningun tipo de convocatoria", async () => {
    authGetSession.mockResolvedValue({ user: { sub: "okta|3" } } as never);
    obtenerPermisosMock.mockResolvedValue(
      permisos("Autob_Administrar_Convocatorias"),
    );
    const sesion = await getSession();
    expect(sesion?.tiposDeConvocatoriaPermitidos).toEqual([]);
    expect(sesion?.permisos.has("Autob_Administrar_Convocatorias")).toBe(true);
  });

  it("una sesion autenticada sin permisos no lanza: se distingue de un EAS caido", async () => {
    authGetSession.mockResolvedValue({ user: { sub: "okta|4" } } as never);
    obtenerPermisosMock.mockResolvedValue(permisos());
    const sesion = await getSession();
    expect(sesion?.permisos.size).toBe(0);
    expect(sesion?.tiposDeConvocatoriaPermitidos).toEqual([]);
  });

  it("propaga el error si EAS falla — sin fallback silencioso (regla 15)", async () => {
    authGetSession.mockResolvedValue({ user: { sub: "okta|5" } } as never);
    obtenerPermisosMock.mockRejectedValue(new Error("EAS no responde"));
    await expect(getSession()).rejects.toThrow("EAS no responde");
  });

  it("usa el correo como nombre de respaldo si Okta no envia name", async () => {
    authGetSession.mockResolvedValue({
      user: { sub: "okta|6", email: "x@example.com" },
    } as never);
    obtenerPermisosMock.mockResolvedValue(permisos());
    expect((await getSession())?.nombre).toBe("x@example.com");
  });
});

describe("getSession con impersonacion de desarrollo", () => {
  const beto: PersonaSimulada = {
    id: "aprobador",
    participanteId: "dev-aprobador",
    nombre: "Beto Berrones",
    correo: "beto.berrones@autob.invalid",
    roles: ["APROBADOR_CONVOCATORIA"],
  };

  it("sustituye identidad y permisos, y no consulta EAS", async () => {
    authGetSession.mockResolvedValue({
      user: { sub: "okta|real", email: "yo@example.com", name: "Yo Real" },
    } as never);
    leerPersonaMock.mockResolvedValue(beto);

    expect(await getSession()).toEqual({
      participanteId: "dev-aprobador",
      // El sub real se conserva: es lo unico que sigue respondiendo quien
      // esta conduciendo la sesion.
      oktaSub: "okta|real",
      correo: "beto.berrones@autob.invalid",
      nombre: "Beto Berrones",
      permisos: permisos("Autob_Aprobar_Convocatorias"),
      tiposDeConvocatoriaPermitidos: [],
    });
    expect(obtenerPermisosMock).not.toHaveBeenCalled();
  });

  it("no sustituye la autenticacion: sin sesion de Okta no hay persona simulada", async () => {
    authGetSession.mockResolvedValue(null);
    leerPersonaMock.mockResolvedValue(beto);

    expect(await getSession()).toBeNull();
    // Ni siquiera se pregunta por la cookie: la sesion real se exige primero.
    expect(leerPersonaMock).not.toHaveBeenCalled();
  });

  it("los tipos de convocatoria se derivan de los permisos de la persona", async () => {
    authGetSession.mockResolvedValue({ user: { sub: "okta|real" } } as never);
    leerPersonaMock.mockResolvedValue({
      ...beto,
      id: "publico",
      participanteId: "dev-publico",
      roles: ["OTRO_USUARIO"],
    });

    expect((await getSession())?.tiposDeConvocatoriaPermitidos).toEqual([
      "PUBLICO_GENERAL",
    ]);
  });

  it("sin persona elegida, la sesion sigue saliendo de EAS o del entorno", async () => {
    authGetSession.mockResolvedValue({
      user: { sub: "okta|real", email: "yo@example.com" },
    } as never);
    leerPersonaMock.mockResolvedValue(null);
    obtenerPermisosMock.mockResolvedValue(permisos("Autob_Auditar"));

    const sesion = await getSession();
    expect(sesion?.participanteId).toBe("okta|real");
    expect(sesion?.permisos).toEqual(permisos("Autob_Auditar"));
    expect(obtenerPermisosMock).toHaveBeenCalledWith("okta|real");
  });
});

describe("getSession y el perfil del participante", () => {
  it("deja el nombre y el correo alcanzables para el auditor", async () => {
    authGetSession.mockResolvedValue({
      user: { sub: "okta|perfil-1", email: "ana@example.com", name: "Ana" },
    } as never);
    obtenerPermisosMock.mockResolvedValue(permisos());

    await getSession();

    expect(registrarPerfilMock).toHaveBeenCalledWith({
      participanteId: "okta|perfil-1",
      oktaSub: "okta|perfil-1",
      nombre: "Ana",
      correo: "ana@example.com",
    });
  });

  it("no vuelve a escribirlo en la misma instancia", async () => {
    authGetSession.mockResolvedValue({
      user: { sub: "okta|perfil-2", email: "b@example.com", name: "B" },
    } as never);
    obtenerPermisosMock.mockResolvedValue(permisos());

    await getSession();
    await getSession();
    await getSession();

    expect(registrarPerfilMock).toHaveBeenCalledTimes(1);
  });

  it("si la escritura falla, la sesion se entrega igual", async () => {
    // Es la invariante que importa: que no se pueda escribir una etiqueta de
    // auditoria no puede dejar sin aplicacion a quien inicio sesion.
    authGetSession.mockResolvedValue({
      user: { sub: "okta|perfil-3", email: "c@example.com", name: "C" },
    } as never);
    obtenerPermisosMock.mockResolvedValue(permisos("Autob_Venta_en_general"));
    registrarPerfilMock.mockRejectedValue(new Error("Falta AUTOB_TABLE_NAME"));

    const sesion = await getSession();

    expect(sesion?.participanteId).toBe("okta|perfil-3");
    expect(sesion?.permisos).toEqual(permisos("Autob_Venta_en_general"));
  });

  it("un fallo pasajero se reintenta en la peticion siguiente", async () => {
    authGetSession.mockResolvedValue({
      user: { sub: "okta|perfil-4", email: "d@example.com", name: "D" },
    } as never);
    obtenerPermisosMock.mockResolvedValue(permisos());
    registrarPerfilMock.mockRejectedValueOnce(new Error("throttling"));

    await getSession();
    await getSession();

    expect(registrarPerfilMock).toHaveBeenCalledTimes(2);
  });

  it("tambien registra el perfil de una persona simulada", async () => {
    authGetSession.mockResolvedValue({
      user: { sub: "okta|real-5", email: "yo@example.com", name: "Yo Real" },
    } as never);
    leerPersonaMock.mockResolvedValue({
      id: "auditor",
      participanteId: "dev-auditor-5",
      nombre: "Carla Auditora",
      correo: "carla@autob.invalid",
      roles: ["AUDITOR_CUMPLIMIENTO"],
    });

    await getSession();

    expect(registrarPerfilMock).toHaveBeenCalledWith({
      participanteId: "dev-auditor-5",
      // El sub real: es lo unico que responde quien conduce la sesion.
      oktaSub: "okta|real-5",
      nombre: "Carla Auditora",
      correo: "carla@autob.invalid",
    });
  });
});
