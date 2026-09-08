import { describe, expect, it } from "vitest";
import type { EventoDTO } from "@/types/auditoria";
import { reconstruirHistoriaDeFila } from "./reconstruccionDeFila";

const evento = (
  parcial: Partial<EventoDTO> & { tipo: EventoDTO["tipo"] },
): EventoDTO => ({
  eventoId: "E",
  ocurridoEn: "2026-10-06T10:00:00.000Z",
  actorTipo: "SISTEMA",
  actorId: "SISTEMA",
  correlacionId: "COR",
  ...parcial,
});

describe("reconstruirHistoriaDeFila", () => {
  it("agrupa por turno, ordenado de menor a mayor", () => {
    const dto = reconstruirHistoriaDeFila("L1", [
      evento({ tipo: "SOLICITUD_CREADA", datos: { turno: 2 } }),
      evento({ tipo: "SOLICITUD_CREADA", datos: { turno: 1 } }),
    ]);

    expect(dto.solicitudes.map((s) => s.turno)).toEqual([1, 2]);
  });

  it("toma participanteId del actorId de SOLICITUD_CREADA", () => {
    const dto = reconstruirHistoriaDeFila("L1", [
      evento({
        tipo: "SOLICITUD_CREADA",
        actorTipo: "USUARIO",
        actorId: "P9",
        datos: { turno: 1 },
      }),
      evento({ tipo: "LOTE_ADJUDICADO", datos: { turno: 1 } }),
    ]);

    expect(dto.solicitudes[0]).toMatchObject({
      turno: 1,
      participanteId: "P9",
    });
    expect(dto.solicitudes[0]?.eventos).toHaveLength(2);
  });

  it("un evento sin turno (FILA_AGOTADA) va en eventosDelLote, no en ninguna solicitud", () => {
    const dto = reconstruirHistoriaDeFila("L1", [
      evento({ tipo: "SOLICITUD_CREADA", datos: { turno: 1 } }),
      evento({ tipo: "FILA_AGOTADA", datos: { turnosRevisados: 3 } }),
    ]);

    expect(dto.solicitudes).toHaveLength(1);
    expect(dto.eventosDelLote).toHaveLength(1);
    expect(dto.eventosDelLote[0]?.tipo).toBe("FILA_AGOTADA");
  });

  it("un evento de tesoreria se agrupa con el turno que mapeo.ts ya completo", () => {
    // `PAGO_AVALADO` no lleva `datos.turno` en la bitacora real; lo completa
    // `src/lib/auditoria/mapeo.ts` antes de que el DTO llegue aqui (P-2: el
    // dominio no deriva nada de `solicitudId`, que es una codificacion de la
    // capa de datos). Esta prueba construye el DTO a mano, ya completado.
    const dto = reconstruirHistoriaDeFila("L1", [
      evento({
        tipo: "SOLICITUD_CREADA",
        actorTipo: "USUARIO",
        actorId: "P1",
        solicitudId: "L1-1",
        datos: { turno: 1 },
      }),
      evento({
        tipo: "PAGO_AVALADO",
        solicitudId: "L1-1",
        datos: { turno: 1 },
      }),
    ]);

    expect(dto.solicitudes).toHaveLength(1);
    expect(dto.solicitudes[0]?.eventos.map((e) => e.tipo)).toEqual([
      "SOLICITUD_CREADA",
      "PAGO_AVALADO",
    ]);
  });

  it("sin ningun SOLICITUD_CREADA visible, participanteId queda vacio en vez de inventarse", () => {
    const dto = reconstruirHistoriaDeFila("L1", [
      evento({
        tipo: "SOLICITUD_OMITIDA",
        datos: { turno: 1, razonOmision: "ADJUDICACION_ACTIVA" },
      }),
    ]);

    expect(dto.solicitudes[0]).toMatchObject({ turno: 1, participanteId: "" });
  });

  it("sin eventos, devuelve listas vacias", () => {
    expect(reconstruirHistoriaDeFila("L1", [])).toEqual({
      loteId: "L1",
      solicitudes: [],
      eventosDelLote: [],
    });
  });
});
