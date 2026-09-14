import { describe, expect, it } from "vitest";
import { momentoDeVistaPrevia } from "./vistaPrevia";

const AHORA = new Date("2026-09-14T15:00:00.000Z");

describe("momentoDeVistaPrevia", () => {
  it("un borrador que publica manana se mira desde su publicacion", () => {
    // Es el caso que existe para arreglar: con `ahora`, la fase seria
    // `NO_VISIBLE` y `calcularEstadoDeVentaUi` la mostraria como venta
    // cerrada.
    const publicadaEn = new Date("2026-09-15T15:00:00.000Z");

    expect(
      momentoDeVistaPrevia({ estatus: "BORRADOR", publicadaEn }, AHORA),
    ).toEqual({ momento: publicadaEn, aunNoVisible: true });
  });

  it("una publicada y ya visible se mira en el presente", () => {
    const publicadaEn = new Date("2026-09-01T15:00:00.000Z");

    expect(
      momentoDeVistaPrevia({ estatus: "PUBLICADA", publicadaEn }, AHORA),
    ).toEqual({ momento: AHORA, aunNoVisible: false });
  });

  it("publicada con fecha futura todavia no la ve nadie", () => {
    // El estatus ya es `PUBLICADA` pero `publicadaEn` no ha llegado: la
    // segunda condicion del gating triple.
    const publicadaEn = new Date("2026-09-20T15:00:00.000Z");

    expect(
      momentoDeVistaPrevia({ estatus: "PUBLICADA", publicadaEn }, AHORA),
    ).toEqual({ momento: publicadaEn, aunNoVisible: true });
  });

  it("una oculta con publicacion pasada no adelanta el reloj", () => {
    // Adelantarse al pasado no significa nada: se mira ahora, y el aviso
    // dice que hoy no la ve nadie.
    const publicadaEn = new Date("2026-09-01T15:00:00.000Z");

    expect(
      momentoDeVistaPrevia({ estatus: "OCULTA", publicadaEn }, AHORA),
    ).toEqual({ momento: AHORA, aunNoVisible: true });
  });

  it("una concluida se mira en el presente, como la vio el participante", () => {
    const publicadaEn = new Date("2026-08-01T15:00:00.000Z");

    expect(
      momentoDeVistaPrevia({ estatus: "CONCLUIDA", publicadaEn }, AHORA)
        .momento,
    ).toBe(AHORA);
  });
});
