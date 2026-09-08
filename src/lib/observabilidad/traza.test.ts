// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __test__, conTraza } from "./traza";

vi.mock("server-only", () => ({}));

const espiar = (nivel: "info" | "warn" | "error") =>
  vi.spyOn(console, nivel).mockImplementation(() => undefined);

beforeEach(() => {
  // Ver `registro.test.ts`: dentro de Vitest el registro esta silenciado a
  // proposito, y estas pruebas se sacan de la excepcion para poder mirarlo.
  vi.stubEnv("VITEST", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("conTraza", () => {
  it("devuelve intacto lo que devolvio la operacion", async () => {
    espiar("info");
    const valor = await conTraza(
      "solicitarCompra",
      {},
      async () => ({ ok: true as const, data: { turno: 7 } }),
      () => ({ desenlace: "ok" }),
    );

    expect(valor).toEqual({ ok: true, data: { turno: 7 } });
  });

  it("un desenlace ok se registra en info, con duracion y contexto", async () => {
    const consola = espiar("info");
    await conTraza(
      "adjudicarLote",
      { correlacionId: "COR1", loteId: "L1" },
      async () => "listo",
      () => ({ desenlace: "ok", turno: 1 }),
    );

    expect(consola.mock.calls[0]?.[0]).toMatchObject({
      operacion: "adjudicarLote",
      correlacionId: "COR1",
      loteId: "L1",
      desenlace: "ok",
      turno: 1,
    });
    expect(
      (consola.mock.calls[0]?.[0] as { duracionMs: unknown }).duracionMs,
    ).toEqual(expect.any(Number));
  });

  it("un rechazo se registra en warn, no en error", async () => {
    // Un lote ya adjudicado es una respuesta correcta del sistema. Contarla
    // como error hace inservible cualquier alarma basada en el nivel.
    const warn = espiar("warn");
    const error = espiar("error");

    await conTraza(
      "adjudicarLote",
      {},
      async () => ({ estado: "lote_no_disponible" }),
      (v) => ({ desenlace: "rechazado", estado: v.estado }),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      desenlace: "rechazado",
      estado: "lote_no_disponible",
    });
  });

  it("una excepcion se registra en error y se vuelve a lanzar", async () => {
    const consola = espiar("error");

    await expect(
      conTraza(
        "vencerYReasignar",
        { loteId: "L9" },
        () => Promise.reject(new TypeError("cliente sin credenciales")),
        () => ({ desenlace: "ok" }),
      ),
    ).rejects.toThrow("cliente sin credenciales");

    expect(consola.mock.calls[0]?.[0]).toMatchObject({
      operacion: "vencerYReasignar",
      loteId: "L9",
      desenlace: "error",
      error: "TypeError: cliente sin credenciales",
    });
  });

  it("no llama a resumir cuando la operacion lanza", async () => {
    espiar("error");
    const resumir = vi.fn(() => ({ desenlace: "ok" as const }));

    await expect(
      conTraza(
        "procesarOutbox",
        {},
        () => Promise.reject(new Error("CES caido")),
        resumir,
      ),
    ).rejects.toThrow("CES caido");

    expect(resumir).not.toHaveBeenCalled();
  });

  it("redacta los campos sensibles del resumen, igual que el registro directo", async () => {
    const consola = espiar("warn");
    await conTraza(
      "procesarOutbox",
      {},
      async () => "fallo",
      () => ({ desenlace: "rechazado", destinatario: "ana@example.com" }),
    );

    expect(consola.mock.calls[0]?.[0]).toMatchObject({
      destinatario: "[redactado]",
    });
  });
});

describe("descripcionDeError", () => {
  it("compone nombre y mensaje, sin la pila", () => {
    expect(__test__.descripcionDeError(new RangeError("fuera"))).toBe(
      "RangeError: fuera",
    );
  });

  it("tolera algo que no es un Error", () => {
    expect(__test__.descripcionDeError("cadena suelta")).toBe("cadena suelta");
  });
});
