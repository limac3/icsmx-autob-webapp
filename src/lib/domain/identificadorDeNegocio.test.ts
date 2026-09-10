// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  LIMITE_IDENTIFICADOR_DE_NEGOCIO,
  normalizarIdentificadorDeNegocio,
  prepararIdentificadorDeNegocio,
  revisarIdentificadorDeNegocio,
} from "./identificadorDeNegocio";

describe("normalizarIdentificadorDeNegocio", () => {
  it("recorta y pasa a mayusculas", () => {
    expect(normalizarIdentificadorDeNegocio("  ab-12 ")).toBe("AB-12");
  });

  it("**es lo que hace real la unicidad**", () => {
    // Sin normalizar, estos tres serian tres registros distintos para la base
    // de datos y el mismo vehiculo para cualquier persona.
    const variantes = ["ab-1", "AB-1", " Ab-1 ", "aB-1"];
    expect(new Set(variantes.map(normalizarIdentificadorDeNegocio)).size).toBe(
      1,
    );
  });
});

describe("revisarIdentificadorDeNegocio", () => {
  it("acepta mayusculas, digitos y los tres separadores", () => {
    for (const valido of [
      "A",
      "1",
      "AB-12",
      "VEH_001",
      "MX/2026/017",
      "A-_/1",
    ]) {
      expect(revisarIdentificadorDeNegocio(valido), valido).toBeUndefined();
    }
  });

  it("rechaza el vacio", () => {
    expect(revisarIdentificadorDeNegocio("")).toBe("requerido");
  });

  it("acota la longitud, porque el valor entra en la clave del centinela", () => {
    const alLimite = "A".repeat(LIMITE_IDENTIFICADOR_DE_NEGOCIO);
    expect(revisarIdentificadorDeNegocio(alLimite)).toBeUndefined();
    expect(revisarIdentificadorDeNegocio(`${alLimite}A`)).toBe("muy_largo");
  });

  it("**rechaza el separador de claves**", () => {
    // Es la razon de que el alfabeto sea lista blanca: el valor normalizado
    // entra en la `PK` del centinela (`NUMECO_VEH#<valor>`), asi que un `#`
    // colado desplazaria la clave y podria fabricar el centinela de otro
    // registro.
    expect(revisarIdentificadorDeNegocio("AB#12")).toBe(
      "caracter_no_permitido",
    );
  });

  it.each([
    ["espacio interior", "AB 12"],
    ["minuscula sin normalizar", "ab-12"],
    ["acento", "ÁB-12"],
    ["punto", "AB.12"],
    ["coma", "AB,12"],
    ["dos puntos", "AB:12"],
  ])("rechaza %s", (_caso, valor) => {
    expect(revisarIdentificadorDeNegocio(valor)).toBe("caracter_no_permitido");
  });

  it("un espacio interior no se admite ni normalizando", () => {
    // Recortar quita los extremos, no el medio: "AB 12" contra "AB  12" serian
    // dos registros que nadie distingue a la vista.
    expect(prepararIdentificadorDeNegocio(" ab 12 ")).toEqual({
      ok: false,
      motivo: "caracter_no_permitido",
    });
  });
});

describe("prepararIdentificadorDeNegocio", () => {
  it("devuelve el valor listo para guardar", () => {
    expect(prepararIdentificadorDeNegocio("  veh_001 ")).toEqual({
      ok: true,
      valor: "VEH_001",
    });
  });

  it("revisa **despues** de normalizar, no antes", () => {
    // `" ab-1 "` es valido aunque el texto crudo tenga espacios y minusculas.
    // Decidirlo sobre el crudo daria un veredicto sobre algo que no es lo que
    // se va a guardar.
    expect(prepararIdentificadorDeNegocio(" ab-1 ").ok).toBe(true);
  });

  it("un valor de solo espacios es requerido, no caracter no permitido", () => {
    expect(prepararIdentificadorDeNegocio("   ")).toEqual({
      ok: false,
      motivo: "requerido",
    });
  });
});
