// @vitest-environment node
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import type { Lote } from "@/types/lote";
import { adjudicarLote } from "./adjudicarLote";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-10-06T15:00:00.000Z");
/** `AHORA + 48 h`, el plazo de liquidacion del lote de prueba (R-13). */
const VENCE = "2026-10-08T15:00:00.000Z";

const lote: Lote = {
  loteId: "L1",
  convocatoriaId: "C1",
  vehiculoId: "V1",
  precio: 180_000,
  estatus: "EN_OFERTA",
  contadorTurnos: 3,
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
};

const deps = (cliente: unknown) => ({
  cliente: cliente as never,
  ahora: () => AHORA,
});

const solicitudEnFila = (turno: number, participanteId: string) => ({
  PK: "LOTE#L1",
  SK: `SOL#${String(turno).padStart(10, "0")}`,
  turno,
  participanteId,
  estatus: "EN_FILA",
  solicitudId: `L1-${String(turno)}`,
  loteId: "L1",
  solicitadoEn: AHORA.toISOString(),
});

/** Query de reservas vacia, fila con los candidatos dados, resto vacio. */
const conFila = (
  candidatos: Record<string, unknown>[],
  opciones: { reservas?: Record<string, unknown>[] } = {},
) => {
  return (comando: ComandoEnviado): unknown => {
    if (comando.nombre !== "QueryCommand") return {};
    const valores = comando.input.ExpressionAttributeValues as Record<
      string,
      string
    >;
    return valores[":prefijo"] === "RESERVA#"
      ? { Items: opciones.reservas ?? [] }
      : { Items: candidatos };
  };
};

/** Cancelacion con una sola condicion incumplida, en la posicion pedida. */
const canceladaEn = (indice: number): TransactionCanceledException =>
  new TransactionCanceledException({
    message: "cancelada",
    $metadata: {},
    CancellationReasons: Array.from({ length: 5 }, (_, i) => ({
      Code: i === indice ? "ConditionalCheckFailed" : "None",
    })),
  });

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("abstencion por reservas vigentes — R18", () => {
  it("no adjudica mientras haya un turno en vuelo", async () => {
    // Hay un turno entregado cuya solicitud todavia no es visible. Adjudicar
    // ahora coronaria a un turno mayor: es exactamente el defecto que el
    // prototipo reprodujo.
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(2, "P2")], {
        reservas: [
          {
            SK: "RESERVA#R1",
            anotadaEn: new Date(AHORA.getTime() - 500).toISOString(),
          },
        ],
      }),
    });

    const resultado = await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ estado: "abstenido", reservasVigentes: 1 });
    expect(
      falso.comandos.some((c) => c.nombre === "TransactWriteCommand"),
    ).toBe(false);
  });

  it("lee las reservas ANTES que la fila, y ese orden es el mecanismo", async () => {
    // Al reves, una solicitud confirmada entre las dos lecturas quedaria
    // invisible por ambos lados: no estaria en la fila leida y ya no tendria
    // reserva.
    const falso = crearClienteFalso({ responder: conFila([]) });

    await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    const consultas = falso.comandos
      .filter((c) => c.nombre === "QueryCommand")
      .map(
        (c) =>
          (c.input.ExpressionAttributeValues as Record<string, string>)[
            ":prefijo"
          ],
      );
    expect(consultas[0]).toBe("RESERVA#");
    expect(consultas[1]).toBe("SOL#");
  });

  it("depura las reservas mas viejas que el umbral y sigue adelante", async () => {
    // Un proceso caido no puede bloquear el lote para siempre. Su paso 2, si
    // llegara, fallara por la condicion de existencia.
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(1, "P1")], {
        reservas: [
          {
            SK: "RESERVA#VIEJA",
            anotadaEn: new Date(AHORA.getTime() - 60_000).toISOString(),
          },
        ],
      }),
    });

    const resultado = await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    const borrado = falso.comandos.find((c) => c.nombre === "DeleteCommand");
    expect(borrado?.input.Key).toEqual({ PK: "LOTE#L1", SK: "RESERVA#VIEJA" });
    expect(resultado.estado).toBe("adjudicado");
  });

  it("una fecha de reserva ilegible se trata como vigente, no como muerta", async () => {
    // En la duda, abstenerse retrasa una adjudicacion; depurar de mas la
    // entrega al turno equivocado.
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(1, "P1")], {
        reservas: [{ SK: "RESERVA#RARA", anotadaEn: "no-es-una-fecha" }],
      }),
    });

    const resultado = await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ estado: "abstenido", reservasVigentes: 1 });
  });
});

