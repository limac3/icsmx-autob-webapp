// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  aConvocatoria,
  aLote,
  camposFaltantesDeConvocatoria,
  camposFaltantesDeLote,
} from "./mapeo";

/**
 * El diagnostico y el mapeador **no pueden separarse**.
 *
 * `camposFaltantesDeConvocatoria` repite la lista de campos obligatorios que
 * `aConvocatoria` comprueba, y esa duplicacion es deliberada: extraerla a un
 * solo sitio obligaria a renunciar al estrechamiento de tipos que hace el `if`
 * del mapeador, o a mentirle al compilador con un `as`. El precio es que las
 * dos listas pueden divergir, y una divergencia seria justo la clase de fallo
 * que este mecanismo existe para evitar — un item descartado cuyo diagnostico
 * dice que no le falta nada.
 *
 * Lo que impide la deriva es esta prueba, no el cuidado: recorre **campo por
 * campo**, lo quita, y exige que el mapeador rechace el item y que el
 * diagnostico nombre ese campo exacto.
 */

const CONVOCATORIA: Record<string, unknown> = {
  convocatoriaId: "C1",
  folio: "CONV-001",
  nombre: "Venta de septiembre",
  tipo: "EMPLEADOS",
  descripcionParticipacion: "Abierta al personal.",
  publicadaEn: "2026-09-01T15:00:00.000Z",
  inicioVenta: "2026-09-05T15:00:00.000Z",
  finVenta: "2026-09-12T15:00:00.000Z",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  estatus: "PUBLICADA",
  creadoEn: "2026-08-20T10:00:00.000Z",
  creadoPor: "P9",
};

const LOTE: Record<string, unknown> = {
  loteId: "L1",
  convocatoriaId: "C1",
  vehiculoId: "V1",
  precio: 180_000,
  estatus: "EN_OFERTA",
  contadorTurnos: 0,
  inicioVenta: "2026-09-05T15:00:00.000Z",
  finVenta: "2026-09-12T15:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  creadoEn: "2026-08-20T10:00:00.000Z",
  creadoPor: "P9",
};

const sin = (
  base: Record<string, unknown>,
  campo: string,
): Record<string, unknown> => {
  const copia = { ...base };
  delete copia[campo];
  return copia;
};

describe("aConvocatoria y su diagnostico coinciden", () => {
  it("el item completo se mapea y no reporta faltantes", () => {
    expect(aConvocatoria(CONVOCATORIA)).toBeDefined();
    expect(camposFaltantesDeConvocatoria(CONVOCATORIA)).toEqual([]);
  });

  it.each(Object.keys(CONVOCATORIA))(
    "sin %s: el mapeador rechaza y el diagnostico lo nombra",
    (campo) => {
      const item = sin(CONVOCATORIA, campo);

      expect(aConvocatoria(item)).toBeUndefined();
      expect(camposFaltantesDeConvocatoria(item)).toEqual([campo]);
    },
  );

  it("reporta todos los que faltan, no solo el primero", () => {
    // El caso real que motivo esto: las Etapas 14 y 15 agregaron estos tres a
    // la vez, y las convocatorias anteriores no tenian ninguno
    // (`desafios-implementacion.md` 78). Un diagnostico que solo nombrara el
    // primero obligaria a tres vueltas para entender una sola causa.
    const vieja = sin(
      sin(sin(CONVOCATORIA, "limiteAdjudicaciones"), "limiteSolicitudes"),
      "modalidadAdjudicacion",
    );

    expect(aConvocatoria(vieja)).toBeUndefined();
    expect(camposFaltantesDeConvocatoria(vieja)).toEqual([
      "limiteAdjudicaciones",
      "limiteSolicitudes",
      "modalidadAdjudicacion",
    ]);
  });

  it("un valor presente pero invalido cuenta como faltante", () => {
    // `estatus: "INVENTADO"` no es ausencia, pero para el mapeador da igual: el
    // item no se puede usar. El diagnostico tiene que decir lo mismo, o la
    // linea de registro mandaria a buscar un campo que si esta.
    const item = { ...CONVOCATORIA, estatus: "INVENTADO" };

    expect(aConvocatoria(item)).toBeUndefined();
    expect(camposFaltantesDeConvocatoria(item)).toEqual(["estatus"]);
  });
});

describe("aLote y su diagnostico coinciden", () => {
  it("el item completo se mapea y no reporta faltantes", () => {
    expect(aLote(LOTE)).toBeDefined();
    expect(camposFaltantesDeLote(LOTE)).toEqual([]);
  });

  it.each(Object.keys(LOTE))(
    "sin %s: el mapeador rechaza y el diagnostico lo nombra",
    (campo) => {
      const item = sin(LOTE, campo);

      expect(aLote(item)).toBeUndefined();
      expect(camposFaltantesDeLote(item)).toEqual([campo]);
    },
  );

  it("los tres desnormalizados de las Etapas 14 y 15 se reportan juntos", () => {
    const viejo = sin(
      sin(sin(LOTE, "limiteAdjudicaciones"), "limiteSolicitudes"),
      "modalidadAdjudicacion",
    );

    expect(aLote(viejo)).toBeUndefined();
    expect(camposFaltantesDeLote(viejo)).toEqual([
      "limiteAdjudicaciones",
      "limiteSolicitudes",
      "modalidadAdjudicacion",
    ]);
  });
});
