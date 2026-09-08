// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateTag } from "next/cache";

import {
  fijarPersonaSimulada,
  impersonacionHabilitada,
} from "@/lib/auth/impersonacion";
import { getSession } from "@/lib/auth/session";
import { etiqueta } from "@/lib/cache";
import type { Sesion } from "@/types/identidad";
import { cambiarPersonaSimulada } from "./devTools";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/impersonacion", () => ({
  fijarPersonaSimulada: vi.fn(),
  impersonacionHabilitada: vi.fn(),
}));

const habilitada = vi.mocked(impersonacionHabilitada);
const fijar = vi.mocked(fijarPersonaSimulada);
const sesionSimulada = vi.mocked(getSession);
const invalidar = vi.mocked(updateTag);

const sesion: Sesion = {
  participanteId: "okta|real",
  oktaSub: "okta|real",
  correo: "yo@example.com",
  nombre: "Yo Real",
  permisos: new Set(),
  tiposDeConvocatoriaPermitidos: [],
};

const formulario = (valor?: string) => {
  const datos = new FormData();
  if (valor !== undefined) datos.set("persona", valor);
  return datos;
};

beforeEach(() => {
  habilitada.mockReset();
  fijar.mockReset();
  sesionSimulada.mockReset();
  invalidar.mockReset();

  habilitada.mockReturnValue(true);
  fijar.mockResolvedValue(null);
  sesionSimulada.mockResolvedValue(sesion);
});

describe("cambiarPersonaSimulada", () => {
  it("fija la persona que llega en el formulario", async () => {
    await cambiarPersonaSimulada(formulario("aprobador"));
    expect(fijar).toHaveBeenCalledWith("aprobador");
  });

  it("con el campo vacio borra la persona: es el boton de dejar de simular", async () => {
    await cambiarPersonaSimulada(formulario(""));
    expect(fijar).toHaveBeenCalledWith(null);
  });

  it("sin el campo tambien borra la persona", async () => {
    await cambiarPersonaSimulada(formulario());
    expect(fijar).toHaveBeenCalledWith(null);
  });

  it("invalida los listados que dependen de los permisos de quien mira", async () => {
    await cambiarPersonaSimulada(formulario("admin"));
    expect(invalidar).toHaveBeenCalledWith(etiqueta.convocatoriasVisibles);
    expect(invalidar).toHaveBeenCalledWith(etiqueta.catalogoConvocatorias);
    expect(invalidar).toHaveBeenCalledWith(etiqueta.catalogoVehiculos);
  });

  it("lanza si el modo no admite impersonacion, sin tocar la cookie", async () => {
    habilitada.mockReturnValue(false);
    await expect(cambiarPersonaSimulada(formulario("admin"))).rejects.toThrow(
      /ENABLE_DEV_TOOLS=FULL/,
    );
    expect(fijar).not.toHaveBeenCalled();
    expect(sesionSimulada).not.toHaveBeenCalled();
  });

  it("lanza sin sesion real de Okta: la impersonacion no sustituye la autenticacion", async () => {
    sesionSimulada.mockResolvedValue(null);
    await expect(cambiarPersonaSimulada(formulario("admin"))).rejects.toThrow(
      /sesion real de Okta/,
    );
    expect(fijar).not.toHaveBeenCalled();
  });

  it("no invalida nada si fijar la persona falla", async () => {
    fijar.mockRejectedValue(new Error("No existe la persona simulada"));
    await expect(
      cambiarPersonaSimulada(formulario("inventada")),
    ).rejects.toThrow(/No existe la persona simulada/);
    expect(invalidar).not.toHaveBeenCalled();
  });
});
