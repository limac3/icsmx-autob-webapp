// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crearClienteFalso } from "@/utils/clienteDynamoFalso";
import { cerrarFilaDelLote } from "@/lib/fila/cerrarFilaDelLote";
import { registrar } from "@/lib/observabilidad/registro";
import type { ActorUsuario } from "@/types/auditoria";
import type { Solicitud } from "@/types/fila";
import type { Lote } from "@/types/lote";
import { avalarPago } from "./avalarPago";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/fila/cerrarFilaDelLote", () => ({
  cerrarFilaDelLote: vi.fn(),
}));
vi.mock("@/lib/observabilidad/registro", () => ({ registrar: vi.fn() }));

const cierre = vi.mocked(cerrarFilaDelLote);
const registro = vi.mocked(registrar);

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
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
  adjudicacionActual: "L1-2",
  adjudicadoEn: "2026-10-06T15:00:00.000Z",
  venceEn: "2026-10-08T15:00:00.000Z",
  turnoAdjudicado: 2,
};

const solicitud: Solicitud = {
  solicitudId: "L1-2",
  loteId: "L1",
  convocatoriaId: "C1",
  participanteId: "P1",
  turno: 2,
  estatus: "EN_VERIFICACION",
  solicitadoEn: "2026-10-06T14:00:00.000Z",
  adjudicadoEn: "2026-10-06T15:00:00.000Z",
  venceEn: "2026-10-08T15:00:00.000Z",
  comprobanteClaveS3: "comprobantes/L1-2/A1.jpg",
  comprobanteSubidoEn: "2026-10-06T16:00:00.000Z",
};

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "OP1",
  permisos: ["Autob_Operar_Tesoreria"],
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
  cierre.mockResolvedValue({ ok: true, data: 0 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("avalarPago — T4", () => {
  it("vende la solicitud, el lote y el vehiculo, y NO devuelve cupo", async () => {
    const falso = crearClienteFalso();

    const resultado = await avalarPago(
      { lote, solicitud, actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.estatus).toBe("VENDIDA");

    const items = itemsDe(falso);
    expect(items).toHaveLength(5);
    expect(items[0]?.Update).toMatchObject({
      Key: { PK: "LOTE#L1", SK: "SOL#0000000002" },
      ConditionExpression: "#estatus = :enVerificacion",
    });
    expect(String(items[0]?.Update?.UpdateExpression)).toContain(
      "REMOVE GSI2PK, GSI2SK",
    );
    expect(items[1]?.Update).toMatchObject({
      Key: { PK: "CONV#C1", SK: "LOTE#L1" },
      ConditionExpression:
        "#estatus = :adjudicado AND adjudicacionActual = :solicitudId",
    });
    expect(items[2]?.Update).toMatchObject({
      Key: { PK: "VEH#V1", SK: "META" },
      ConditionExpression: "#estatus = :reservado",
    });
    expect(items[3]?.Delete?.Key).toEqual({ PK: "VEH#V1", SK: "ACTIVO" });

    // **Nada toca el item de cupo, y es el punto entero de R-09.** Hasta la
    // Etapa 14 esta transaccion borraba el centinela de adjudicacion activa, de
    // modo que completar la compra dejaba al participante libre para ganar otro
    // lote de inmediato. Un tope que la compra liberara no seria un tope.
    expect(JSON.stringify(items)).not.toContain("CUPO#");

    const evento = items[4]?.Put?.Item as Record<string, unknown>;
    expect(evento).toMatchObject({
      tipo: "PAGO_AVALADO",
      solicitudId: "L1-2",
      estadoAnterior: "EN_VERIFICACION",
      estadoNuevo: "VENDIDA",
    });
  });

  it("guarda la nota opcional en el evento, sin exigirla", async () => {
    const falso = crearClienteFalso();

    await avalarPago(
      { lote, solicitud, nota: "Transferencia verificada por SPEI", actor },
      deps(falso.cliente),
    );

    const evento = itemsDe(falso)[4]?.Put?.Item as Record<string, unknown>;
    expect(evento.datos).toEqual({ nota: "Transferencia verificada por SPEI" });
  });

  it("desde un estado que no es EN_VERIFICACION responde invalid_state", async () => {
    const falso = crearClienteFalso();

    const resultado = await avalarPago(
      { lote, solicitud: { ...solicitud, estatus: "ADJUDICADA" }, actor },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(cierre).not.toHaveBeenCalled();
  });

  it("cierra la fila restante del lote fuera de la transaccion", async () => {
    cierre.mockResolvedValue({ ok: true, data: 3 });
    const falso = crearClienteFalso();

    const resultado = await avalarPago(
      { lote, solicitud, actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.cierre).toEqual({ ok: true, cerradas: 3 });
    expect(cierre).toHaveBeenCalledWith(
      { lote: expect.objectContaining({ estatus: "VENDIDO" }), actor },
      expect.anything(),
    );
  });

  it("no cierra la fila si la transaccion de venta fallo", async () => {
    const falso = crearClienteFalso();

    await avalarPago(
      { lote, solicitud: { ...solicitud, estatus: "ADJUDICADA" }, actor },
      deps(falso.cliente),
    );

    expect(cierre).not.toHaveBeenCalled();
  });
});

describe("cuando el cierre de la fila falla despues de la venta", () => {
  // El camino que la auditoria externa encontro descubierto: el mock de
  // `cerrarFilaDelLote` solo se resolvia `ok`, asi que nada probaba lo que pasa
  // cuando falla — y lo que pasaba era que el error se convertia en
  // `cerradas: 0` y salia como exito.

  it("la venta se sostiene: revertirla seria peor", async () => {
    cierre.mockResolvedValue({ ok: false, error: "conflicto_concurrencia" });
    const falso = crearClienteFalso();

    const resultado = await avalarPago(
      { lote, solicitud, actor },
      deps(falso.cliente),
    );

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.estatus).toBe("VENDIDA");
  });

  it("el resultado delata el fallo, en vez de confundirlo con cero cerradas", async () => {
    // La ambiguedad que se elimino: `cerrarFilaDelLote` devuelve `exito(0)`
    // legitimamente cuando no habia nada que cerrar, asi que un `0` no podia
    // distinguir "no habia fila" de "el cierre fallo".
    cierre.mockResolvedValue({ ok: false, error: "conflicto_concurrencia" });
    const falso = crearClienteFalso();

    const resultado = await avalarPago(
      { lote, solicitud, actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.cierre).toEqual({
      ok: false,
      error: "conflicto_concurrencia",
    });
  });

  it("no confunde 'no habia fila que cerrar' con un fallo", async () => {
    cierre.mockResolvedValue({ ok: true, data: 0 });
    const falso = crearClienteFalso();

    const resultado = await avalarPago(
      { lote, solicitud, actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.cierre).toEqual({ ok: true, cerradas: 0 });
  });

  it("deja una linea de registro: nadie mas va a reportar este fallo", async () => {
    // Sin esta linea el fallo era invisible por completo — el tesorero ve la
    // venta hecha y los participantes solo ven una posicion que ya no
    // significa nada. `registrar` se silencia dentro de Vitest, asi que lo que
    // se comprueba es que se le llama y con que.
    cierre.mockResolvedValue({ ok: false, error: "conflicto_concurrencia" });
    const falso = crearClienteFalso();

    await avalarPago({ lote, solicitud, actor }, deps(falso.cliente));

    expect(registro).toHaveBeenCalledWith(
      "warn",
      "cerrarFilaDelLote",
      expect.objectContaining({
        loteId: "L1",
        desenlace: "rechazado",
        error: "conflicto_concurrencia",
      }),
    );
  });

  it("no registra nada cuando el cierre funciona", async () => {
    cierre.mockResolvedValue({ ok: true, data: 2 });
    const falso = crearClienteFalso();

    await avalarPago({ lote, solicitud, actor }, deps(falso.cliente));

    expect(registro).not.toHaveBeenCalled();
  });
});
