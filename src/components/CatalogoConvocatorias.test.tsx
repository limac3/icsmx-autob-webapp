import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import CatalogoConvocatorias, {
  type ConvocatoriaEnCatalogo,
} from "./CatalogoConvocatorias";

// Mismo ruido de router y de deteccion de desbordamiento que
// `TablaConvocatorias.test.tsx`: no hay nada que redimensione en jsdom, y
// `next/link` observa interseccion fuera de `act` si no se sustituye.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const convocatoria = (
  convocatoriaId: string,
  estadoDeVenta: ConvocatoriaEnCatalogo["estadoDeVenta"],
): ConvocatoriaEnCatalogo => ({
  convocatoriaId,
  folio: `CONV-2026-${convocatoriaId}`,
  nombre: "Venta de septiembre",
  cantidadDeLotes: 3,
  estadoDeVenta,
});

const context = getTestContext();

genericTests(context, CatalogoConvocatorias, {
  convocatorias: [
    convocatoria("C1", {
      fase: "PUBLICADA_SIN_ABRIR",
      segundosParaAbrir: 3_600 * 26,
    }),
    convocatoria("C2", {
      fase: "VENTA_ABIERTA",
      cierraFormateado: "12 sep 2026, 18:00",
    }),
    convocatoria("C3", { fase: "VENTA_CERRADA" }),
  ],
  diccionario: obtenerDiccionario("es"),
  idioma: "es",
});

describe("CatalogoConvocatorias", () => {
  it("muestra el mensaje vacio sin insinuar convocatorias ocultas", async () => {
    await act(async () => {
      context.root.render(
        <CatalogoConvocatorias
          convocatorias={[]}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
    expect(context.container.textContent).toContain(
      "No hay convocatorias disponibles en este momento.",
    );
  });

  it("muestra la cuenta regresiva antes de abrir", async () => {
    await act(async () => {
      context.root.render(
        <CatalogoConvocatorias
          convocatorias={[
            convocatoria("C1", {
              fase: "PUBLICADA_SIN_ABRIR",
              segundosParaAbrir: 3_600 * 26,
            }),
          ]}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
    expect(context.container.textContent).toContain("Abre en");
    expect(context.container.textContent).toContain("1 d 2 h");
  });

  it("muestra la fecha de cierre cuando la venta esta abierta", async () => {
    await act(async () => {
      context.root.render(
        <CatalogoConvocatorias
          convocatorias={[
            convocatoria("C2", {
              fase: "VENTA_ABIERTA",
              cierraFormateado: "12 sep 2026, 18:00",
            }),
          ]}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
    expect(context.container.textContent).toContain("Abierta");
    expect(context.container.textContent).toContain("12 sep 2026, 18:00");
  });

  it("identifica cada convocatoria por su nombre y su folio", async () => {
    // Antes la columna era el **tipo** mas un resumen de la descripcion: dos
    // convocatorias de empleados quedaban indistinguibles, y el resumen se
    // repite casi palabra por palabra de una a otra.
    await act(async () => {
      context.root.render(
        <CatalogoConvocatorias
          convocatorias={[convocatoria("C1", { fase: "VENTA_CERRADA" })]}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });

    const enlace = context.container.querySelector("a");
    expect(enlace?.textContent).toBe("Venta de septiembre");
    expect(enlace?.getAttribute("href")).toBe("/convocatorias/C1");
    expect(context.container.textContent).toContain("Folio: CONV-2026-C1");
    expect(context.container.textContent).not.toContain("De empleados");
  });

  it("nunca expone identidad de terceros", async () => {
    await act(async () => {
      context.root.render(
        <CatalogoConvocatorias
          convocatorias={[convocatoria("C1", { fase: "VENTA_CERRADA" })]}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
    expect(context.container.textContent).not.toMatch(/@|participante|correo/i);
  });
});
