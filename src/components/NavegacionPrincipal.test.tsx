import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import NavegacionPrincipal, { type EnlaceDeMenu } from "./NavegacionPrincipal";

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

  it("con un solo enlace, la variante angosta lo muestra suelto y navegable", async () => {
    await pintar({ enlaces: [enlaces[0]!] });

    const angosta = context.container.querySelector(
      ".navegacion-principal__angosta",
    );
    expect(hrefsDe(angosta)).toEqual(["/convocatorias"]);
    // Sin `<details>`: envolver un unico enlace no ahorra nada.
    expect(angosta?.querySelector("details")).toBeNull();
  });

  it("con mas de un enlace, la variante angosta los colapsa en un detalle", async () => {
    await pintar({ enlaces });

    const angosta = context.container.querySelector(
      ".navegacion-principal__angosta",
    );
    const detalle = angosta?.querySelector("details");
    expect(detalle).not.toBeNull();
    // El resumen es solo vista previa: no hay enlace navegable antes de
    // expandir, ni siquiera al primero.
    expect(detalle?.querySelector("summary")?.textContent).toContain(
      etiquetas.convocatorias,
    );
    expect(detalle?.querySelector("summary a")).toBeNull();
    // Expandido, las dos opciones son navegables.
    expect(hrefsDe(detalle ?? null)).toEqual([
      "/convocatorias",
      "/tesoreria/verificacion",
    ]);
  });

  it("es una region de navegacion con nombre accesible", async () => {
    await pintar({ enlaces });

    const navegacion = context.container.querySelector("nav");
    expect(navegacion?.getAttribute("aria-label")).toBe(etiquetas.menu);
  });
});
