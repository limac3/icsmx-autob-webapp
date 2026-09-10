// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import { consultarActividadDeParticipante } from "./consultarActividadDeParticipante";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const PARTICIPANTE = "okta|ana";

/**
 * Un evento de la particion del **lote**, que es donde de verdad viven los
 * eventos de una fila.
 *
 * Los 19 escritores anclan a `LOTE` porque la fila es del lote y la solicitud es
 * un lugar dentro de ella. La version anterior de esta consulta leia
 * `AUDIT#SOLICITUD#<id>`, particiones que **ningun escritor escribe**: devolvia
 * cero siempre y nadie lo notaba, porque cero es una respuesta plausible.
 */
const eventoDeLote = (
  eventoId: string,
  ocurridoEn: string,
  extras: Record<string, unknown> = {},
) => ({
  PK: "AUDIT#LOTE#L1",
  SK: `${ocurridoEn}#${eventoId}`,
  eventoId,
  tipo: "SOLICITUD_CREADA",
  ocurridoEn,
  actorTipo: "USUARIO",
  actorId: PARTICIPANTE,
  correlacionId: "COR1",
  solicitudId: "L1-7",
  loteId: "L1",
  ...extras,
});

const solicitudCruda = (
  solicitudId: string,
  loteId: string,
  turno: number,
) => ({
  PK: `LOTE#${loteId}`,
  SK: `SOL#${String(turno).padStart(10, "0")}`,
  solicitudId,
  loteId,
  participanteId: PARTICIPANTE,
  turno,
  estatus: "EN_FILA",
  solicitadoEn: "2026-09-06T18:00:00.000Z",
});

/** Distingue las tres clases de consulta que hace este servicio. */
const clase = (comando: ComandoEnviado): string => {
  const valores = comando.input.ExpressionAttributeValues as Record<
    string,
    unknown
  >;
  if (comando.input.IndexName === "GSI3") return "solicitudes";
  // Lo que **firmo**: GSI9, particion por mes.
  if (comando.input.IndexName === "GSI9") return "firmados";
  // Lo que **le ocurrio**: la particion del lote, sin indice.
  if (String(valores[":pk"] ?? "").startsWith("AUDIT#LOTE#")) return "lote";
  return "otra";
};

const cliente = (falso: ReturnType<typeof crearClienteFalso>) => ({
  cliente: falso.cliente as never,
});

