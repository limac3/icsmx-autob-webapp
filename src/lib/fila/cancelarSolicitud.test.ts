// @vitest-environment node
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crearClienteFalso } from "@/utils/clienteDynamoFalso";
import type { ActorUsuario } from "@/types/auditoria";
import type { Solicitud } from "@/types/fila";
import type { Lote } from "@/types/lote";
import { adjudicarLote } from "./adjudicarLote";
import { cancelarSolicitud } from "./cancelarSolicitud";
import { descongelarSolicitudes } from "./descongelarSolicitudes";

vi.mock("server-only", () => ({}));
vi.mock("./adjudicarLote", () => ({ adjudicarLote: vi.fn() }));
vi.mock("./descongelarSolicitudes", () => ({
  descongelarSolicitudes: vi.fn(),
}));

const adjudicacion = vi.mocked(adjudicarLote);
const descongelamiento = vi.mocked(descongelarSolicitudes);

const AHORA = new Date("2026-10-07T15:00:00.000Z");

const lote: Lote = {
  loteId: "L1",
  convocatoriaId: "C1",
  vehiculoId: "V1",
  precio: 180_000,
  estatus: "ADJUDICADO",
  contadorTurnos: 3,
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
  adjudicacionActual: "L1-2",
  adjudicadoEn: "2026-10-06T15:00:00.000Z",
  venceEn: "2026-10-08T15:00:00.000Z",
  turnoAdjudicado: 2,
};

const solicitud = (estatus: Solicitud["estatus"]): Solicitud => ({
  solicitudId: "L1-2",
  loteId: "L1",
  participanteId: "P1",
  turno: 2,
  estatus,
  solicitadoEn: "2026-10-06T14:00:00.000Z",
});

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Venta_a_empleados"],
};

const deps = (cliente: unknown) => ({
  cliente: cliente as never,
  ahora: () => AHORA,
});

