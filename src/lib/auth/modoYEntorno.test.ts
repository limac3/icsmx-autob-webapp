// @vitest-environment node
vi.mock("server-only", () => ({}));
vi.mock("./easAdapter", () => ({ consultarPermisosEas: vi.fn() }));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consultarPermisosEas } from "./easAdapter";
import { obtenerPermisos } from "./eas";
import { impersonacionHabilitada } from "./impersonacion";

/**
 * Tabla de verdad de `ENABLE_DEV_TOOLS` x `APP_ENV`.
 *
 * Las dos variables juntas deciden si la autorizacion de una peticion es
 * **real** o **simulada**, que es la decision mas consecuente de toda la
 * configuracion. La especificacion esta en `identidad-autorizacion.md` 4.1.2;
 * este archivo la recorre **completa** —incluidos los valores ausentes,
 * vacios e invalidos— porque una tabla en un documento no garantiza nada.
 *
 * Lo que se verifica no es "el codigo hace lo que hace": es que **ninguna
 * omision ni ningun valor mal escrito conceda mas que `OFF`**. Esa es la
 * propiedad de seguridad, y se comprueba por enumeracion y no por muestreo.
 */

const consultarMock = vi.mocked(consultarPermisosEas);

beforeEach(() => {
  consultarMock.mockReset();
  consultarMock.mockResolvedValue(new Set(["Autob_Auditar"]));
  vi.unstubAllEnvs();
  // Los valores invalidos avisan por `console.warn` a proposito; aqui solo
  // estorbarian la salida.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Los tres desenlaces posibles, y ninguno mas. */
type Desenlace = "EAS" | "SIMULADO" | "LANZA";

/**
 * Todos los valores que `ENABLE_DEV_TOOLS` puede traer en la practica.
 * `"ON"` esta a proposito: es el valor que uno escribe por intuicion y **no
 * existe**.
 */
const MODOS = [
  { etiqueta: "ausente", valor: undefined },
  { etiqueta: "OFF", valor: "OFF" },
  { etiqueta: "invalido (ON)", valor: "ON" },
  { etiqueta: "MOCK_USERS", valor: "MOCK_USERS" },
  { etiqueta: "FULL", valor: "FULL" },
] as const;

/** `"production"` en ingles es el error probable de `APP_ENV`. */
const ENTORNOS = [
  { etiqueta: "ausente", valor: undefined },
  { etiqueta: "produccion", valor: "produccion" },
  { etiqueta: "pruebas", valor: "pruebas" },
  { etiqueta: "invalido (production)", valor: "production" },
] as const;

/**
 * Lo esperado, escrito como la tabla del documento y no derivado del codigo:
 * si se derivara, la prueba no podria contradecirlo.
 *
 * Fila = modo, columna = entorno, en el mismo orden que los arreglos de arriba.
 */
const ESPERADO_EN_DESPLIEGUE: readonly (readonly Desenlace[])[] = [
  /* ausente       */ ["EAS", "EAS", "EAS", "EAS"],
  /* OFF           */ ["EAS", "EAS", "EAS", "EAS"],
  /* invalido (ON) */ ["EAS", "EAS", "EAS", "EAS"],
  /* MOCK_USERS    */ ["LANZA", "LANZA", "SIMULADO", "LANZA"],
  /* FULL          */ ["LANZA", "LANZA", "SIMULADO", "LANZA"],
];

/** En local `APP_ENV` es irrelevante: la misma respuesta en las cuatro columnas. */
const ESPERADO_EN_LOCAL: readonly Desenlace[] = [
  "EAS",
  "EAS",
  "EAS",
  "SIMULADO",
  "SIMULADO",
];

const montar = (
  nodeEnv: string,
  modo: string | undefined,
  entorno: string | undefined,
) => {
  vi.stubEnv("NODE_ENV", nodeEnv);
  // `stubEnv` con `undefined` borra la variable, que es lo que hay que
  // distinguir de una cadena vacia.
  vi.stubEnv("ENABLE_DEV_TOOLS", modo as string);
  vi.stubEnv("APP_ENV", entorno as string);
};

/** Ejecuta una peticion real y clasifica lo que paso. */
const desenlaceObservado = async (): Promise<Desenlace> => {
  try {
    await obtenerPermisos("okta|1");
  } catch {
    return "LANZA";
  }
  return consultarMock.mock.calls.length > 0 ? "EAS" : "SIMULADO";
};

describe("tabla de verdad en un despliegue compilado (NODE_ENV=production)", () => {
  // Amplify Hosting compila y sirve **toda** rama en modo produccion, incluida
  // una de pruebas: esta es la mitad de la tabla que decide la seguridad de un
  // despliegue.
  MODOS.forEach((modo, fila) => {
    ENTORNOS.forEach((entorno, columna) => {
      const esperado = ESPERADO_EN_DESPLIEGUE[fila]?.[columna];

      it(`ENABLE_DEV_TOOLS ${modo.etiqueta} + APP_ENV ${entorno.etiqueta} -> ${String(esperado)}`, async () => {
        montar("production", modo.valor, entorno.valor);

        expect(await desenlaceObservado()).toBe(esperado);
      });
    });
  });
});

describe("tabla de verdad en local (NODE_ENV distinto de production)", () => {
  MODOS.forEach((modo, fila) => {
    const esperado = ESPERADO_EN_LOCAL[fila];

    ENTORNOS.forEach((entorno) => {
      it(`ENABLE_DEV_TOOLS ${modo.etiqueta} + APP_ENV ${entorno.etiqueta} -> ${String(esperado)}`, async () => {
        montar("development", modo.valor, entorno.valor);

        expect(await desenlaceObservado()).toBe(esperado);
      });
    });
  });
});

describe("las propiedades que la tabla existe para garantizar", () => {
  it("ninguna omision concede mas que OFF", async () => {
    // La propiedad central (regla 18). Se comprueba sobre la tabla entera y no
    // sobre una casilla: en un despliegue, cualquier combinacion donde falte
    // una de las dos variables tiene que dar EAS o LANZA, jamas SIMULADO.
    const conAlgunaAusente = MODOS.flatMap((modo, fila) =>
      ENTORNOS.map((entorno, columna) => ({
        modo,
        entorno,
        esperado: ESPERADO_EN_DESPLIEGUE[fila]?.[columna],
      })),
    ).filter(({ modo, entorno }) => !modo.valor || !entorno.valor);

    expect(conAlgunaAusente.length).toBeGreaterThan(0);
    for (const { modo, entorno, esperado } of conAlgunaAusente) {
      expect(
        esperado,
        `${modo.etiqueta} + ${entorno.etiqueta} no puede ser SIMULADO`,
      ).not.toBe("SIMULADO");
    }
  });

  it("solo dos casillas de un despliegue dan autorizacion simulada", async () => {
    // Y las dos exigen las dos variables escritas a proposito.
    const simuladas = MODOS.flatMap((modo, fila) =>
      ENTORNOS.filter(
        (_, columna) => ESPERADO_EN_DESPLIEGUE[fila]?.[columna] === "SIMULADO",
      ).map((entorno) => `${modo.etiqueta} + ${entorno.etiqueta}`),
    );

    expect(simuladas).toEqual(["MOCK_USERS + pruebas", "FULL + pruebas"]);
  });

  it("APP_ENV=pruebas no enciende nada por si sola", async () => {
    // Declarar el entorno solo deja de bloquear lo que `ENABLE_DEV_TOOLS` ya
    // pidio. La fila de `OFF` es EAS en las cuatro columnas.
    montar("production", "OFF", "pruebas");

    expect(await desenlaceObservado()).toBe("EAS");
  });

  it("la impersonacion es un subconjunto estricto de SIMULADO: solo FULL", () => {
    // `MOCK_USERS` nunca lee la cookie, ni en pruebas ni en local.
    for (const entorno of ENTORNOS) {
      montar("production", "MOCK_USERS", entorno.valor);
      expect(impersonacionHabilitada()).toBe(false);

      montar("development", "MOCK_USERS", entorno.valor);
      expect(impersonacionHabilitada()).toBe(false);
    }

    montar("production", "FULL", "pruebas");
    expect(impersonacionHabilitada()).toBe(true);
  });

  it("un ENABLE_DEV_TOOLS invalido intenta EAS de verdad, y eso es el sintoma de `ON`", async () => {
    // Cae del lado seguro, pero conviene saber que pasa: quien escriba
    // `ENABLE_DEV_TOOLS=ON` en un ambiente de pruebas no vera el conmutador —
    // vera la aplicacion consultando un EAS que quizas no esta aprobado (R17).
    montar("production", "ON", "pruebas");

    expect(await desenlaceObservado()).toBe("EAS");
    expect(consultarMock).toHaveBeenCalledWith("okta|1");
  });
});
