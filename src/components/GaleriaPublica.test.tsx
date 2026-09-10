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

  it("escribe la descripcion de cada foto debajo de su miniatura", async () => {
    // El pie lo pinta `title` y no `caption`: la galeria lee el `title` del
    // hijo y lo pasa como `description` al `Thumbnail`. `caption` solo llega al
    // visor ampliado, asi que con el la tira quedaria sin pies.
    await act(async () => {
      context.root.render(
        <GaleriaPublica
          titulo="Nissan NP300 2019"
          fotografias={[
            {
              fotoId: "F1",
              url: "https://cdn/foto1.jpg",
              descripcion: "Frente",
            },
            {
              fotoId: "F2",
              url: "https://cdn/foto2.jpg",
              descripcion: "Motor",
            },
          ]}
          diccionario={obtenerDiccionario("es")}
        />,
      );
    });

    expect(context.container.textContent).toContain("Frente");
    expect(context.container.textContent).toContain("Motor");

    // Y con pie visible la imagen queda decorativa: repetir el pie en el `alt`
    // lo anuncia dos veces, y axe lo marca como violacion.
    for (const imagen of context.container.querySelectorAll("img")) {
      expect(imagen.getAttribute("alt")).toBe("");
    }
  });

  it("no repite el nombre del vehiculo: el encabezado lo pone la pagina", async () => {
    // `MediaThumbnailGallery` pinta su `title` como un `H3` debajo de la tira,
    // asi que con el nombre ahi la pantalla del lote lo mostraba dos veces
    // seguidas —ese `H3` y el `H1` de identificacion—.
    await act(async () => {
      context.root.render(
        <GaleriaPublica
          titulo="Nissan NP300 2019"
          fotografias={[{ fotoId: "F1", url: "https://cdn/foto1.jpg" }]}
          diccionario={obtenerDiccionario("es")}
        />,
      );
    });

    expect(context.container.textContent).not.toContain("Nissan NP300 2019");
    // Pero sigue siendo el respaldo del texto alternativo de una foto sin
    // descripcion: una imagen sin `alt` es una violacion de accesibilidad.
    expect(context.container.querySelector("img")?.getAttribute("alt")).toBe(
      "Nissan NP300 2019",
    );
  });
});
