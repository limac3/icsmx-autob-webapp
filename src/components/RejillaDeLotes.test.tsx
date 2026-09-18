import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import { fuentesDePrueba } from "@/utils/fotografiaDePrueba";
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
  rutaBase: "/convocatorias/CONV1",
  lotes: [
    lote("L1"),
    lote("L2", { fotografiaPrincipal: fuentesDePrueba("F1") }),
  ],
  diccionario: obtenerDiccionario("es"),
  idioma: "es",
});

describe("RejillaDeLotes", () => {
  it("muestra el mensaje vacio si no hay lotes", async () => {
    await act(async () => {
      context.root.render(
        <RejillaDeLotes
          rutaBase="/convocatorias/CONV1"
          lotes={[]}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
    // Se afirma contra la clave y no contra el texto: el literal que habia
    // aqui era el del **listado de convocatorias**, y fijaba un mensaje que
    // contestaba otra pregunta. Con la clave, cambiar la redaccion no rompe
    // la prueba y cambiar de mensaje si.
    const diccionario = obtenerDiccionario("es");
    expect(context.container.textContent).toContain(
      diccionario.catalogo.sinLotes,
    );
    expect(context.container.textContent).not.toContain(
      diccionario.catalogo.sinResultados,
    );
  });

  it("enlaza cada tarjeta al detalle del lote", async () => {
    await act(async () => {
      context.root.render(
        <RejillaDeLotes
          rutaBase="/convocatorias/CONV1"
          lotes={[lote("L1")]}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
    const enlace = context.container.querySelector("a");
    expect(enlace?.getAttribute("href")).toBe("/convocatorias/CONV1/lotes/L1");
  });

  it("enlaza dentro de la vista previa cuando se mira desde ella", async () => {
    // Es el defecto que obligo a cambiar la prop: con el identificador de la
    // convocatoria, la vista previa administrativa mandaba al detalle publico
    // del vehiculo, que le responde 404 a quien administra (R-01, R-02).
    await act(async () => {
      context.root.render(
        <RejillaDeLotes
          rutaBase="/admin/convocatorias/CONV1/vista-publica"
          lotes={[lote("L1")]}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
    expect(context.container.querySelector("a")?.getAttribute("href")).toBe(
      "/admin/convocatorias/CONV1/vista-publica/lotes/L1",
    );
  });

  it("muestra la cantidad en fila, nunca identidades", async () => {
    await act(async () => {
      context.root.render(
        <RejillaDeLotes
          rutaBase="/convocatorias/CONV1"
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
          rutaBase="/convocatorias/CONV1"
          lotes={[lote("L1", { precio: 185_000 })]}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
    expect(context.container.textContent).toContain("185,000");
  });
});

describe("peso de las fotografias", () => {
  const conFoto = (cuantos: number, variantes = 3) =>
    Array.from({ length: cuantos }, (_, indice) =>
      lote(`L${String(indice + 1)}`, {
        fotografiaPrincipal: fuentesDePrueba(
          `F${String(indice + 1)}`,
          variantes,
        ),
      }),
    );

  const pintar = async (lotes: readonly LoteEnCatalogo[]) => {
    await act(async () => {
      context.root.render(
        <RejillaDeLotes
          rutaBase="/convocatorias/CONV1"
          lotes={lotes}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
  };

  const imagenes = () => [...context.container.querySelectorAll("img")];

  it("ofrece candidatas con su descriptor y el sizes de esta rejilla", async () => {
    await pintar(conFoto(1));

    const imagen = imagenes()[0];
    expect(imagen?.getAttribute("srcset")).toContain("480w");
    // El `sizes` traduce las container queries de `eden-grid` a viewport. Se
    // fija la cadena completa para que cambiarla se vea en el diff: si el
    // padding de la envoltura cambia, esto miente y ninguna otra prueba lo
    // detecta.
    expect(imagen?.getAttribute("sizes")).toBe(
      "(min-width: 1584px) 480px, " +
        "(min-width: 936px) calc((100vw - 96px) / 3 - 16px), " +
        "(min-width: 561px) calc((100vw - 96px) / 2 - 12px), " +
        "calc(100vw - 80px)",
    );
  });

  it("reserva el hueco con width y height, contra el salto de maquetacion", async () => {
    await pintar(conFoto(1));

    const imagen = imagenes()[0];
    expect(imagen?.getAttribute("width")).toBeTruthy();
    expect(imagen?.getAttribute("height")).toBeTruthy();
  });

  it("las tres primeras cargan con prioridad y el resto diferido", async () => {
    // El LCP de esta pantalla es la primera fotografia, y estaba marcada
    // `lazy`: el navegador la posterga hasta despues del layout y con prioridad
    // baja. Es el antipatron conocido, y solo se ve en una pantalla real.
    await pintar(conFoto(4));

    const cargas = imagenes().map((imagen) => imagen.getAttribute("loading"));
    expect(cargas).toEqual(["eager", "eager", "eager", "lazy"]);
    expect(imagenes()[0]?.getAttribute("fetchpriority")).toBe("high");
    expect(imagenes()[3]?.getAttribute("fetchpriority")).toBeNull();
  });

  it("con una sola variante no emite srcSet ni sizes", async () => {
    // La normalizacion no agranda, asi que un original chico colapsa las tres
    // variantes en una. Emitir un `srcSet` de una entrada no aporta nada y en
    // la galeria de Eden le quita el `alt` a la miniatura.
    await pintar(conFoto(1, 1));

    const imagen = imagenes()[0];
    expect(imagen?.getAttribute("srcset")).toBeNull();
    expect(imagen?.getAttribute("sizes")).toBeNull();
    expect(imagen?.getAttribute("src")).toBeTruthy();
  });

  it("un lote sin fotografia no pinta una imagen rota", async () => {
    await pintar([lote("L1")]);

    expect(imagenes()).toHaveLength(0);
    expect(context.container.textContent).toContain("fotografías");
  });
});
