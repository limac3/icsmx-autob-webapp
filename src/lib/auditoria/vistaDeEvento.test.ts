import { describe, expect, it } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import type { EventoDTO } from "@/types/auditoria";
import { aFilaDeBitacora } from "./vistaDeEvento";

const diccionario = obtenerDiccionario("es");

const evento: EventoDTO = {
  eventoId: "E1",
  tipo: "SOLICITUD_CREADA",
  ocurridoEn: "2026-10-06T16:00:00.000Z",
  actorTipo: "USUARIO",
  actorId: "P1",
  correlacionId: "COR1",
};

describe("aFilaDeBitacora", () => {
  it("traduce el tipo contra el diccionario, no lo deja crudo (regla 11)", () => {
    expect(aFilaDeBitacora(evento, diccionario).tipo).toBe(
      diccionario.tiposDeEvento.SOLICITUD_CREADA,
    );
  });

  it("un actor USUARIO se identifica con su id", () => {
    expect(aFilaDeBitacora(evento, diccionario).actor).toBe(
      `${diccionario.tiposDeActor.USUARIO} (P1)`,
    );
  });

  it("un actor SISTEMA no lleva id entre parentesis", () => {
    const fila = aFilaDeBitacora(
      { ...evento, actorTipo: "SISTEMA", actorId: "SISTEMA" },
      diccionario,
    );
    expect(fila.actor).toBe(diccionario.tiposDeActor.SISTEMA);
  });

  it("sin motivo, no lo inventa", () => {
    expect(aFilaDeBitacora(evento, diccionario).motivo).toBeUndefined();
  });

  it("conserva el correlacionId, para rastrear causalidad sin depender del orden visual", () => {
    expect(
      aFilaDeBitacora({ ...evento, correlacionId: "COR9" }, diccionario)
        .correlacionId,
    ).toBe("COR9");
  });

  it("con motivo, lo conserva", () => {
    expect(
      aFilaDeBitacora(
        { ...evento, motivo: "Comprobante ilegible" },
        diccionario,
      ).motivo,
    ).toBe("Comprobante ilegible");
  });
});
