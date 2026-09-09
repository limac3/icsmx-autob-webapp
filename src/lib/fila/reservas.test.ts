// @vitest-environment node
import {
  ConditionalCheckFailedException,
  TransactionConflictException,
} from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  anotarReserva,
  CONDICION_RESERVA_NUEVA,
  liberarReserva,
} from "./reservas";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const clienteQue = (comportamiento: () => unknown): DynamoDBDocumentClient =>
  ({
    send: vi.fn(async () => comportamiento()),
  }) as unknown as DynamoDBDocumentClient;

const reserva = { loteId: "L1", reservaId: "R1" };

describe("liberarReserva tolera lo que declara tolerar", () => {
  // El comentario del helper dice: "Idempotente: que ya no exista es exito, no
  // error" y "es de **mejor esfuerzo**: la correccion no depende de ella, solo
  // la espera". Estas pruebas fijan las dos formas en que eso se puede romper,
  // porque `adjudicarLote` llama a `depurarYContarReservas` en cada ronda y
  // cualquier excepcion que escape de aqui tumba una adjudicacion.

  it("borra la reserva por su clave", async () => {
    type Comando = { input: { Key: unknown } };
    const send = vi.fn<(comando: Comando) => Promise<object>>(async () => ({}));
    const cliente = { send } as unknown as DynamoDBDocumentClient;

    await liberarReserva(reserva, { cliente });

    expect(send.mock.calls[0]![0].input.Key).toEqual({
      PK: "LOTE#L1",
      SK: "RESERVA#R1",
    });
  });

  it("un fallo de condicion no es un error: la reserva ya no estaba", async () => {
    const cliente = clienteQue(() => {
      throw new ConditionalCheckFailedException({
        message: "condicion",
        $metadata: {},
      });
    });

    await expect(liberarReserva(reserva, { cliente })).resolves.toBeUndefined();
  });

  it("un conflicto de transaccion tampoco: alguien mas la esta resolviendo", async () => {
    // El item de la reserva **si** participa en transacciones — el paso 2 de T1
    // lo borra dentro de la suya —, asi que depurar una reserva muerta puede
    // chocar con el paso 2 que la esta borrando. Dejar escapar la excepcion
    // convertiria una limpieza de mejor esfuerzo en una adjudicacion fallida.
    const cliente = clienteQue(() => {
      throw new TransactionConflictException({
        message: "Transaction is ongoing for the item",
        $metadata: {},
      });
    });

    await expect(liberarReserva(reserva, { cliente })).resolves.toBeUndefined();
  });

  it("cualquier otro error si escapa (regla 15)", async () => {
    // Credenciales, red, tabla inexistente: nada de eso es "alguien mas ya lo
    // resolvio", y tragarlo dejaria reservas huerfanas deteniendo
    // adjudicaciones sin que nadie se enterara.
    const cliente = clienteQue(() => {
      throw new TypeError("cliente sin credenciales");
    });

    await expect(liberarReserva(reserva, { cliente })).rejects.toThrow(
      "cliente sin credenciales",
    );
  });
});

describe("anotarReserva no puede pisar una reserva ajena", () => {
  // El `reservaId` tiene 25 bits de azar dentro de su segundo, asi que con cien
  // solicitudes por segundo sobre el mismo lote repetirlo tiene probabilidad
  // ~1,5 x 10^-4. Sin condicion eso sobrescribiria en silencio la reserva de
  // otro participante, su ventana quedaria sin marcar y R18 —que es justo lo
  // que la reserva existe para cerrar— dejaria de sostenerse.

  it("escribe con la condicion de que la reserva sea nueva", async () => {
    type Comando = { input: { ConditionExpression?: string } };
    const send = vi.fn<(comando: Comando) => Promise<object>>(async () => ({}));
    const cliente = { send } as unknown as DynamoDBDocumentClient;

    await anotarReserva({ ...reserva, ahora: new Date() }, { cliente });

    expect(send.mock.calls[0]?.[0].input.ConditionExpression).toBe(
      CONDICION_RESERVA_NUEVA,
    );
    expect(CONDICION_RESERVA_NUEVA).toBe("attribute_not_exists(SK)");
  });

  it("devuelve false si el identificador ya existia, en vez de lanzar", async () => {
    // Se devuelve y no se lanza para que quien llama pueda responder
    // `conflicto_concurrencia`, que la interfaz sabe reintentar, y no un 500.
    const cliente = clienteQue(() => {
      throw new ConditionalCheckFailedException({
        message: "existe",
        $metadata: {},
      });
    });

    await expect(
      anotarReserva({ ...reserva, ahora: new Date() }, { cliente }),
    ).resolves.toBe(false);
  });

  it("devuelve true cuando la escribe", async () => {
    const cliente = clienteQue(() => ({}));

    await expect(
      anotarReserva({ ...reserva, ahora: new Date() }, { cliente }),
    ).resolves.toBe(true);
  });

  it("propaga cualquier otro fallo: no es un helper de mejor esfuerzo", async () => {
    // A diferencia de `liberarReserva`, la correccion **si** depende de esta:
    // si no se puede anotar la reserva, la solicitud no debe continuar.
    const cliente = clienteQue(() => {
      throw new TransactionConflictException({
        message: "conflicto",
        $metadata: {},
      });
    });

    await expect(
      anotarReserva({ ...reserva, ahora: new Date() }, { cliente }),
    ).rejects.toThrow(TransactionConflictException);
  });
});
