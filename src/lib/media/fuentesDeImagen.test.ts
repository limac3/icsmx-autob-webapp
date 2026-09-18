// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { fuentesDeImagen } from "./fuentesDeImagen";
import { ANCHOS_DE_VARIANTE, type Fotografia } from "@/types/vehiculo";
import { fotografiaDePrueba } from "@/utils/fotografiaDePrueba";

vi.mock("server-only", () => ({}));

/** Firma de mentira, pero distinguible: deja ver que clave se firmo. */
const firmar = (claveS3: string) => `https://cdn/${claveS3}?firma`;

const foto = fotografiaDePrueba("F1", 1);

/** Una fotografia cuyas tres variantes tienen el mismo ancho. */
const fotoChica: Pick<Fotografia, "variantes"> = {
  variantes: {
    min: {
      claveS3: "vehiculos/V1/F1-min.webp",
      ancho: 400,
      alto: 300,
      bytes: 1,
    },
    med: {
      claveS3: "vehiculos/V1/F1-med.webp",
      ancho: 400,
      alto: 300,
      bytes: 1,
    },
    max: {
      claveS3: "vehiculos/V1/F1-max.webp",
      ancho: 400,
      alto: 300,
      bytes: 1,
    },
  },
};

describe("fuentesDeImagen", () => {
  it("ordena ascendente y emite el descriptor w de cada candidata", () => {
    const fuentes = fuentesDeImagen(foto, {
      anchoMaximo: ANCHOS_DE_VARIANTE.max,
      firmar,
    });

    expect(fuentes.srcSet).toBe(
      [
        "https://cdn/vehiculos/V1/F1-min.webp?firma 480w",
        "https://cdn/vehiculos/V1/F1-med.webp?firma 1280w",
        "https://cdn/vehiculos/V1/F1-max.webp?firma 2048w",
      ].join(", "),
    );
  });

  it("el src es la mas chica: el peor caso es blando, nunca pesado", () => {
    const fuentes = fuentesDeImagen(foto, {
      anchoMaximo: ANCHOS_DE_VARIANTE.max,
      firmar,
    });

    expect(fuentes.src).toBe("https://cdn/vehiculos/V1/F1-min.webp?firma");
  });

  it("ancho y alto son los de la mayor incluida, para el ratio intrinseco", () => {
    const fuentes = fuentesDeImagen(foto, {
      anchoMaximo: ANCHOS_DE_VARIANTE.med,
      firmar,
    });

    expect({ ancho: fuentes.ancho, alto: fuentes.alto }).toEqual({
      ancho: 1280,
      alto: 960,
    });
  });

  it("descarta las que pasan del tope de la pantalla", () => {
    // La rejilla del catalogo nunca llega a 2048 px CSS: ofrecerla seria peso
    // que nadie necesita.
    const fuentes = fuentesDeImagen(foto, {
      anchoMaximo: ANCHOS_DE_VARIANTE.med,
      firmar,
    });

    expect(fuentes.srcSet).not.toContain("2048w");
    expect(fuentes.srcSet).toContain("1280w");
  });

  it("nunca emite un srcSet de una sola candidata", () => {
    // **La trampa de Eden.** Con una sola candidata, `getThumbnailImage`
    // devuelve `{src, size}` sin `alt`, y el boton que envuelve la miniatura se
    // queda sin nombre accesible: axe lo marca como `button-name`.
    const fuentes = fuentesDeImagen(fotoChica, {
      anchoMaximo: ANCHOS_DE_VARIANTE.max,
      firmar,
    });

    expect(fuentes.srcSet).toBeUndefined();
    expect(fuentes.src).toBe("https://cdn/vehiculos/V1/F1-min.webp?firma");
  });

  it("con un tope por debajo de todas conserva la mas chica", () => {
    // Una imagen algo pesada es mejor que ninguna: quedarse sin `src` dejaria
    // la tarjeta en blanco.
    const fuentes = fuentesDeImagen(foto, { anchoMaximo: 100, firmar });

    expect(fuentes.src).toBe("https://cdn/vehiculos/V1/F1-min.webp?firma");
    expect(fuentes.srcSet).toBeUndefined();
    expect(fuentes.ancho).toBe(480);
  });

  it("firma cada variante exactamente una vez", () => {
    // Firmar es cripto local, no red, pero repetirlo serian bytes de mas en el
    // HTML por cada fotografia de la pantalla.
    const espia = vi.fn(firmar);
    fuentesDeImagen(foto, {
      anchoMaximo: ANCHOS_DE_VARIANTE.max,
      firmar: espia,
    });

    expect(espia).toHaveBeenCalledTimes(3);
    expect(new Set(espia.mock.calls.map(([clave]) => clave)).size).toBe(3);
  });

  it("acotado a la miniatura firma solo una vez", () => {
    const espia = vi.fn(firmar);
    fuentesDeImagen(foto, {
      anchoMaximo: ANCHOS_DE_VARIANTE.min,
      firmar: espia,
    });

    expect(espia).toHaveBeenCalledTimes(1);
  });
});
