import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatosCorreoAdjudicacion } from "@/types/correo";
import { correoDeAdjudicacion } from "./plantillas";

const datos: DatosCorreoAdjudicacion = {
  solicitudId: "L1-2",
  loteId: "L1",
  convocatoriaId: "C1",
  vehiculoId: "V1",
  precio: 180_000,
  venceEn: "2026-10-10T15:00:00.000Z",
};

beforeEach(() => {
  vi.stubEnv("APP_BASE_URL", "https://autob.example.org");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("correoDeAdjudicacion", () => {
  it("incluye el precio formateado en pesos (el dato de pago)", () => {
    const correo = correoDeAdjudicacion(datos);
    expect(correo.cuerpoHtml).toContain("$180,000");
  });

  it("enlaza directo al lote cuando hay convocatoriaId", () => {
    const correo = correoDeAdjudicacion(datos);
    expect(correo.cuerpoHtml).toContain(
      "https://autob.example.org/convocatorias/C1/lotes/L1",
    );
  });

  it("enlaza a la raiz si falta convocatoriaId (dato viejo)", () => {
    const correo = correoDeAdjudicacion({
      ...datos,
      convocatoriaId: undefined,
    });
    expect(correo.cuerpoHtml).toContain("https://autob.example.org");
    expect(correo.cuerpoHtml).not.toContain("/convocatorias/undefined");
  });

  it("responde en ingles cuando se pide", () => {
    const correo = correoDeAdjudicacion(datos, "en");
    expect(correo.asunto).toMatch(/won the bid/i);
  });

  it("es en espanol por omision", () => {
    const correo = correoDeAdjudicacion(datos);
    expect(correo.asunto).toMatch(/adjudicacion/i);
  });
});
