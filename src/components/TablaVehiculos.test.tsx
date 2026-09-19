import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import type { Vehiculo } from "@/types/vehiculo";
import TablaVehiculos, { type TablaVehiculosProps } from "./TablaVehiculos";

// `next/link` observa la interseccion para precargar y dispara un `setState`
// fuera de `act` cuando el temporizador salta despues de desmontar. Es ruido
// del router, no del componente: aqui basta un ancla.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const context = getTestContext();

const diccionario = obtenerDiccionario("es");

const vehiculo = (
  vehiculoId: string,
  estatus: Vehiculo["estatus"],
  convocatoriaId?: string,
): Vehiculo => ({
  ...(convocatoriaId ? { convocatoriaId } : {}),
  numeroEconomico: "VEH-001",
  numeroDeSerie: "3N6AD33A9KK870001",
  vehiculoId,
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 148_320,
  estatus,
  creadoEn: "2026-01-10T10:00:00.000Z",
  creadoPor: "P0",
  actualizadoEn: "2026-01-10T10:00:00.000Z",
  actualizadoPor: "P0",
});

genericTests(context, TablaVehiculos, {
  vehiculos: [
    vehiculo("V1", "DISPONIBLE"),
    vehiculo("V2", "EN_CONVOCATORIA", "C1"),
    vehiculo("V3", "VENDIDO"),
  ],
  diccionario,
  idioma: "es" as const,
  puedeEditar: true,
  puedeAuditar: true,
  convocatorias: { C1: { nombre: "Venta de septiembre", folio: "CONV-001" } },
});

const render = async (props: Partial<TablaVehiculosProps> = {}) => {
  await act(async () => {
    context.root.render(
      <TablaVehiculos
        vehiculos={[vehiculo("V2", "EN_CONVOCATORIA", "C1")]}
        diccionario={diccionario}
        idioma="es"
        puedeEditar
        {...props}
      />,
    );
  });
  return context.container;
};

describe("columna de convocatoria activa (seccion 4.1)", () => {
  it("muestra el nombre y el folio, no el identificador", async () => {
    const container = await render({
      convocatorias: {
        C1: { nombre: "Venta de septiembre", folio: "CONV-001" },
      },
    });

    expect(container.textContent).toContain("Venta de septiembre");
    expect(container.textContent).toContain("Folio: CONV-001");
    // Un ULID en pantalla no le dice nada a nadie.
    expect(container.textContent).not.toContain("C1");
  });

  it("sin nombre que resolver no imprime el identificador crudo", async () => {
    const container = await render({ convocatorias: {} });

    expect(container.textContent).not.toContain("C1");
    expect(container.textContent).toContain(
      diccionario.vehiculos.sinConvocatoria,
    );
  });

  it("un vehiculo sin convocatoria activa deja la celda vacia", async () => {
    const container = await render({
      vehiculos: [vehiculo("V1", "DISPONIBLE")],
    });

    expect(container.textContent).toContain(
      diccionario.vehiculos.sinConvocatoria,
    );
  });
});

describe("columna de fotografia (seccion 4.1)", () => {
  it("muestra la miniatura firmada que le pasa el servidor", async () => {
    const container = await render({
      miniaturas: { V2: "https://cdn/v2-min.webp?firma" },
    });

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn/v2-min.webp?firma");
    // Decorativa: repite lo que dice la celda del nombre, y describirla haria
    // al lector de pantalla leer cada vehiculo dos veces.
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("sin fotografia no dibuja un marco vacio", async () => {
    const container = await render({ miniaturas: {} });

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(
      diccionario.vehiculos.sinFotografia,
    );
  });
});

describe("acciones por fila", () => {
  const abrir = async (container: HTMLElement) => {
    const boton = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    );
    await act(async () => {
      boton?.click();
    });
  };

  it("el menu ofrece editar y la bitacora segun los permisos", async () => {
    const container = await render({ puedeEditar: true, puedeAuditar: true });
    await abrir(container);

    const enlaces = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(enlaces).toContain("/admin/vehiculos/V2/editar");
    expect(enlaces.some((h) => h?.startsWith("/auditoria"))).toBe(true);
  });

  it("sin Autob_Auditar el menu no ofrece la bitacora", async () => {
    const container = await render({ puedeEditar: true, puedeAuditar: false });
    await abrir(container);

    const enlaces = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(enlaces.some((h) => h?.startsWith("/auditoria"))).toBe(false);
  });

  it("sin ninguna accion disponible no hay boton de menu", async () => {
    // Un menu vacio es peor que ninguno: promete algo y no lo cumple.
    const container = await render({ puedeEditar: false, puedeAuditar: false });

    expect(container.querySelector("button[aria-expanded]")).toBeNull();
  });

  it("editar sigue estando fuera del menu, porque el menu necesita JavaScript", async () => {
    // El formulario de filtros funciona sin JavaScript; si la unica via de
    // editar fuera el desplegable, la pantalla dejaria de funcionar sin el.
    const container = await render({ puedeEditar: true, puedeAuditar: false });

    const enlaceDelNombre = container.querySelector("tbody a");
    expect(enlaceDelNombre?.getAttribute("href")).toBe(
      "/admin/vehiculos/V2/editar",
    );
  });
});