describe("la transaccion de adjudicacion", () => {
  const items = (falso: ReturnType<typeof crearClienteFalso>) =>
    falso.comandos.find((c) => c.nombre === "TransactWriteCommand")?.input
      .TransactItems as Record<string, Record<string, unknown>>[];

  it("gana con escritura condicional, nunca con una lectura previa (regla 6)", async () => {
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(1, "P1")]),
    });

    await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    expect(items(falso)[0]?.Update).toMatchObject({
      Key: { PK: "CONV#C1", SK: "LOTE#L1" },
      ConditionExpression:
        "attribute_not_exists(adjudicacionActual) AND #estatus = :enOferta",
    });
  });

  it("exige tambien que el lote siga EN_OFERTA", async () => {
    // Correccion sobre T2: un lote `NO_VENDIDO` cierra **sin**
    // `adjudicacionActual`, asi que la condicion original lo habria dejado
    // adjudicar despues de concluida la convocatoria.
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(1, "P1")]),
    });

    await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    const valores = items(falso)[0]?.Update
      ?.ExpressionAttributeValues as Record<string, string>;
    expect(valores[":enOferta"]).toBe("EN_OFERTA");
  });

  it("escribe el plazo en horas naturales y las claves de GSI4", async () => {
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(1, "P1")]),
    });

    await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    const solicitud = items(falso)[1]?.Update;
    expect(solicitud?.ExpressionAttributeValues).toMatchObject({
      ":venceEn": VENCE,
      ":adjudicada": "ADJUDICADA",
      ":enFila": "EN_FILA",
      // El dia de la particion se calcula en hora de negocio: `VENCE` son las
      // 09:00 del 8 de octubre en Ciudad de Mexico.
      ":gsi4pk": "VENCE#2026-10-08",
      ":gsi4sk": VENCE,
    });
  });

  it("pone el centinela de adjudicacion activa con attribute_not_exists (R-09)", async () => {
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(1, "P1")]),
    });

    await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    expect(items(falso)[2]?.Put).toMatchObject({
      Item: {
        PK: "PART#P1",
        SK: "ADJUDICACION_ACTIVA",
        loteId: "L1",
        turno: 1,
      },
      ConditionExpression: "attribute_not_exists(SK)",
    });
  });

  it("reserva el vehiculo, que es lo que hace alcanzable RESERVADO", async () => {
    // Sin este item la maquina de estados del vehiculo no tendria transicion
    // valida al vender (`proyecto.md` 5.2: solo `RESERVADO` admite AVALAR_PAGO).
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(1, "P1")]),
    });

    await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    expect(items(falso)[3]?.Update).toMatchObject({
      Key: { PK: "VEH#V1", SK: "META" },
      ConditionExpression: "#estatus = :enConvocatoria",
    });
  });

  it("el evento LOTE_ADJUDICADO viaja en la misma transaccion (regla 4)", async () => {
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(1, "P1")]),
    });

    await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    expect(items(falso)[4]?.Put).toMatchObject({
      ConditionExpression: "attribute_not_exists(PK)",
      Item: {
        PK: "AUDIT#LOTE#L1",
        tipo: "LOTE_ADJUDICADO",
        actorTipo: "SISTEMA",
        solicitudId: "L1-1",
        datos: {
          turno: 1,
          venceEn: VENCE,
          motivoAdjudicacion: "PRIMERA_ADJUDICACION",
        },
      },
    });
  });

  it("devuelve el turno ganador y su plazo", async () => {
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(4, "P4")]),
    });

    const resultado = await adjudicarLote(
      { lote, motivo: "REASIGNACION_POR_CANCELACION" },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({
      estado: "adjudicado",
      turno: 4,
      solicitudId: "L1-4",
      participanteId: "P4",
      venceEn: VENCE,
    });
  });
});

