import { act } from "react";
import { describe, expect, it } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import MenuDeUsuario from "./MenuDeUsuario";

const context = getTestContext();

const diccionario = obtenerDiccionario("es");
const etiquetas = diccionario.navegacion;

const propsBase = {
  nombre: "Ana Alcantara" as string | null,
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

  it("al abrirlo muestra solo los accesos fijos de la cuenta", async () => {
    // Los enlaces que dependen de permisos ya no viven aqui, sino en
    // `NavegacionPrincipal`: este menu es solo la cuenta.
    await renderizar();
    await abrir();

    expect(disparador()?.getAttribute("aria-expanded")).toBe("true");
    expect(hrefs()).toEqual(["/sesion", "/auth/logout"]);
  });

  it("el panel se nombra como menu de cuenta, distinto del de secciones", async () => {
    // Dos landmarks de navegacion con el mismo nombre accesible no se
    // distinguirian con un lector de pantalla, y desde que las secciones
    // salieron de aqui son dos.
    await renderizar();
    await abrir();

    const navegacion = context.container.querySelector("nav");
    expect(navegacion?.getAttribute("aria-label")).toBe(etiquetas.menuCuenta);
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
