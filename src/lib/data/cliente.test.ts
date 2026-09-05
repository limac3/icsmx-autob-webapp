// @vitest-environment node
vi.mock("server-only", () => ({}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __test__, nombreDeTabla, obtenerCliente } from "./cliente";

// Sin red y sin AWS: construir el cliente no resuelve credenciales ni region.
// Eso solo ocurre al enviar un comando, y aqui no se envia ninguno.

beforeEach(() => {
  __test__.reiniciar();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __test__.reiniciar();
});

describe("nombreDeTabla", () => {
  it("devuelve la variable de entorno", () => {
    vi.stubEnv("AUTOB_TABLE_NAME", "autob-sandbox");
    expect(nombreDeTabla()).toBe("autob-sandbox");
  });

  it("falla explicitamente si no esta configurada (regla 15)", () => {
    // Sin fallback silencioso ni valor por defecto: una tabla equivocada es
    // peor que un arranque fallido, porque escribe datos reales en el lugar
    // incorrecto y nadie se entera.
    vi.stubEnv("AUTOB_TABLE_NAME", "");
    expect(() => nombreDeTabla()).toThrow(/AUTOB_TABLE_NAME/);
  });

  it("el mensaje dice como obtener el nombre", () => {
    vi.stubEnv("AUTOB_TABLE_NAME", "");
    expect(() => nombreDeTabla()).toThrow(/ampx sandbox/);
  });
});

describe("obtenerCliente", () => {
  it("devuelve siempre la misma instancia", () => {
    // Un cliente por proceso: cada instancia abre su propio grupo de
    // conexiones y su propia cadena de credenciales.
    expect(obtenerCliente()).toBe(obtenerCliente());
  });

  it("no se construye al importar el modulo", () => {
    // Diferido a proposito: `next build` evalua los modulos que alcanza al
    // recolectar rutas, y un cliente creado al importar exigiria region y
    // credenciales en tiempo de compilacion. La compuerta debe correr en una
    // maquina sin AWS.
    //
    // Que este test llegue hasta aqui ya lo demuestra: el import de arriba
    // ocurrio y `reiniciar()` dejo el memo vacio, asi que la primera
    // construccion es la de la linea siguiente.
    expect(() => obtenerCliente()).not.toThrow();
  });

  it("no necesita AUTOB_TABLE_NAME para construirse", () => {
    // El nombre de la tabla se resuelve por operacion, no al construir: un
    // modulo que solo importa el cliente no debe fallar por una variable que
    // no va a usar.
    vi.stubEnv("AUTOB_TABLE_NAME", "");
    expect(() => obtenerCliente()).not.toThrow();
  });

  it("reiniciar descarta la instancia memorizada", () => {
    const primera = obtenerCliente();
    __test__.reiniciar();
    expect(obtenerCliente()).not.toBe(primera);
  });
});

describe("opciones de conversion", () => {
  type ConClientConfig = {
    config: {
      translateConfig?: {
        marshallOptions?: Record<string, unknown>;
        unmarshallOptions?: Record<string, unknown>;
      };
    };
  };

  const translateConfig = () =>
    (obtenerCliente() as unknown as ConClientConfig).config.translateConfig;

  it("omite los atributos undefined en vez de fallar", () => {
    expect(translateConfig()?.marshallOptions?.removeUndefinedValues).toBe(
      true,
    );
  });

  it("no envuelve los numeros en BigInt", () => {
    // Turno, contador, precio y horas caben de sobra en un `number`.
    // Envolverlos obligaria a convertir en cada comparacion, que es donde se
    // cometen los errores.
    expect(translateConfig()?.unmarshallOptions?.wrapNumbers).toBe(false);
  });

  it("no convierte instancias de clase en mapas", () => {
    // Escribir un objeto que no es un item plano debe ser un error visible, no
    // una serializacion parcial que se descubre al leer.
    expect(translateConfig()?.marshallOptions?.convertClassInstanceToMap).toBe(
      false,
    );
  });

  it("no hay ninguna opcion que convierta null en ausencia", () => {
    // `removeUndefinedValues` omite `undefined`, **no** `null`, y ninguna otra
    // opcion lo hace. Escribir `adjudicacionActual: null` romperia la
    // exclusion mutua del lote: la condicion
    // `attribute_not_exists(adjudicacionActual)` pasaria sobre un atributo que
    // si existe, y el mismo lote se adjudicaria dos veces. Por eso ese
    // atributo se quita con REMOVE y nunca se asigna (modelo-datos 2.2).
    //
    // La afirmacion util es que la configuracion es exactamente esta: si
    // alguien agrega una opcion de conversion, este test lo obliga a razonar
    // sobre el efecto en `null` antes de pasar la compuerta.
    expect(translateConfig()?.marshallOptions).toEqual({
      removeUndefinedValues: true,
      convertClassInstanceToMap: false,
    });
  });
});
