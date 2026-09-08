import { act } from "react";
import { describe, expect, it } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import MenuDeUsuario, { type EnlaceDeMenu } from "./MenuDeUsuario";

const context = getTestContext();

const diccionario = obtenerDiccionario("es");
const etiquetas = diccionario.navegacion;

const enlaces: EnlaceDeMenu[] = [
  { href: "/convocatorias", etiqueta: etiquetas.convocatorias },
  { href: "/tesoreria/verificacion", etiqueta: etiquetas.tesoreria },
];

const propsBase = {
  nombre: "Ana Alcantara" as string | null,
  enlaces,
  diccionario,
};

genericTests(context, MenuDeUsuario, propsBase);

const renderizar = async (props: Partial<typeof propsBase> = {}) => {
  await act(async () => {
    context.root.render(<MenuDeUsuario {...propsBase} {...props} />);
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

describe("MenuDeUsuario", () => {
  it("sin sesion se reduce a un enlace de entrada, sin menu", async () => {
    await renderizar({ nombre: null });

    expect(hrefs()).toEqual(["/auth/login"]);
    expect(context.container.textContent).toContain(etiquetas.entrar);
    expect(disparador()).toBeNull();
  });

  it("con sesion muestra el nombre en el disparador, colapsado", async () => {
    await renderizar();

    expect(disparador()?.getAttribute("aria-expanded")).toBe("false");
    expect(context.container.textContent).toContain("Ana Alcantara");
  });

  it("al abrirlo aparecen los enlaces recibidos y los de la cuenta", async () => {
    await renderizar();
    await abrir();

    expect(disparador()?.getAttribute("aria-expanded")).toBe("true");
    expect(hrefs()).toEqual([
      "/convocatorias",
      "/tesoreria/verificacion",
      "/sesion",
      "/auth/logout",
    ]);
  });

  it("no inventa enlaces: solo muestra los que le pasaron", async () => {
    await renderizar({
      enlaces: [{ href: "/aprobaciones", etiqueta: etiquetas.aprobaciones }],
    });
    await abrir();

    expect(hrefs()).toEqual(["/aprobaciones", "/sesion", "/auth/logout"]);
    expect(context.container.textContent).not.toContain(
      etiquetas.convocatorias,
    );
  });

  it("con la lista vacia lo dice, y deja los enlaces de la cuenta", async () => {
    // Una sesion autenticada sin permisos es un caso real y distinto de un EAS
    // caido (`session.ts`): tiene que poder ver su sesion y salir.
    await renderizar({ enlaces: [] });
    await abrir();

    expect(context.container.textContent).toContain(etiquetas.sinAccesos);
    expect(hrefs()).toEqual(["/sesion", "/auth/logout"]);
  });

  it("el panel es una region de navegacion con nombre accesible", async () => {
    await renderizar();
    await abrir();

    const navegacion = context.container.querySelector("nav");
    expect(navegacion?.getAttribute("aria-label")).toBe(etiquetas.menu);
  });

  it("cierra con Escape", async () => {
    await renderizar();
    await abrir();
    expect(disparador()?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      disparador()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(disparador()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("cerrar sesion no pasa por el enrutador: es un <a> nativo", async () => {
    await renderizar();
    await abrir();

    const salir = [...context.container.querySelectorAll("a")].find(
      (enlace) => enlace.getAttribute("href") === "/auth/logout",
    );
    expect(salir?.textContent).toBe(etiquetas.salir);
  });
});
