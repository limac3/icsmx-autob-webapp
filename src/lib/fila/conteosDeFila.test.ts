// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crearClienteFalso } from "@/utils/clienteDynamoFalso";
import {
  consultarTamanoFila,
  contarVivasAntesDe,
  __test__,
} from "./conteosDeFila";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("consultarTamanoFila", () => {
  it("cuenta con Select: COUNT, sin traer los items (R-12)", async () => {
    // Es lo que hace estructuralmente imposible filtrar identidades: los items
    // de terceros no salen de DynamoDB, asi que no hay nada que se pueda
    // olvidar al serializar.
    const falso = crearClienteFalso({ respuestas: [{ Count: 0 }] });
    await consultarTamanoFila("L1", { cliente: falso.cliente });

    expect(falso.comandos).toHaveLength(1);
    expect(falso.comandos[0]?.input).toMatchObject({
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :desde AND :hasta",
      Select: "COUNT",
      ExpressionAttributeValues: expect.objectContaining({
        ":pk": "LOTE#L1",
        ":desde": "SOL#0000000000",
        ":hasta": "SOL#9999999999",
      }),
    });
  });

  it("filtra por los cuatro estados vivos", async () => {
    const falso = crearClienteFalso({ respuestas: [{ Count: 0 }] });
    await consultarTamanoFila("L1", { cliente: falso.cliente });

    const input = falso.comandos[0]?.input as {
      FilterExpression: string;
      ExpressionAttributeValues: Record<string, string>;
    };
    expect(input.FilterExpression).toBe(__test__.FILTRO_VIVAS);
    const estados = Object.entries(input.ExpressionAttributeValues)
      .filter(([marca]) => marca.startsWith(":e"))
      .map(([, valor]) => valor);
    expect(new Set(estados)).toEqual(
      new Set(["EN_FILA", "CONGELADA", "ADJUDICADA", "EN_VERIFICACION"]),
    );
  });

  it("devuelve el conteo, y cero cuando no hay fila", async () => {
    const conTres = crearClienteFalso({ respuestas: [{ Count: 3 }] });
    const resultado = await consultarTamanoFila("L1", {
      cliente: conTres.cliente,
    });
    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data).toBe(3);

    const vacio = crearClienteFalso({ respuestas: [{}] });
    const sinFila = await consultarTamanoFila("L1", { cliente: vacio.cliente });
    if (!sinFila.ok) throw new Error("se esperaba exito");
    expect(sinFila.data).toBe(0);
  });
});

describe("contarVivasAntesDe", () => {
  it("acota el rango al turno anterior, sin contarse a si mismo", async () => {
    // `BETWEEN` es inclusivo en los dos extremos: incluir el propio turno
    // devolveria una posicion de mas.
    const falso = crearClienteFalso({ respuestas: [{ Count: 2 }] });
    await contarVivasAntesDe("L1", 5, { cliente: falso.cliente });

    expect(falso.comandos[0]?.input).toMatchObject({
      ExpressionAttributeValues: expect.objectContaining({
        ":desde": "SOL#0000000000",
        ":hasta": "SOL#0000000004",
      }),
    });
  });

  it("el primer turno no tiene a nadie delante y no consulta nada", async () => {
    const falso = crearClienteFalso({ respuestas: [{ Count: 9 }] });
    const resultado = await contarVivasAntesDe("L1", 1, {
      cliente: falso.cliente,
    });

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data).toBe(0);
    expect(falso.comandos).toHaveLength(0);
  });

  it("solo cuenta las vivas: una cancelada no ocupa lugar", async () => {
    const falso = crearClienteFalso({ respuestas: [{ Count: 1 }] });
    await contarVivasAntesDe("L1", 4, { cliente: falso.cliente });

    expect(falso.comandos[0]?.input).toMatchObject({
      FilterExpression: __test__.FILTRO_VIVAS,
    });
  });
});
