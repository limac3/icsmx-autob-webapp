import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import ReconstruccionDeFila, {
  type SolicitudParaVista,
} from "./ReconstruccionDeFila";
import type { FilaDeBitacora } from "./BitacoraDeEventos";

vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
}));

const context = getTestContext();
const diccionario = obtenerDiccionario("es");

const evento = (cambios: Partial<FilaDeBitacora> = {}): FilaDeBitacora => ({
  eventoId: "E1",
  fecha: "6 oct 2026, 09:00",
  tipo: "Solicitud de compra registrada",
  actor: "Persona (P1)",
  correlacionId: "COR1",
  ...cambios,
});

const solicitud = (
  cambios: Partial<SolicitudParaVista> = {},
): SolicitudParaVista => ({
  turno: 1,
  participanteId: "P1",
  eventos: [evento()],
  ...cambios,
});

genericTests(context, ReconstruccionDeFila, {
  solicitudes: [solicitud()],
  eventosDelLote: [],
  diccionario,
});

const pintar = async (
  solicitudes: readonly SolicitudParaVista[],
  eventosDelLote: readonly FilaDeBitacora[] = [],
) => {
  await act(async () => {
    context.root.render(
      <ReconstruccionDeFila
        solicitudes={solicitudes}
        eventosDelLote={eventosDelLote}
        diccionario={diccionario}
      />,
    );
  });
};

describe("ReconstruccionDeFila", () => {
  it("sin nada que reconstruir, dice que el lote no tiene solicitudes", async () => {
    await pintar([]);

    expect(context.container.textContent).toContain(
      diccionario.auditoria.sinSolicitudes,
    );
  });

  it("muestra el participante de cada turno — es la excepcion a R-12", async () => {
    await pintar([solicitud({ turno: 3, participanteId: "P9" })]);

    expect(context.container.textContent).toContain("P9");
  });

  it("un turno con varios eventos los muestra todos en su propia bitacora", async () => {
    await pintar([
      solicitud({
        eventos: [
          evento({ eventoId: "E1", tipo: "Solicitud de compra registrada" }),
          evento({ eventoId: "E2", tipo: "Vehículo adjudicado" }),
        ],
      }),
    ]);

    expect(context.container.textContent).toContain(
      "Solicitud de compra registrada",
    );
    expect(context.container.textContent).toContain("Vehículo adjudicado");
  });

  it("los eventos del lote (FILA_AGOTADA) aparecen aparte, sin turno", async () => {
    await pintar([], [evento({ eventoId: "EX", tipo: "Fila agotada" })]);

    expect(context.container.textContent).toContain(
      diccionario.auditoria.eventosDelLote,
    );
    expect(context.container.textContent).toContain("Fila agotada");
  });
});
