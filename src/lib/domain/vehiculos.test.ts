// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  LIMITES,
  modeloMaximo,
  normalizarDatosVehiculo,
  revisarDatosVehiculo,
  rotuloVehiculo,
  validarDatosVehiculo,
} from "./vehiculos";
import type { DatosVehiculo } from "@/types/vehiculo";

import { CAMPOS_VEHICULO } from "@/types/vehiculo";

const AHORA = new Date("2026-09-05T18:00:00.000Z");

const validos: DatosVehiculo = {
  numeroEconomico: "VEH-001",
  numeroDeSerie: "3N6AD33A9KK870001",
  marca: "Nissan",
  version: "NP300 Doble Cabina",
  modelo: 2019,
  kilometraje: 148_320,
  nivelEquipamiento: "Base",
  especificacionMecanica: "2.5L 4 cilindros, manual, 6 velocidades",
  condicionesMecanicas: "Servicio al dia; clutch reemplazado en 2025",
  detallesEsteticos: "Rayones en la caja, defensa trasera golpeada",
};

const con = (cambios: Partial<DatosVehiculo>): DatosVehiculo => ({
  ...validos,
  ...cambios,
});

describe("datos validos", () => {
  it("acepta un vehiculo completo", () => {
    expect(revisarDatosVehiculo(validos, AHORA)).toEqual({});
    expect(validarDatosVehiculo(validos, AHORA).ok).toBe(true);
  });

  it("acepta un vehiculo sin los campos descriptivos", () => {
    // `api-contracts.md` enumera las validaciones exigidas y no incluye estos
    // cuatro campos. Exigirlos aqui rechazaria capturas que el contrato admite.
    const minimo: DatosVehiculo = {
      numeroEconomico: "VEH-001",
      numeroDeSerie: "3N6AD33A9KK870001",
      marca: "Ford",
      version: "Ranger XL",
      modelo: 2020,
      kilometraje: 0,
    };
    expect(revisarDatosVehiculo(minimo, AHORA)).toEqual({});
  });

  it("acepta kilometraje cero", () => {
    expect(revisarDatosVehiculo(con({ kilometraje: 0 }), AHORA)).toEqual({});
  });
});

describe("marca y version", () => {
  it.each(["", "   ", "\t\n"])("rechaza marca en blanco (%j)", (marca) => {
    expect(revisarDatosVehiculo(con({ marca }), AHORA)).toEqual({
      marca: "requerido",
    });
  });

  it.each(["", "   "])("rechaza version en blanco (%j)", (version) => {
    expect(revisarDatosVehiculo(con({ version }), AHORA)).toEqual({
      version: "requerido",
    });
  });

  it("acepta exactamente el limite y rechaza uno mas", () => {
    expect(
      revisarDatosVehiculo(con({ marca: "M".repeat(LIMITES.marca) }), AHORA),
    ).toEqual({});
    expect(
      revisarDatosVehiculo(
        con({ marca: "M".repeat(LIMITES.marca + 1) }),
        AHORA,
      ),
    ).toEqual({ marca: "muy_largo" });
  });

  it("mide la longitud despues de recortar", () => {
    // Si midiera antes, un pegado con espacios al final se rechazaria pese a
    // que lo que se guarda si cabe.
    const marca = `  ${"M".repeat(LIMITES.marca)}  `;
    expect(revisarDatosVehiculo(con({ marca }), AHORA)).toEqual({});
  });
});