describe("las dos preguntas", () => {
  it("consulta GSI9 para lo firmado y la particion del lote para lo ocurrido", async () => {
    const falso = crearClienteFalso({
      responder: (comando) =>
        clase(comando) === "solicitudes"
          ? { Items: [solicitudCruda("L1-7", "L1", 7)] }
          : { Items: [] },
    });

    await consultarActividadDeParticipante(
      {
        participanteId: PARTICIPANTE,
        desde: "2026-09-08",
        hasta: "2026-09-08",
      },
      cliente(falso),
    );

    const clases = falso.comandos.map(clase);
    expect(clases).toContain("firmados");
    expect(clases).toContain("solicitudes");
    expect(clases).toContain("lote");
    // Y ninguna consulta a las particiones inertes de solicitud.
    expect(clases).not.toContain("otra");
  });

  it("la particion del lote se acota por rango en la clave y filtra por solicitud", async () => {
    // El reparto correcto: el rango recorta la particion **antes** de leerla, y
    // el filtro descarta los eventos de otros participantes del mismo lote —que
    // en un lote con fila son la mayoria.
    const falso = crearClienteFalso({
      responder: (comando) =>
        clase(comando) === "solicitudes"
          ? { Items: [solicitudCruda("L1-7", "L1", 7)] }
          : { Items: [] },
    });

    await consultarActividadDeParticipante(
      {
        participanteId: PARTICIPANTE,
        desde: "2026-09-08",
        hasta: "2026-09-08",
      },
      cliente(falso),
    );

    const deLote = falso.comandos.find((c) => clase(c) === "lote");
    expect(deLote?.input).toMatchObject({
      KeyConditionExpression:
        "PK = :pk AND SK BETWEEN :desdeCrono AND :hastaCrono",
      FilterExpression: "#solicitudId IN (:solicitud0)",
    });
    expect(
      (deLote?.input.ExpressionAttributeValues as Record<string, unknown>)[
        ":solicitud0"
      ],
    ).toBe("L1-7");
  });

  it("agrupa por lote: varias solicitudes en el mismo lote son una consulta", async () => {
    // Turnos distintos de la misma fila. Sin agrupar seria una `Query` por
    // solicitud sobre la misma particion.
    const falso = crearClienteFalso({
      responder: (comando) =>
        clase(comando) === "solicitudes"
          ? {
              Items: [
                solicitudCruda("L1-7", "L1", 7),
                solicitudCruda("L1-9", "L1", 9),
                solicitudCruda("L2-1", "L2", 1),
              ],
            }
          : { Items: [] },
    });

    await consultarActividadDeParticipante(
      {
        participanteId: PARTICIPANTE,
        desde: "2026-09-08",
        hasta: "2026-09-08",
      },
      cliente(falso),
    );

    const deLote = falso.comandos.filter((c) => clase(c) === "lote");
    expect(deLote).toHaveLength(2);
    const conDos = deLote.find(
      (c) => String(c.input.FilterExpression).split(",").length === 2,
    );
    expect(conDos?.input.FilterExpression).toBe(
      "#solicitudId IN (:solicitud0, :solicitud1)",
    );
  });

  it("incluye un evento que el SISTEMA firmo sobre su solicitud", async () => {
    // Es la mitad que estaba muerta, y la que explica por que alguien perdio
    // una adjudicacion: un vencimiento no lo firma la persona.
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (clase(comando) === "solicitudes") {
          return { Items: [solicitudCruda("L1-7", "L1", 7)] };
        }
        if (clase(comando) === "lote") {
          return {
            Items: [
              eventoDeLote("SIS1", "2026-09-08T20:00:00.000Z", {
                tipo: "SOLICITUD_VENCIDA",
                actorTipo: "SISTEMA",
                actorId: "SISTEMA",
              }),
            ],
          };
        }
        return { Items: [] };
      },
    });

    const resultado = await consultarActividadDeParticipante(
      {
        participanteId: PARTICIPANTE,
        desde: "2026-09-08",
        hasta: "2026-09-08",
      },
      cliente(falso),
    );

    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["SIS1"]);
  });

  it("no cuenta dos veces el evento que aparece en las dos lecturas", async () => {
    // `SOLICITUD_CREADA` la firma la persona y cuelga del lote, asi que viene en
    // las dos. Sin desduplicar, el auditor veria dos veces el mismo hecho.
    const compartido = eventoDeLote("E1", "2026-09-08T18:00:00.000Z");
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (clase(comando) === "solicitudes") {
          return { Items: [solicitudCruda("L1-7", "L1", 7)] };
        }
        return { Items: [compartido] };
      },
    });

    const resultado = await consultarActividadDeParticipante(
      {
        participanteId: PARTICIPANTE,
        desde: "2026-09-08",
        hasta: "2026-09-08",
      },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.eventos).toHaveLength(1);
  });

  it("respeta el filtro de tipo tambien en la historia del lote", async () => {
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (clase(comando) === "solicitudes") {
          return { Items: [solicitudCruda("L1-7", "L1", 7)] };
        }
        if (clase(comando) === "lote") {
          return {
            Items: [
              eventoDeLote("V1", "2026-09-08T20:00:00.000Z", {
                tipo: "SOLICITUD_VENCIDA",
              }),
              eventoDeLote("C1", "2026-09-08T19:00:00.000Z", {
                tipo: "SOLICITUD_CREADA",
              }),
            ],
          };
        }
        return { Items: [] };
      },
    });

    const resultado = await consultarActividadDeParticipante(
      {
        participanteId: PARTICIPANTE,
        desde: "2026-09-08",
        hasta: "2026-09-08",
        tipo: "SOLICITUD_VENCIDA",
      },
      cliente(falso),
    );

    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["V1"]);
  });

  it("ordena por instante y desempata por eventoId, igual que la clave", async () => {
    // Es el unico lugar de la auditoria donde hay que ordenar en memoria,
    // porque aqui se unen dos lecturas. El criterio reproduce la `SK`.
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (clase(comando) === "solicitudes") {
          return { Items: [solicitudCruda("L1-7", "L1", 7)] };
        }
        if (clase(comando) === "lote") {
          return {
            Items: [
              eventoDeLote("ZZZ", "2026-09-08T18:00:00.000Z"),
              eventoDeLote("AAA", "2026-09-08T18:00:00.000Z"),
              eventoDeLote("MMM", "2026-09-08T09:00:00.000Z"),
            ],
          };
        }
        return { Items: [] };
      },
    });

    const resultado = await consultarActividadDeParticipante(
      {
        participanteId: PARTICIPANTE,
        desde: "2026-09-08",
        hasta: "2026-09-08",
      },
      cliente(falso),
    );

    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["MMM", "AAA", "ZZZ"]);
  });

  it("un participante sin solicitudes solo devuelve lo que firmo", async () => {
    const falso = crearClienteFalso({
      responder: (comando) =>
        clase(comando) === "firmados"
          ? { Items: [eventoDeLote("F1", "2026-09-08T18:00:00.000Z")] }
          : { Items: [] },
    });

    const resultado = await consultarActividadDeParticipante(
      {
        participanteId: PARTICIPANTE,
        desde: "2026-09-08",
        hasta: "2026-09-08",
      },
      cliente(falso),
    );

    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["F1"]);
    expect(falso.comandos.map(clase)).not.toContain("lote");
  });
});
