import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import BarraDeIdentidadSimulada, {
  type PersonaEnBarra,
} from "./BarraDeIdentidadSimulada";

const context = getTestContext();

const diccionario = obtenerDiccionario("es");

const personas: PersonaEnBarra[] = [
  {
    id: "admin",
    nombre: "Ana Alcantara",
    permisos: [
      "Autob_Administrar_Vehiculos",
      "Autob_Administrar_Convocatorias",
    ],
  },
  {
    id: "aprobador",
    nombre: "Beto Berrones",
    permisos: ["Autob_Aprobar_Convocatorias"],
  },
  { id: "sinNada", nombre: "Zoe Zapata", permisos: [] },
];

const propsBase = {
  personas,
  idActivo: "aprobador" as string | null,
  nombreVigente: "Beto Berrones",
  oktaSub: "okta|real",
  accion: vi.fn(),
  diccionario,
};

genericTests(context, BarraDeIdentidadSimulada, propsBase);

const renderizar = async (props: Partial<typeof propsBase> = {}) => {
  await act(async () => {
    context.root.render(<BarraDeIdentidadSimulada {...propsBase} {...props} />);
  });
};

const botones = () => [
  ...context.container.querySelectorAll("button[name='persona']"),
];

describe("BarraDeIdentidadSimulada", () => {
  it("ofrece un boton de envio por persona, con su id como value", async () => {
    await renderizar();
    expect(botones().map((boton) => boton.getAttribute("value"))).toEqual([
      "admin",
      "aprobador",
      "sinNada",
      // El ultimo, con value vacio, es el de dejar de simular.
      "",
    ]);
  });

  it("marca la persona vigente con aria-pressed y no las demas", async () => {
    await renderizar();
    const presionados = botones()
      .filter((boton) => boton.getAttribute("aria-pressed") === "true")
      .map((boton) => boton.getAttribute("value"));
    expect(presionados).toEqual(["aprobador"]);
  });

  it("describe a cada persona con etiquetas de permiso, no con ENUMs crudos (regla 11)", async () => {
    await renderizar();
    const texto = context.container.textContent ?? "";

    expect(texto).toContain(diccionario.permisos.Autob_Aprobar_Convocatorias);
    expect(texto).toContain(diccionario.permisos.Autob_Administrar_Vehiculos);
    expect(texto).not.toContain("Autob_Aprobar_Convocatorias");
    expect(texto).not.toContain("APROBADOR_CONVOCATORIA");
  });

  it("una persona sin permisos se describe igual, sin quedar en blanco", async () => {
    await renderizar();
    expect(context.container.textContent).toContain(
      diccionario.desarrollo.sinPermisos,
    );
  });

  it("muestra el sub real de Okta, para no confundirlo con la identidad simulada", async () => {
    await renderizar();
    expect(context.container.textContent).toContain("okta|real");
    expect(context.container.textContent).toContain(
      diccionario.desarrollo.sesionRealDeOkta,
    );
  });

  it("sin persona elegida lo dice y no ofrece el boton de dejar de simular", async () => {
    await renderizar({ idActivo: null });

    expect(context.container.textContent).toContain(
      diccionario.desarrollo.sinSimular,
    );
    expect(botones().map((boton) => boton.getAttribute("value"))).toEqual([
      "admin",
      "aprobador",
      "sinNada",
    ]);
  });

  it("con persona elegida muestra su nombre en el resumen colapsado", async () => {
    await renderizar();
    const resumen = context.container.querySelector("summary");
    expect(resumen?.textContent).toContain("Beto Berrones");
    expect(resumen?.textContent).toContain(diccionario.desarrollo.insignia);
  });

  it("todos los botones envian el mismo formulario: funciona sin JavaScript de cliente", async () => {
    await renderizar();
    const formulario = context.container.querySelector("form");
    expect(formulario).toBeTruthy();
    for (const boton of botones()) {
      expect(boton.getAttribute("type")).toBe("submit");
      expect(boton.closest("form")).toBe(formulario);
    }
  });
});
