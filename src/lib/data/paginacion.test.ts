// @vitest-environment node
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crearClienteFalso } from "@/utils/clienteDynamoFalso";
import { contarConQuery, itemsDeQuery, paginasDeQuery } from "./paginacion";

vi.mock("server-only", () => ({}));

const deps = (cliente: unknown) => ({ cliente: cliente as never });

/** El comando que se repite en cada pagina, con la clave de continuacion. */
const comando = (desde: Record<string, unknown> | undefined) =>
  new QueryCommand({
    TableName: "tabla-de-prueba",
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": "LOTE#L1" },
    ExclusiveStartKey: desde,
  });

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("paginasDeQuery", () => {
  it("una pagina sin LastEvaluatedKey es una sola consulta", async () => {
    const falso = crearClienteFalso({ respuestas: [{ Items: [{ SK: "a" }] }] });

    const paginas = [];
    for await (const pagina of paginasDeQuery(comando, deps(falso.cliente))) {
      paginas.push(pagina);
    }

    expect(paginas).toHaveLength(1);
    expect(falso.comandos).toHaveLength(1);
  });

  it("recorre hasta que LastEvaluatedKey deja de venir", async () => {
    const falso = crearClienteFalso({
      respuestas: [
        { Items: [{ SK: "a" }], LastEvaluatedKey: { SK: "a" } },
        { Items: [{ SK: "b" }], LastEvaluatedKey: { SK: "b" } },
        { Items: [{ SK: "c" }] },
      ],
    });

    const items = await itemsDeQuery(comando, deps(falso.cliente));

    expect(items.map((item) => item.SK)).toEqual(["a", "b", "c"]);
    expect(falso.comandos).toHaveLength(3);
  });

  it("cada consulta continua desde la clave que devolvio la anterior", async () => {
    const falso = crearClienteFalso({
      respuestas: [
        { Items: [], LastEvaluatedKey: { SK: "corte-1" } },
        { Items: [], LastEvaluatedKey: { SK: "corte-2" } },
        { Items: [] },
      ],
    });

    await itemsDeQuery(comando, deps(falso.cliente));

    expect(falso.comandos[0]?.input.ExclusiveStartKey).toBeUndefined();
    expect(falso.comandos[1]?.input.ExclusiveStartKey).toEqual({
      SK: "corte-1",
    });
    expect(falso.comandos[2]?.input.ExclusiveStartKey).toEqual({
      SK: "corte-2",
    });
  });

  it("una pagina vacia con clave de continuacion no termina el recorrido", async () => {
    // El caso que producia el defecto: con `FilterExpression`, DynamoDB puede
    // devolver cero items **y** `LastEvaluatedKey`, porque el filtro se evalua
    // despues de leer. Quien se detiene ahi concluye "no hay nada" con datos
    // detras.
    const falso = crearClienteFalso({
      respuestas: [
        { Items: [], LastEvaluatedKey: { SK: "corte" } },
        { Items: [{ SK: "z" }] },
      ],
    });

    const items = await itemsDeQuery(comando, deps(falso.cliente));

    expect(items.map((item) => item.SK)).toEqual(["z"]);
  });

  it("un break deja de leer: quien llama decide cuando tiene suficiente", async () => {
    const falso = crearClienteFalso({
      respuestas: [
        { Items: [{ SK: "a" }], LastEvaluatedKey: { SK: "a" } },
        { Items: [{ SK: "b" }], LastEvaluatedKey: { SK: "b" } },
      ],
    });

    for await (const pagina of paginasDeQuery(comando, deps(falso.cliente))) {
      expect(pagina.Items).toBeDefined();
      break;
    }

    expect(falso.comandos).toHaveLength(1);
  });
});

describe("contarConQuery", () => {
  it("suma el Count de todas las paginas", async () => {
    // Con `Select: COUNT` cada pagina devuelve solo lo que paso su propio
    // filtro: quedarse con la primera devuelve una posicion de fila menor que
    // la real.
    const falso = crearClienteFalso({
      respuestas: [
        { Count: 40, LastEvaluatedKey: { SK: "a" } },
        { Count: 35, LastEvaluatedKey: { SK: "b" } },
        { Count: 7 },
      ],
    });

    expect(await contarConQuery(comando, deps(falso.cliente))).toBe(82);
  });

  it("sin resultados cuenta cero, no undefined", async () => {
    const falso = crearClienteFalso({ respuestas: [{}] });

    expect(await contarConQuery(comando, deps(falso.cliente))).toBe(0);
  });
});
