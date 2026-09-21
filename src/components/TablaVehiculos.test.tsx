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
  // Distinto por fila: es el indice de la tabla, asi que un fixture que lo
  // repitiera volveria inservible cualquier asercion sobre el.
  numeroEconomico: `VEH-${vehiculoId}`,
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

describe("columna del vehiculo", () => {
  it("el numero economico es el enlace, y marca/version/modelo la linea de apoyo", async () => {
    // El indice tiene que ser el enlace: veinte NP300 2019 se ven identicas y
    // lo unico que las distingue es el numero economico.
    const container = await render();

    const enlace = container.querySelector("tbody a");
    expect(enlace?.textContent).toBe("VEH-V2");
    expect(enlace?.getAttribute("href")).toBe("/admin/vehiculos/V2/editar");
    expect(container.querySelector("tbody p")?.textContent).toBe(
      "Nissan NP300 2019",
    );
  });

  it("la columna se llama Vehiculo", async () => {
    const container = await render();

    const encabezados = [...container.querySelectorAll("th")].map(
      (th) => th.textContent,
    );
    // `toContain` y no `toBe`: `CardView` repite el texto del encabezado dentro
    // del mismo `<th>` —lo reusa como etiqueta de la celda en la vista de
    // tarjetas—, asi que el contenido es "VehiculoVehiculo".
    expect(encabezados[1]).toContain(diccionario.vehiculos.campos.vehiculo);
    // Y ya no es "Marca": la columna dejo de ser un campo para ser el vehiculo.
    expect(encabezados[1]).not.toContain(diccionario.vehiculos.campos.marca);
  });

  it("sin permiso de edicion el numero se muestra sin enlace", async () => {
    const container = await render({ puedeEditar: false });

    expect(container.textContent).toContain("VEH-V2");
    expect(container.querySelector("tbody a")).toBeNull();
  });

  it("el menu de acciones se identifica por el numero economico", async () => {
    // Con marca y version, el `aria-label` nombra veinte filas distintas.
    const container = await render({ puedeEditar: true });

    expect(
      container
        .querySelector("button[aria-expanded]")
        ?.getAttribute("aria-label"),
    ).toBe(`${diccionario.vehiculos.acciones}: VEH-V2`);
  });
});

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
