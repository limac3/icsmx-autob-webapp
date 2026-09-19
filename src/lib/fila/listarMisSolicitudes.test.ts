// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import type { ConvocatoriaConLotes } from "@/types/convocatoria";
import type { Lote } from "@/types/lote";
import { exito, fallo } from "@/types/resultado";
import { crearClienteFalso } from "@/utils/clienteDynamoFalso";
import {
  listarMisSolicitudes,
  MAXIMO_MIS_SOLICITUDES,
} from "./listarMisSolicitudes";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/convocatorias/obtenerConvocatoria", () => ({
  obtenerConvocatoria: vi.fn(),
}));
vi.mock("@/lib/vehiculos/obtenerVehiculo", () => ({
  obtenerVehiculo: vi.fn(),
}));

const leerConvocatoria = vi.mocked(obtenerConvocatoria);
const leerVehiculo = vi.mocked(obtenerVehiculo);

const AHORA = new Date("2026-09-19T12:00:00.000Z");
const PARTICIPANTE = "P1";

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
  leerVehiculo.mockResolvedValue(exito(vehiculo()));
  leerConvocatoria.mockResolvedValue(exito(convocatoria(["L1", "L2"])));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const lote = (loteId: string): Lote => ({
  loteId,
  convocatoriaId: "C1",
  vehiculoId: "V1",
  precio: 180_000,
  estatus: "EN_OFERTA",
  contadorTurnos: 0,
  inicioVenta: "2026-09-05T15:00:00.000Z",
  finVenta: "2026-09-30T15:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  creadoEn: "2026-08-20T10:00:00.000Z",
  creadoPor: "P9",
});

const convocatoria = (lotes: readonly string[]): ConvocatoriaConLotes => ({
  convocatoriaId: "C1",
  folio: "CONV-001",
  nombre: "Venta de septiembre",
  tipo: "EMPLEADOS",
  descripcionParticipacion: "<p>Abierta al personal.</p>",
  publicadaEn: "2026-09-01T15:00:00.000Z",
  inicioVenta: "2026-09-05T15:00:00.000Z",
  finVenta: "2026-09-30T15:00:00.000Z",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  estatus: "PUBLICADA",
  creadoEn: "2026-08-20T10:00:00.000Z",
  creadoPor: "P9",
  lotes: lotes.map(lote),
});

const vehiculo = () => ({
  vehiculoId: "V1",
  numeroEconomico: "VEH-001",
  numeroDeSerie: "3N6AD33A9KK870001",
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 100_000,
  estatus: "DISPONIBLE" as const,
  creadoEn: "2026-08-20T10:00:00.000Z",
  creadoPor: "P9",
  actualizadoEn: "2026-08-20T10:00:00.000Z",
  actualizadoPor: "P9",
  fotografias: [],
});

const solicitudCruda = (campos: {
  loteId: string;
  turno: number;
  estatus: string;
  solicitadoEn: string;
  venceEn?: string;
  convocatoriaId?: string | null;
}): Record<string, unknown> => ({
  PK: `LOTE#${campos.loteId}`,
  SK: `SOL#${String(campos.turno).padStart(10, "0")}`,
  solicitudId: `${campos.loteId}-${campos.turno}`,
  loteId: campos.loteId,
  participanteId: PARTICIPANTE,
  turno: campos.turno,
  estatus: campos.estatus,
  solicitadoEn: campos.solicitadoEn,
  ...(campos.venceEn ? { venceEn: campos.venceEn } : {}),
  ...(campos.convocatoriaId === null ? {} : { convocatoriaId: "C1" }),
});

const deps = (
  items: readonly Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) => {
  const falso = crearClienteFalso({
    respuestas: [{ Items: items, ...extra }],
  });
  return {
    falso,
    deps: { cliente: falso.cliente as never, ahora: () => AHORA },
  };
};

describe("la consulta a GSI3", () => {
  it("lee las mas recientes primero, y ese orden es de correccion (D-37)", async () => {
    // Ascendente con `Limit` devolveria las mas viejas y dejaria fuera justo
    // las que pueden tener un plazo corriendo: una lista incompleta que se ve
    // completa.
    const { falso, deps: d } = deps([]);

    await listarMisSolicitudes(PARTICIPANTE, d);

    expect(falso.comandos[0]?.input).toMatchObject({
      IndexName: "GSI3",
      ScanIndexForward: false,
      Limit: MAXIMO_MIS_SOLICITUDES,
      ExpressionAttributeValues: { ":pk": `PART#${PARTICIPANTE}` },
    });
  });

  it("avisa cuando se trunco, en vez de mostrar una lista incompleta", async () => {
    const { deps: d } = deps([], { LastEvaluatedKey: { PK: "algo" } });

    const resultado = await listarMisSolicitudes(PARTICIPANTE, d);

    expect(resultado.ok && resultado.data.truncada).toBe(true);
  });
});

