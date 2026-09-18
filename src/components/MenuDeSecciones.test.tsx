import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import type { EnlaceDeMenu } from "@/types/navegacion";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import MenuDeSecciones from "./MenuDeSecciones";

// `next/link` precarga por interseccion y aterriza fuera del `act` de la
// prueba (mismo motivo que en `BandejaDeAdjudicacion.test.tsx`).
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    onClick,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
  }) => (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));

const context = getTestContext();

const diccionario = obtenerDiccionario("es");
const etiquetas = diccionario.navegacion;

const enlaces: EnlaceDeMenu[] = [
  { href: "/convocatorias", etiqueta: etiquetas.convocatorias },
  { href: "/auditoria", etiqueta: etiquetas.auditoria },
  { href: "/tesoreria/verificacion", etiqueta: etiquetas.tesoreria },
];

genericTests(context, MenuDeSecciones, { enlaces, diccionario });

const pintar = async (lista: readonly EnlaceDeMenu[]) => {
  await act(async () => {
    context.root.render(
      <MenuDeSecciones enlaces={lista} diccionario={diccionario} />,
    );
  });
};

const disparador = () =>
  context.container.querySelector<HTMLButtonElement>("button[aria-expanded]");

const abrir = async () => {
  await act(async () => {
    disparador()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const hrefs = () =>
  [...context.container.querySelectorAll("a")].map((enlace) =>
    enlace.getAttribute("href"),
  );

describe("MenuDeSecciones", () => {
  it("sin enlaces no dibuja nada", async () => {
    await pintar([]);

    expect(context.container.textContent).toBe("");
  });

  it("con un solo enlace lo muestra suelto: no hay nada que colapsar", async () => {
    await pintar([enlaces[0]!]);

    expect(hrefs()).toEqual(["/convocatorias"]);
    expect(disparador()).toBeNull();
  });

  it("con varios, colapsado muestra el primero como vista previa, sin navegar", async () => {
    await pintar(enlaces);

    expect(disparador()?.getAttribute("aria-expanded")).toBe("false");
    expect(disparador()?.textContent).toContain(etiquetas.convocatorias);
    // La vista previa no es un enlace: el clic abre el menu.
    expect(disparador()?.querySelector("a")).toBeNull();
  });

  it("al expandirlo aparecen todas las opciones, incluida la primera", async () => {
    await pintar(enlaces);
    await abrir();

    expect(disparador()?.getAttribute("aria-expanded")).toBe("true");
    expect(hrefs()).toEqual([
      "/convocatorias",
      "/auditoria",
      "/tesoreria/verificacion",
    ]);
  });

  it("se despliega como lista vertical, no como fila", async () => {
    // El defecto que motivo este componente: colapsada en un `<details>`, la
    // fila horizontal se expandia hacia los lados y se salia de la pantalla.
    await pintar(enlaces);
    await abrir();

    const elementos = context.container.querySelectorAll(
      ".menu-secciones__lista > li",
    );
    expect(elementos).toHaveLength(3);
    for (const elemento of elementos) {
      const enlace = elemento.querySelector(".menu-secciones__enlace");
      expect(enlace).not.toBeNull();
    }
  });

  it("el panel es una region de navegacion con nombre accesible", async () => {
    await pintar(enlaces);
    await abrir();

    const navegacion = context.container.querySelector("nav");
    expect(navegacion?.getAttribute("aria-label")).toBe(etiquetas.menu);
  });

  it("cierra con Escape", async () => {
    await pintar(enlaces);
    await abrir();
    expect(disparador()?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      disparador()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(disparador()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("cierra al elegir una seccion", async () => {
    await pintar(enlaces);
    await abrir();

    await act(async () => {
      context.container
        .querySelector<HTMLAnchorElement>('a[href="/auditoria"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(disparador()?.getAttribute("aria-expanded")).toBe("false");
  });
});
