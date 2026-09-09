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

const evento = (
  eventoId: string,
  ocurridoEn: string,
  extras: Record<string, unknown> = {},
) => ({
  PK: "AUDIT#SOLICITUD#L1-7",
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

const solicitudCruda = {
  PK: "LOTE#L1",
  SK: "SOL#0000000007",
  solicitudId: "L1-7",
  loteId: "L1",
  participanteId: PARTICIPANTE,
  turno: 7,
  estatus: "EN_FILA",
  solicitadoEn: "2026-09-06T18:00:00.000Z",
};

/** Distingue las tres clases de consulta que hace este servicio. */
const clase = (comando: ComandoEnviado): string => {
  const valores = comando.input.ExpressionAttributeValues as Record<
    string,
    unknown
  >;
  const pk = String(valores[":pk"] ?? "");
  if (comando.input.IndexName === "GSI3") return "solicitudes";
  if (comando.input.IndexName === "GSI2") return "global";
  if (pk.startsWith("AUDIT#SOLICITUD#")) return "historia";
  return "otra";
};

describe("consultarActividadDeParticipante", () => {
  it("busca lo que firmo y lo que le ocurrio, que son dos lecturas distintas", async () => {
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (clase(comando) === "solicitudes")
          return { Items: [solicitudCruda] };
        return { Items: [] };
      },
    });

    await consultarActividadDeParticipante(
      {
        participanteId: PARTICIPANTE,
        desde: "2026-09-08",
        hasta: "2026-09-08",
      },
      { cliente: falso.cliente as never },
    );

    const clases = falso.comandos.map(clase);
    expect(clases).toContain("global");
    expect(clases).toContain("solicitudes");
    expect(clases).toContain("historia");
  });

  it("la lectura global filtra por actorId en DynamoDB", async () => {
    const falso = crearClienteFalso({ responder: () => ({ Items: [] }) });

    await consultarActividadDeParticipante(
      {
        participanteId: PARTICIPANTE,
        desde: "2026-09-08",
        hasta: "2026-09-08",
      },
      { cliente: falso.cliente as never },
    );

    const global = falso.comandos.find((c) => clase(c) === "global");
    expect(global?.input.FilterExpression).toBe("#actorId = :actorId");
    expect(
      (global?.input.ExpressionAttributeValues as Record<string, unknown>)[
        ":actorId"
      ],
    ).toBe(PARTICIPANTE);
  });

  it("incluye un evento que el SISTEMA firmo sobre su solicitud", async () => {
    // Es la razon de ser del servicio: un vencimiento lo firma SISTEMA, asi
    // que buscar por actorId no lo encontraria — y es justo el evento que
    // explica por que alguien perdio su adjudicacion.
    const vencida = evento("E-VENC", "2026-09-08T18:00:00.000Z", {
      tipo: "SOLICITUD_VENCIDA",
      actorTipo: "SISTEMA",
      actorId: "SISTEMA",
    });

    const falso = crearClienteFalso({
      responder: (comando) => {
        const cual = clase(comando);
        if (cual === "solicitudes") return { Items: [solicitudCruda] };
        if (cual === "historia") return { Items: [vencida] };
        return { Items: [] };
      },
    });

    const resultado = await consultarActividadDeParticipante(
      {
        participanteId: PARTICIPANTE,
        desde: "2026-09-08",
        hasta: "2026-09-08",
      },
      { cliente: falso.cliente as never },
    );

    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["E-VENC"]);
  });

  it("no cuenta dos veces el evento que aparece en las dos lecturas", async () => {
    // `SOLICITUD_CREADA` la firma la persona y vive en la historia de su
    // solicitud: sin desduplicar, el auditor veria dos veces el mismo hecho.
    const creada = evento("E-CREADA", "2026-09-08T18:00:00.000Z");

    const falso = crearClienteFalso({
      responder: (comando) => {
        const cual = clase(comando);
        if (cual === "solicitudes") return { Items: [solicitudCruda] };
        if (cual === "historia") return { Items: [creada] };
        if (cual === "global") return { Items: [creada] };
        return { Items: [] };
      },
    });

    const resultado = await consultarActividadDeParticipante(
      {
        participanteId: PARTICIPANTE,
        desde: "2026-09-08",
        hasta: "2026-09-08",
      },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok && resultado.data.eventos).toHaveLength(1);
  });

  it("acota la historia de la solicitud al rango pedido", async () => {
    // La particion de la solicitud se lee entera —no conoce el rango—, asi que
    // el recorte tiene que ocurrir aqui o la pantalla mostraria eventos fuera
    // de las fechas que el auditor escribio.
    const vieja = evento("E-VIEJA", "2026-07-01T18:00:00.000Z");

    const falso = crearClienteFalso({
      responder: (comando) => {
        const cual = clase(comando);
        if (cual === "solicitudes") return { Items: [solicitudCruda] };
        if (cual === "historia") return { Items: [vieja] };
        return { Items: [] };
      },
    });

    const resultado = await consultarActividadDeParticipante(
      {
        participanteId: PARTICIPANTE,
        desde: "2026-09-08",
        hasta: "2026-09-08",
      },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok && resultado.data.eventos).toHaveLength(0);
  });

  it("respeta el filtro de tipo tambien en la historia de la solicitud", async () => {
    const falso = crearClienteFalso({
      responder: (comando) => {
        const cual = clase(comando);
        if (cual === "solicitudes") return { Items: [solicitudCruda] };
        if (cual === "historia") {
          return {
            Items: [
              evento("E-CREADA", "2026-09-08T18:00:00.000Z"),
              evento("E-VENC", "2026-09-08T19:00:00.000Z", {
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
        tipo: "SOLICITUD_VENCIDA",
      },
      { cliente: falso.cliente as never },
    );

    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["E-VENC"]);
  });

  it("ordena por instante y desempata por eventoId, igual que la clave de la bitacora", async () => {
    const falso = crearClienteFalso({
      responder: (comando) => {
        const cual = clase(comando);
        if (cual === "solicitudes") return { Items: [solicitudCruda] };
        if (cual === "historia") {
          return {
            Items: [
              evento("E-B", "2026-09-08T18:00:00.000Z"),
              evento("E-A", "2026-09-08T18:00:00.000Z"),
              evento("E-C", "2026-09-08T17:00:00.000Z"),
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
      { cliente: falso.cliente as never },
    );

    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["E-C", "E-A", "E-B"]);
  });

  it("un participante sin solicitudes no rompe: solo devuelve lo que firmo", async () => {
    const propio = evento("E-PROPIO", "2026-09-08T18:00:00.000Z", {
      PK: "AUDIT#VEHICULO#V1",
      tipo: "VEHICULO_EDITADO",
      solicitudId: undefined,
    });

    const falso = crearClienteFalso({
      responder: (comando) => {
        const cual = clase(comando);
        if (cual === "global") return { Items: [propio] };
        return { Items: [] };
      },
    });

    const resultado = await consultarActividadDeParticipante(
      {
        participanteId: PARTICIPANTE,
        desde: "2026-09-08",
        hasta: "2026-09-08",
      },
      { cliente: falso.cliente as never },
    );

    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["E-PROPIO"]);
  });

  it("propaga el fallo de un rango invalido", async () => {
    const falso = crearClienteFalso();

    const resultado = await consultarActividadDeParticipante(
      {
        participanteId: PARTICIPANTE,
        desde: "2026-09-08",
        hasta: "2026-09-01",
      },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok).toBe(false);
    expect(falso.comandos).toHaveLength(0);
  });
});
