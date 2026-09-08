import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import RejillaDeLotes, { type LoteEnCatalogo } from "./RejillaDeLotes";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const lote = (
  loteId: string,
  extras: Partial<LoteEnCatalogo> = {},
): LoteEnCatalogo => ({
  loteId,
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 100_000,
  precio: 185_000,
  estatus: "EN_OFERTA",
  tamanoFila: 0,
  ...extras,
});

const context = getTestContext();

genericTests(context, RejillaDeLotes, {
  convocatoriaId: "CONV1",
  lotes: [
    lote("L1"),
    lote("L2", { fotografiaPrincipalUrl: "https://cdn/foto.jpg" }),
  ],
  diccionario: obtenerDiccionario("es"),
  idioma: "es",
});

describe("RejillaDeLotes", () => {
  it("muestra el mensaje vacio si no hay lotes", async () => {
    await act(async () => {
      context.root.render(
        <RejillaDeLotes
          convocatoriaId="CONV1"
          lotes={[]}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
    expect(context.container.textContent).toContain(
      "No hay convocatorias disponibles en este momento.",
    );
  });

  it("enlaza cada tarjeta al detalle del lote", async () => {
    await act(async () => {
      context.root.render(
        <RejillaDeLotes
          convocatoriaId="CONV1"
          lotes={[lote("L1")]}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
    const enlace = context.container.querySelector("a");
    expect(enlace?.getAttribute("href")).toBe("/convocatorias/CONV1/lotes/L1");
  });

  it("muestra la cantidad en fila, nunca identidades", async () => {
    await act(async () => {
      context.root.render(
        <RejillaDeLotes
          convocatoriaId="CONV1"
          lotes={[lote("L1", { tamanoFila: 3 })]}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
    expect(context.container.textContent).toContain("3 en fila");
    expect(context.container.textContent).not.toMatch(/@|participante/i);
  });

  it("muestra el precio formateado", async () => {
    await act(async () => {
      context.root.render(
        <RejillaDeLotes
          convocatoriaId="CONV1"
          lotes={[lote("L1", { precio: 185_000 })]}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
    expect(context.container.textContent).toContain("185,000");
  });
});
