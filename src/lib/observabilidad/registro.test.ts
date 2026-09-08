// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMPOS_REDACTADOS,
  MARCA_DE_REDACCION,
  OPERACIONES,
  redactar,
  registrar,
} from "./registro";

vi.mock("server-only", () => ({}));

const espiar = (nivel: "info" | "warn" | "error") =>
  vi.spyOn(console, nivel).mockImplementation(() => undefined);

beforeEach(() => {
  // `registrar` no escribe nada dentro de Vitest: con el motor de fila
  // ejercitandose cientos de veces, la compuerta quedaria sepultada bajo miles
  // de lineas de traza. Estas pruebas —las unicas que miran la salida— se
  // sacan de esa excepcion quitando la marca del corredor.
  vi.stubEnv("VITEST", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("redactar", () => {
  it("sustituye el valor de un campo sensible por la marca, sin quitar la clave", () => {
    // Quitar la clave dejaria un registro que parece completo y no lo esta:
    // nadie podria distinguir "se redacto" de "nadie lo paso".
    expect(redactar({ destinatario: "ana@example.com", turno: 3 })).toEqual({
      destinatario: MARCA_DE_REDACCION,
      turno: 3,
    });
  });

  it("redacta tambien dentro de un objeto anidado", () => {
    expect(
      redactar({ mensaje: { correo: "ana@example.com", intentos: 2 } }),
    ).toEqual({
      mensaje: { correo: MARCA_DE_REDACCION, intentos: 2 },
    });
  });

  it("no redacta participanteId: es un ULID interno y sin el no se diagnostica R-8", () => {
    // El runbook R-8 ("sospecha de orden injusto en una fila") consiste en
    // seguir a un participante por la fila. Redactar su identificador tecnico
    // no protege a nadie y vuelve el runbook inejecutable.
    expect(CAMPOS_REDACTADOS.has("participanteId")).toBe(false);
    expect(redactar({ participanteId: "01JABC" })).toEqual({
      participanteId: "01JABC",
    });
  });

  it("deja pasar null y undefined sin convertirlos en objeto", () => {
    // `typeof null === "object"`: sin la comprobacion explicita, `redactar`
    // recurriria sobre null y lo devolveria como `{}`.
    expect(redactar({ a: null, b: undefined })).toEqual({
      a: null,
      b: undefined,
    });
  });
});

describe("registrar", () => {
  it("escribe un objeto (no una cadena) para que Logs Insights lo recorra", () => {
    // Con el formato JSON de Lambda, `JSON.stringify` quedaria como
    // `message: "{...}"` —JSON escapado dentro de JSON— y `message.operacion`
    // no existiria como campo consultable.
    const consola = espiar("info");
    registrar("info", "adjudicarLote", { correlacionId: "COR1" });

    expect(consola).toHaveBeenCalledTimes(1);
    expect(typeof consola.mock.calls[0]?.[0]).toBe("object");
  });

  it("incluye nivel, operacion y un instante ISO", () => {
    const consola = espiar("info");
    registrar("info", "solicitarCompra", {});

    expect(consola.mock.calls[0]?.[0]).toMatchObject({
      nivel: "info",
      operacion: "solicitarCompra",
      en: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) as unknown as string,
    });
  });

  it("usa la consola que corresponde a cada nivel", () => {
    const info = espiar("info");
    const warn = espiar("warn");
    const error = espiar("error");

    registrar("info", "transaccion", {});
    registrar("warn", "transaccion", {});
    registrar("error", "transaccion", {});

    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("redacta los campos sensibles que le llegan", () => {
    const consola = espiar("warn");
    registrar("warn", "procesarOutbox", { destinatario: "ana@example.com" });

    expect(consola.mock.calls[0]?.[0]).toMatchObject({
      destinatario: MARCA_DE_REDACCION,
    });
  });

  it("nivel y operacion no se pueden pisar desde los campos", () => {
    const consola = espiar("error");
    registrar("error", "adjudicarLote", {
      nivel: "info",
      operacion: "procesarOutbox",
    });

    expect(consola.mock.calls[0]?.[0]).toMatchObject({
      nivel: "error",
      operacion: "adjudicarLote",
    });
  });

  it("no lanza si la consola falla: el registro observa, no decide", () => {
    // Contrapartida de la regla 15. Un fallo de infraestructura de negocio
    // tiene que ser explicito; un fallo al *describir* la operacion no puede
    // tumbar la adjudicacion que estaba describiendo.
    vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("consola caida");
    });

    expect(() => {
      registrar("info", "adjudicarLote", {});
    }).not.toThrow();
  });

  it("con la marca del corredor puesta no escribe nada", () => {
    // Es lo que mantiene legible la salida de `verify:rapido`. Se comprueba
    // porque es una excepcion deliberada: si algun dia deja de aplicarse, la
    // compuerta se vuelve ilegible de golpe y conviene que falle una prueba
    // antes que descubrirlo leyendo tres mil lineas.
    vi.stubEnv("VITEST", "true");
    const consola = espiar("info");

    registrar("info", "adjudicarLote", {});

    expect(consola).not.toHaveBeenCalled();
  });
});

describe("catalogo de operaciones", () => {
  it("cubre las tres operaciones criticas y las dos del barrido", () => {
    // `arquitectura-tecnica-aws.md` 7 nombra solicitar, adjudicar y vencer. El
    // barrido y el outbox se agregan porque corren sin nadie mirando.
    expect([...OPERACIONES]).toEqual(
      expect.arrayContaining([
        "solicitarCompra",
        "adjudicarLote",
        "vencerYReasignar",
        "barridoDeVencimientos",
        "procesarOutbox",
      ]),
    );
  });

  it("no tiene nombres repetidos: uno duplicado partiria una serie en dos", () => {
    expect(new Set(OPERACIONES).size).toBe(OPERACIONES.length);
  });
});
