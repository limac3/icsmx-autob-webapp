import { describe, expect, it } from "vitest";
import type { EventoDTO } from "@/types/auditoria";
import { turnoDelEvento } from "./turnoDeEvento";

const base: EventoDTO = {
  eventoId: "E1",
  tipo: "SOLICITUD_CREADA",
  ocurridoEn: "2026-10-06T10:00:00.000Z",
  actorTipo: "USUARIO",
  actorId: "P1",
  correlacionId: "COR1",
};

describe("turnoDelEvento", () => {
  it("lo lee de datos.turno cuando esta presente", () => {
    expect(turnoDelEvento({ ...base, datos: { turno: 3 } })).toBe(3);
  });

  it("sin datos.turno no hay turno (FILA_AGOTADA, o un evento sin completar por mapeo.ts)", () => {
    expect(turnoDelEvento({ ...base, tipo: "FILA_AGOTADA" })).toBeUndefined();
  });

  it("un datos.turno que no es numero se ignora en vez de fallar", () => {
    expect(
      turnoDelEvento({ ...base, datos: { turno: "no-es-numero" } }),
    ).toBeUndefined();
  });
});