const itemsDe = (falso: ReturnType<typeof crearClienteFalso>) =>
  falso.comandos.find((c) => c.nombre === "TransactWriteCommand")?.input
    .TransactItems as Record<string, Record<string, unknown>>[];

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
  adjudicacion.mockResolvedValue({
    estado: "fila_agotada",
    turnosRevisados: 0,
  });
  descongelamiento.mockResolvedValue(0);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("cancelar desde la fila", () => {
  it("retira la solicitud y su centinela, con su evento (regla 4)", async () => {
    const falso = crearClienteFalso();

    const resultado = await cancelarSolicitud(
      {
        lote: { ...lote, estatus: "EN_OFERTA" },
        solicitud: solicitud("EN_FILA"),
        actor,
      },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({
      ok: true,
      data: {
        estatus: "CANCELADA_POR_PARTICIPANTE",
        liberoElLote: false,
        descongeladas: 0,
      },
    });

    const items = itemsDe(falso);
    expect(items).toHaveLength(3);
    expect(items[0]?.Update).toMatchObject({
      Key: { PK: "LOTE#L1", SK: "SOL#0000000002" },
      ConditionExpression: "#estatus = :esperado",
    });
    // Retirar el centinela es lo que permite volver a formarse con un turno
    // nuevo; jamas recupera el anterior (R-07).
    expect(items[1]?.Delete?.Key).toEqual({ PK: "LOTE#L1", SK: "PART#P1" });
    expect(items[2]?.Put?.Item).toMatchObject({
      PK: "AUDIT#LOTE#L1",
      tipo: "SOLICITUD_CANCELADA_POR_PARTICIPANTE",
      actorId: "P1",
      datos: { turno: 2, liberoElLote: false },
    });
  });

  it("no libera nada ni dispara reasignacion", async () => {
    const falso = crearClienteFalso();

    await cancelarSolicitud(
      {
        lote: { ...lote, estatus: "EN_OFERTA" },
        solicitud: solicitud("EN_FILA"),
        actor,
      },
      deps(falso.cliente),
    );

    expect(adjudicacion).not.toHaveBeenCalled();
    expect(descongelamiento).not.toHaveBeenCalled();
  });

  it("tambien se puede cancelar una congelada (R-09)", async () => {
    const falso = crearClienteFalso();

    const resultado = await cancelarSolicitud(
      { lote, solicitud: solicitud("CONGELADA"), actor },
      deps(falso.cliente),
    );

    expect(resultado.ok).toBe(true);
    expect(itemsDe(falso)).toHaveLength(3);
  });

  it("desde un estado que no admite CANCELAR responde invalid_state", async () => {
    // La lista de estados cancelables sale de la maquina de estados, no de una
    // constante local: `EN_VERIFICACION` no la admite porque el reloj ya se
    // detuvo y el caso lo resuelve tesoreria (R-16).
    const falso = crearClienteFalso();

    const resultado = await cancelarSolicitud(
      { lote, solicitud: solicitud("EN_VERIFICACION"), actor },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(falso.comandos).toHaveLength(0);
  });
});

describe("cancelar una adjudicacion libera el lote", () => {
  it("retira el centinela de adjudicacion, libera el lote y el vehiculo", async () => {
    const falso = crearClienteFalso();

    await cancelarSolicitud(
      { lote, solicitud: solicitud("ADJUDICADA"), actor },
      deps(falso.cliente),
    );

    const items = itemsDe(falso);
    expect(items).toHaveLength(6);
    expect(items[2]?.Delete?.Key).toEqual({
      PK: "PART#P1",
      SK: "ADJUDICACION_ACTIVA",
    });
    expect(items[3]?.Update).toMatchObject({
      Key: { PK: "CONV#C1", SK: "LOTE#L1" },
      ConditionExpression: "adjudicacionActual = :solicitudId",
    });
    expect(items[4]?.Update).toMatchObject({
      Key: { PK: "VEH#V1", SK: "META" },
      ConditionExpression: "#estatus = :reservado",
    });
  });

  it("quita la adjudicacion con REMOVE, nunca poniendola en null", async () => {
    // Un `null` es un atributo que existe: pasaria
    // `attribute_not_exists(adjudicacionActual)` y adjudicaria el lote dos
    // veces (modelo-datos 2.2).
    const falso = crearClienteFalso();

    await cancelarSolicitud(
      { lote, solicitud: solicitud("ADJUDICADA"), actor },
      deps(falso.cliente),
    );

    const expresion = String(itemsDe(falso)[3]?.Update?.UpdateExpression);
    expect(expresion).toContain("REMOVE adjudicacionActual");
    expect(expresion).not.toContain("adjudicacionActual = :null");
  });

  it("detiene el reloj del vencimiento quitando las claves de GSI4", async () => {
    const falso = crearClienteFalso();

    await cancelarSolicitud(
      { lote, solicitud: solicitud("ADJUDICADA"), actor },
      deps(falso.cliente),
    );

    expect(String(itemsDe(falso)[0]?.Update?.UpdateExpression)).toContain(
      "REMOVE GSI4PK, GSI4SK",
    );
  });

  it("descongela lo del participante antes de reasignar (R-09)", async () => {
    descongelamiento.mockResolvedValue(2);
    const falso = crearClienteFalso();

    const resultado = await cancelarSolicitud(
      { lote, solicitud: solicitud("ADJUDICADA"), actor },
      deps(falso.cliente),
    );

    expect(descongelamiento).toHaveBeenCalledWith(
      { participanteId: "P1" },
      expect.anything(),
    );
    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.descongeladas).toBe(2);
    expect(descongelamiento.mock.invocationCallOrder[0]).toBeLessThan(
      adjudicacion.mock.invocationCallOrder[0]!,
    );
  });

  it("reasigna al siguiente turno vivo, reusando el camino de siempre", async () => {
    adjudicacion.mockResolvedValue({
      estado: "adjudicado",
      turno: 3,
      solicitudId: "L1-3",
      participanteId: "P3",
      venceEn: "2026-10-09T15:00:00.000Z",
    });
    const falso = crearClienteFalso();

    const resultado = await cancelarSolicitud(
      { lote, solicitud: solicitud("ADJUDICADA"), actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.reasignacion).toMatchObject({
      estado: "adjudicado",
      turno: 3,
    });
    expect(adjudicacion.mock.calls[0]?.[0]).toMatchObject({
      motivo: "REASIGNACION_POR_CANCELACION",
      // El lote que se le pasa ya refleja la liberacion: sin eso, la condicion
      // de T2 se evaluaria contra un estado que ya no existe.
      lote: expect.objectContaining({ estatus: "EN_OFERTA" }),
    });
    expect(
      adjudicacion.mock.calls[0]?.[0].lote.adjudicacionActual,
    ).toBeUndefined();
  });

  it("si otro proceso ya reasigno el lote, la cancelacion falla entera", async () => {
    // La condicion `adjudicacionActual = :solicitudId` es lo que impide
    // arrebatarle el vehiculo a quien acaba de recibirlo.
    const falso = crearClienteFalso({
      lanza: new TransactionCanceledException({
        message: "cancelada",
        $metadata: {},
        CancellationReasons: [
          { Code: "None" },
          { Code: "None" },
          { Code: "None" },
          { Code: "ConditionalCheckFailed" },
          { Code: "None" },
          { Code: "None" },
        ],
      }),
    });

    const resultado = await cancelarSolicitud(
      { lote, solicitud: solicitud("ADJUDICADA"), actor },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "conflicto_concurrencia" });
    expect(adjudicacion).not.toHaveBeenCalled();
    expect(descongelamiento).not.toHaveBeenCalled();
  });
});
