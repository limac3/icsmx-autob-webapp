// @vitest-environment node
vi.mock("server-only", () => ({}));

import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clave } from "./claves";
import {
  CONDICION_APPEND_ONLY,
  CONDICION_CENTINELA_NUEVO,
  CONDICION_LOTE_LIBRE,
  ejecutarTransaccion,
  esFalloDeCondicion,
  MAXIMO_ITEMS_POR_TRANSACCION,
  putDeEvento,
  type ItemDeTransaccion,
} from "./transacciones";

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Cliente falso: nunca sale de la maquina, ni siquiera para resolver region. */
const clienteQue = (comportamiento: () => unknown): DynamoDBDocumentClient =>
  ({
    send: vi.fn(async () => comportamiento()),
  }) as unknown as DynamoDBDocumentClient;

const cancelacion = (
  codigos: readonly (string | undefined)[],
): TransactionCanceledException =>
  new TransactionCanceledException({
    message: "Transaction cancelled, please refer cancellation reasons",
    $metadata: {},
    CancellationReasons: codigos.map((Code) => ({ Code })),
  });

const item = (siFalla: ItemDeTransaccion["siFalla"], descripcion: string) =>
  ({
    item: { Put: { TableName: "tabla-de-prueba", Item: { PK: "x", SK: "y" } } },
    siFalla,
    descripcion,
  }) satisfies ItemDeTransaccion;

// Los cuatro items del paso 2 de T2, en su orden real. Es el escenario que
// justifica todo este archivo: segun **cual** condicion falle, el bucle de
// candidatos debe abortar o continuar con el turno siguiente.
const ITEMS_DE_T2: ItemDeTransaccion[] = [
  item("lote_no_disponible", "lote sin adjudicacion"),
  item("invalid_state", "solicitud EN_FILA"),
  item("adjudicacion_activa", "centinela de adjudicacion"),
  item("conflicto_concurrencia", "evento LOTE_ADJUDICADO"),
];

describe("ejecutarTransaccion", () => {
  it("devuelve ok cuando la transaccion pasa", async () => {
    const cliente = clienteQue(() => ({}));
    await expect(
      ejecutarTransaccion(ITEMS_DE_T2, { cliente }),
    ).resolves.toEqual({ ok: true });
  });

  it("envia exactamente los items recibidos, en orden", async () => {
    type ComandoEnviado = { input: { TransactItems: unknown[] } };
    const send = vi.fn<(comando: ComandoEnviado) => Promise<object>>(
      async () => ({}),
    );
    const cliente = { send } as unknown as DynamoDBDocumentClient;
    await ejecutarTransaccion(ITEMS_DE_T2, { cliente });

    const comando = send.mock.calls[0]![0];
    expect(comando.input.TransactItems).toHaveLength(4);
    expect(comando.input.TransactItems).toEqual(ITEMS_DE_T2.map((i) => i.item));
  });
});

