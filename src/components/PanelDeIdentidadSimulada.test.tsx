// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  impersonacionHabilitada,
  leerPersonaSimulada,
} from "@/lib/auth/impersonacion";
import { PERSONAS_SIMULADAS } from "@/lib/auth/personasSimuladas";
import { getSession } from "@/lib/auth/session";
import type { Sesion } from "@/types/identidad";
import PanelDeIdentidadSimulada from "./PanelDeIdentidadSimulada";

vi.mock("server-only", () => ({}));
vi.mock("@/app/actions/devTools", () => ({ cambiarPersonaSimulada: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/impersonacion", () => ({
  impersonacionHabilitada: vi.fn(),
  leerPersonaSimulada: vi.fn(),
}));
vi.mock("@/lib/idioma", () => ({
  obtenerIdiomaDePeticion: vi.fn(async () => "es" as const),
}));

const habilitada = vi.mocked(impersonacionHabilitada);
const leerPersona = vi.mocked(leerPersonaSimulada);
const sesionSimulada = vi.mocked(getSession);

const sesion: Sesion = {
  participanteId: "dev-aprobador",
  oktaSub: "okta|real",
  correo: "beto.berrones@autob.invalid",
  nombre: "Beto Berrones",
  permisos: new Set(["Autob_Aprobar_Convocatorias"]),
  tiposDeConvocatoriaPermitidos: [],
};

const beto = PERSONAS_SIMULADAS.find((persona) => persona.id === "aprobador")!;

/**
 * El panel es un Server Component asincrono: se invoca como funcion y se
 * inspecciona el elemento que devuelve. No hace falta jsdom — lo que se prueba
 * aqui es la compuerta y el cableado de props, no el marcado (eso lo cubre
 * `BarraDeIdentidadSimulada.test.tsx`).
 */
const montar = async () => PanelDeIdentidadSimulada();

beforeEach(() => {
  habilitada.mockReset();
  leerPersona.mockReset();
  sesionSimulada.mockReset();

  habilitada.mockReturnValue(true);
  leerPersona.mockResolvedValue(beto);
  sesionSimulada.mockResolvedValue(sesion);
});

describe("PanelDeIdentidadSimulada", () => {
  it("no renderiza nada si el modo no admite impersonacion", async () => {
    habilitada.mockReturnValue(false);
    expect(await montar()).toBeNull();
    // Ni se pregunta por la sesion: en produccion esta rama no cuesta nada.
    expect(sesionSimulada).not.toHaveBeenCalled();
    expect(leerPersona).not.toHaveBeenCalled();
  });

  it("no renderiza nada sin sesion de Okta", async () => {
    sesionSimulada.mockResolvedValue(null);
    expect(await montar()).toBeNull();
  });

  it("no renderiza nada si la sesion falla, en vez de tumbar la pantalla", async () => {
    sesionSimulada.mockRejectedValue(new Error("EAS no responde"));
    await expect(montar()).resolves.toBeNull();
  });

  it("sobrevive a un fallo al leer la cookie", async () => {
    leerPersona.mockRejectedValue(new Error("cookie ilegible"));
    const elemento = await montar();
    expect(elemento).not.toBeNull();
    expect(elemento?.props.idActivo).toBeNull();
  });

  it("pasa el roster completo, con permisos ya derivados", async () => {
    const elemento = await montar();
    const personas = elemento?.props.personas as {
      id: string;
      permisos: string[];
    }[];

    expect(personas).toHaveLength(PERSONAS_SIMULADAS.length);
    expect(personas.map((persona) => persona.id)).toEqual(
      PERSONAS_SIMULADAS.map((persona) => persona.id),
    );
    // Permisos, no roles: el concepto de rol no cruza hacia la presentacion.
    expect(
      personas.find((persona) => persona.id === "aprobador")?.permisos,
    ).toEqual(["Autob_Aprobar_Convocatorias"]);
  });

  it("marca como activa la persona de la cookie y muestra el sub real de Okta", async () => {
    const elemento = await montar();
    expect(elemento?.props.idActivo).toBe("aprobador");
    expect(elemento?.props.nombreVigente).toBe("Beto Berrones");
    expect(elemento?.props.oktaSub).toBe("okta|real");
  });

  it("sin persona elegida, idActivo es null", async () => {
    leerPersona.mockResolvedValue(null);
    expect((await montar())?.props.idActivo).toBeNull();
  });
});
