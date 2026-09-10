// @vitest-environment node
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import {
  COOKIE_PERSONA_SIMULADA,
  fijarPersonaSimulada,
  impersonacionHabilitada,
  leerPersonaSimulada,
} from "./impersonacion";
import { PERSONAS_SIMULADAS } from "./personasSimuladas";

const cookiesMock = vi.mocked(cookies);

/** Almacen de cookies falso, con la superficie que usa impersonacion.ts. */
const crearAlmacen = (valorInicial?: string) => {
  const almacen = {
    valor: valorInicial,
    get: vi.fn((nombre: string) =>
      nombre === COOKIE_PERSONA_SIMULADA && almacen.valor !== undefined
        ? { name: nombre, value: almacen.valor }
        : undefined,
    ),
    set: vi.fn(),
    delete: vi.fn(),
  };
  return almacen;
};

let almacen: ReturnType<typeof crearAlmacen>;

const conAlmacen = (valorInicial?: string) => {
  almacen = crearAlmacen(valorInicial);
  cookiesMock.mockResolvedValue(almacen as never);
  return almacen;
};

const alguien = PERSONAS_SIMULADAS[0]!;

beforeEach(() => {
  cookiesMock.mockReset();
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("impersonacionHabilitada", () => {
  it("solo en FULL — es lo que distingue FULL de MOCK_USERS", () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "FULL");
    expect(impersonacionHabilitada()).toBe(true);
    vi.stubEnv("ENABLE_DEV_TOOLS", "MOCK_USERS");
    expect(impersonacionHabilitada()).toBe(false);
    vi.stubEnv("ENABLE_DEV_TOOLS", "OFF");
    expect(impersonacionHabilitada()).toBe(false);
  });

  it("sin variable de entorno, no", () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "");
    expect(impersonacionHabilitada()).toBe(false);
  });
});

describe("leerPersonaSimulada", () => {
  it("devuelve la persona cuando la cookie trae un id del roster", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "FULL");
    conAlmacen(alguien.id);
    expect(await leerPersonaSimulada()).toEqual(alguien);
  });

  it("devuelve null si no hay cookie", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "FULL");
    conAlmacen();
    expect(await leerPersonaSimulada()).toBeNull();
  });

  it("ignora un id que no esta en el roster en vez de lanzar", async () => {
    // Una cookie sobreviviente de un roster anterior no debe dejar la
    // aplicacion inservible: se cae al comportamiento por entorno.
    vi.stubEnv("ENABLE_DEV_TOOLS", "FULL");
    conAlmacen("persona-que-ya-no-existe");
    expect(await leerPersonaSimulada()).toBeNull();
  });

  it("en MOCK_USERS no lee la cookie siquiera", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "MOCK_USERS");
    conAlmacen(alguien.id);
    expect(await leerPersonaSimulada()).toBeNull();
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("en OFF no lee la cookie siquiera: no vuelve dinamica ninguna pantalla", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "OFF");
    conAlmacen(alguien.id);
    expect(await leerPersonaSimulada()).toBeNull();
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("lanza si alguien pone FULL en un despliegue sin habilitar, antes de conceder identidad", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "FULL");
    vi.stubEnv("NODE_ENV", "production");
    conAlmacen(alguien.id);
    await expect(leerPersonaSimulada()).rejects.toThrow(/APP_ENV/);
  });

  it("en un ambiente de pruebas habilitado si concede la identidad", async () => {
    // El caso que motiva la habilitacion: Amplify Hosting sirve toda rama con
    // `NODE_ENV=production`, asi que sin esto no habria forma de recorrer el
    // flujo con dos identidades en un despliegue de prueba.
    vi.stubEnv("ENABLE_DEV_TOOLS", "FULL");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "pruebas");
    conAlmacen(alguien.id);

    expect(await leerPersonaSimulada()).toEqual(alguien);
  });
});

describe("fijarPersonaSimulada", () => {
  it("escribe la cookie con el id de la persona, httpOnly y con ruta raiz", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "FULL");
    conAlmacen();

    expect(await fijarPersonaSimulada(alguien.id)).toEqual(alguien);
    expect(almacen.set).toHaveBeenCalledWith(
      COOKIE_PERSONA_SIMULADA,
      alguien.id,
      expect.objectContaining({ httpOnly: true, path: "/", sameSite: "lax" }),
    );
  });

  it("con null borra la cookie y vuelve al comportamiento por entorno", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "FULL");
    conAlmacen(alguien.id);

    expect(await fijarPersonaSimulada(null)).toBeNull();
    expect(almacen.delete).toHaveBeenCalledWith(COOKIE_PERSONA_SIMULADA);
    expect(almacen.set).not.toHaveBeenCalled();
  });

  it("lanza ante un id fuera del roster, sin escribir nada", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "FULL");
    conAlmacen();

    await expect(fijarPersonaSimulada("inventada")).rejects.toThrow(
      /No existe la persona simulada/,
    );
    expect(almacen.set).not.toHaveBeenCalled();
  });

  it("lanza en MOCK_USERS: la impersonacion es exclusiva de FULL", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "MOCK_USERS");
    conAlmacen();

    await expect(fijarPersonaSimulada(alguien.id)).rejects.toThrow(
      /ENABLE_DEV_TOOLS=FULL/,
    );
    expect(almacen.set).not.toHaveBeenCalled();
  });

  it("lanza en OFF", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "OFF");
    conAlmacen();
    await expect(fijarPersonaSimulada(alguien.id)).rejects.toThrow(
      /ENABLE_DEV_TOOLS=FULL/,
    );
  });

  it("lanza en un despliegue sin habilitar aunque el modo sea FULL, y no borra ni escribe", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "FULL");
    vi.stubEnv("NODE_ENV", "production");
    conAlmacen();

    await expect(fijarPersonaSimulada(alguien.id)).rejects.toThrow(/APP_ENV/);
    expect(almacen.set).not.toHaveBeenCalled();
    expect(almacen.delete).not.toHaveBeenCalled();
  });

  it("en un ambiente de pruebas habilitado escribe la cookie con `secure`", async () => {
    // El despliegue va por HTTPS, y ahi `secure` si aplica — a diferencia del
    // `npm run dev` de una maquina, que sirve por HTTP.
    vi.stubEnv("ENABLE_DEV_TOOLS", "FULL");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "pruebas");
    conAlmacen();

    expect(await fijarPersonaSimulada(alguien.id)).toEqual(alguien);
    expect(almacen.set).toHaveBeenCalledWith(
      COOKIE_PERSONA_SIMULADA,
      alguien.id,
      expect.objectContaining({ secure: true }),
    );
  });
});
