import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import GuiaDeInicio, { type GuiaDeInicioProps } from "./GuiaDeInicio";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const diccionario = obtenerDiccionario("es");

const props: GuiaDeInicioProps = {
  bloques: [
    { id: "comprar", href: "/convocatorias" },
    { id: "pagar", href: "/mis-solicitudes" },
  ],
  diccionario,
};

const context = getTestContext();

genericTests(context, GuiaDeInicio, props);

describe("GuiaDeInicio", () => {
  const pintar = async (extra: Partial<GuiaDeInicioProps> = {}) => {
    await act(async () => {
      context.root.render(<GuiaDeInicio {...props} {...extra} />);
    });
    return context.container;
  };

  it("pinta un desplegable por bloque, con sus pasos", async () => {
    const contenedor = await pintar();
    const texto = contenedor.textContent ?? "";

    expect(contenedor.querySelectorAll("details")).toHaveLength(2);
    expect(texto).toContain(diccionario.inicio.bloques.comprar.titulo);
    expect(texto).toContain(diccionario.inicio.bloques.pagar.titulo);
    for (const paso of diccionario.inicio.bloques.comprar.pasos) {
      expect(texto).toContain(paso);
    }
  });

  it("abre el primero y deja cerrados los demas", async () => {
    // Con todos abiertos la pantalla es un muro de texto y deja de leerse;
    // con todos cerrados nadie sabe que hay dentro.
    const detalles = Array.from((await pintar()).querySelectorAll("details"));

    expect(detalles.map((detalle) => detalle.open)).toEqual([true, false]);
  });

  it("los pasos van en una lista ordenada, porque el orden es el contenido", async () => {
    const contenedor = await pintar();
    const lista = contenedor.querySelector("ol.guia-inicio__pasos");

    expect(lista).not.toBeNull();
    expect(lista?.querySelectorAll("li")).toHaveLength(
      diccionario.inicio.bloques.comprar.pasos.length,
    );
  });

  it("cada bloque lleva a donde se hace lo que explica", async () => {
    const enlaces = Array.from((await pintar()).querySelectorAll("a")).map(
      (enlace) => enlace.getAttribute("href"),
    );

    expect(enlaces).toEqual(["/convocatorias", "/mis-solicitudes"]);
  });

  it("sin bloques no dibuja nada, ni siquiera el encabezado", async () => {
    // El aviso de "sin accesos" lo pone la pagina: es la unica que distingue
    // una sesion sin permisos de una visita sin sesion.
    const contenedor = await pintar({ bloques: [] });

    expect(contenedor.textContent).toBe("");
  });

  it("ningun desplegable se encabeza con el identificador del bloque (regla 11)", async () => {
    const titulos = Array.from(
      (await pintar()).querySelectorAll("summary"),
    ).map((resumen) => resumen.textContent);

    expect(titulos).toEqual([
      diccionario.inicio.bloques.comprar.titulo,
      diccionario.inicio.bloques.pagar.titulo,
    ]);
    for (const bloque of props.bloques) {
      expect(titulos).not.toContain(bloque.id);
    }
  });
});
