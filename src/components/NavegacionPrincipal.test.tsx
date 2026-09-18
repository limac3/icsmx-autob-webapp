import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import type { EnlaceDeMenu } from "@/types/navegacion";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import NavegacionPrincipal from "./NavegacionPrincipal";

// `next/link` precarga por interseccion y aterriza fuera del `act` de la
// prueba (mismo motivo que en `BandejaDeAdjudicacion.test.tsx`).
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
const etiquetas = diccionario.navegacion;

const enlaces: EnlaceDeMenu[] = [
  { href: "/convocatorias", etiqueta: etiquetas.convocatorias },
  { href: "/tesoreria/verificacion", etiqueta: etiquetas.tesoreria },
];

genericTests(context, NavegacionPrincipal, { enlaces, diccionario });

const pintar = async (props: { enlaces: readonly EnlaceDeMenu[] }) => {
  await act(async () => {
    context.root.render(
      <NavegacionPrincipal enlaces={props.enlaces} diccionario={diccionario} />,
    );
  });
};

const hrefsDe = (contenedor: Element | null) =>
  [...(contenedor?.querySelectorAll("a") ?? [])].map((enlace) =>
    enlace.getAttribute("href"),
  );

describe("NavegacionPrincipal", () => {
  it("dice cuando no hay ningun acceso, en vez de una barra vacia", async () => {
    // Una sesion autenticada sin permisos es un caso real y distinto de un
    // EAS caido (`session.ts`).
    await pintar({ enlaces: [] });

    expect(context.container.textContent).toContain(etiquetas.sinAccesos);
    expect(context.container.querySelector("a")).toBeNull();
  });

  it("la variante ancha muestra todos los enlaces, siempre navegables", async () => {
    await pintar({ enlaces });

    const ancha = context.container.querySelector(
      ".navegacion-principal__ancha",
    );
    expect(hrefsDe(ancha)).toEqual([
      "/convocatorias",
      "/tesoreria/verificacion",
    ]);
  });

  it("la variante ancha es una region de navegacion con nombre accesible", async () => {
    await pintar({ enlaces });

    const navegacion = context.container.querySelector(
      ".navegacion-principal__ancha",
    );
    expect(navegacion?.tagName).toBe("NAV");
    expect(navegacion?.getAttribute("aria-label")).toBe(etiquetas.menu);
  });

  it("la variante angosta delega en el desplegable, no repite la fila", async () => {
    // La fila horizontal no cabe en un telefono: al expandirse hacia los
    // lados empujaba el nombre de usuario fuera de la pantalla.
    await pintar({ enlaces });

    const angosta = context.container.querySelector(
      ".navegacion-principal__angosta",
    );
    expect(angosta?.querySelector("button[aria-expanded]")).not.toBeNull();
    // Colapsada no ofrece enlaces: hay que expandirla.
    expect(hrefsDe(angosta)).toEqual([]);
  });

  it("con un solo enlace la variante angosta lo muestra suelto y navegable", async () => {
    await pintar({ enlaces: [enlaces[0]!] });

    const angosta = context.container.querySelector(
      ".navegacion-principal__angosta",
    );
    expect(hrefsDe(angosta)).toEqual(["/convocatorias"]);
    expect(angosta?.querySelector("button[aria-expanded]")).toBeNull();
  });
});
