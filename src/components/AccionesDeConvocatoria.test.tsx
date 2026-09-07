import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import AccionesDeConvocatoria from "./AccionesDeConvocatoria";

vi.mock("@/app/actions/convocatorias", () => ({
  aprobarConvocatoria: vi.fn(),
  concluirConvocatoria: vi.fn(),
  enviarAAprobacion: vi.fn(),
  ocultarConvocatoria: vi.fn(),
  publicarConvocatoria: vi.fn(),
  reactivarConvocatoria: vi.fn(),
  rechazarConvocatoria: vi.fn(),
}));

// El `FormField` del motivo arrastra `Fade`, que mide el desbordamiento con un
// `setTimeout` de 50 ms y aterriza fuera del `act` de la prueba. Misma utilidad
// hoja, mismo motivo que en las otras dos pruebas de componente.
vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
}));

const context = getTestContext();

genericTests(context, AccionesDeConvocatoria, {
  convocatoriaId: "C1",
  estatus: "EN_APROBACION",
  diccionario: obtenerDiccionario("es"),
  permisos: ["Autob_Aprobar_Convocatorias"],
});

const pintar = async (
  estatus: Parameters<typeof AccionesDeConvocatoria>[0]["estatus"],
  permisos: string[],
) => {
  await act(async () => {
    context.root.render(
      <AccionesDeConvocatoria
        convocatoriaId="C1"
        estatus={estatus}
        diccionario={obtenerDiccionario("es")}
        permisos={permisos}
      />,
    );
  });
};

const botones = () =>
  [...context.container.querySelectorAll("button")].map((boton) =>
    boton.textContent?.trim(),
  );

describe("las acciones salen de la maquina de estados", () => {
  it("desde EN_APROBACION ofrece aprobar, rechazar y ocultar", async () => {
    await pintar("EN_APROBACION", [
      "Autob_Aprobar_Convocatorias",
      "Autob_Administrar_Convocatorias",
    ]);

    expect(botones()).toEqual(
      expect.arrayContaining(["Aprobar", "Rechazar", "Ocultar"]),
    );
    // Publicar no sale de EN_APROBACION: la maquina no tiene esa transicion.
    expect(botones()).not.toContain("Publicar");
  });

  it("desde APROBADA ofrece publicar", async () => {
    await pintar("APROBADA", ["Autob_Administrar_Convocatorias"]);

    expect(botones()).toEqual(expect.arrayContaining(["Publicar", "Ocultar"]));
  });

  it("no ofrece nada desde un estado terminal", async () => {
    // CONCLUIDA no tiene salidas en la maquina.
    await pintar("CONCLUIDA", ["Autob_Administrar_Convocatorias"]);

    expect(botones()).toEqual([]);
    expect(context.container.textContent).toContain(
      "No hay acciones disponibles",
    );
  });
});

describe("se ocultan las acciones sin permiso", () => {
  it("quien solo aprueba no ve ocultar, que es de administracion", async () => {
    await pintar("EN_APROBACION", ["Autob_Aprobar_Convocatorias"]);

    expect(botones()).toEqual(expect.arrayContaining(["Aprobar", "Rechazar"]));
    expect(botones()).not.toContain("Ocultar");
  });

  it("quien solo administra no ve aprobar ni rechazar", async () => {
    // R-05 se decide en el servidor con `creadoPor`; esto es solo el permiso.
    await pintar("EN_APROBACION", ["Autob_Administrar_Convocatorias"]);

    expect(botones()).toContain("Ocultar");
    expect(botones()).not.toContain("Aprobar");
    expect(botones()).not.toContain("Rechazar");
  });
});
