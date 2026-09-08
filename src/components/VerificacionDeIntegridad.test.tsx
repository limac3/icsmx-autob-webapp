import { act } from "react";
import { describe, expect, it } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import type { ComprobacionDeIntegridad } from "@/types/auditoria";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import VerificacionDeIntegridad from "./VerificacionDeIntegridad";

const context = getTestContext();
const diccionario = obtenerDiccionario("es");

const CUMPLE: ComprobacionDeIntegridad[] = [
  { clave: "turnosContiguos", veredicto: "cumple", huecos: [], duplicados: [] },
  {
    clave: "ordenDeAdjudicacion",
    veredicto: "cumple",
    saltosSinJustificar: [],
  },
  { clave: "unaAdjudicacionVigente", veredicto: "cumple", conflictos: [] },
  {
    clave: "vencimientosConTiempo",
    veredicto: "cumple",
    turnosConFechaInconsistente: [],
  },
  {
    clave: "transicionesConEvento",
    veredicto: "cumple",
    turnosSinExplicar: [],
  },
  { clave: "motivosObligatorios", veredicto: "cumple", eventosSinMotivo: [] },
];

genericTests(context, VerificacionDeIntegridad, {
  comprobaciones: CUMPLE,
  diccionario,
});

const pintar = async (comprobaciones: readonly ComprobacionDeIntegridad[]) => {
  await act(async () => {
    context.root.render(
      <VerificacionDeIntegridad
        comprobaciones={comprobaciones}
        diccionario={diccionario}
      />,
    );
  });
};

describe("VerificacionDeIntegridad", () => {
  it("muestra las seis comprobaciones con su veredicto traducido", async () => {
    await pintar(CUMPLE);

    expect(context.container.textContent).toContain(
      diccionario.auditoria.comprobaciones.turnosContiguos,
    );
    expect(context.container.textContent).toContain(
      diccionario.auditoria.veredictos.cumple,
    );
  });

  it("un hueco de turno se lista como informativo, sin alarmar", async () => {
    await pintar([
      {
        clave: "turnosContiguos",
        veredicto: "informativo",
        huecos: [2],
        duplicados: [],
      },
    ]);

    expect(context.container.textContent).toContain(
      diccionario.auditoria.veredictos.informativo,
    );
    expect(context.container.textContent).toContain("2");
  });

  it("un salto sin justificar se lista con ambos turnos", async () => {
    await pintar([
      {
        clave: "ordenDeAdjudicacion",
        veredicto: "incumple",
        saltosSinJustificar: [{ turnoSaltado: 1, turnoAdjudicado: 3 }],
      },
    ]);

    expect(context.container.textContent).toContain(
      diccionario.auditoria.veredictos.incumple,
    );
    const texto = context.container.textContent ?? "";
    expect(texto).toContain("1");
    expect(texto).toContain("3");
  });

  it("una comprobacion que cumple no lista hallazgos", async () => {
    await pintar([
      {
        clave: "motivosObligatorios",
        veredicto: "cumple",
        eventosSinMotivo: [],
      },
    ]);

    expect(context.container.textContent).not.toContain("undefined");
  });
});
