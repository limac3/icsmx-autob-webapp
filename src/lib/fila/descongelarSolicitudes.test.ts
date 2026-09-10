// @vitest-environment node
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import {
  descongelarSolicitudes,
  MAXIMO_A_DESCONGELAR,
} from "./descongelarSolicitudes";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-10-07T15:00:00.000Z");

const congelada = (loteId: string, turno: number) => ({
  PK: `LOTE#${loteId}`,
  SK: `SOL#${String(turno).padStart(10, "0")}`,
  solicitudId: `${loteId}-${String(turno)}`,
  loteId,
  participanteId: "P1",
  turno,
  estatus: "CONGELADA",
  solicitadoEn: "2026-10-06T15:00:00.000Z",
});

const conCongeladas =
  (items: Record<string, unknown>[]) => (comando: ComandoEnviado) =>
    comando.nombre === "QueryCommand" ? { Items: items } : {};

const deps = (cliente: unknown) => ({
  cliente: cliente as never,
  ahora: () => AHORA,
});

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("descongelarSolicitudes — R-09", () => {
  it("busca las congeladas del participante por GSI3", async () => {
    const falso = crearClienteFalso({ responder: conCongeladas([]) });

    await descongelarSolicitudes({ participanteId: "P1" }, deps(falso.cliente));

    expect(falso.comandos[0]?.input).toMatchObject({
      IndexName: "GSI3",
      KeyConditionExpression: "GSI3PK = :pk",
      FilterExpression: "estatus = :congelada",
      ExpressionAttributeValues: {
        ":pk": "PART#P1",
        ":congelada": "CONGELADA",
      },
    });
  });

  it("las devuelve a EN_FILA conservando el turno original", async () => {
    // El estatus vuelve, la clave `SOL#<turno>` no se reescribe nunca: el lugar
    // en la fila es inmutable por construccion.
    const falso = crearClienteFalso({
      responder: conCongeladas([congelada("L2", 3), congelada("L3", 7)]),
    });

    const descongeladas = await descongelarSolicitudes(
      { participanteId: "P1" },
      deps(falso.cliente),
    );

    expect(descongeladas).toBe(2);

    const transacciones = falso.comandos
      .filter((c) => c.nombre === "TransactWriteCommand")
      .map(
        (c) =>
          c.input.TransactItems as Record<string, Record<string, unknown>>[],
      );

    expect(transacciones[0]?.[0]?.Update).toMatchObject({
      Key: { PK: "LOTE#L2", SK: "SOL#0000000003" },
      ConditionExpression: "#estatus = :congelada",
      ExpressionAttributeValues: { ":enFila": "EN_FILA" },
    });
    expect(transacciones[1]?.[0]?.Update?.Key).toEqual({
      PK: "LOTE#L3",
      SK: "SOL#0000000007",
    });
  });

  it("cada descongelamiento lleva su evento en la misma transaccion", async () => {
    const falso = crearClienteFalso({
      responder: conCongeladas([congelada("L2", 3)]),
    });

    await descongelarSolicitudes({ participanteId: "P1" }, deps(falso.cliente));

    const items = falso.comandos.find(
      (c) => c.nombre === "TransactWriteCommand",
    )?.input.TransactItems as Record<string, Record<string, unknown>>[];
    expect(items).toHaveLength(2);
    expect(items[1]?.Put?.Item).toMatchObject({
      PK: "AUDIT#LOTE#L2",
      tipo: "SOLICITUD_DESCONGELADA",
      estadoAnterior: "CONGELADA",
      estadoNuevo: "EN_FILA",
      datos: { turno: 3 },
    });
  });

  it("una transaccion por solicitud: el limite de 100 items no puede acotar la regla", async () => {
    // Meterlas todas en una sola transaccion convertiria una garantia de
    // negocio en un limite tecnico.
    const falso = crearClienteFalso({
      responder: conCongeladas([
        congelada("L2", 1),
        congelada("L3", 2),
        congelada("L4", 3),
      ]),
    });

    await descongelarSolicitudes({ participanteId: "P1" }, deps(falso.cliente));

    expect(
      falso.comandos.filter((c) => c.nombre === "TransactWriteCommand"),
    ).toHaveLength(3);
  });

  it("un fallo aislado no impide descongelar las demas", async () => {
    let transaccion = 0;
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "TransactWriteCommand") {
          transaccion += 1;
          if (transaccion === 1) {
            throw new TransactionCanceledException({
              message: "cancelada",
              $metadata: {},
              CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
            });
          }
          return {};
        }
        return conCongeladas([congelada("L2", 1), congelada("L3", 2)])(comando);
      },
    });

    const descongeladas = await descongelarSolicitudes(
      { participanteId: "P1" },
      deps(falso.cliente),
    );

    expect(descongeladas).toBe(1);
  });

  it("sin congeladas no escribe nada", async () => {
    const falso = crearClienteFalso({ responder: conCongeladas([]) });

    const descongeladas = await descongelarSolicitudes(
      { participanteId: "P1" },
      deps(falso.cliente),
    );

    expect(descongeladas).toBe(0);
    expect(
      falso.comandos.filter((c) => c.nombre === "TransactWriteCommand"),
    ).toHaveLength(0);
  });
});

