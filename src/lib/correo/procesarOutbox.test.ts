// @vitest-environment node
import { TransactionConflictException } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import { enviarCorreo } from "./clienteCes";
import { MAXIMO_INTENTOS_CORREO, procesarOutbox } from "./procesarOutbox";

vi.mock("server-only", () => ({}));
vi.mock("./clienteCes", () => ({ enviarCorreo: vi.fn() }));

const enviar = vi.mocked(enviarCorreo);

const AHORA = new Date("2026-10-08T15:00:00.000Z");

const mensajeItem = (
  mensajeId: string,
  extra: Record<string, unknown> = {},
) => ({
  PK: `OUTBOX#${mensajeId}`,
  SK: "META",
  mensajeId,
  tipo: "ADJUDICACION",
  destinatario: "p1@example.org",
  creadoEn: "2026-10-08T14:00:00.000Z",
  estatus: "PENDIENTE",
  intentos: 0,
  datos: {
    solicitudId: "L1-2",
    loteId: "L1",
    convocatoriaId: "C1",
    vehiculoId: "V1",
    precio: 180_000,
    venceEn: "2026-10-10T15:00:00.000Z",
  },
  ...extra,
});

const conPendientes = (items: Record<string, unknown>[]) => {
  return (comando: ComandoEnviado): unknown => {
    if (comando.nombre === "QueryCommand") return { Items: items };
    return {};
  };
};

