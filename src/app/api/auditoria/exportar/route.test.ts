// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { consultarBitacoraCompleta } from "@/lib/auditoria/consultarBitacora";
import { ejecutarTransaccion } from "@/lib/data/transacciones";
import type { EventoDTO } from "@/types/auditoria";
import { GET } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/exigirPermiso", () => ({ exigirPermiso: vi.fn() }));
vi.mock("@/lib/auditoria/consultarBitacora", () => ({
  consultarBitacoraCompleta: vi.fn(),
}));
vi.mock("@/lib/data/transacciones", () => ({ ejecutarTransaccion: vi.fn() }));
vi.mock("@/lib/data/eventos", () => ({
  eventoParaTransaccion: vi.fn((entrada) => ({
    item: { Put: { TableName: "x", Item: { tipo: entrada.tipo } } },
    siFalla: "conflicto_concurrencia",
    descripcion: "evento de prueba",
  })),
  nuevaCorrelacion: () => "CORR1",
}));

const permisoSimulado = vi.mocked(exigirPermiso);
const lectura = vi.mocked(consultarBitacoraCompleta);
const transaccion = vi.mocked(ejecutarTransaccion);

const actor = {
  tipo: "USUARIO" as const,
  id: "AUD-1",
  permisos: ["Autob_Auditar" as const],
};

const peticion = (query: string) =>
  GET(new Request(`https://app.invalid/api/auditoria/exportar${query}`));

const evento = (extras: Partial<EventoDTO> = {}): EventoDTO => ({
  eventoId: "E1",
  tipo: "LOTE_ADJUDICADO",
  ocurridoEn: "2026-10-06T10:00:00.000Z",
  actorTipo: "SISTEMA",
  actorId: "SISTEMA",
  correlacionId: "COR1",
  ...extras,
});

describe("GET /api/auditoria/exportar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("403 sin el permiso, sin llegar a leer la bitacora", async () => {
    permisoSimulado.mockResolvedValue({ ok: false, error: "forbidden" });

    const respuesta = await peticion("?agregado=LOTE&agregadoId=L1");

    expect(respuesta.status).toBe(403);
    expect(lectura).not.toHaveBeenCalled();
  });

  it("400 con un agregado que no existe en el catalogo", async () => {
    permisoSimulado.mockResolvedValue({ ok: true, sesion: {} as never, actor });

    const respuesta = await peticion("?agregado=PARTICIPANTE&agregadoId=P1");

    expect(respuesta.status).toBe(400);
  });

  it("400 sin agregadoId", async () => {
    permisoSimulado.mockResolvedValue({ ok: true, sesion: {} as never, actor });

    const respuesta = await peticion("?agregado=LOTE");

    expect(respuesta.status).toBe(400);
  });

  it("200 con el CSV de la bitacora filtrada", async () => {
    permisoSimulado.mockResolvedValue({ ok: true, sesion: {} as never, actor });
    lectura.mockResolvedValue({
      ok: true,
      data: [
        evento({ eventoId: "E1", tipo: "LOTE_ADJUDICADO" }),
        evento({ eventoId: "E2", tipo: "SOLICITUD_CREADA" }),
      ],
    });
    transaccion.mockResolvedValue({ ok: true });

    const respuesta = await peticion(
      "?agregado=LOTE&agregadoId=L1&tipo=LOTE_ADJUDICADO",
    );

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Content-Type")).toContain("text/csv");
    expect(respuesta.headers.get("Content-Disposition")).toContain(
      "bitacora-LOTE-L1.csv",
    );
    const texto = await respuesta.text();
    expect(texto).toContain("E1");
    expect(texto).not.toContain("E2");
  });

  it("registra BITACORA_EXPORTADA con los filtros aplicados, antes de responder", async () => {
    permisoSimulado.mockResolvedValue({ ok: true, sesion: {} as never, actor });
    lectura.mockResolvedValue({ ok: true, data: [evento()] });
    transaccion.mockResolvedValue({ ok: true });

    await peticion("?agregado=LOTE&agregadoId=L1");

    expect(transaccion).toHaveBeenCalledTimes(1);
  });

  it("falla explicito si no se puede registrar la exportacion (regla 15)", async () => {
    permisoSimulado.mockResolvedValue({ ok: true, sesion: {} as never, actor });
    lectura.mockResolvedValue({ ok: true, data: [evento()] });
    transaccion.mockResolvedValue({
      ok: false,
      error: "conflicto_concurrencia",
    });

    await expect(peticion("?agregado=LOTE&agregadoId=L1")).rejects.toThrow();
  });
});
