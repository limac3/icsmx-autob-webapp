// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import type { ActorUsuario } from "@/types/auditoria";
import type { EstatusSolicitud } from "@/types/solicitud";
import type { Lote } from "@/types/lote";
import { cerrarFilaDelLote, SOLICITUDES_POR_TANDA } from "./cerrarFilaDelLote";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-10-13T15:00:00.000Z");

const lote: Lote = {
  loteId: "L1",
  convocatoriaId: "C1",
  vehiculoId: "V1",
  precio: 180_000,
  estatus: "ADJUDICADO",
  contadorTurnos: 4,
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
};

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "ADMIN",
  permisos: ["Autob_Administrar_Convocatorias"],
};

const solicitud = (turno: number, estatus: EstatusSolicitud) => ({
  PK: "LOTE#L1",
  SK: `SOL#${String(turno).padStart(10, "0")}`,
  solicitudId: `L1-${String(turno)}`,
  loteId: "L1",
  participanteId: `P${String(turno)}`,
  turno,
  estatus,
  solicitadoEn: "2026-10-06T15:00:00.000Z",
});

const conFila =
  (items: Record<string, unknown>[]) => (comando: ComandoEnviado) =>
    comando.nombre === "QueryCommand" ? { Items: items } : {};

const deps = (cliente: unknown) => ({
  cliente: cliente as never,
  ahora: () => AHORA,
});

const transacciones = (falso: ReturnType<typeof crearClienteFalso>) =>
  falso.comandos
    .filter((c) => c.nombre === "TransactWriteCommand")
    .map(
      (c) => c.input.TransactItems as Record<string, Record<string, unknown>>[],
    );

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("R-18 — que se cierra y que sobrevive", () => {
  it("cierra las EN_FILA y las CONGELADA", async () => {
    const falso = crearClienteFalso({
      responder: conFila([solicitud(1, "EN_FILA"), solicitud(2, "CONGELADA")]),
    });

    const resultado = await cerrarFilaDelLote(
      { lote, actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data).toBe(2);

    const items = transacciones(falso)[0]!;
    expect(items[0]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":destino": "NO_ADJUDICADA",
      ":esperado": "EN_FILA",
    });
    expect(items[3]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":destino": "NO_ADJUDICADA",
      ":esperado": "CONGELADA",
    });
  });

  it("una adjudicacion vigente sobrevive con su plazo intacto", async () => {
    // Quien gano antes del cierre tiene derecho a terminar de pagar. Cerrarla
    // seria quitarle el vehiculo por una decision administrativa.
    const falso = crearClienteFalso({
      responder: conFila([
        solicitud(1, "ADJUDICADA"),
        solicitud(2, "EN_VERIFICACION"),
      ]),
    });

    const resultado = await cerrarFilaDelLote(
      { lote, actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data).toBe(0);
    expect(transacciones(falso)).toHaveLength(0);
  });

  it("no vuelve a tocar lo que ya termino", async () => {
    const falso = crearClienteFalso({
      responder: conFila([
        solicitud(1, "CANCELADA_POR_PARTICIPANTE"),
        solicitud(2, "NO_ADJUDICADA"),
        solicitud(3, "VENDIDA"),
      ]),
    });

    const resultado = await cerrarFilaDelLote(
      { lote, actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data).toBe(0);
  });

  it("un lote sin fila no escribe nada", async () => {
    const falso = crearClienteFalso({ responder: conFila([]) });

    const resultado = await cerrarFilaDelLote(
      { lote, actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data).toBe(0);
    expect(transacciones(falso)).toHaveLength(0);
  });
});

describe("cada cierre deja rastro", () => {
  it("retira el centinela de fila y escribe su evento, en la misma transaccion", async () => {
    const falso = crearClienteFalso({
      responder: conFila([solicitud(1, "EN_FILA")]),
    });

    await cerrarFilaDelLote({ lote, actor }, deps(falso.cliente));

    const items = transacciones(falso)[0]!;
    expect(items).toHaveLength(3);
    expect(items[1]?.Delete?.Key).toEqual({ PK: "LOTE#L1", SK: "PART#P1" });
    expect(items[2]?.Put).toMatchObject({
      ConditionExpression: "attribute_not_exists(PK)",
      Item: {
        PK: "AUDIT#LOTE#L1",
        tipo: "SOLICITUD_NO_ADJUDICADA",
        estadoAnterior: "EN_FILA",
        estadoNuevo: "NO_ADJUDICADA",
        datos: { turno: 1 },
      },
    });
  });
});

describe("tandas", () => {
  it("parte en transacciones que caben en el limite de DynamoDB", async () => {
    const muchas = Array.from({ length: SOLICITUDES_POR_TANDA + 5 }, (_, i) =>
      solicitud(i + 1, "EN_FILA"),
    );
    const falso = crearClienteFalso({ responder: conFila(muchas) });

    const resultado = await cerrarFilaDelLote(
      { lote, actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data).toBe(muchas.length);

    const tandas = transacciones(falso);
    expect(tandas).toHaveLength(2);
    for (const tanda of tandas) {
      expect(tanda.length).toBeLessThanOrEqual(100);
    }
  });
});