describe("traduccion posicional de la cancelacion", () => {
  // Esta es la razon de existir del archivo. `CancellationReasons` es un
  // arreglo paralelo a los items; tratar todas las cancelaciones igual haria
  // imposible distinguir "abortar" de "probar con el siguiente".

  it("el fallo del item 1 de T2 dice que el lote ya se adjudico", async () => {
    const cliente = clienteQue(() => {
      throw cancelacion(["ConditionalCheckFailed", "None", "None", "None"]);
    });

    await expect(
      ejecutarTransaccion(ITEMS_DE_T2, { cliente }),
    ).resolves.toEqual({
      ok: false,
      error: "lote_no_disponible",
      indice: 0,
      descripcion: "lote sin adjudicacion",
    });
  });

  it("el fallo del item 3 dice que el candidato ya tiene una adjudicacion", async () => {
    // Misma excepcion, otra posicion, reaccion opuesta: aqui el bucle marca la
    // solicitud CONGELADA y sigue con el turno siguiente (R-09).
    const cliente = clienteQue(() => {
      throw cancelacion(["None", "None", "ConditionalCheckFailed", "None"]);
    });

    await expect(
      ejecutarTransaccion(ITEMS_DE_T2, { cliente }),
    ).resolves.toEqual({
      ok: false,
      error: "adjudicacion_activa",
      indice: 2,
      descripcion: "centinela de adjudicacion",
    });
  });

  it("dos posiciones distintas producen errores de dominio distintos", async () => {
    const resultados = await Promise.all(
      [0, 1, 2, 3].map((posicion) => {
        const codigos = ITEMS_DE_T2.map((_, i) =>
          i === posicion ? "ConditionalCheckFailed" : "None",
        );
        return ejecutarTransaccion(ITEMS_DE_T2, {
          cliente: clienteQue(() => {
            throw cancelacion(codigos);
          }),
        });
      }),
    );

    expect(resultados.map((r) => (r.ok ? "ok" : r.error))).toEqual([
      "lote_no_disponible",
      "invalid_state",
      "adjudicacion_activa",
      "conflicto_concurrencia",
    ]);
  });

  it("con varias condiciones fallidas se queda con la primera", async () => {
    // El item 1 de T2 es "el lote ya esta adjudicado", que aborta el bucle; los
    // siguientes son razones para continuar con otro candidato. Quedarse con el
    // ultimo invertiria la decision.
    const cliente = clienteQue(() => {
      throw cancelacion([
        "ConditionalCheckFailed",
        "None",
        "ConditionalCheckFailed",
        "None",
      ]);
    });

    const resultado = await ejecutarTransaccion(ITEMS_DE_T2, { cliente });
    expect(resultado).toMatchObject({ error: "lote_no_disponible", indice: 0 });
  });

  it("TransactionConflict es una carrera, no un estado de negocio", async () => {
    const cliente = clienteQue(() => {
      throw cancelacion(["None", "TransactionConflict", "None", "None"]);
    });

    await expect(
      ejecutarTransaccion(ITEMS_DE_T2, { cliente }),
    ).resolves.toMatchObject({ error: "conflicto_concurrencia", indice: 1 });
  });

  it.each([
    "ThrottlingError",
    "ProvisionedThroughputExceeded",
    "ItemCollectionSizeLimitExceeded",
  ])("%s es una dependencia que no responde", async (codigo) => {
    const cliente = clienteQue(() => {
      throw cancelacion(["None", "None", "None", codigo]);
    });

    await expect(
      ejecutarTransaccion(ITEMS_DE_T2, { cliente }),
    ).resolves.toMatchObject({ error: "dependencia_no_disponible" });
  });

  it("un codigo desconocido no se confunde con un estado de negocio", async () => {
    // `ValidationError` y cualquier codigo nuevo del servicio son defectos de
    // la transaccion que escribimos, no del negocio. Devolver el `siFalla`
    // declarado le diria al participante que su solicitud es invalida cuando
    // el problema es nuestro.
    const cliente = clienteQue(() => {
      throw cancelacion(["ValidationError", "None", "None", "None"]);
    });

    await expect(
      ejecutarTransaccion(ITEMS_DE_T2, { cliente }),
    ).resolves.toMatchObject({ error: "invalid_state", indice: 0 });
  });

  it("una cancelacion sin motivo atribuible es una carrera", async () => {
    const cliente = clienteQue(() => {
      throw cancelacion(["None", "None", "None", "None"]);
    });

    await expect(
      ejecutarTransaccion(ITEMS_DE_T2, { cliente }),
    ).resolves.toEqual({ ok: false, error: "conflicto_concurrencia" });
  });

  it("aguanta que el servicio no mande CancellationReasons", async () => {
    const cliente = clienteQue(() => {
      throw new TransactionCanceledException({
        message: "Transaction cancelled",
        $metadata: {},
      });
    });

    await expect(
      ejecutarTransaccion(ITEMS_DE_T2, { cliente }),
    ).resolves.toEqual({ ok: false, error: "conflicto_concurrencia" });
  });

  it("propaga cualquier otro error en vez de disfrazarlo", async () => {
    // Regla 15: sin fallback silencioso. Un fallo de red no es un estado de
    // negocio y la capa superior no puede hacer nada sensato con el.
    const cliente = clienteQue(() => {
      throw new Error("ECONNRESET");
    });

    await expect(ejecutarTransaccion(ITEMS_DE_T2, { cliente })).rejects.toThrow(
      "ECONNRESET",
    );
  });
});

