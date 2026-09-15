// @vitest-environment node
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import type { ActorUsuario } from "@/types/auditoria";
import type { Lote } from "@/types/lote";
import { adjudicarManualmente } from "./adjudicarManualmente";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-10-06T15:00:00.000Z");

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
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "MANUAL",
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
};

const adjudicador: ActorUsuario = {
  tipo: "USUARIO",
  id: "ADJ1",
  permisos: ["Autob_Adjudicar_Convocatorias"],
};

const deps = (cliente: unknown) => ({
  cliente: cliente as never,
  ahora: () => AHORA,
  nuevoId: () => "M1",
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

const conFila = (candidatos: Record<string, unknown>[]) => {
  return (comando: ComandoEnviado): unknown => {
    if (comando.nombre !== "QueryCommand") return {};
    const valores = comando.input.ExpressionAttributeValues as Record<
      string,
      string
    >;
    return valores[":prefijo"] === "RESERVA#"
      ? { Items: [] }
      : { Items: candidatos };
  };
};

const items = (falso: ReturnType<typeof crearClienteFalso>) =>
  falso.comandos.find((c) => c.nombre === "TransactWriteCommand")?.input
    .TransactItems as Record<string, Record<string, unknown>>[];

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("la eleccion del adjudicador", () => {
  it("adjudica al turno que eligio, aunque haya turnos menores vivos", async () => {
    // **Saltarse el orden es el proposito de la modalidad, no una anomalia.**
    const falso = crearClienteFalso({
      responder: conFila([
        solicitudEnFila(1, "P1"),
        solicitudEnFila(2, "P2"),
        solicitudEnFila(3, "P3"),
      ]),
    });

    const resultado = await adjudicarManualmente(
      { lote, turno: 3, motivo: "mejor perfil crediticio", actor: adjudicador },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error(`se esperaba exito: ${resultado.error}`);
    expect(resultado.data).toMatchObject({ turno: 3, participanteId: "P3" });
    expect(items(falso)[1]?.Update?.Key).toEqual({
      PK: "LOTE#L1",
      SK: "SOL#0000000003",
    });
  });

  it("conserva las cinco condiciones de T2: gana con escritura condicional", async () => {
    // La regla 6 aplica igual cuando quien decide es una persona. Si esto
    // releyera el lote y despues escribiera, la modalidad manual seria el unico
    // camino del sistema con una carrera abierta.
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(1, "P1")]),
    });

    await adjudicarManualmente(
      { lote, turno: 1, motivo: "unico interesado", actor: adjudicador },
      deps(falso.cliente),
    );

    const transaccion = items(falso);
    expect(transaccion[0]?.Update?.ConditionExpression).toBe(
      "attribute_not_exists(adjudicacionActual) AND #estatus = :enOferta",
    );
    expect(transaccion[1]?.Update?.ConditionExpression).toBe(
      "#estatus = :enFila",
    );
    expect(String(transaccion[2]?.Update?.ConditionExpression)).toContain(
      "cupoConsumido < :limite",
    );
    expect(transaccion[3]?.Update?.ConditionExpression).toBe(
      "#estatus = :enConvocatoria",
    );
  });

  it("firma el evento con la persona, su motivo y sus permisos", async () => {
    // Es lo unico que distingue una decision humana legitima de un automatismo
    // que actuo donde debia decidir alguien (trazabilidad 5.1).
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(2, "P2")]),
    });

    await adjudicarManualmente(
      {
        lote,
        turno: 2,
        motivo: "documentacion completa",
        actor: adjudicador,
        ventaAbiertaAlDecidir: true,
      },
      deps(falso.cliente),
    );

    const evento = items(falso)[4]?.Put?.Item as Record<string, unknown>;
    expect(evento).toMatchObject({
      tipo: "LOTE_ADJUDICADO",
      actorTipo: "USUARIO",
      actorId: "ADJ1",
      motivo: "documentacion completa",
    });
    expect(evento.datos).toMatchObject({
      turno: 2,
      motivoAdjudicacion: "DECISION_MANUAL",
      // Se decidio que puede dictaminar con la fila creciendo. Eso lo hace
      // legitimo, no invisible.
      ventaAbiertaAlDecidir: true,
    });
  });
});

describe("lo que se niega a hacer", () => {
  it("si el elegido agota su cupo, falla — no prueba con otro", async () => {
    // Elegir a otro por su cuenta seria volver a la modalidad automatica justo
    // en el acto que existe para no ser automatico.
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "TransactWriteCommand") {
          throw new TransactionCanceledException({
            message: "cancelada",
            $metadata: {},
            CancellationReasons: [
              { Code: "None" },
              { Code: "None" },
              { Code: "ConditionalCheckFailed" },
              { Code: "None" },
              { Code: "None" },
            ],
          });
        }
        return conFila([solicitudEnFila(1, "P1"), solicitudEnFila(2, "P2")])(
          comando,
        );
      },
    });

    const resultado = await adjudicarManualmente(
      { lote, turno: 1, motivo: "por antiguedad", actor: adjudicador },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "limite_alcanzado" });
    // **Un solo intento.** Reintentar con el turno 2 seria decidir por el
    // adjudicador.
    expect(
      falso.comandos.filter((c) => c.nombre === "TransactWriteCommand"),
    ).toHaveLength(1);
  });

  it("sobre una convocatoria automatica responde invalid_state", async () => {
    // El servicio es invocable directamente, asi que no se fia de que la guarda
    // del permiso lo haya comprobado. Mismo criterio que `rechazarPago` con su
    // motivo obligatorio.
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(1, "P1")]),
    });

    const resultado = await adjudicarManualmente(
      {
        lote: { ...lote, modalidadAdjudicacion: "AUTOMATICA" },
        turno: 1,
        motivo: "porque si",
        actor: adjudicador,
      },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(falso.comandos).toHaveLength(0);
  });

  it("sin motivo no decide nada", async () => {
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(1, "P1")]),
    });

    const resultado = await adjudicarManualmente(
      { lote, turno: 1, motivo: "   ", actor: adjudicador },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "validation_failed" });
    expect(falso.comandos).toHaveLength(0);
  });

  it("un turno que no esta en la fila responde not_found", async () => {
    const falso = crearClienteFalso({
      responder: conFila([solicitudEnFila(1, "P1")]),
    });

    const resultado = await adjudicarManualmente(
      { lote, turno: 9, motivo: "el nueve", actor: adjudicador },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "not_found" });
  });

  it("un turno que dejo de estar EN_FILA tampoco es elegible", async () => {
    // `leerFila` solo devuelve `EN_FILA`. Un turno cancelado sigue en la
    // particion para siempre, y ofrecerlo invitaria a elegir a alguien que ya
    // no esta.
    const falso = crearClienteFalso({
      responder: conFila([
        { ...solicitudEnFila(1, "P1"), estatus: "CANCELADA_POR_PARTICIPANTE" },
      ]),
    });

    const resultado = await adjudicarManualmente(
      { lote, turno: 1, motivo: "el uno", actor: adjudicador },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "not_found" });
  });
});
