// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { itemDeConsumoDeCupo, itemDeLiberacionDeCupo } from "./cupo";

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("consumir cupo", () => {
  it("condiciona sobre el valor previo al ADD, en la misma operacion atomica", () => {
    // Es lo que hace innecesaria —y prohibida, por la regla 6— una lectura
    // previa: no hay ventana entre comprobar y sumar, asi que con cupo K, N
    // intentos simultaneos producen exactamente K exitos.
    const item = itemDeConsumoDeCupo({
      participanteId: "P1",
      convocatoriaId: "C1",
      limite: 2,
    });

    expect(item.item.Update).toMatchObject({
      Key: { PK: "PART#P1", SK: "CUPO#C1" },
      UpdateExpression: "ADD cupoConsumido :uno",
      ConditionExpression:
        "attribute_not_exists(cupoConsumido) OR cupoConsumido < :limite",
      ExpressionAttributeValues: { ":uno": 1, ":limite": 2 },
    });
  });

  it("la primera adjudicacion pasa aunque el item ya exista sin el contador", () => {
    // El item de cupo nace con el ordinal de R-22 en la **primera solicitud**,
    // asi que para cuando se adjudica ya existe, pero sin `cupoConsumido`. Sin
    // la rama `attribute_not_exists` nadie podria ganar su primer vehiculo.
    const item = itemDeConsumoDeCupo({
      participanteId: "P1",
      convocatoriaId: "C1",
      limite: 1,
    });

    expect(String(item.item.Update?.ConditionExpression)).toContain(
      "attribute_not_exists(cupoConsumido)",
    );
  });

  it("su fallo se traduce a limite_alcanzado, no a un error generico", () => {
    // `siFalla` es lo que permite a T2 distinguir "el lote ya se adjudico,
    // abortar" de "este candidato agoto su cupo, probar con el siguiente" —
    // dos reacciones opuestas ante la misma `TransactionCanceledException`.
    const item = itemDeConsumoDeCupo({
      participanteId: "P1",
      convocatoriaId: "C1",
      limite: 1,
    });

    expect(item.siFalla).toBe("limite_alcanzado");
  });
});

describe("liberar cupo", () => {
  it("resta uno, sin condicion propia", () => {
    // La proteccion contra el doble decremento es de sus hermanos: este item
    // siempre viaja en una transaccion que ademas cierra la solicitud
    // adjudicada, con condiciones que fallan al repetirse.
    const item = itemDeLiberacionDeCupo({
      participanteId: "P1",
      convocatoriaId: "C1",
    });

    expect(item.item.Update).toMatchObject({
      Key: { PK: "PART#P1", SK: "CUPO#C1" },
      UpdateExpression: "ADD cupoConsumido :menosUno",
      ExpressionAttributeValues: { ":menosUno": -1 },
    });
    expect(item.item.Update?.ConditionExpression).toBeUndefined();
  });

  it("apunta al mismo item que el consumo, para que los dos se anulen", () => {
    const consumo = itemDeConsumoDeCupo({
      participanteId: "P7",
      convocatoriaId: "C9",
      limite: 3,
    });
    const liberacion = itemDeLiberacionDeCupo({
      participanteId: "P7",
      convocatoriaId: "C9",
    });

    expect(liberacion.item.Update?.Key).toEqual(consumo.item.Update?.Key);
  });
});
