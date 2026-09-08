// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateTag } from "next/cache";

import { getSession } from "@/lib/auth/session";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { leerSolicitudPorId } from "@/lib/fila/leerSolicitud";
import { avalarPago as avalarServicio } from "@/lib/tesoreria/avalarPago";
import { listarPendientesVerificacion as listarServicio } from "@/lib/tesoreria/listarPendientesVerificacion";
import { rechazarPago as rechazarServicio } from "@/lib/tesoreria/rechazarPago";
import { subirComprobante as subirServicio } from "@/lib/tesoreria/subirComprobante";
import type { ConvocatoriaConLotes } from "@/types/convocatoria";
import type { Solicitud } from "@/types/fila";
import type { Sesion } from "@/types/identidad";
import type { Lote } from "@/types/lote";
import * as acciones from "./tesoreria";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/convocatorias/obtenerConvocatoria", () => ({
  obtenerConvocatoria: vi.fn(),
}));
vi.mock("@/lib/fila/leerSolicitud", () => ({ leerSolicitudPorId: vi.fn() }));
vi.mock("@/lib/tesoreria/subirComprobante", () => ({
  subirComprobante: vi.fn(),
}));
vi.mock("@/lib/tesoreria/avalarPago", () => ({ avalarPago: vi.fn() }));
vi.mock("@/lib/tesoreria/rechazarPago", () => ({ rechazarPago: vi.fn() }));
vi.mock("@/lib/tesoreria/listarPendientesVerificacion", () => ({
  listarPendientesVerificacion: vi.fn(),
}));

const sesionSimulada = vi.mocked(getSession);
const lectura = vi.mocked(obtenerConvocatoria);
const solicitudLeida = vi.mocked(leerSolicitudPorId);
const subir = vi.mocked(subirServicio);
const avalar = vi.mocked(avalarServicio);
const rechazar = vi.mocked(rechazarServicio);
const listar = vi.mocked(listarServicio);

const AHORA = new Date();
const enHoras = (horas: number) =>
  new Date(AHORA.getTime() + horas * 3_600_000).toISOString();

const lote: Lote = {
  loteId: "L1",
  convocatoriaId: "C1",
  vehiculoId: "V1",
  precio: 180_000,
  estatus: "ADJUDICADO",
  contadorTurnos: 2,
  inicioVenta: enHoras(-48),
  finVenta: enHoras(48),
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
  adjudicacionActual: "L1-2",
};

const convocatoria: ConvocatoriaConLotes = {
  convocatoriaId: "C1",
  tipo: "EMPLEADOS",
  descripcionParticipacion: "<p>Abierta al personal.</p>",
  publicadaEn: enHoras(-72),
  inicioVenta: enHoras(-48),
  finVenta: enHoras(48),
  horasLiquidacion: 48,
  estatus: "PUBLICADA",
  creadoEn: "2026-09-01T10:00:00.000Z",
  creadoPor: "P9",
  lotes: [lote],
};

const sesion = (permisos: string[], participanteId = "OP1"): Sesion => ({
  participanteId,
  oktaSub: `okta|${participanteId}`,
  correo: "quien@example.org",
  nombre: "Quien Sea",
  permisos: new Set(permisos) as Sesion["permisos"],
  tiposDeConvocatoriaPermitidos: [],
});

const solicitud = (
  estatus: Solicitud["estatus"],
  extras: Partial<Solicitud> = {},
): Solicitud => ({
  solicitudId: "L1-2",
  loteId: "L1",
  convocatoriaId: "C1",
  participanteId: "P1",
  turno: 2,
  estatus,
  solicitadoEn: enHoras(-49),
  adjudicadoEn: enHoras(-24),
  venceEn: enHoras(24),
  ...extras,
});

beforeEach(() => {
  vi.clearAllMocks();
  lectura.mockResolvedValue({ ok: true, data: convocatoria });
});

