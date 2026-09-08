// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { consultarBitacora as consultarServicio } from "@/lib/auditoria/consultarBitacora";
import { reconstruirFila as reconstruirServicio } from "@/lib/auditoria/reconstruirFila";
import { verificarIntegridad as verificarServicio } from "@/lib/auditoria/verificarIntegridad";
import type { Sesion } from "@/types/identidad";
import * as acciones from "./auditoria";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auditoria/consultarBitacora", () => ({
  consultarBitacora: vi.fn(),
}));
vi.mock("@/lib/auditoria/reconstruirFila", () => ({
  reconstruirFila: vi.fn(),
}));
vi.mock("@/lib/auditoria/verificarIntegridad", () => ({
  verificarIntegridad: vi.fn(),
}));

const sesionSimulada = vi.mocked(getSession);
const consultar = vi.mocked(consultarServicio);
const reconstruir = vi.mocked(reconstruirServicio);
const verificar = vi.mocked(verificarServicio);

const sesion = (permisos: Sesion["permisos"]): Sesion => ({
  participanteId: "AUD-1",
  oktaSub: "okta|aud-1",
  correo: "auditor@example.org",
  nombre: "Auditor",
  permisos,
  tiposDeConvocatoriaPermitidos: [],
});

const AUDITOR = new Set(["Autob_Auditar"] as const);
const SIN_PERMISOS = new Set([] as const);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("consultarBitacora", () => {
  it("sin Autob_Auditar, forbidden — no delega en el servicio", async () => {
    sesionSimulada.mockResolvedValue(sesion(SIN_PERMISOS));

    const resultado = await acciones.consultarBitacora({
      agregado: "LOTE",
      agregadoId: "L1",
    });

    expect(resultado).toEqual({ ok: false, error: "forbidden" });
    expect(consultar).not.toHaveBeenCalled();
  });

  it("con Autob_Auditar, delega en el servicio", async () => {
    sesionSimulada.mockResolvedValue(sesion(AUDITOR));
    consultar.mockResolvedValue({ ok: true, data: { eventos: [] } });

    const resultado = await acciones.consultarBitacora({
      agregado: "LOTE",
      agregadoId: "L1",
    });

    expect(resultado).toEqual({ ok: true, data: { eventos: [] } });
    expect(consultar).toHaveBeenCalledWith({
      agregado: "LOTE",
      agregadoId: "L1",
      cursor: undefined,
    });
  });

  it("un agregado que no es del catalogo se rechaza antes de consultar", async () => {
    sesionSimulada.mockResolvedValue(sesion(AUDITOR));

    const resultado = await acciones.consultarBitacora({
      agregado: "PARTICIPANTE",
      agregadoId: "P1",
    });

    expect(resultado).toEqual({ ok: false, error: "validation_failed" });
    expect(consultar).not.toHaveBeenCalled();
  });

  it("sin sesion, unauthorized", async () => {
    sesionSimulada.mockResolvedValue(null);

    const resultado = await acciones.consultarBitacora({
      agregado: "LOTE",
      agregadoId: "L1",
    });

    expect(resultado).toEqual({ ok: false, error: "unauthorized" });
  });
});

describe("reconstruirFila", () => {
  it("exige auditoria:ver-fila-historica", async () => {
    sesionSimulada.mockResolvedValue(sesion(SIN_PERMISOS));

    const resultado = await acciones.reconstruirFila({ loteId: "L1" });

    expect(resultado).toEqual({ ok: false, error: "forbidden" });
    expect(reconstruir).not.toHaveBeenCalled();
  });

  it("con permiso, delega en el servicio con el loteId", async () => {
    sesionSimulada.mockResolvedValue(sesion(AUDITOR));
    reconstruir.mockResolvedValue({
      ok: true,
      data: { loteId: "L1", solicitudes: [], eventosDelLote: [] },
    });

    await acciones.reconstruirFila({ loteId: "L1" });

    expect(reconstruir).toHaveBeenCalledWith("L1");
  });
});

