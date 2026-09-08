// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatearPrecio, MONEDA_DE_NEGOCIO } from "./dinero";

describe("formatearPrecio", () => {
  it("agrupa los miles con coma, como se lee en Mexico", () => {
    // La falsificacion util: con el idioma a secas —`es`— `Intl` aplica las
    // convenciones de Espana y devuelve "185.000 MXN". Ese punto es justo lo
    // que un lector mexicano toma por separador de decimales.
    expect(formatearPrecio(185_000, "es")).toBe("$185,000");
  });

  it("no muestra centavos, porque el precio es entero de pesos", () => {
    expect(formatearPrecio(1000, "es")).not.toContain(".00");
  });

  it("en ingles distingue el peso del dolar", () => {
    expect(formatearPrecio(185_000, "en")).toBe("MX$185,000");
  });

  it("el importe sigue siendo pesos se lea en el idioma que se lea", () => {
    expect(MONEDA_DE_NEGOCIO).toBe("MXN");
    for (const idioma of ["es", "en"]) {
      expect(formatearPrecio(185_000, idioma)).toContain("185,000");
    }
  });

  it("formatea el maximo sin notacion cientifica", () => {
    expect(formatearPrecio(99_999_999, "es")).toBe("$99,999,999");
  });
});
