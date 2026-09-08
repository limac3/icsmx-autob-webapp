import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import BitacoraDeEventos, { type FilaDeBitacora } from "./BitacoraDeEventos";

vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
}));

const context = getTestContext();
const diccionario = obtenerDiccionario("es");

const fila = (cambios: Partial<FilaDeBitacora> = {}): FilaDeBitacora => ({
  eventoId: "E1",
  fecha: "6 oct 2026, 09:00",
  tipo: "Solicitud de compra registrada",
  actor: "Persona (P1)",
  motivo: undefined,
  correlacionId: "COR1",
  ...cambios,
});

genericTests(context, BitacoraDeEventos, {
  eventos: [fila()],
  diccionario,
});

const pintar = async (eventos: readonly FilaDeBitacora[]) => {
  await act(async () => {
    context.root.render(
      <BitacoraDeEventos eventos={eventos} diccionario={diccionario} />,
    );
  });
};

describe("BitacoraDeEventos", () => {
  it("dice que no hay eventos en vez de pintar una tabla vacia", async () => {
    await pintar([]);

    expect(context.container.textContent).toContain(
      diccionario.auditoria.sinEventos,
    );
    expect(context.container.querySelector("table")).toBeNull();
  });

  it("muestra el tipo y el actor ya traducidos", async () => {
    await pintar([
      fila({ tipo: "Vehículo adjudicado", actor: "Proceso automático" }),
    ]);

    expect(context.container.textContent).toContain("Vehículo adjudicado");
    expect(context.container.textContent).toContain("Proceso automático");
  });

  it('un motivo ausente no pinta "undefined"', async () => {
    await pintar([fila({ motivo: undefined })]);

    expect(context.container.textContent).not.toContain("undefined");
  });

  it("respeta el orden en que llegan las filas", async () => {
    await pintar([
      fila({ eventoId: "E1", fecha: "hace 2 días" }),
      fila({ eventoId: "E2", fecha: "hace 1 hora" }),
    ]);

    const filas = [...context.container.querySelectorAll("tbody tr")];
    expect(filas[0]?.textContent).toContain("hace 2 días");
    expect(filas[1]?.textContent).toContain("hace 1 hora");
  });
});
