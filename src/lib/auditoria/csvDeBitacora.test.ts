import { describe, expect, it } from "vitest";
import type { EventoDTO } from "@/types/auditoria";
import { csvDeBitacora } from "./csvDeBitacora";

const evento: EventoDTO = {
  eventoId: "E1",
  tipo: "SOLICITUD_CREADA",
  ocurridoEn: "2026-10-06T10:00:00.000Z",
  actorTipo: "USUARIO",
  actorId: "P1",
  correlacionId: "COR1",
  loteId: "L1",
  datos: { turno: 1 },
};

describe("csvDeBitacora", () => {
  it("sin eventos, solo el encabezado", () => {
    expect(csvDeBitacora([])).toBe(
      "eventoId,tipo,ocurridoEn,actorTipo,actorId,correlacionId,vehiculoId,convocatoriaId,loteId,solicitudId,estadoAnterior,estadoNuevo,motivo,datos",
    );
  });

  it("serializa datos como JSON", () => {
    const [, fila] = csvDeBitacora([evento]).split("\r\n");
    expect(fila).toContain('"{""turno"":1}"');
  });

  it("un motivo con coma queda entre comillas", () => {
    const [, fila] = csvDeBitacora([
      { ...evento, motivo: "rechazado, sin razon" },
    ]).split("\r\n");
    expect(fila).toContain('"rechazado, sin razon"');
  });

  it('un campo ausente queda vacio, no "undefined"', () => {
    const [, fila] = csvDeBitacora([evento]).split("\r\n");
    expect(fila).not.toContain("undefined");
  });

  it("tipo y valores crudos, no traducidos", () => {
    const [, fila] = csvDeBitacora([evento]).split("\r\n");
    expect(fila).toContain("SOLICITUD_CREADA");
  });
});
