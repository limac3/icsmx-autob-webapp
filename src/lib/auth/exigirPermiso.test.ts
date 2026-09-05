// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exigirPermiso } from "./exigirPermiso";
import { getSession } from "./session";
import type { Sesion } from "@/types/identidad";

vi.mock("server-only", () => ({}));
vi.mock("./session", () => ({ getSession: vi.fn() }));

const sesionSimulada = vi.mocked(getSession);

const sesion = (permisos: string[]): Sesion => ({
  participanteId: "P1",
  oktaSub: "okta|1",
  correo: "quien@example.org",
  nombre: "Quien Sea",
  permisos: new Set(permisos) as Sesion["permisos"],
  tiposDeConvocatoriaPermitidos: [],
});

beforeEach(() => {
  sesionSimulada.mockReset();
});

describe("sin sesion", () => {
  it("devuelve unauthorized y no consulta permisos", async () => {
    sesionSimulada.mockResolvedValue(null);
    await expect(exigirPermiso("vehiculo:crear")).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
  });

  it("distingue no autenticado de no autorizado", async () => {
    // Son respuestas distintas para el navegador: una lleva a iniciar sesion y
    // la otra a una pantalla de 403. Colapsarlas manda a login a quien ya lo
    // hizo.
    sesionSimulada.mockResolvedValue(null);
    const sinSesion = await exigirPermiso("vehiculo:crear");

    sesionSimulada.mockResolvedValue(sesion([]));
    const sinPermiso = await exigirPermiso("vehiculo:crear");

    expect(sinSesion).toEqual({ ok: false, error: "unauthorized" });
    expect(sinPermiso).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("capacidad", () => {
  it("permite cuando el permiso esta y la accion no tiene guarda", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Administrar_Vehiculos"]));
    const resultado = await exigirPermiso("vehiculo:crear");

    expect(resultado.ok).toBe(true);
  });

  it("deniega con forbidden cuando falta el permiso", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Auditar"]));
    await expect(exigirPermiso("vehiculo:crear")).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

describe("aplicabilidad", () => {
  it("traduce una guarda de estado a invalid_state", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Administrar_Vehiculos"]));
    await expect(
      exigirPermiso("vehiculo:editar", { estatusVehiculo: "VENDIDO" }),
    ).resolves.toEqual({ ok: false, error: "invalid_state" });
  });

  it("deniega cuando el dato de la guarda no llego", async () => {
    // Cerrado por omision (regla 18): un contexto incompleto no puede conceder.
    sesionSimulada.mockResolvedValue(sesion(["Autob_Administrar_Vehiculos"]));
    await expect(exigirPermiso("vehiculo:editar")).resolves.toEqual({
      ok: false,
      error: "invalid_state",
    });
  });

  it("permite cuando el estado si aplica", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Administrar_Vehiculos"]));
    const resultado = await exigirPermiso("vehiculo:editar", {
      estatusVehiculo: "DISPONIBLE",
    });
    expect(resultado.ok).toBe(true);
  });
});

describe("el actor para la bitacora", () => {
  it("sale de la sesion, con los permisos vigentes", async () => {
    sesionSimulada.mockResolvedValue(
      sesion(["Autob_Administrar_Vehiculos", "Autob_Auditar"]),
    );
    const resultado = await exigirPermiso("vehiculo:crear");

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.actor).toEqual({
      tipo: "USUARIO",
      id: "P1",
      permisos: ["Autob_Administrar_Vehiculos", "Autob_Auditar"],
    });
  });

  it("el identificador no se puede inyectar por contexto", async () => {
    // `participanteId` lo pone esta funcion desde la sesion. Si viniera del
    // input, cualquiera podria actuar en nombre de otro y la bitacora
    // registraria una autoria falsa.
    sesionSimulada.mockResolvedValue(sesion(["Autob_Administrar_Vehiculos"]));
    const resultado = await exigirPermiso("vehiculo:crear", {
      // @ts-expect-error el tipo lo prohibe; la prueba comprueba que ademas se ignora
      participanteId: "OTRO",
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.actor.id).toBe("P1");
  });
});
