// @vitest-environment node
import { describe, expect, it } from "vitest";
import { aIso, desdeIso } from "./fechas";
import {
  calcularVenceEn,
  dentroDePlazo,
  estaVencido,
  tiempoRestante,
} from "./plazos";

const instante = (iso: string): Date => {
  const valor = desdeIso(iso);
  if (!valor) throw new Error(`literal de prueba invalido: ${iso}`);
  return valor;
};

const ADJUDICADO_EN = "2026-09-15T16:30:00Z";

describe("calcularVenceEn — R-13", () => {
  it("suma horas naturales al instante de adjudicacion", () => {
    const vence = calcularVenceEn(instante(ADJUDICADO_EN), 48);
    expect(vence && aIso(vence)).toBe("2026-09-17T16:30:00.000Z");
  });

  it("cuenta el fin de semana como cualquier otro dia", () => {
    // Viernes 16:30Z + 72 h = lunes 16:30Z. Horas naturales, reloj corrido
    // 24/7: no se excluyen fines de semana ni festivos. La alternativa de
    // horas habiles se descarto por auditabilidad (proyecto.md seccion 8).
    const viernes = instante("2026-09-18T16:30:00Z");
    const vence = calcularVenceEn(viernes, 72);
    expect(vence && aIso(vence)).toBe("2026-09-21T16:30:00.000Z");
    expect(vence?.getUTCDay()).toBe(1); // lunes
  });

  it("no lo altera un cambio de horario", () => {
    // Cruzando el salto de primavera historico de 2021: 24 horas naturales son
    // 24 horas, aunque el reloj de pared local avance 25. El plazo es una
    // comparacion de timestamps UTC y no depende de la zona.
    const antes = instante("2021-04-03T20:00:00Z");
    const vence = calcularVenceEn(antes, 24);
    expect(vence && aIso(vence)).toBe("2021-04-04T20:00:00.000Z");
  });

  it("acepta una sola hora", () => {
    const vence = calcularVenceEn(instante(ADJUDICADO_EN), 1);
    expect(vence && aIso(vence)).toBe("2026-09-15T17:30:00.000Z");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rechaza horasLiquidacion = %s",
    (horas) => {
      expect(calcularVenceEn(instante(ADJUDICADO_EN), horas)).toBeUndefined();
    },
  );

  it("rechaza fraccionarios aunque sean positivos", () => {
    // Un valor fraccionario produciria vencimientos con milisegundos que
    // ningun operador puede explicar al participante.
    expect(calcularVenceEn(instante(ADJUDICADO_EN), 0.5)).toBeUndefined();
  });

  it("rechaza una fecha de adjudicacion invalida", () => {
    expect(calcularVenceEn(new Date(NaN), 48)).toBeUndefined();
  });
});

describe("estaVencido y dentroDePlazo", () => {
  const venceEn = instante("2026-09-17T16:30:00Z");
  const unMsAntes = new Date(venceEn.getTime() - 1);
  const unMsDespues = new Date(venceEn.getTime() + 1);

  it("no esta vencido un milisegundo antes", () => {
    expect(estaVencido(venceEn, unMsAntes)).toBe(false);
  });

  it("esta vencido en el instante exacto de venceEn", () => {
    // Inclusivo, igual que la condicion del item 1 de T5: `venceEn <= :ahora`.
    expect(estaVencido(venceEn, venceEn)).toBe(true);
  });

  it("esta vencido un milisegundo despues", () => {
    expect(estaVencido(venceEn, unMsDespues)).toBe(true);
  });

  it("dentroDePlazo cierra en el instante exacto", () => {
    // Condicion del item 1 de T3: `venceEn > :ahora`. En el instante justo del
    // vencimiento ya no se puede subir el comprobante.
    expect(dentroDePlazo(venceEn, unMsAntes)).toBe(true);
    expect(dentroDePlazo(venceEn, venceEn)).toBe(false);
  });

  it("particionan el tiempo sin solapamiento ni hueco", () => {
    // Si una solicitud pudiera estar a la vez vencida y en plazo, el barrido y
    // la subida del comprobante competirian con condiciones que ambas pasan.
    // Si pudiera no estar en ninguna, quedaria bloqueada.
    for (const ahora of [
      new Date(venceEn.getTime() - 86_400_000),
      unMsAntes,
      venceEn,
      unMsDespues,
      new Date(venceEn.getTime() + 86_400_000),
    ]) {
      expect(estaVencido(venceEn, ahora)).toBe(!dentroDePlazo(venceEn, ahora));
    }
  });

  it("reproduce las condiciones de T3 y T5", () => {
    const comoT3 = (ahora: Date) => venceEn.getTime() > ahora.getTime();
    const comoT5 = (ahora: Date) => venceEn.getTime() <= ahora.getTime();

    for (const ahora of [unMsAntes, venceEn, unMsDespues]) {
      expect(dentroDePlazo(venceEn, ahora)).toBe(comoT3(ahora));
      expect(estaVencido(venceEn, ahora)).toBe(comoT5(ahora));
    }
  });
});

describe("tiempoRestante", () => {
  const venceEn = instante("2026-09-17T16:30:00Z");

  it("da los milisegundos que faltan", () => {
    const dosHorasAntes = new Date(venceEn.getTime() - 2 * 60 * 60 * 1000);
    expect(tiempoRestante(venceEn, dosHorasAntes)).toBe(7_200_000);
  });

  it("es cero en el instante del vencimiento", () => {
    expect(tiempoRestante(venceEn, venceEn)).toBe(0);
  });

  it("nunca es negativo", () => {
    // "Quedan -3 horas" no significa nada para el participante; quien necesita
    // saber si vencio usa estaVencido.
    const muchoDespues = new Date(venceEn.getTime() + 86_400_000);
    expect(tiempoRestante(venceEn, muchoDespues)).toBe(0);
  });
});

describe("composicion con calcularVenceEn", () => {
  it("una adjudicacion recien hecha esta siempre en plazo", () => {
    const adjudicadoEn = instante(ADJUDICADO_EN);
    const vence = calcularVenceEn(adjudicadoEn, 48);
    expect(vence).toBeDefined();
    expect(dentroDePlazo(vence!, adjudicadoEn)).toBe(true);
    expect(estaVencido(vence!, adjudicadoEn)).toBe(false);
  });

  it("vence exactamente al cumplirse las horas pactadas", () => {
    const adjudicadoEn = instante(ADJUDICADO_EN);
    const vence = calcularVenceEn(adjudicadoEn, 48)!;
    const justoAlCumplirse = new Date(
      adjudicadoEn.getTime() + 48 * 60 * 60 * 1000,
    );
    expect(estaVencido(vence, justoAlCumplirse)).toBe(true);
    expect(estaVencido(vence, new Date(justoAlCumplirse.getTime() - 1))).toBe(
      false,
    );
  });
});