describe("descongelarSolicitudes — el corte de 1 MB no puede esconder congeladas", () => {
  it("sigue LastEvaluatedKey cuando la primera pagina vuelve vacia por el filtro", async () => {
    // Es el defecto que encontro la auditoria externa, y su forma exacta: con
    // `FilterExpression` DynamoDB puede devolver `Items: []` **y**
    // `LastEvaluatedKey`, porque el filtro se evalua despues de leer. Un
    // participante con mas de 100 solicitudes historicas terminales llenaba la
    // primera pagina con ellas y su `CONGELADA` quedaba detras: R-09 dejaba de
    // devolverle el turno y la funcion respondia cero, sin nada que distinguiera
    // "no tenia" de "no la alcance a ver".
    let consultas = 0;
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre !== "QueryCommand") return {};
        consultas += 1;
        return consultas === 1
          ? { Items: [], LastEvaluatedKey: { GSI3PK: "PART#P1", GSI3SK: "x" } }
          : { Items: [congelada("L9", 4)] };
      },
    });

    const descongeladas = await descongelarSolicitudes(
      { participanteId: "P1" },
      deps(falso.cliente),
    );

    expect(descongeladas).toBe(1);
    expect(consultas).toBe(2);
  });

  it("la segunda pagina continua desde la clave de la primera", async () => {
    const cursor = { GSI3PK: "PART#P1", GSI3SK: "SOL#2026-01-01#L1" };
    let consultas = 0;
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre !== "QueryCommand") return {};
        consultas += 1;
        return consultas === 1
          ? { Items: [], LastEvaluatedKey: cursor }
          : { Items: [] };
      },
    });

    await descongelarSolicitudes({ participanteId: "P1" }, deps(falso.cliente));

    const consultasEnviadas = falso.comandos.filter(
      (c) => c.nombre === "QueryCommand",
    );
    expect(consultasEnviadas[0]?.input.ExclusiveStartKey).toBeUndefined();
    expect(consultasEnviadas[1]?.input.ExclusiveStartKey).toEqual(cursor);
  });

  it("no manda Limit: acotaria items leidos y no congeladas encontradas", async () => {
    // La guarda de la regresion. `Limit` aqui es justo lo que producia el
    // defecto, y la regla ya estaba escrita en tres archivos del repo.
    const falso = crearClienteFalso({ responder: conCongeladas([]) });

    await descongelarSolicitudes({ participanteId: "P1" }, deps(falso.cliente));

    expect(falso.comandos[0]?.input).not.toHaveProperty("Limit");
  });

  it("el tope acota congeladas descongeladas, no paginas leidas", async () => {
    // Con el tope viejo esto habria leido 100 items y descongelado las que
    // pasaran el filtro; ahora lee lo que haga falta y se detiene al reunir 100
    // congeladas de verdad.
    const muchas = Array.from({ length: 130 }, (_, indice) =>
      congelada(`L${String(indice)}`, indice + 1),
    );
    const falso = crearClienteFalso({ responder: conCongeladas(muchas) });

    const descongeladas = await descongelarSolicitudes(
      { participanteId: "P1" },
      deps(falso.cliente),
    );

    expect(descongeladas).toBe(MAXIMO_A_DESCONGELAR);
  });
});
