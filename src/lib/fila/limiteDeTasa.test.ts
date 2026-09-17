// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clave } from "@/lib/data/claves";
import { comandoDe, crearClienteFalso } from "@/utils/clienteDynamoFalso";
import {
  INTENTOS_POR_VENTANA,
  registrarIntento,
  VENTANA_DE_TASA_MS,
  ventanaDe,
} from "./limiteDeTasa";

vi.mock("server-only", () => ({}));

const PARTICIPANTE = "P1";
const CONVOCATORIA = "C1";

const entrada = { participanteId: PARTICIPANTE, convocatoriaId: CONVOCATORIA };

describe("ventanaDe", () => {
  it("alinea al inicio de la ventana que contiene al instante", () => {
    const instante = 1_700_000_007_321;
    const ventana = ventanaDe(new Date(instante));

    expect(ventana % VENTANA_DE_TASA_MS).toBe(0);
    expect(ventana).toBeLessThanOrEqual(instante);
    expect(ventana + VENTANA_DE_TASA_MS).toBeGreaterThan(instante);
  });

  it("dos instantes de la misma ventana caen en el mismo contador", () => {
    const base = 1_700_000_000_000;

    expect(ventanaDe(new Date(base))).toBe(
      ventanaDe(new Date(base + VENTANA_DE_TASA_MS - 1)),
    );
  });

  it("el borde de la ventana abre una nueva", () => {
    // La holgura conocida y aceptada: quien se alinee al borde junta dos
    // ventanas y saca el doble de intentos en unos milisegundos. Se prueba para
    // que el dia que alguien lo lea como un defecto encuentre escrito que es
    // una decision — la alternativa deslizante cuesta un viaje mas en el camino
    // que R26 senala como el mas caro, y solo le quita un factor de dos a un
    // adversario que ya iba a ganar con un disparo.
    const base = 1_700_000_000_000;

    expect(ventanaDe(new Date(base + VENTANA_DE_TASA_MS))).not.toBe(
      ventanaDe(new Date(base)),
    );
  });
});

describe("registrarIntento", () => {
  beforeEach(() => {
    vi.stubEnv("AUTOB_TABLE_NAME", "tabla");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const conContador = (intentos: number) =>
    crearClienteFalso({ respuestas: [{ Attributes: { intentos } }] });

  it("el primer intento de la ventana se admite", async () => {
    const falso = conContador(1);

    expect(await registrarIntento(entrada, { cliente: falso.cliente })).toEqual(
      { permitido: true, intentos: 1, ventana: expect.any(Number) },
    );
  });

  it("el intento que iguala el umbral todavia se admite", async () => {
    // El umbral es "cuantos caben", no "a partir de cual se corta". Con la
    // frontera al reves el tope efectivo seria nueve, y el numero escrito en
    // `INTENTOS_POR_VENTANA` mentiria.
    const falso = conContador(INTENTOS_POR_VENTANA);

    expect(
      (await registrarIntento(entrada, { cliente: falso.cliente })).permitido,
    ).toBe(true);
  });

  it("el siguiente se rechaza", async () => {
    const falso = conContador(INTENTOS_POR_VENTANA + 1);

    expect(
      await registrarIntento(entrada, { cliente: falso.cliente }),
    ).toMatchObject({ permitido: false, intentos: INTENTOS_POR_VENTANA + 1 });
  });

  it("sigue contando despues de rechazar", async () => {
    // Un limitador que dejara de contar al pasarse premiaria al que insiste:
    // bastaria seguir disparando para que la ventana pareciera vacia. Y sin
    // esto la evidencia diria "se paso", pero no "se paso ochenta y cinco
    // veces", que es lo unico que distingue un doble clic de un bucle.
    const falso = conContador(85);

    expect(
      await registrarIntento(entrada, { cliente: falso.cliente }),
    ).toMatchObject({ permitido: false, intentos: 85 });
  });

  it("escribe un `ADD` sobre la clave del participante, la convocatoria y la ventana", async () => {
    const ahora = new Date(1_700_000_003_000);
    const falso = conContador(1);

    await registrarIntento(entrada, {
      cliente: falso.cliente,
      ahora: () => ahora,
    });

    const enviado = comandoDe(falso, "UpdateCommand");
    expect(enviado?.Key).toEqual(
      clave.tasaDeParticipante(PARTICIPANTE, CONVOCATORIA, ventanaDe(ahora)),
    );
    expect(enviado?.UpdateExpression).toContain("ADD intentos :uno");
    expect(enviado?.ReturnValues).toBe("UPDATED_NEW");
    // Sin condicion: la ventana esta en la clave, asi que una ventana nueva es
    // un item nuevo y el `ADD` arranca en uno sin ninguna rama. Es lo que hace
    // que el mecanismo quepa en un solo viaje.
    expect(enviado?.ConditionExpression).toBeUndefined();
  });

  it("un solo viaje, y fuera de toda transaccion", async () => {
    // Lo segundo es lo que impide que un contador inocuo cancele adjudicaciones
    // legitimas del mismo participante con `TransactionConflict`, que es la
    // razon de que no viva en el item de cupo.
    const falso = conContador(1);

    await registrarIntento(entrada, { cliente: falso.cliente });

    expect(falso.comandos.map((comando) => comando.nombre)).toEqual([
      "UpdateCommand",
    ]);
  });

  it("un contador que no vuelve rompe fuerte, no deja pasar", async () => {
    // Regla 15: dejar pasar el intento sin haberlo contado seria un fallback
    // silencioso, y ademas apagaria el umbral justo cuando hace falta.
    const falso = crearClienteFalso({ respuestas: [{ Attributes: {} }] });

    await expect(
      registrarIntento(entrada, { cliente: falso.cliente }),
    ).rejects.toThrow(/contador de tasa/i);
  });
});