describe("modelo", () => {
  it("el maximo es el anio siguiente al actual, en hora de negocio", () => {
    expect(modeloMaximo(AHORA)).toBe(2027);
  });

  it("usa el anio de Mexico y no el de UTC", () => {
    // 2027-01-01T04:00Z siguen siendo las 22:00 del 31 de diciembre de 2026 en
    // Mexico: el maximo todavia es 2027, no 2028.
    expect(modeloMaximo(new Date("2027-01-01T04:00:00.000Z"))).toBe(2027);
    expect(modeloMaximo(new Date("2027-01-01T07:00:00.000Z"))).toBe(2028);
  });

  it.each([
    [LIMITES.modeloMinimo, {}],
    [LIMITES.modeloMinimo - 1, { modelo: "fuera_de_rango" }],
    [2027, {}],
    [2028, { modelo: "fuera_de_rango" }],
  ])("modelo %i", (modelo, esperado) => {
    expect(revisarDatosVehiculo(con({ modelo }), AHORA)).toEqual(esperado);
  });

  it.each([2019.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rechaza el modelo %s por no ser entero",
    (modelo) => {
      expect(revisarDatosVehiculo(con({ modelo }), AHORA)).toEqual({
        modelo: "no_es_entero",
      });
    },
  );
});

describe("kilometraje", () => {
  it.each([
    [0, {}],
    [-1, { kilometraje: "fuera_de_rango" }],
    [LIMITES.kilometrajeMaximo, {}],
    [LIMITES.kilometrajeMaximo + 1, { kilometraje: "fuera_de_rango" }],
  ])("kilometraje %i", (kilometraje, esperado) => {
    expect(revisarDatosVehiculo(con({ kilometraje }), AHORA)).toEqual(esperado);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rechaza el kilometraje %s por no ser entero",
    (kilometraje) => {
      expect(revisarDatosVehiculo(con({ kilometraje }), AHORA)).toEqual({
        kilometraje: "no_es_entero",
      });
    },
  );
});

describe("campos descriptivos", () => {
  it.each([
    "nivelEquipamiento",
    "especificacionMecanica",
    "condicionesMecanicas",
    "detallesEsteticos",
  ] as const)("%s acepta su limite y rechaza uno mas", (campo) => {
    expect(
      revisarDatosVehiculo(con({ [campo]: "x".repeat(LIMITES[campo]) }), AHORA),
    ).toEqual({});
    expect(
      revisarDatosVehiculo(
        con({ [campo]: "x".repeat(LIMITES[campo] + 1) }),
        AHORA,
      ),
    ).toEqual({ [campo]: "muy_largo" });
  });
});

describe("CAMPOS_VEHICULO", () => {
  it("enumera todos los campos capturables, sin quedarse corto", () => {
    // `as const satisfies readonly (keyof DatosVehiculo)[]` comprueba que cada
    // elemento **sea** una clave valida, no que esten **todas**: al agregar el
    // numero economico y el de serie la lista se quedo sin ellos y el
    // typecheck paso. Cuesta caro, porque de esa lista dependen dos cosas:
    // `camposModificados` —una edicion de un campo ausente devolveria exito sin
    // escribir nada— y el reenvio de errores del formulario, que recorre la
    // lista para volver a marcar los controles.
    //
    // La referencia es el literal que devuelve `normalizarDatosVehiculo`, que
    // el compilador **si** obliga a cubrir entero.
    expect([...CAMPOS_VEHICULO].sort()).toEqual(
      Object.keys(normalizarDatosVehiculo(validos)).sort(),
    );
  });
});

describe("informa todos los errores de una vez", () => {
  it("no se detiene en el primero", () => {
    // Un formulario que corrige un campo, reenvia y descubre el siguiente error
    // es un formulario que se abandona.
    expect(
      revisarDatosVehiculo(
        {
          numeroEconomico: "",
          numeroDeSerie: "VIN#1",
          marca: "",
          version: "",
          modelo: 1800,
          kilometraje: -5,
        },
        AHORA,
      ),
    ).toEqual({
      numeroEconomico: "requerido",
      numeroDeSerie: "caracter_no_permitido",
      marca: "requerido",
      version: "requerido",
      modelo: "fuera_de_rango",
      kilometraje: "fuera_de_rango",
    });
  });
});

describe("normalizacion", () => {
  it("recorta los espacios de los campos de texto", () => {
    const normalizado = normalizarDatosVehiculo(
      con({ marca: "  Nissan  ", version: " NP300 " }),
    );
    expect(normalizado.marca).toBe("Nissan");
    expect(normalizado.version).toBe("NP300");
  });

  it("convierte un opcional en blanco en ausente, no en cadena vacia", () => {
    // El cliente descarta los `undefined`, asi que el atributo no se escribe y
    // una lectura posterior distingue "no se capturo" de "se capturo vacio".
    const normalizado = normalizarDatosVehiculo(
      con({ nivelEquipamiento: "   ", detallesEsteticos: "" }),
    );
    expect(normalizado.nivelEquipamiento).toBeUndefined();
    expect(normalizado.detallesEsteticos).toBeUndefined();
    expect("nivelEquipamiento" in normalizado).toBe(true);
  });

  it("no toca los numeros", () => {
    const normalizado = normalizarDatosVehiculo(validos);
    expect(normalizado.modelo).toBe(2019);
    expect(normalizado.kilometraje).toBe(148_320);
  });
});

describe("validarDatosVehiculo", () => {
  it("devuelve los datos ya normalizados cuando son validos", () => {
    const resultado = validarDatosVehiculo(
      con({ marca: "  Nissan  ", nivelEquipamiento: "  " }),
      AHORA,
    );

    expect(resultado).toEqual({
      ok: true,
      data: expect.objectContaining({
        marca: "Nissan",
        nivelEquipamiento: undefined,
      }),
    });
  });

  it("devuelve validation_failed con el detalle por campo", () => {
    const resultado = validarDatosVehiculo(
      con({ marca: "", kilometraje: -1 }),
      AHORA,
    );

    expect(resultado).toEqual({
      ok: false,
      error: "validation_failed",
      detalles: { marca: "requerido", kilometraje: "fuera_de_rango" },
    });
  });

  it("no normaliza lo que no valido", () => {
    const resultado = validarDatosVehiculo(con({ marca: "" }), AHORA);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado).not.toHaveProperty("data");
  });
});

describe("rotuloVehiculo", () => {
  it("junta marca, version y modelo, nunca el vehiculoId", () => {
    expect(rotuloVehiculo(validos)).toBe("Nissan NP300 Doble Cabina 2019");
  });
});
