// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  esId,
  instanteDeId,
  SEGUNDOS_MAXIMOS,
  LONGITUD_ID,
  nuevoId,
} from "./identificadores";

const ALFABETO_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Un instante cualquiera, con milisegundos que el identificador descarta. */
const INSTANTE = new Date("2026-09-05T12:34:56.789Z");

describe("forma del identificador", () => {
  it("tiene 12 caracteres", () => {
    expect(LONGITUD_ID).toBe(12);
    expect(nuevoId()).toHaveLength(12);
  });

  it("usa solo el alfabeto de Crockford", () => {
    for (let i = 0; i < 200; i += 1) {
      for (const caracter of nuevoId()) {
        expect(ALFABETO_CROCKFORD).toContain(caracter);
      }
    }
  });

  it("no contiene ninguno de los dos separadores de clave", () => {
    // `claves.ts` rechaza cualquier identificador con `#`, porque uno colado
    // desplazaria el resto de la clave. Y `loteYTurnoDesdeIdentificador` parte
    // `<loteId>-<turno>` por el ultimo `-`, asi que un `-` dentro de un
    // `loteId` haria irrecuperable el turno. El alfabeto lo hace imposible por
    // construccion, y esta prueba lo deja afirmado y no supuesto.
    expect(ALFABETO_CROCKFORD).not.toContain("#");
    expect(ALFABETO_CROCKFORD).not.toContain("-");
    for (let i = 0; i < 200; i += 1) {
      expect(nuevoId()).not.toContain("#");
      expect(nuevoId()).not.toContain("-");
    }
  });

  it("excluye las letras ambiguas", () => {
    for (const ambigua of ["I", "L", "O", "U"]) {
      expect(ALFABETO_CROCKFORD).not.toContain(ambigua);
    }
  });
});

describe("el orden lexicografico es el orden cronologico", () => {
  it("respeta el orden de instantes crecientes, al segundo", () => {
    // Es la unica razon por la que el identificador lleva el tiempo delante. Si
    // esto deja de cumplirse, la bitacora deja de leerse en orden y las listas
    // de opciones de auditoria dejan de ofrecer lo mas reciente primero.
    const instantes = [
      new Date("2020-01-01T00:00:00.000Z"),
      new Date("2026-09-05T12:00:00.000Z"),
      new Date("2026-09-05T12:00:01.000Z"),
      new Date("2026-09-05T12:00:02.000Z"),
      new Date("2030-12-31T23:59:59.000Z"),
    ];
    const ids = instantes.map((instante) => nuevoId(instante));
    expect([...ids].sort()).toEqual(ids);
  });

  it("ordena bien a traves de un cambio de longitud del contador", () => {
    // Sin relleno a siete caracteres, un instante mas corto ordenaria antes que
    // otro anterior. El relleno es lo que lo impide. 32^5 segundos es la
    // frontera entre cinco y seis simbolos significativos.
    const antes = nuevoId(new Date(33_554_431 * 1000));
    const despues = nuevoId(new Date(33_554_432 * 1000));
    expect(antes < despues).toBe(true);
    expect(antes.slice(0, 7)).toHaveLength(despues.slice(0, 7).length);
  });

  it("el mismo segundo comparte prefijo: es lo que los agrupa en la clave", () => {
    const dentroDelMismoSegundo = [
      new Date("2026-09-05T12:00:00.000Z"),
      new Date("2026-09-05T12:00:00.001Z"),
      new Date("2026-09-05T12:00:00.999Z"),
    ];
    const prefijos = new Set(
      dentroDelMismoSegundo.map((i) => nuevoId(i).slice(0, 7)),
    );
    expect(prefijos.size).toBe(1);
  });
});

