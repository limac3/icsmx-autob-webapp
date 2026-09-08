// @vitest-environment node
import { describe, expect, it } from "vitest";
import { desdeIso } from "./fechas";
import {
  calcularEstadoDeVentaUi,
  faseDeVenta,
  fechasCoherentes,
  puedeConcluirse,
  ventaAbierta,
  ventaFinalizada,
  yaPublicada,
  type VentanaDeConvocatoria,
} from "./ventanas";

const instante = (iso: string): Date => {
  const valor = desdeIso(iso);
  if (!valor) throw new Error(`literal de prueba invalido: ${iso}`);
  return valor;
};

// Una convocatoria de referencia con las tres fechas separadas, para que cada
// frontera se pueda ejercer sin que las otras interfieran.
const PUBLICADA_EN = "2026-09-10T14:00:00Z";
const INICIO_VENTA = "2026-09-15T15:00:00Z";
const FIN_VENTA = "2026-09-20T23:00:00Z";

const ventana: VentanaDeConvocatoria = {
  publicadaEn: instante(PUBLICADA_EN),
  inicioVenta: instante(INICIO_VENTA),
  finVenta: instante(FIN_VENTA),
};

/** Un milisegundo antes y despues, que es donde viven los errores. */
const unMsAntes = (iso: string) => new Date(instante(iso).getTime() - 1);
const unMsDespues = (iso: string) => new Date(instante(iso).getTime() + 1);

describe("yaPublicada — segunda pata del gating triple (R-01)", () => {
  it("es falso un milisegundo antes de publicadaEn", () => {
    expect(yaPublicada(ventana.publicadaEn, unMsAntes(PUBLICADA_EN))).toBe(
      false,
    );
  });

  it("es verdadero en el instante exacto de publicadaEn", () => {
    // Inclusivo, igual que la condicion de rango `GSI2SK <= ahora` de PA-05.
    expect(yaPublicada(ventana.publicadaEn, instante(PUBLICADA_EN))).toBe(true);
  });

  it("es verdadero un milisegundo despues", () => {
    expect(yaPublicada(ventana.publicadaEn, unMsDespues(PUBLICADA_EN))).toBe(
      true,
    );
  });
});

describe("ventaAbierta — intervalo [inicioVenta, finVenta)", () => {
  it("esta cerrada antes de inicioVenta (R-03)", () => {
    // Entre publicadaEn e inicioVenta el participante ve la convocatoria pero
    // no puede solicitar: es la ventana que da a todos la misma oportunidad de
    // prepararse.
    expect(ventaAbierta(ventana, unMsAntes(INICIO_VENTA))).toBe(false);
  });

  it("abre en el instante exacto de inicioVenta", () => {
    expect(ventaAbierta(ventana, instante(INICIO_VENTA))).toBe(true);
  });

  it("sigue abierta un milisegundo antes de finVenta", () => {
    expect(ventaAbierta(ventana, unMsAntes(FIN_VENTA))).toBe(true);
  });

  it("cierra en el instante exacto de finVenta", () => {
    // Extremo superior exclusivo: con ambos inclusivos, dos convocatorias
    // consecutivas sobre el mismo vehiculo compartirian un milisegundo en el
    // que las dos aceptan solicitudes.
    expect(ventaAbierta(ventana, instante(FIN_VENTA))).toBe(false);
  });

  it("reproduce la condicion del paso 1 de T1", () => {
    // `inicioVenta <= :ahora AND finVenta > :ahora`. Si este archivo usara
    // otra inclusividad, la UI ofreceria un boton que DynamoDB rechaza.
    const comoDynamo = (ahora: Date) =>
      ventana.inicioVenta.getTime() <= ahora.getTime() &&
      ventana.finVenta.getTime() > ahora.getTime();

    for (const ahora of [
      unMsAntes(INICIO_VENTA),
      instante(INICIO_VENTA),
      unMsDespues(INICIO_VENTA),
      unMsAntes(FIN_VENTA),
      instante(FIN_VENTA),
      unMsDespues(FIN_VENTA),
    ]) {
      expect(ventaAbierta(ventana, ahora)).toBe(comoDynamo(ahora));
    }
  });
});

describe("ventaFinalizada", () => {
  it("es falso un milisegundo antes de finVenta", () => {
    expect(ventaFinalizada(ventana.finVenta, unMsAntes(FIN_VENTA))).toBe(false);
  });

  it("es verdadero en el instante exacto de finVenta", () => {
    expect(ventaFinalizada(ventana.finVenta, instante(FIN_VENTA))).toBe(true);
  });

  it("no es la negacion de ventaAbierta antes de la apertura", () => {
    // Antes de inicioVenta la venta no esta abierta **ni** finalizada. Tratar
    // una como negacion de la otra daria por concluida una convocatoria que ni
    // siquiera abrio.
    const antesDeAbrir = unMsAntes(INICIO_VENTA);
    expect(ventaAbierta(ventana, antesDeAbrir)).toBe(false);
    expect(ventaFinalizada(ventana.finVenta, antesDeAbrir)).toBe(false);
  });
});

