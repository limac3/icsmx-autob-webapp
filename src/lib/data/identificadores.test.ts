// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  esUlid,
  instanteDeUlid,
  INSTANTE_MAXIMO,
  LONGITUD_ULID,
  nuevoUlid,
} from "./identificadores";

const ALFABETO_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

describe("forma del ULID", () => {
  it("tiene 26 caracteres", () => {
    expect(LONGITUD_ULID).toBe(26);
    expect(nuevoUlid()).toHaveLength(26);
  });

  it("usa solo el alfabeto de Crockford", () => {
    for (let i = 0; i < 200; i += 1) {
      for (const caracter of nuevoUlid()) {
        expect(ALFABETO_CROCKFORD).toContain(caracter);
      }
    }
  });

  it("no contiene el separador de claves", () => {
    // `claves.ts` rechaza cualquier identificador con `#`, porque uno colado
    // desplazaria el resto de la clave. El alfabeto lo hace imposible por
    // construccion, y esta prueba lo deja afirmado y no supuesto.
    expect(ALFABETO_CROCKFORD).not.toContain("#");
    for (let i = 0; i < 200; i += 1) expect(nuevoUlid()).not.toContain("#");
  });

  it("excluye las letras ambiguas", () => {
    for (const ambigua of ["I", "L", "O", "U"]) {
      expect(ALFABETO_CROCKFORD).not.toContain(ambigua);
    }
  });
});

describe("el orden lexicografico es el orden cronologico", () => {
  it("respeta el orden de instantes crecientes", () => {
    // Es la unica razon por la que se eligio ULID sobre UUID v4. Si esto deja
    // de cumplirse, la bitacora deja de leerse en orden y GSI3 devuelve las
    // solicitudes desordenadas.
    const instantes = [
      new Date("2020-01-01T00:00:00.000Z"),
      new Date("2026-09-05T12:00:00.000Z"),
      new Date("2026-09-05T12:00:00.001Z"),
      new Date("2026-09-05T12:00:01.000Z"),
      new Date("2030-12-31T23:59:59.999Z"),
    ];
    const ulids = instantes.map((instante) => nuevoUlid(instante));
    expect([...ulids].sort()).toEqual(ulids);
  });

  it("ordena bien a traves de un cambio de longitud del contador", () => {
    // Sin relleno a diez caracteres, un instante mas corto ordenaria antes que
    // otro anterior. El relleno es lo que lo impide.
    const antes = nuevoUlid(new Date(33_554_431)); // ultimo de 5 simbolos
    const despues = nuevoUlid(new Date(33_554_432)); // primero de 6
    expect(antes < despues).toBe(true);
    expect(antes.slice(0, 10)).toHaveLength(despues.slice(0, 10).length);
  });

  it("dos del mismo milisegundo difieren, aunque no esten ordenados entre si", () => {
    const instante = new Date("2026-09-05T12:00:00.000Z");
    const generados = new Set(
      Array.from({ length: 500 }, () => nuevoUlid(instante)),
    );
    expect(generados.size).toBe(500);
    // Y comparten el prefijo de tiempo, que es lo que los agrupa en la clave.
    const prefijos = new Set([...generados].map((u) => u.slice(0, 10)));
    expect(prefijos.size).toBe(1);
  });
});

describe("instanteDeUlid", () => {
  it.each([
    "1970-01-01T00:00:00.000Z",
    "2026-09-05T12:34:56.789Z",
    "2099-12-31T23:59:59.999Z",
  ])("hace ida y vuelta con %s", (iso) => {
    const instante = new Date(iso);
    expect(instanteDeUlid(nuevoUlid(instante))).toEqual(instante);
  });

  it("devuelve undefined para un texto que no es ULID", () => {
    expect(instanteDeUlid("no-es-un-ulid")).toBeUndefined();
    expect(instanteDeUlid("")).toBeUndefined();
    // Longitud correcta pero con una letra excluida del alfabeto.
    expect(instanteDeUlid("01ARZ3NDEKTSV4RRFFQ69G5FAI")).toBeUndefined();
  });
});

describe("esUlid", () => {
  it("acepta lo que genera nuevoUlid", () => {
    for (let i = 0; i < 100; i += 1) expect(esUlid(nuevoUlid())).toBe(true);
  });

  it.each([
    ["vacio", ""],
    ["muy corto", "01ARZ3NDEK"],
    ["muy largo", "01ARZ3NDEKTSV4RRFFQ69G5FAV0"],
    ["minusculas", "01arz3ndektsv4rrffq69g5fav"],
    ["con separador", "01ARZ3NDEKTSV4RRFFQ69G5F#V"],
    ["con letra excluida", "01ARZ3NDEKTSV4RRFFQ69G5FAL"],
  ])("rechaza %s", (_nombre, texto) => {
    expect(esUlid(texto)).toBe(false);
  });
});

describe("limites", () => {
  it("acepta el instante maximo representable", () => {
    expect(esUlid(nuevoUlid(new Date(INSTANTE_MAXIMO)))).toBe(true);
  });

  it("rechaza un instante que desbordaria el campo de tiempo", () => {
    // Desbordar no daria un error visible: daria un identificador que ordena
    // **antes** que los anteriores, que es el peor fallo posible aqui.
    expect(() => nuevoUlid(new Date(INSTANTE_MAXIMO + 1))).toThrow(RangeError);
  });

  it("rechaza una fecha invalida", () => {
    expect(() => nuevoUlid(new Date("no es una fecha"))).toThrow(RangeError);
  });
});
