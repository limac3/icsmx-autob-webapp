// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { obtenerDiccionario } from "@/dictionaries";
import { getSession } from "@/lib/auth/session";
import type { Permiso, Sesion } from "@/types/identidad";
import EncabezadoAplicacion from "./EncabezadoAplicacion";
import MenuDeUsuario from "./MenuDeUsuario";
import NavegacionPrincipal from "./NavegacionPrincipal";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/idioma", () => ({
  obtenerIdiomaDePeticion: vi.fn(async () => "es" as const),
}));

const sesionSimulada = vi.mocked(getSession);
const etiquetas = obtenerDiccionario("es").navegacion;

const sesionCon = (...permisos: Permiso[]): Sesion => ({
  participanteId: "p1",
  oktaSub: "okta|1",
  correo: "p1@example.com",
  nombre: "Ana Alcantara",
  permisos: new Set(permisos),
  tiposDeConvocatoriaPermitidos: [],
});

/**
 * Server Component asincrono: se invoca como funcion y se inspeccionan las
 * props del `WorkforceHeader` que devuelve. Lo que se prueba es el filtrado y
 * el cableado, no el marcado de Eden.
 */
const montar = async () => EncabezadoAplicacion();

/**
 * El slot `tools` es ahora un `<div>` con dos hijos: `NavegacionPrincipal`
 * (ausente sin sesion) y `MenuDeUsuario`. Se identifican por tipo en vez de
 * por posicion, para que la prueba no dependa del orden en el que se
 * declaran en el JSX.
 */
type HijoDeTools = { type: unknown; props: Record<string, unknown> };

const menu = (elemento: Awaited<ReturnType<typeof montar>>) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = (elemento.props as any).tools as {
    props: { children: unknown[] };
  };
  const hijos = tools.props.children.filter(Boolean) as HijoDeTools[];

  const navegacion = hijos.find((h) => h.type === NavegacionPrincipal);
  const cuenta = hijos.find((h) => h.type === MenuDeUsuario);

  return {
    nombre: (cuenta?.props.nombre ?? null) as string | null,
    enlaces: (navegacion?.props.enlaces ?? []) as {
      href: string;
      etiqueta: string;
    }[],
  };
};

beforeEach(() => {
  sesionSimulada.mockReset();
  sesionSimulada.mockResolvedValue(sesionCon());
});

describe("EncabezadoAplicacion", () => {
  it("pasa al menu solo los enlaces que los permisos de la sesion abren", async () => {
    sesionSimulada.mockResolvedValue(sesionCon("Autob_Operar_Tesoreria"));

    expect(menu(await montar()).enlaces).toEqual([
      { href: "/tesoreria/verificacion", etiqueta: etiquetas.tesoreria },
    ]);
  });

  it("traduce las etiquetas con el diccionario, nunca el id crudo (regla 11)", async () => {
    sesionSimulada.mockResolvedValue(
      sesionCon("Autob_Administrar_Convocatorias"),
    );

    const { enlaces } = menu(await montar());
    expect(enlaces.map((enlace) => enlace.etiqueta)).toEqual([
      etiquetas.vehiculos,
      etiquetas.convocatoriasAdmin,
    ]);
  });

  it("una sesion sin permisos recibe un menu vacio, no todos los enlaces", async () => {
    sesionSimulada.mockResolvedValue(sesionCon());
    const { nombre, enlaces } = menu(await montar());

    expect(enlaces).toEqual([]);
    expect(nombre).toBe("Ana Alcantara");
  });

  it("los permisos de la sesion no cruzan al cliente", async () => {
    sesionSimulada.mockResolvedValue(sesionCon("Autob_Auditar"));
    const props = menu(await montar()) as Record<string, unknown>;

    expect(props).not.toHaveProperty("permisos");
    expect(props).not.toHaveProperty("sesion");
    expect(JSON.stringify(props.enlaces)).not.toContain("Autob_");
  });

  it("sin sesion se dibuja igual, con nombre nulo y sin enlaces", async () => {
    sesionSimulada.mockResolvedValue(null);
    const { nombre, enlaces } = menu(await montar());

    expect(nombre).toBeNull();
    expect(enlaces).toEqual([]);
  });

  it("si la sesion falla degrada al estado sin sesion, sin tumbar la pagina", async () => {
    sesionSimulada.mockRejectedValue(new Error("EAS no responde"));
    const elemento = await montar();

    expect(elemento).not.toBeNull();
    expect(menu(elemento).nombre).toBeNull();
  });
});