describe("faseDeVenta", () => {
  it.each([
    ["NO_VISIBLE", unMsAntes(PUBLICADA_EN)],
    ["PUBLICADA_SIN_ABRIR", instante(PUBLICADA_EN)],
    ["PUBLICADA_SIN_ABRIR", unMsAntes(INICIO_VENTA)],
    ["VENTA_ABIERTA", instante(INICIO_VENTA)],
    ["VENTA_ABIERTA", unMsAntes(FIN_VENTA)],
    ["VENTA_CERRADA", instante(FIN_VENTA)],
    ["VENTA_CERRADA", unMsDespues(FIN_VENTA)],
  ])("es %s en %s", (esperada, ahora) => {
    expect(faseDeVenta(ventana, ahora)).toBe(esperada);
  });

  it("las cuatro fases son exhaustivas y mutuamente excluyentes", () => {
    const momentos = [
      unMsAntes(PUBLICADA_EN),
      instante(PUBLICADA_EN),
      instante(INICIO_VENTA),
      instante(FIN_VENTA),
    ];
    const fases = momentos.map((ahora) => faseDeVenta(ventana, ahora));
    expect(new Set(fases).size).toBe(4);
  });

  it("con publicadaEn igual a inicioVenta nunca hay fase de espera", () => {
    // Una convocatoria que abre al publicarse es legitima (R-03 no la exige).
    const sinEspera: VentanaDeConvocatoria = {
      publicadaEn: instante(INICIO_VENTA),
      inicioVenta: instante(INICIO_VENTA),
      finVenta: instante(FIN_VENTA),
    };
    expect(faseDeVenta(sinEspera, unMsAntes(INICIO_VENTA))).toBe("NO_VISIBLE");
    expect(faseDeVenta(sinEspera, instante(INICIO_VENTA))).toBe(
      "VENTA_ABIERTA",
    );
  });
});

describe("calcularEstadoDeVentaUi", () => {
  it("antes de abrir, entrega los segundos restantes para la apertura", () => {
    const ahora = new Date(instante(INICIO_VENTA).getTime() - 3_600_000);
    const estado = calcularEstadoDeVentaUi(ventana, ahora);
    expect(estado).toEqual({
      fase: "PUBLICADA_SIN_ABRIR",
      segundosParaAbrir: 3_600,
    });
  });

  it("con la venta abierta, entrega la fecha de cierre ya formateada", () => {
    const estado = calcularEstadoDeVentaUi(ventana, instante(INICIO_VENTA));
    expect(estado.fase).toBe("VENTA_ABIERTA");
    expect(estado).toHaveProperty("cierraFormateado");
    if (estado.fase === "VENTA_ABIERTA") {
      expect(typeof estado.cierraFormateado).toBe("string");
      expect(estado.cierraFormateado.length).toBeGreaterThan(0);
    }
  });

  it("despues de cerrar, no entrega ningun dato extra", () => {
    const estado = calcularEstadoDeVentaUi(ventana, unMsDespues(FIN_VENTA));
    expect(estado).toEqual({ fase: "VENTA_CERRADA" });
  });

  it("nunca devuelve NO_VISIBLE: se trata como cerrada", () => {
    // Las dos pantallas que la llaman ya pasaron el gating triple, asi que
    // este caso no deberia ocurrir en produccion; el valor de respaldo no
    // puede ser una fase que la union del tipo no admite.
    const estado = calcularEstadoDeVentaUi(ventana, unMsAntes(PUBLICADA_EN));
    expect(estado).toEqual({ fase: "VENTA_CERRADA" });
  });
});

describe("fechasCoherentes — R-14", () => {
  it("acepta la ventana de referencia", () => {
    expect(fechasCoherentes(ventana, 48)).toBe(true);
  });

  it("acepta publicar y abrir en el mismo instante", () => {
    expect(
      fechasCoherentes({ ...ventana, publicadaEn: instante(INICIO_VENTA) }, 48),
    ).toBe(true);
  });

  it("rechaza publicar despues de abrir la venta", () => {
    expect(
      fechasCoherentes(
        { ...ventana, publicadaEn: unMsDespues(INICIO_VENTA) },
        48,
      ),
    ).toBe(false);
  });

  it("rechaza una ventana de duracion cero", () => {
    // No acepta ninguna solicitud; solo puede ser un error de captura.
    expect(
      fechasCoherentes({ ...ventana, finVenta: instante(INICIO_VENTA) }, 48),
    ).toBe(false);
  });

  it("rechaza que la venta termine antes de empezar", () => {
    expect(
      fechasCoherentes({ ...ventana, finVenta: unMsAntes(INICIO_VENTA) }, 48),
    ).toBe(false);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rechaza horasLiquidacion = %s",
    (horas) => {
      expect(fechasCoherentes(ventana, horas)).toBe(false);
    },
  );

  it("acepta una sola hora de liquidacion", () => {
    expect(fechasCoherentes(ventana, 1)).toBe(true);
  });
});

describe("puedeConcluirse", () => {
  const dentroDeLaVenta = instante(INICIO_VENTA);

  it("permite concluir despues del fin de venta aunque haya fila", () => {
    expect(
      puedeConcluirse("PUBLICADA", ventana.finVenta, instante(FIN_VENTA), true),
    ).toBe(true);
  });

  it("permite concluir antes del cierre si nadie se formo", () => {
    expect(
      puedeConcluirse("PUBLICADA", ventana.finVenta, dentroDeLaVenta, false),
    ).toBe(true);
  });

  it("no permite concluir en plena venta con fila viva", () => {
    expect(
      puedeConcluirse("PUBLICADA", ventana.finVenta, dentroDeLaVenta, true),
    ).toBe(false);
  });

  it.each([
    "BORRADOR",
    "EN_APROBACION",
    "APROBADA",
    "CONCLUIDA",
    "OCULTA",
  ] as const)("no permite concluir desde %s", (estatus) => {
    expect(
      puedeConcluirse(estatus, ventana.finVenta, instante(FIN_VENTA), false),
    ).toBe(false);
  });
});