describe("subirComprobante — autorizacion", () => {
  const archivo = new File(["contenido"], "comprobante.jpg", {
    type: "image/jpeg",
  });

  it("el titular, dentro del plazo, puede subir su comprobante", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Venta_a_empleados"], "P1"));
    solicitudLeida.mockResolvedValue({
      ok: true,
      data: solicitud("ADJUDICADA"),
    });
    subir.mockResolvedValue({ ok: true, data: { estatus: "EN_VERIFICACION" } });

    const resultado = await acciones.subirComprobante({
      solicitudId: "L1-2",
      archivo,
    });

    expect(resultado).toEqual({
      ok: true,
      data: { estatus: "EN_VERIFICACION" },
    });
    expect(subir).toHaveBeenCalledTimes(1);
    expect(updateTag).toHaveBeenCalledWith("lote:L1");
    expect(updateTag).toHaveBeenCalledWith("convocatoria:C1");
  });

  it("no se puede subir el comprobante de otro (not_owner -> forbidden)", async () => {
    sesionSimulada.mockResolvedValue(
      sesion(["Autob_Venta_a_empleados"], "OTRO"),
    );
    solicitudLeida.mockResolvedValue({
      ok: true,
      data: solicitud("ADJUDICADA"),
    });

    const resultado = await acciones.subirComprobante({
      solicitudId: "L1-2",
      archivo,
    });

    expect(resultado).toEqual({ ok: false, error: "forbidden" });
    expect(subir).not.toHaveBeenCalled();
  });

  it("fuera de plazo responde invalid_state, sin llegar al servicio", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Venta_a_empleados"], "P1"));
    solicitudLeida.mockResolvedValue({
      ok: true,
      data: solicitud("ADJUDICADA", { venceEn: enHoras(-1) }),
    });

    const resultado = await acciones.subirComprobante({
      solicitudId: "L1-2",
      archivo,
    });

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(subir).not.toHaveBeenCalled();
  });

  it("sin sesion responde unauthorized", async () => {
    sesionSimulada.mockResolvedValue(null);
    solicitudLeida.mockResolvedValue({
      ok: true,
      data: solicitud("ADJUDICADA"),
    });

    const resultado = await acciones.subirComprobante({
      solicitudId: "L1-2",
      archivo,
    });

    expect(resultado).toEqual({ ok: false, error: "unauthorized" });
    expect(subir).not.toHaveBeenCalled();
  });

  it("un solicitudId que no existe responde not_found", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Venta_a_empleados"], "P1"));
    solicitudLeida.mockResolvedValue({ ok: false, error: "not_found" });

    const resultado = await acciones.subirComprobante({
      solicitudId: "no-existe",
      archivo,
    });

    expect(resultado).toEqual({ ok: false, error: "not_found" });
  });
});

describe("pago:avalar y pago:rechazar — solo Autob_Operar_Tesoreria", () => {
  it("avalarPago con el permiso, en EN_VERIFICACION, tiene exito", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Operar_Tesoreria"]));
    solicitudLeida.mockResolvedValue({
      ok: true,
      data: solicitud("EN_VERIFICACION"),
    });
    avalar.mockResolvedValue({
      ok: true,
      data: { estatus: "VENDIDA", cerradas: 0 },
    });

    const resultado = await acciones.avalarPago({ solicitudId: "L1-2" });

    expect(resultado).toEqual({ ok: true, data: { estatus: "VENDIDA" } });
    expect(updateTag).toHaveBeenCalledWith("lote:L1");
    expect(updateTag).toHaveBeenCalledWith("convocatoria:C1");
  });

  it("sin Autob_Operar_Tesoreria, avalarPago se deniega", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Venta_a_empleados"]));
    solicitudLeida.mockResolvedValue({
      ok: true,
      data: solicitud("EN_VERIFICACION"),
    });

    const resultado = await acciones.avalarPago({ solicitudId: "L1-2" });

    expect(resultado).toEqual({ ok: false, error: "forbidden" });
    expect(avalar).not.toHaveBeenCalled();
  });

  it("un comprador con Autob_Auditar tampoco puede avalar (solo lectura)", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Auditar"]));
    solicitudLeida.mockResolvedValue({
      ok: true,
      data: solicitud("EN_VERIFICACION"),
    });

    const resultado = await acciones.avalarPago({ solicitudId: "L1-2" });

    expect(resultado).toEqual({ ok: false, error: "forbidden" });
    expect(avalar).not.toHaveBeenCalled();
  });

  it("rechazarPago exige motivo no vacio (R-16)", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Operar_Tesoreria"]));
    solicitudLeida.mockResolvedValue({
      ok: true,
      data: solicitud("EN_VERIFICACION"),
    });

    const resultado = await acciones.rechazarPago({
      solicitudId: "L1-2",
      motivo: "   ",
    });

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(rechazar).not.toHaveBeenCalled();
  });

  it("rechazarPago con motivo y permiso, tiene exito", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Operar_Tesoreria"]));
    solicitudLeida.mockResolvedValue({
      ok: true,
      data: solicitud("EN_VERIFICACION"),
    });
    rechazar.mockResolvedValue({
      ok: true,
      data: {
        estatus: "RECHAZADA_POR_TESORERIA",
        reasignacion: { estado: "fila_agotada", turnosRevisados: 0 },
        descongeladas: 0,
      },
    });

    const resultado = await acciones.rechazarPago({
      solicitudId: "L1-2",
      motivo: "Sin evidencia de pago",
    });

    expect(resultado).toEqual({
      ok: true,
      data: { estatus: "RECHAZADA_POR_TESORERIA" },
    });
    expect(rechazar).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: "Sin evidencia de pago" }),
    );
  });
});

describe("listarPendientesVerificacion — bandeja", () => {
  it("Autob_Operar_Tesoreria ve la bandeja", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Operar_Tesoreria"]));
    listar.mockResolvedValue({ ok: true, data: [] });

    const resultado = await acciones.listarPendientesVerificacion();

    expect(resultado).toEqual({ ok: true, data: [] });
  });

  it("Autob_Auditar tambien ve la bandeja, en solo lectura", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Auditar"]));
    listar.mockResolvedValue({ ok: true, data: [] });

    const resultado = await acciones.listarPendientesVerificacion();

    expect(resultado.ok).toBe(true);
  });

  it("un comprador no puede ver la bandeja", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Venta_a_empleados"]));

    const resultado = await acciones.listarPendientesVerificacion();

    expect(resultado).toEqual({ ok: false, error: "forbidden" });
    expect(listar).not.toHaveBeenCalled();
  });
});