describe("verificarIntegridad", () => {
  it("exige Autob_Auditar y delega con el loteId", async () => {
    sesionSimulada.mockResolvedValue(sesion(AUDITOR));
    verificar.mockResolvedValue({
      ok: true,
      data: { loteId: "L1", comprobaciones: [] },
    });

    await acciones.verificarIntegridad({ loteId: "L1" });

    expect(verificar).toHaveBeenCalledWith("L1");
  });

  it("sin permiso, forbidden", async () => {
    sesionSimulada.mockResolvedValue(sesion(SIN_PERMISOS));

    const resultado = await acciones.verificarIntegridad({ loteId: "L1" });

    expect(resultado).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("exportarBitacora", () => {
  it("sin Autob_Auditar, forbidden", async () => {
    sesionSimulada.mockResolvedValue(sesion(SIN_PERMISOS));

    const resultado = await acciones.exportarBitacora({
      agregado: "LOTE",
      agregadoId: "L1",
    });

    expect(resultado).toEqual({ ok: false, error: "forbidden" });
  });

  it("con permiso, devuelve la URL del Route Handler con los filtros", async () => {
    sesionSimulada.mockResolvedValue(sesion(AUDITOR));

    const resultado = await acciones.exportarBitacora({
      agregado: "LOTE",
      agregadoId: "L1",
      tipo: "LOTE_ADJUDICADO",
    });

    expect(resultado.ok).toBe(true);
    const url = resultado.ok ? resultado.data.urlDescarga : "";
    expect(url).toBe(
      "/api/auditoria/exportar?agregado=LOTE&agregadoId=L1&tipo=LOTE_ADJUDICADO",
    );
  });

  it("no consulta la bitacora ni escribe BITACORA_EXPORTADA — eso lo hace la descarga", async () => {
    sesionSimulada.mockResolvedValue(sesion(AUDITOR));

    await acciones.exportarBitacora({ agregado: "LOTE", agregadoId: "L1" });

    expect(consultar).not.toHaveBeenCalled();
  });
});

describe("exportarBitacoraFormulario", () => {
  const formulario = (campos: Record<string, string>) => {
    const datos = new FormData();
    for (const [clave, valor] of Object.entries(campos))
      datos.set(clave, valor);
    return datos;
  };

  it("redirige a la URL de descarga con permiso", async () => {
    sesionSimulada.mockResolvedValue(sesion(AUDITOR));

    await acciones.exportarBitacoraFormulario(
      formulario({ agregado: "LOTE", agregadoId: "L1" }),
    );

    expect(redirect).toHaveBeenCalledWith(
      "/api/auditoria/exportar?agregado=LOTE&agregadoId=L1",
    );
  });

  it("sin agregadoId, no redirige a ningun lado", async () => {
    sesionSimulada.mockResolvedValue(sesion(AUDITOR));

    await acciones.exportarBitacoraFormulario(formulario({ agregado: "LOTE" }));

    expect(redirect).not.toHaveBeenCalled();
  });

  it("un tipo de evento invalido se descarta en vez de viajar a la URL", async () => {
    sesionSimulada.mockResolvedValue(sesion(AUDITOR));

    await acciones.exportarBitacoraFormulario(
      formulario({ agregado: "LOTE", agregadoId: "L1", tipo: "NO_EXISTE" }),
    );

    expect(redirect).toHaveBeenCalledWith(
      "/api/auditoria/exportar?agregado=LOTE&agregadoId=L1",
    );
  });

  it("sin permiso, no redirige", async () => {
    sesionSimulada.mockResolvedValue(sesion(SIN_PERMISOS));

    await acciones.exportarBitacoraFormulario(
      formulario({ agregado: "LOTE", agregadoId: "L1" }),
    );

    expect(redirect).not.toHaveBeenCalled();
  });
});