const itemsDe = (falso: ReturnType<typeof crearClienteFalso>, nombre: string) =>
  falso.comandos.filter((c) => c.nombre === nombre);

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("procesarOutbox — exito", () => {
  it("marca ENVIADO, retira GSI4 y escribe CORREO_ENVIADO", async () => {
    enviar.mockResolvedValue({ ok: true, idExterno: "MSG-1" });
    const falso = crearClienteFalso({
      responder: conPendientes([mensajeItem("M1")]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado).toEqual({
      enviados: 1,
      fallidosPermanentes: 0,
      reintentaraDespues: 0,
      // `creadoEn` de la plantilla es una hora antes de `AHORA`.
      antiguedadMaximaMin: 60,
    });

    const transaccion = itemsDe(falso, "TransactWriteCommand")[0]?.input
      .TransactItems as Record<string, Record<string, unknown>>[];
    expect(transaccion[0]?.Update).toMatchObject({
      Key: { PK: "OUTBOX#M1", SK: "META" },
      ConditionExpression: "estatus = :pendiente",
    });
    expect(String(transaccion[0]?.Update?.UpdateExpression)).toContain(
      "REMOVE GSI4PK, GSI4SK",
    );
    expect(transaccion[1]?.Put?.Item).toMatchObject({
      tipo: "CORREO_ENVIADO",
      solicitudId: "L1-2",
      loteId: "L1",
      datos: { mensajeId: "M1", idExterno: "MSG-1" },
    });
  });
});

describe("procesarOutbox — fallo transitorio", () => {
  it("solo incrementa intentos, sin transaccion ni evento", async () => {
    enviar.mockResolvedValue({
      ok: false,
      error: "timeout",
      reintentable: true,
    });
    const falso = crearClienteFalso({
      responder: conPendientes([mensajeItem("M1")]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado).toEqual({
      enviados: 0,
      fallidosPermanentes: 0,
      reintentaraDespues: 1,
      antiguedadMaximaMin: 60,
    });
    expect(itemsDe(falso, "TransactWriteCommand")).toHaveLength(0);
    const update = itemsDe(falso, "UpdateCommand")[0];
    expect(update?.input).toMatchObject({
      Key: { PK: "OUTBOX#M1", SK: "META" },
      ConditionExpression: "estatus = :pendiente",
    });
    expect(update?.input.ExpressionAttributeValues).toMatchObject({
      ":intentos": 1,
      ":error": "timeout",
    });
  });

  it("un conflicto de transaccion al anotar el intento no aborta la corrida", async () => {
    // El item del mensaje **si** participa en transacciones (`marcarEnviado` y
    // `marcarFallido`), asi que dos corridas solapadas del barrido pueden
    // chocar: una resolviendo el mensaje por transaccion, la otra anotandole el
    // intento con este `UpdateItem` suelto. Dejar escapar la excepcion
    // abortaria el resto del outbox por no poder escribir un contador.
    enviar.mockResolvedValue({
      ok: false,
      error: "timeout",
      reintentable: true,
    });
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "QueryCommand") {
          return { Items: [mensajeItem("M1")] };
        }
        if (comando.nombre === "UpdateCommand") {
          throw new TransactionConflictException({
            message: "Transaction is ongoing for the item",
            $metadata: {},
          });
        }
        return {};
      },
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado.reintentaraDespues).toBe(1);
  });

  it("al agotar MAXIMO_INTENTOS_CORREO, un fallo reintentable se vuelve permanente", async () => {
    enviar.mockResolvedValue({
      ok: false,
      error: "timeout",
      reintentable: true,
    });
    const falso = crearClienteFalso({
      responder: conPendientes([
        mensajeItem("M1", { intentos: MAXIMO_INTENTOS_CORREO - 1 }),
      ]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado.fallidosPermanentes).toBe(1);
    const transaccion = itemsDe(falso, "TransactWriteCommand")[0]?.input
      .TransactItems as Record<string, Record<string, unknown>>[];
    expect(transaccion[1]?.Put?.Item).toMatchObject({
      tipo: "CORREO_FALLIDO",
      motivo: "timeout",
    });
  });
});

describe("procesarOutbox — fallo no reintentable", () => {
  it("un 401/4xx se vuelve CORREO_FALLIDO de inmediato, sin esperar los reintentos", async () => {
    enviar.mockResolvedValue({
      ok: false,
      error: "CES respondio 401: credenciales",
      reintentable: false,
    });
    const falso = crearClienteFalso({
      responder: conPendientes([mensajeItem("M1")]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado.fallidosPermanentes).toBe(1);
    expect(itemsDe(falso, "UpdateCommand")).toHaveLength(0);
    const transaccion = itemsDe(falso, "TransactWriteCommand")[0]?.input
      .TransactItems as Record<string, Record<string, unknown>>[];
    expect(transaccion[0]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":intentos": 1,
    });
  });
});

describe("procesarOutbox — varios mensajes", () => {
  it("procesa cada mensaje pendiente de forma independiente", async () => {
    enviar
      .mockResolvedValueOnce({ ok: true, idExterno: "MSG-1" })
      .mockResolvedValueOnce({
        ok: false,
        error: "timeout",
        reintentable: true,
      });
    const falso = crearClienteFalso({
      responder: conPendientes([mensajeItem("M1"), mensajeItem("M2")]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado).toEqual({
      enviados: 1,
      fallidosPermanentes: 0,
      reintentaraDespues: 1,
      antiguedadMaximaMin: 60,
    });
  });
});

describe("procesarOutbox — antiguedad del pendiente mas viejo", () => {
  // Es el numero que alimenta la alarma "correos en el outbox mas antiguos que
  // un umbral". Los contadores no sirven para eso: un CES caido deja
  // `reintentaraDespues` en un valor pequeno y constante, igual con dos
  // minutos de retraso que con dos dias.

  it("mide desde el primero de la lista, que PA-14 devuelve como el mas viejo", async () => {
    enviar.mockResolvedValue({
      ok: false,
      error: "timeout",
      reintentable: true,
    });
    const falso = crearClienteFalso({
      responder: conPendientes([
        mensajeItem("M1", { creadoEn: "2026-10-06T15:00:00.000Z" }),
        mensajeItem("M2", { creadoEn: "2026-10-08T14:30:00.000Z" }),
      ]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado.antiguedadMaximaMin).toBe(2 * 24 * 60);
  });

  it("sin pendientes, es cero y no NaN", async () => {
    const falso = crearClienteFalso({ responder: conPendientes([]) });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado.antiguedadMaximaMin).toBe(0);
  });

  it("un creadoEn en el futuro se acota a cero, no a un negativo", async () => {
    // Un negativo no dispararia jamas una alarma de umbral, asi que un reloj
    // torcido o un dato sembrado a mano dejaria el outbox sin vigilancia.
    enviar.mockResolvedValue({
      ok: false,
      error: "timeout",
      reintentable: true,
    });
    const falso = crearClienteFalso({
      responder: conPendientes([
        mensajeItem("M1", { creadoEn: "2026-10-09T15:00:00.000Z" }),
      ]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado.antiguedadMaximaMin).toBe(0);
  });
});
