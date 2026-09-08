// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { ejecutarTransaccion } from "@/lib/data/transacciones";
import { leerSolicitudPorId } from "@/lib/fila/leerSolicitud";
import { obtenerClienteS3 } from "@/lib/media/almacenamiento";
import type { Solicitud } from "@/types/fila";
import type { Sesion } from "@/types/identidad";
import { GET } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/exigirPermiso", () => ({ exigirPermiso: vi.fn() }));
vi.mock("@/lib/fila/leerSolicitud", () => ({ leerSolicitudPorId: vi.fn() }));
vi.mock("@/lib/data/transacciones", () => ({
  ejecutarTransaccion: vi.fn(),
}));
vi.mock("@/lib/data/eventos", () => ({
  eventoParaTransaccion: vi.fn(() => ({
    item: { Put: { TableName: "x", Item: {} } },
    siFalla: "conflicto_concurrencia",
    descripcion: "evento de prueba",
  })),
  nuevaCorrelacion: () => "CORR1",
}));
vi.mock("@/lib/media/almacenamiento", () => ({
  obtenerClienteS3: vi.fn(),
  nombreDeBucket: () => "bucket-de-prueba",
}));

const sesionSimulada = vi.mocked(getSession);
const permisoSimulado = vi.mocked(exigirPermiso);
const solicitudLeida = vi.mocked(leerSolicitudPorId);
const transaccion = vi.mocked(ejecutarTransaccion);
const clienteS3 = vi.mocked(obtenerClienteS3);

const sesion = (participanteId: string): Sesion => ({
  participanteId,
  oktaSub: `okta|${participanteId}`,
  correo: "quien@example.org",
  nombre: "Quien Sea",
  permisos: new Set(["Autob_Venta_a_empleados"]) as Sesion["permisos"],
  tiposDeConvocatoriaPermitidos: [],
});

const solicitud = (extras: Partial<Solicitud> = {}): Solicitud => ({
  solicitudId: "L1-2",
  loteId: "L1",
  participanteId: "P1",
  turno: 2,
  estatus: "EN_VERIFICACION",
  solicitadoEn: "2026-10-06T14:00:00.000Z",
  comprobanteClaveS3: "comprobantes/L1-2/A1.jpg",
  ...extras,
});

const peticion = (solicitudId: string) =>
  GET(new Request("https://app.invalid/api/comprobantes/x"), {
    params: Promise.resolve({ solicitudId }),
  });

const s3ConCuerpo = (bytes: Uint8Array) => ({
  send: vi.fn().mockResolvedValue({
    Body: { transformToByteArray: () => Promise.resolve(bytes) },
    ContentType: "image/jpeg",
  }),
});

describe("GET /api/comprobantes/[solicitudId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 sin sesion, sin llegar a leer la solicitud", async () => {
    sesionSimulada.mockResolvedValue(null);

    const respuesta = await peticion("L1-2");

    expect(respuesta.status).toBe(401);
    expect(solicitudLeida).not.toHaveBeenCalled();
  });

  it("404 si el solicitudId no existe", async () => {
    sesionSimulada.mockResolvedValue(sesion("P1"));
    solicitudLeida.mockResolvedValue({ ok: false, error: "not_found" });

    const respuesta = await peticion("no-existe");

    expect(respuesta.status).toBe(404);
  });

  it("404 si todavia no hay comprobante cargado", async () => {
    sesionSimulada.mockResolvedValue(sesion("P1"));
    solicitudLeida.mockResolvedValue({
      ok: true,
      data: solicitud({ comprobanteClaveS3: undefined }),
    });

    const respuesta = await peticion("L1-2");

    expect(respuesta.status).toBe(404);
  });

  it("404, nunca 403, cuando la solicitud es de otro participante", async () => {
    sesionSimulada.mockResolvedValue(sesion("OTRO"));
    solicitudLeida.mockResolvedValue({ ok: true, data: solicitud() });
    permisoSimulado.mockResolvedValue({ ok: false, error: "forbidden" });

    const respuesta = await peticion("L1-2");

    expect(respuesta.status).toBe(404);
    expect(exigirPermiso).toHaveBeenCalledWith("comprobante:descargar", {
      titularId: "P1",
    });
  });

  it("200 y el archivo para el propio titular", async () => {
    sesionSimulada.mockResolvedValue(sesion("P1"));
    solicitudLeida.mockResolvedValue({ ok: true, data: solicitud() });
    permisoSimulado.mockResolvedValue({
      ok: true,
      sesion: sesion("P1"),
      actor: {
        tipo: "USUARIO",
        id: "P1",
        permisos: ["Autob_Venta_a_empleados"],
      },
    });
    const bytes = new Uint8Array([1, 2, 3]);
    clienteS3.mockReturnValue(s3ConCuerpo(bytes) as never);
    transaccion.mockResolvedValue({ ok: true });

    const respuesta = await peticion("L1-2");

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Content-Disposition")).toContain(
      "comprobante-L1-2.jpg",
    );
    expect(respuesta.headers.get("Cache-Control")).toBe("no-store");
    expect(new Uint8Array(await respuesta.arrayBuffer())).toEqual(bytes);
  });

  it("200 para tesoreria descargando el comprobante de otro", async () => {
    sesionSimulada.mockResolvedValue(sesion("OP1"));
    solicitudLeida.mockResolvedValue({ ok: true, data: solicitud() });
    permisoSimulado.mockResolvedValue({
      ok: true,
      sesion: sesion("OP1"),
      actor: {
        tipo: "USUARIO",
        id: "OP1",
        permisos: ["Autob_Operar_Tesoreria"],
      },
    });
    clienteS3.mockReturnValue(s3ConCuerpo(new Uint8Array([9])) as never);
    transaccion.mockResolvedValue({ ok: true });

    const respuesta = await peticion("L1-2");

    expect(respuesta.status).toBe(200);
  });

  it("audita la descarga antes de responder, y falla explicito si no se puede escribir", async () => {
    sesionSimulada.mockResolvedValue(sesion("P1"));
    solicitudLeida.mockResolvedValue({ ok: true, data: solicitud() });
    permisoSimulado.mockResolvedValue({
      ok: true,
      sesion: sesion("P1"),
      actor: {
        tipo: "USUARIO",
        id: "P1",
        permisos: ["Autob_Venta_a_empleados"],
      },
    });
    clienteS3.mockReturnValue(s3ConCuerpo(new Uint8Array([1])) as never);
    transaccion.mockResolvedValue({
      ok: false,
      error: "conflicto_concurrencia",
    });

    await expect(peticion("L1-2")).rejects.toThrow();
    expect(transaccion).toHaveBeenCalledTimes(1);
  });
});
