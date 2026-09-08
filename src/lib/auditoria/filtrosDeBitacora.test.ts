import { describe, expect, it } from "vitest";
import type { EventoDTO } from "@/types/auditoria";
import { eventoCoincideConFiltros } from "./filtrosDeBitacora";

const evento: EventoDTO = {
  eventoId: "E1",
  tipo: "SOLICITUD_CREADA",
  ocurridoEn: "2026-10-06T10:00:00.000Z",
  actorTipo: "USUARIO",
  actorId: "P1",
  correlacionId: "COR1",
};

describe("eventoCoincideConFiltros", () => {
  it("sin filtros, coincide siempre", () => {
    expect(eventoCoincideConFiltros(evento, {})).toBe(true);
  });

  it("filtra por tipo", () => {
    expect(eventoCoincideConFiltros(evento, { tipo: "SOLICITUD_CREADA" })).toBe(
      true,
    );
    expect(eventoCoincideConFiltros(evento, { tipo: "LOTE_ADJUDICADO" })).toBe(
      false,
    );
  });

  it("filtra por rango de fechas, inclusivo en ambos extremos", () => {
    expect(
      eventoCoincideConFiltros(evento, {
        desde: "2026-10-06T10:00:00.000Z",
        hasta: "2026-10-06T10:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      eventoCoincideConFiltros(evento, { desde: "2026-10-06T10:00:00.001Z" }),
    ).toBe(false);
    expect(
      eventoCoincideConFiltros(evento, { hasta: "2026-10-06T09:59:59.999Z" }),
    ).toBe(false);
  });

  it('un "hasta" de solo fecha incluye el resto de ese mismo dia', () => {
    // Sin la correccion, "2026-10-06T10:00:00.000Z" > "2026-10-06" excluiria
    // por error un evento ocurrido ese mismo dia.
    expect(eventoCoincideConFiltros(evento, { hasta: "2026-10-06" })).toBe(
      true,
    );
    expect(eventoCoincideConFiltros(evento, { hasta: "2026-10-05" })).toBe(
      false,
    );
  });

  it("filtra por participante (actorId)", () => {
    expect(eventoCoincideConFiltros(evento, { participanteId: "P1" })).toBe(
      true,
    );
    expect(eventoCoincideConFiltros(evento, { participanteId: "P2" })).toBe(
      false,
    );
  });
});