describe("el orden manda sobre el tiempo — R-08", () => {
  it("adjudica al turno menor aunque otro haya solicitado antes en el reloj", async () => {
    // PA-07 devuelve la fila ordenada por la `SK`, no por `solicitadoEn`. Este
    // caso escribe los tiempos al reves a proposito.
    const temprano = {
      ...solicitudEnFila(9, "P9"),
      solicitadoEn: "2020-01-01T00:00:00.000Z",
    };
    const tardio = {
      ...solicitudEnFila(2, "P2"),
      solicitadoEn: "2030-01-01T00:00:00.000Z",
    };
    // Se entregan en el orden en que la `Query` los devolveria: por turno.
    const falso = crearClienteFalso({ responder: conFila([tardio, temprano]) });

    const resultado = await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    expect(resultado).toMatchObject({ estado: "adjudicado", turno: 2 });
  });

  it("solo considera candidatos EN_FILA", async () => {
    const congelada = { ...solicitudEnFila(1, "P1"), estatus: "CONGELADA" };
    const falso = crearClienteFalso({
      responder: conFila([congelada, solicitudEnFila(2, "P2")]),
    });

    const resultado = await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    expect(resultado).toMatchObject({ estado: "adjudicado", turno: 2 });
  });

  it("pide la fila con lectura consistente y en orden ascendente", async () => {
    // Una lectura eventual podria no ver al turno menor y coronar al siguiente.
    const falso = crearClienteFalso({ responder: conFila([]) });

    await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    const fila = falso.comandos.filter((c) => c.nombre === "QueryCommand")[1];
    expect(fila?.input).toMatchObject({
      ConsistentRead: true,
      ScanIndexForward: true,
    });
  });
});