describe("agrupacion y orden", () => {
  it("la adjudicacion con el plazo corriendo va primera, y la urgente antes que la reciente", async () => {
    leerConvocatoria.mockResolvedValue(exito(convocatoria(["L1", "L2", "L3"])));
    const { deps: d } = deps([
      solicitudCruda({
        loteId: "L3",
        turno: 1,
        estatus: "EN_FILA",
        solicitadoEn: "2026-09-18T10:00:00.000Z",
      }),
      solicitudCruda({
        loteId: "L2",
        turno: 4,
        estatus: "ADJUDICADA",
        solicitadoEn: "2026-09-17T10:00:00.000Z",
        venceEn: "2026-09-25T10:00:00.000Z",
      }),
      solicitudCruda({
        loteId: "L1",
        turno: 2,
        estatus: "ADJUDICADA",
        solicitadoEn: "2026-09-10T10:00:00.000Z",
        venceEn: "2026-09-20T06:00:00.000Z",
      }),
    ]);

    const resultado = await listarMisSolicitudes(PARTICIPANTE, d);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.data.solicitudes.map((s) => [s.loteId, s.grupo])).toEqual([
      // La mas antigua de las dos adjudicadas, porque su plazo vence antes.
      ["L1", "REQUIERE_ATENCION"],
      ["L2", "REQUIERE_ATENCION"],
      ["L3", "ACTIVA"],
    ]);
  });

  it("marca el plazo vencido sin escribir nada (D-35)", async () => {
    const { falso, deps: d } = deps([
      solicitudCruda({
        loteId: "L1",
        turno: 2,
        estatus: "ADJUDICADA",
        solicitadoEn: "2026-09-10T10:00:00.000Z",
        venceEn: "2026-09-12T06:00:00.000Z",
      }),
    ]);

    const resultado = await listarMisSolicitudes(PARTICIPANTE, d);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const fila = resultado.data.solicitudes[0];
    expect(fila?.plazoVencido).toBe(true);
    // Deja de requerir atencion: ya no se puede subir el comprobante. Pero
    // sigue `ADJUDICADA`, porque esta lectura no escribe la transicion.
    expect(fila?.grupo).toBe("ACTIVA");
    expect(fila?.estatus).toBe("ADJUDICADA");

    // La diferencia con `consultarMiLugar`, afirmada: ninguna escritura.
    expect(falso.comandos.map((c) => c.nombre)).toEqual(["QueryCommand"]);
  });
});

describe("datos incompletos", () => {
  it("omite la solicitud sin convocatoriaId: no hay lote que alcanzar", async () => {
    const { deps: d } = deps([
      solicitudCruda({
        loteId: "L1",
        turno: 2,
        estatus: "EN_FILA",
        solicitadoEn: "2026-09-10T10:00:00.000Z",
        convocatoriaId: null,
      }),
    ]);

    const resultado = await listarMisSolicitudes(PARTICIPANTE, d);

    expect(resultado.ok && resultado.data.solicitudes).toEqual([]);
  });

  it("un vehiculo ilegible deja la fila en blanco pero NO la desaparece", async () => {
    // Desaparecerla le ocultaria a alguien una adjudicacion suya con el plazo
    // corriendo, que es lo que esta pantalla existe para evitar.
    leerVehiculo.mockResolvedValue(fallo("not_found"));
    const { deps: d } = deps([
      solicitudCruda({
        loteId: "L1",
        turno: 2,
        estatus: "ADJUDICADA",
        solicitadoEn: "2026-09-10T10:00:00.000Z",
        venceEn: "2026-09-25T06:00:00.000Z",
      }),
    ]);

    const resultado = await listarMisSolicitudes(PARTICIPANTE, d);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.data.solicitudes).toHaveLength(1);
    expect(resultado.data.solicitudes[0]).toMatchObject({
      marca: "",
      version: "",
      grupo: "REQUIERE_ATENCION",
    });
  });
});

describe("lecturas", () => {
  it("una lectura por convocatoria distinta, no una por solicitud", async () => {
    const { deps: d } = deps([
      solicitudCruda({
        loteId: "L1",
        turno: 1,
        estatus: "EN_FILA",
        solicitadoEn: "2026-09-18T10:00:00.000Z",
      }),
      solicitudCruda({
        loteId: "L2",
        turno: 3,
        estatus: "EN_FILA",
        solicitadoEn: "2026-09-17T10:00:00.000Z",
      }),
    ]);

    await listarMisSolicitudes(PARTICIPANTE, d);

    expect(leerConvocatoria).toHaveBeenCalledTimes(1);
  });

  it("ninguna fila lleva participanteId, ni siquiera el propio", async () => {
    const { deps: d } = deps([
      solicitudCruda({
        loteId: "L1",
        turno: 1,
        estatus: "EN_FILA",
        solicitadoEn: "2026-09-18T10:00:00.000Z",
      }),
    ]);

    const resultado = await listarMisSolicitudes(PARTICIPANTE, d);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const serializado = JSON.stringify(resultado.data.solicitudes);
    expect(serializado).not.toContain(PARTICIPANTE);
    expect(serializado).not.toContain("participanteId");
  });
});