describe("unicidad dentro del mismo segundo", () => {
  // Es la propiedad que el recorte de 26 a 12 caracteres pone en juego: el azar
  // baja de 80 a 25 bits, asi que la colision deja de ser imposible y pasa a
  // ser improbable. Estas pruebas fijan la magnitud de esa improbabilidad.

  it("mil identificadores del mismo segundo son distintos", () => {
    const generados = new Set(
      Array.from({ length: 1_000 }, () => nuevoId(INSTANTE)),
    );
    // Con 2^25 valores y mil extracciones, la probabilidad de que esta prueba
    // falle por azar es ~1,5%. Se afirma con holgura para que no sea
    // intermitente: lo que importa es que no haya un defecto sistematico —un
    // azar sesgado o una semilla compartida— que produzca decenas de repetidos.
    expect(generados.size).toBeGreaterThan(995);
  });

  it("el azar cubre el alfabeto completo, sin sesgo por el modulo", () => {
    // `byte % 32` seria sesgado con un alfabeto que no dividiera a 256. Con 32
    // no lo es, y esta prueba lo comprueba en vez de confiar en el comentario:
    // los 32 simbolos deben aparecer en la parte aleatoria.
    const vistos = new Set<string>();
    for (let i = 0; i < 2_000; i += 1) {
      for (const caracter of nuevoId(INSTANTE).slice(7)) vistos.add(caracter);
    }
    expect(vistos.size).toBe(ALFABETO_CROCKFORD.length);
  });

  it("dos identificadores de segundos distintos nunca colisionan", () => {
    // El prefijo de tiempo los separa por construccion, sin depender del azar.
    const uno = nuevoId(new Date("2026-09-05T12:00:00.000Z"));
    const otro = nuevoId(new Date("2026-09-05T12:00:01.000Z"));
    expect(uno.slice(0, 7)).not.toBe(otro.slice(0, 7));
  });
});

describe("instanteDeId", () => {
  it.each([
    ["1970-01-01T00:00:00.000Z", "1970-01-01T00:00:00.000Z"],
    // El milisegundo se descarta: el identificador guarda el segundo.
    ["2026-09-05T12:34:56.789Z", "2026-09-05T12:34:56.000Z"],
    ["2099-12-31T23:59:59.999Z", "2099-12-31T23:59:59.000Z"],
  ])("con %s devuelve el segundo truncado", (iso, esperado) => {
    expect(instanteDeId(nuevoId(new Date(iso)))).toEqual(new Date(esperado));
  });

  it("devuelve undefined para un texto que no es un identificador", () => {
    expect(instanteDeId("no-es-un-id")).toBeUndefined();
    expect(instanteDeId("")).toBeUndefined();
    // Longitud correcta pero con una letra excluida del alfabeto.
    expect(instanteDeId("01ARZ3NDEKTI")).toBeUndefined();
  });
});

describe("esId", () => {
  it("acepta lo que genera nuevoId", () => {
    for (let i = 0; i < 100; i += 1) expect(esId(nuevoId())).toBe(true);
  });

  it.each([
    ["vacio", ""],
    ["muy corto", "01ARZ3NDEK"],
    ["muy largo", "01ARZ3NDEKTSV"],
    ["minusculas", "01arz3ndekts"],
    ["con separador de clave", "01ARZ3NDEK#V"],
    ["con separador de solicitud", "01ARZ3NDEK-V"],
    ["con letra excluida", "01ARZ3NDEKTL"],
    ["un ULID de los de antes", "01ARZ3NDEKTSV4RRFFQ69G5FAV"],
  ])("rechaza %s", (_nombre, texto) => {
    expect(esId(texto)).toBe(false);
  });
});

describe("limites", () => {
  it("acepta el instante maximo representable", () => {
    expect(esId(nuevoId(new Date(SEGUNDOS_MAXIMOS * 1000)))).toBe(true);
  });

  it("el maximo son 2^35 segundos, o sea el ano 3059", () => {
    expect(SEGUNDOS_MAXIMOS).toBe(2 ** 35 - 1);
    expect(new Date(SEGUNDOS_MAXIMOS * 1000).getUTCFullYear()).toBe(3058);
  });

  it("rechaza un instante que desbordaria el campo de tiempo", () => {
    // Desbordar no daria un error visible: daria un identificador que ordena
    // **antes** que los anteriores, que es el peor fallo posible aqui.
    expect(() => nuevoId(new Date((SEGUNDOS_MAXIMOS + 1) * 1000))).toThrow(
      RangeError,
    );
  });

  it("rechaza una fecha invalida", () => {
    expect(() => nuevoId(new Date("no es una fecha"))).toThrow(RangeError);
  });
});
