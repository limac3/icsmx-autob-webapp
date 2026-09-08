import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import GaleriaPublica from "./GaleriaPublica";

// Igual ruido que en `TablaConvocatorias.test.tsx`: `useHasOverflow` arranca
// un `setTimeout` de 50 ms que en jsdom no tiene nada que redimensione y
// aterriza fuera del `act` de la prueba.
vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
}));

const context = getTestContext();

genericTests(context, GaleriaPublica, {
  titulo: "Nissan NP300 2019",
  fotografias: [
    { fotoId: "F1", url: "https://cdn/foto1.jpg", descripcion: "Frente" },
    { fotoId: "F2", url: "https://cdn/foto2.jpg" },
  ],
  diccionario: obtenerDiccionario("es"),
});

describe("GaleriaPublica", () => {
  it("muestra el mensaje vacio sin fotografias", async () => {
    await act(async () => {
      context.root.render(
        <GaleriaPublica
          titulo="Nissan NP300 2019"
          fotografias={[]}
          diccionario={obtenerDiccionario("es")}
        />,
      );
    });
    expect(context.container.textContent).toContain(
      "Este vehículo no tiene fotografías.",
    );
  });

  it("pinta cada fotografia con su URL ya firmada", async () => {
    await act(async () => {
      context.root.render(
        <GaleriaPublica
          titulo="Nissan NP300 2019"
          fotografias={[{ fotoId: "F1", url: "https://cdn/foto1.jpg" }]}
          diccionario={obtenerDiccionario("es")}
        />,
      );
    });
    const imagen = context.container.querySelector("img");
    expect(imagen?.getAttribute("src")).toBe("https://cdn/foto1.jpg");
  });
});
