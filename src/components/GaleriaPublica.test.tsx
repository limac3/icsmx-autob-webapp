import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import GaleriaPublica from "./GaleriaPublica";
import { fuentesDePrueba } from "@/utils/fotografiaDePrueba";

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
    { fotoId: "F1", fuentes: fuentesDePrueba("F1"), descripcion: "Frente" },
    { fotoId: "F2", fuentes: fuentesDePrueba("F2") },
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

  it("la tira pide la variante chica, no la del visor ampliado", async () => {
    // **El mayor ahorro de toda la aplicacion.** La miniatura mide 100 x 100 px
    // y antes descargaba la fotografia original completa. `MediaThumbnailGallery`
    // parsea el `srcSet` y elige la primera candidata de mas de 100w.
    await act(async () => {
      context.root.render(
        <GaleriaPublica
          titulo="Nissan NP300 2019"
          fotografias={[{ fotoId: "F1", fuentes: fuentesDePrueba("F1") }]}
          diccionario={obtenerDiccionario("es")}
        />,
      );
    });
    const imagen = context.container.querySelector("img");
    expect(imagen?.getAttribute("src")).toBe("https://cdn/F1-min.webp?firma");
    // **Eden resuelve el `srcSet` el mismo y no lo reenvia a la miniatura**:
    // `getThumbnailImage` elige la primera candidata de mas de 100w y le pasa
    // solo `{src, alt}`. Por eso el atributo no llega al DOM de la tira, y por
    // eso basta con que la candidata mas chica sea la de 480 para que la
    // miniatura deje de bajar la fotografia grande.
    expect(imagen?.getAttribute("srcset")).toBeNull();
  });

  it("una fotografia con una sola variante no emite srcSet", async () => {
    // **Regresion de una trampa de Eden.** Con un `srcSet` de una sola
    // candidata, `getThumbnailImage` devuelve `{src, size}` sin `alt`, la
    // imagen queda `role="presentation"` y el boton que la envuelve se queda
    // sin nombre accesible: axe lo marca como `button-name`. Ocurre de verdad,
    // porque la normalizacion no agranda y un original chico produce tres
    // variantes del mismo ancho.
    await act(async () => {
      context.root.render(
        <GaleriaPublica
          titulo="Nissan NP300 2019"
          fotografias={[{ fotoId: "F1", fuentes: fuentesDePrueba("F1", 1) }]}
          diccionario={obtenerDiccionario("es")}
        />,
      );
    });

    const imagen = context.container.querySelector("img");
    expect(imagen?.getAttribute("srcset")).toBeNull();
    // Y conserva su nombre accesible, que es lo que la trampa se llevaba.
    expect(imagen?.getAttribute("alt")).toBe("Nissan NP300 2019");
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
              fuentes: fuentesDePrueba("F1"),
              descripcion: "Frente",
            },
            {
              fotoId: "F2",
              fuentes: fuentesDePrueba("F2"),
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
          fotografias={[{ fotoId: "F1", fuentes: fuentesDePrueba("F1") }]}
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

  it("el visor ampliado si recibe el srcSet completo", async () => {
    // La otra mitad del reparto: la tira se queda con una candidata ya elegida
    // por Eden, y el visor recibe el hijo completo, asi que ahi el navegador si
    // puede subir a la variante grande. Es lo que permite que la miniatura sea
    // barata **sin** que el zoom se vea borroso.
    await act(async () => {
      context.root.render(
        <GaleriaPublica
          titulo="Nissan NP300 2019"
          fotografias={[{ fotoId: "F1", fuentes: fuentesDePrueba("F1") }]}
          diccionario={obtenerDiccionario("es")}
        />,
      );
    });

    await act(async () => {
      context.container
        .querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const conSrcSet = [...context.container.querySelectorAll("img")].find(
      (imagen) => imagen.getAttribute("srcset"),
    );
    expect(conSrcSet?.getAttribute("srcset")).toContain("2048w");
    expect(conSrcSet?.getAttribute("sizes")).toBe("100vw");
  });
});