describe("cuando la transaccion se cancela", () => {
  it("si el lote ya no esta libre, aborta el bucle entero", async () => {
    // Seguir con el turno siguiente solo produciria N fracasos identicos: el
    // lote ya no esta en juego.
    const conCancelacion = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "TransactWriteCommand") throw canceladaEn(0);
        return conFila([solicitudEnFila(1, "P1"), solicitudEnFila(2, "P2")])(
          comando,
        );
      },
    });

    const resultado = await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(conCancelacion.cliente),
    );

    expect(resultado).toEqual({ estado: "no_adjudicable" });
    expect(
      conCancelacion.comandos.filter(
        (c) => c.nombre === "TransactWriteCommand",
      ),
    ).toHaveLength(1);
  });

  it("si el candidato ya tiene adjudicacion activa, lo congela y sigue (R-09)", async () => {
    let intentos = 0;
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "GetCommand") {
          return { Item: { loteId: "OTRO-LOTE" } };
        }
        if (comando.nombre === "TransactWriteCommand") {
          const transaccion = comando.input.TransactItems as unknown[];
          // La transaccion de congelamiento tiene tres items; la de
          // adjudicacion, cinco.
          if (transaccion.length === 3) return {};
          intentos += 1;
          if (intentos === 1) throw canceladaEn(2);
          return {};
        }
        return conFila([solicitudEnFila(1, "P1"), solicitudEnFila(2, "P2")])(
          comando,
        );
      },
    });

    const resultado = await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    expect(resultado).toMatchObject({ estado: "adjudicado", turno: 2 });

    const congelamiento = falso.comandos
      .filter((c) => c.nombre === "TransactWriteCommand")
      .map(
        (c) =>
          c.input.TransactItems as Record<string, Record<string, unknown>>[],
      )
      .find((transaccion) => transaccion.length === 3);

    expect(congelamiento?.[0]?.Update).toMatchObject({
      Key: { PK: "LOTE#L1", SK: "SOL#0000000001" },
      ConditionExpression: "#estatus = :enFila",
    });
    expect(congelamiento?.[1]?.Put?.Item).toMatchObject({
      tipo: "SOLICITUD_CONGELADA",
      datos: { turno: 1, loteQueGano: "OTRO-LOTE" },
    });
    // El segundo evento es el que hace auditable el salto: sin el, la bitacora
    // mostraria una adjudicacion al turno 2 con el turno 1 vivo.
    expect(congelamiento?.[2]?.Put?.Item).toMatchObject({
      tipo: "SOLICITUD_OMITIDA",
      datos: { turno: 1, razonOmision: "ADJUDICACION_ACTIVA" },
    });
  });

  it("los dos eventos del congelamiento comparten correlacionId", async () => {
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "GetCommand") return { Item: { loteId: "L9" } };
        if (comando.nombre === "TransactWriteCommand") {
          const transaccion = comando.input.TransactItems as unknown[];
          if (transaccion.length === 5) throw canceladaEn(2);
          return {};
        }
        return conFila([solicitudEnFila(1, "P1")])(comando);
      },
    });

    await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    const congelamiento = falso.comandos
      .filter((c) => c.nombre === "TransactWriteCommand")
      .map(
        (c) =>
          c.input.TransactItems as Record<string, Record<string, unknown>>[],
      )
      .find((transaccion) => transaccion.length === 3);

    const primero = congelamiento?.[1]?.Put?.Item as Record<string, string>;
    const segundo = congelamiento?.[2]?.Put?.Item as Record<string, string>;
    expect(primero.correlacionId).toBe(segundo.correlacionId);
  });

  it("si la solicitud dejo de estar EN_FILA, sigue sin congelar ni registrar nada", async () => {
    let intentos = 0;
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "TransactWriteCommand") {
          intentos += 1;
          if (intentos === 1) throw canceladaEn(1);
          return {};
        }
        return conFila([solicitudEnFila(1, "P1"), solicitudEnFila(2, "P2")])(
          comando,
        );
      },
    });

    const resultado = await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    expect(resultado).toMatchObject({ estado: "adjudicado", turno: 2 });
    const congelamientos = falso.comandos
      .filter((c) => c.nombre === "TransactWriteCommand")
      .filter((c) => (c.input.TransactItems as unknown[]).length === 3);
    expect(congelamientos).toHaveLength(0);
  });

  it("un TransactionConflict se reintenta en vez de decidir quien gano", async () => {
    let intentos = 0;
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "TransactWriteCommand") {
          intentos += 1;
          if (intentos === 1) {
            throw new TransactionCanceledException({
              message: "conflicto",
              $metadata: {},
              CancellationReasons: [{ Code: "TransactionConflict" }],
            });
          }
          return {};
        }
        return conFila([solicitudEnFila(1, "P1")])(comando);
      },
    });

    const resultado = await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION", intentos: 3 },
      deps(falso.cliente),
    );

    expect(resultado).toMatchObject({ estado: "adjudicado", turno: 1 });
    expect(intentos).toBe(2);
  });

  it("agotados los reintentos devuelve en_conflicto, sin adivinar", async () => {
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "TransactWriteCommand") {
          throw new TransactionCanceledException({
            message: "conflicto",
            $metadata: {},
            CancellationReasons: [{ Code: "TransactionConflict" }],
          });
        }
        return conFila([solicitudEnFila(1, "P1")])(comando);
      },
    });

    const resultado = await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION", intentos: 2 },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ estado: "en_conflicto" });
  });
});

describe("fila agotada — R-17", () => {
  it("sin candidatos vivos deja el lote en oferta y lo registra", async () => {
    const falso = crearClienteFalso({ responder: conFila([]) });

    const resultado = await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ estado: "fila_agotada", turnosRevisados: 0 });

    const transaccion = falso.comandos.find(
      (c) => c.nombre === "TransactWriteCommand",
    )?.input.TransactItems as Record<string, Record<string, unknown>>[];
    expect(transaccion[0]?.Put?.Item).toMatchObject({
      PK: "AUDIT#LOTE#L1",
      tipo: "FILA_AGOTADA",
      datos: { turnosRevisados: 0 },
    });
  });

  it("no toca el item del lote: sigue disponible para quien solicite despues", async () => {
    const falso = crearClienteFalso({ responder: conFila([]) });

    await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    const escrituras = falso.comandos
      .filter((c) => c.nombre === "TransactWriteCommand")
      .flatMap(
        (c) =>
          c.input.TransactItems as Record<string, Record<string, unknown>>[],
      )
      .filter((item) => item.Update !== undefined);
    expect(escrituras).toHaveLength(0);
  });
});