describe("limites de TransactWriteItems", () => {
  it("rechaza una lista vacia", async () => {
    await expect(
      ejecutarTransaccion([], { cliente: clienteQue(() => ({})) }),
    ).rejects.toThrow(RangeError);
  });

  it("acepta exactamente 100 items", async () => {
    const cien = Array.from({ length: MAXIMO_ITEMS_POR_TRANSACCION }, () =>
      item("invalid_state", "x"),
    );
    await expect(
      ejecutarTransaccion(cien, { cliente: clienteQue(() => ({})) }),
    ).resolves.toEqual({ ok: true });
  });

  it("rechaza 101 en vez de partir en tandas", async () => {
    // Dos transacciones no son una transaccion. Partir en silencio una
    // escritura que se creia atomica rompe invariantes sin ningun sintoma;
    // quien necesite tandas las orquesta explicitamente, como hace T8.
    const ciento_uno = Array.from(
      { length: MAXIMO_ITEMS_POR_TRANSACCION + 1 },
      () => item("invalid_state", "x"),
    );
    await expect(
      ejecutarTransaccion(ciento_uno, { cliente: clienteQue(() => ({})) }),
    ).rejects.toThrow(/101/);
  });

  it("el limite es el de DynamoDB", () => {
    expect(MAXIMO_ITEMS_POR_TRANSACCION).toBe(100);
  });
});

describe("putDeEvento", () => {
  const claveEvento = clave.evento(
    "SOLICITUD",
    "S1",
    "2026-09-15T15:00:00.000Z",
    "E1",
  );

  it("lleva siempre la condicion append-only (regla 5)", () => {
    // IAM no puede impedir la sobrescritura, porque `PutItem` es justo lo que
    // la regla 4 obliga a permitir. Este helper existe para que ningun
    // llamador pueda olvidar la condicion.
    const puesto = putDeEvento(claveEvento, { tipo: "SOLICITUD_CREADA" });
    expect(puesto.item.Put?.ConditionExpression).toBe(CONDICION_APPEND_ONLY);
    expect(CONDICION_APPEND_ONLY).toBe("attribute_not_exists(PK)");
  });

  it("escribe en la tabla configurada", () => {
    const puesto = putDeEvento(claveEvento, {});
    expect(puesto.item.Put?.TableName).toBe("tabla-de-prueba");
  });

  it("la clave gana sobre los atributos, no al reves", () => {
    // Un atributo llamado PK no puede desviar el evento a otra particion.
    const puesto = putDeEvento(claveEvento, { PK: "AUDIT#FALSO#X", dato: 1 });
    expect(puesto.item.Put?.Item).toMatchObject({
      PK: claveEvento.PK,
      SK: claveEvento.SK,
      dato: 1,
    });
  });

  it("un choque de clave es una carrera, no un error del usuario", async () => {
    // O se reintento una transaccion ya aplicada, o dos eventos colisionaron
    // en el mismo milisegundo con el mismo identificador.
    const cliente = clienteQue(() => {
      throw cancelacion(["ConditionalCheckFailed"]);
    });
    await expect(
      ejecutarTransaccion([putDeEvento(claveEvento, {})], { cliente }),
    ).resolves.toMatchObject({ error: "conflicto_concurrencia" });
  });
});

describe("condiciones nombradas", () => {
  it("son las literales de los documentos", () => {
    expect(CONDICION_APPEND_ONLY).toBe("attribute_not_exists(PK)");
    expect(CONDICION_LOTE_LIBRE).toBe(
      "attribute_not_exists(adjudicacionActual)",
    );
    expect(CONDICION_CENTINELA_NUEVO).toBe("attribute_not_exists(SK)");
  });

  it("la del lote mira adjudicacionActual y no el estatus", () => {
    // La exclusion mutua depende de que el atributo no exista. Condicionar por
    // `estatus = EN_OFERTA` seria mas legible y estaria mal: el estatus se
    // actualiza en la misma transaccion, y `adjudicacionActual` se elimina con
    // REMOVE justamente para que esta condicion siga siendo autoridad.
    expect(CONDICION_LOTE_LIBRE).toContain("adjudicacionActual");
    expect(CONDICION_LOTE_LIBRE).not.toContain("estatus");
  });
});

describe("esFalloDeCondicion", () => {
  it("no confunde una cancelacion de transaccion con un fallo suelto", async () => {
    // El paso 1 de T1 es un `UpdateItem` fuera de transaccion, porque
    // `TransactWriteItems` no devuelve valores y el turno del `ADD` no se
    // podria usar como clave del `Put` de la misma transaccion.
    expect(esFalloDeCondicion(cancelacion(["ConditionalCheckFailed"]))).toBe(
      false,
    );
    expect(esFalloDeCondicion(new Error("otra cosa"))).toBe(false);
    expect(esFalloDeCondicion(undefined)).toBe(false);
  });
});