describe("el corte de 1 MB no puede declarar agotada una fila viva", () => {
  /**
   * Fila partida en dos paginas: la primera trae solo terminales y la segunda
   * el unico candidato vivo.
   *
   * Es el escenario que pidio la auditoria externa, y el que ninguna prueba
   * cubria porque todas caben de sobra en una pagina. La particion de un lote
   * conserva sus solicitudes terminales para siempre, asi que es la primera
   * pagina la que se llena de ellas — y no se autocura: la corrida siguiente
   * lee exactamente la misma.
   */
  const enDosPaginas = (
    primera: Record<string, unknown>[],
    segunda: Record<string, unknown>[],
  ) => {
    let consultasDeFila = 0;
    return (comando: ComandoEnviado): unknown => {
      if (comando.nombre !== "QueryCommand") return {};
      const valores = comando.input.ExpressionAttributeValues as Record<
        string,
        string
      >;
      if (valores[":prefijo"] === "RESERVA#") return { Items: [] };

      consultasDeFila += 1;
      return consultasDeFila === 1
        ? { Items: primera, LastEvaluatedKey: { PK: "LOTE#L1", SK: "corte" } }
        : { Items: segunda };
    };
  };

  const terminal = (turno: number, estatus: string) => ({
    ...solicitudEnFila(turno, `P${String(turno)}`),
    estatus,
  });

  it("adjudica al candidato que estaba detras del corte", async () => {
    const falso = crearClienteFalso({
      responder: enDosPaginas(
        [
          terminal(1, "CANCELADA_POR_PARTICIPANTE"),
          terminal(2, "CANCELADA_POR_VENCIMIENTO"),
        ],
        [solicitudEnFila(3, "P3")],
      ),
    });

    const resultado = await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    expect(resultado).toMatchObject({ estado: "adjudicado", turno: 3 });
  });

  it("no escribe FILA_AGOTADA con un candidato vivo en la pagina siguiente", async () => {
    // El daño real del defecto: `FILA_AGOTADA` es un evento de auditoria, y
    // escribirlo con turnos vivos detras deja la bitacora afirmando algo falso
    // sobre la equidad de la fila.
    const falso = crearClienteFalso({
      responder: enDosPaginas(
        [terminal(1, "NO_ADJUDICADA")],
        [solicitudEnFila(2, "P2")],
      ),
    });

    await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    const eventos = falso.comandos
      .filter((c) => c.nombre === "TransactWriteCommand")
      .flatMap(
        (c) =>
          c.input.TransactItems as Record<string, Record<string, unknown>>[],
      )
      .map((item) => item.Put?.Item as Record<string, unknown> | undefined)
      .filter((item) => item !== undefined);

    expect(eventos.map((evento) => evento.tipo)).not.toContain("FILA_AGOTADA");
  });

  it("la segunda consulta de la fila continua desde la clave de la primera", async () => {
    const falso = crearClienteFalso({
      responder: enDosPaginas([terminal(1, "NO_ADJUDICADA")], []),
    });

    await adjudicarLote(
      { lote, motivo: "PRIMERA_ADJUDICACION" },
      deps(falso.cliente),
    );

    const consultasDeFila = falso.comandos.filter(
      (c) =>
        c.nombre === "QueryCommand" &&
        (c.input.ExpressionAttributeValues as Record<string, string>)[
          ":prefijo"
        ] === "SOL#",
    );
    expect(consultasDeFila).toHaveLength(2);
    expect(consultasDeFila[1]?.input.ExclusiveStartKey).toEqual({
      PK: "LOTE#L1",
      SK: "corte",
    });
  });
});
