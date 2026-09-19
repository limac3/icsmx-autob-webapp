// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateTag } from "next/cache";

import { getSession } from "@/lib/auth/session";
import { etiqueta } from "@/lib/cache";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { adjudicarManualmente as adjudicarServicio } from "@/lib/fila/adjudicarManualmente";
import type { ConvocatoriaConLotes } from "@/types/convocatoria";
import type { Sesion } from "@/types/identidad";
import type { Lote } from "@/types/lote";
import { adjudicarManualmente } from "./adjudicacion";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/convocatorias/obtenerConvocatoria", () => ({
  obtenerConvocatoria: vi.fn(),
}));
vi.mock("@/lib/fila/adjudicarManualmente", () => ({
  adjudicarManualmente: vi.fn(),
}));

// **`exigirPermiso` y `puedeEjecutar` NO se simulan.** Media prueba de esta
// action es que las cuatro guardas de `adjudicacion:adjudicar` se apliquen de
// verdad — modalidad manual, convocatoria publicada, lote libre y motivo
// presente —, y un doble solo comprobaria que el doble dice que si.

const sesionSimulada = vi.mocked(getSession);
const lectura = vi.mocked(obtenerConvocatoria);
const servicio = vi.mocked(adjudicarServicio);

const AHORA = new Date();
const enHoras = (horas: number) =>
  new Date(AHORA.getTime() + horas * 3_600_000).toISOString();

const lote = (sobrescribe: Partial<Lote> = {}): Lote => ({
  loteId: "L1",
  convocatoriaId: "C1",
  vehiculoId: "V1",
  precio: 180_000,
  estatus: "EN_OFERTA",
  contadorTurnos: 5,
  inicioVenta: enHoras(-1),
  finVenta: enHoras(48),
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "MANUAL",
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
  ...sobrescribe,
});

const convocatoria = (
  sobrescribe: Partial<ConvocatoriaConLotes> = {},
): ConvocatoriaConLotes => ({
  convocatoriaId: "C1",
  folio: "CONV-001",
  nombre: "Venta de septiembre",
  tipo: "EMPLEADOS",
  descripcionParticipacion: "<p>Abierta al personal.</p>",
  publicadaEn: enHoras(-24),
  inicioVenta: enHoras(-1),
  finVenta: enHoras(48),
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "MANUAL",
  estatus: "PUBLICADA",
  creadoEn: "2026-09-01T10:00:00.000Z",
  creadoPor: "P9",
  lotes: [lote()],
  ...sobrescribe,
});

const sesion = (
  permisos: string[] = ["Autob_Adjudicar_Convocatorias"],
): Sesion => ({
  participanteId: "ADJ1",
  oktaSub: "okta|adj",
  correo: "adjudicador@example.org",
  nombre: "Quien Decide",
  permisos: new Set(permisos) as Sesion["permisos"],
  tiposDeConvocatoriaPermitidos: [],
});

const entrada = {
  convocatoriaId: "C1",
  loteId: "L1",
  turno: 4,
  motivo: "Cumple el criterio de antiguedad acordado.",
};

beforeEach(() => {
  vi.clearAllMocks();
  sesionSimulada.mockResolvedValue(sesion());
  lectura.mockResolvedValue({ ok: true, data: convocatoria() });
  servicio.mockResolvedValue({
    ok: true,
    data: {
      turno: 4,
      solicitudId: "L1-4",
      participanteId: "P7",
      venceEn: enHoras(48),
    },
  });
});

describe("guardas previas al permiso", () => {
  it("sin sesion no llega a leer nada", async () => {
    sesionSimulada.mockResolvedValue(null);

    const resultado = await adjudicarManualmente(entrada);

    expect(resultado).toEqual({ ok: false, error: "unauthorized" });
    expect(lectura).not.toHaveBeenCalled();
  });

  it("un lote que no pertenece a la convocatoria es not_found", async () => {
    const resultado = await adjudicarManualmente({
      ...entrada,
      loteId: "L-DE-OTRA",
    });

    expect(resultado).toEqual({ ok: false, error: "not_found" });
    expect(servicio).not.toHaveBeenCalled();
  });

  it("propaga el fallo de la lectura de la convocatoria", async () => {
    lectura.mockResolvedValue({ ok: false, error: "not_found" });

    const resultado = await adjudicarManualmente(entrada);

    expect(resultado).toEqual({ ok: false, error: "not_found" });
  });
});

describe("las cuatro guardas de adjudicacion:adjudicar (R-23)", () => {
  it("sin el permiso, forbidden", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Auditar"]));

    const resultado = await adjudicarManualmente(entrada);

    expect(resultado).toEqual({ ok: false, error: "forbidden" });
    expect(servicio).not.toHaveBeenCalled();
  });

  it("una convocatoria AUTOMATICA no se adjudica a mano", async () => {
    // La guarda que sostiene la modalidad entera: sin ella, quien tenga el
    // permiso podria decidir a mano en una convocatoria que la fila gobierna.
    lectura.mockResolvedValue({
      ok: true,
      data: convocatoria({
        modalidadAdjudicacion: "AUTOMATICA",
        lotes: [lote({ modalidadAdjudicacion: "AUTOMATICA" })],
      }),
    });

    const resultado = await adjudicarManualmente(entrada);

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(servicio).not.toHaveBeenCalled();
  });

  it("una convocatoria que no esta PUBLICADA no se adjudica", async () => {
    lectura.mockResolvedValue({
      ok: true,
      data: convocatoria({ estatus: "APROBADA" }),
    });

    const resultado = await adjudicarManualmente(entrada);

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
  });

  it("un lote ya adjudicado no se vuelve a adjudicar", async () => {
    lectura.mockResolvedValue({
      ok: true,
      data: convocatoria({ lotes: [lote({ estatus: "ADJUDICADO" })] }),
    });

    const resultado = await adjudicarManualmente(entrada);

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
  });

  it.each(["", "   "])(
    "el motivo %j no cuenta como motivo: una decision humana sin razon no es auditable",
    async (motivo) => {
      const resultado = await adjudicarManualmente({ ...entrada, motivo });

      expect(resultado).toEqual({ ok: false, error: "invalid_state" });
      expect(servicio).not.toHaveBeenCalled();
    },
  );
});

describe("delegacion al servicio", () => {
  it("el actor sale de la sesion, nunca del input, y lleva sus permisos del momento", async () => {
    await adjudicarManualmente(entrada);

    expect(servicio).toHaveBeenCalledWith(
      expect.objectContaining({
        turno: 4,
        motivo: entrada.motivo,
        actor: {
          tipo: "USUARIO",
          id: "ADJ1",
          permisos: ["Autob_Adjudicar_Convocatorias"],
        },
      }),
    );
  });

  it("registra que la venta seguia abierta al decidir", async () => {
    // El adjudicador puede decidir con la fila creciendo. Eso lo hace legitimo,
    // no invisible: tiene que quedar en el evento.
    await adjudicarManualmente(entrada);

    expect(servicio).toHaveBeenCalledWith(
      expect.objectContaining({ ventaAbiertaAlDecidir: true }),
    );
  });

  it("y que ya habia cerrado, cuando es el caso", async () => {
    const cerrada = {
      inicioVenta: enHoras(-72),
      finVenta: enHoras(-1),
    };
    lectura.mockResolvedValue({
      ok: true,
      data: convocatoria({ ...cerrada, lotes: [lote(cerrada)] }),
    });

    await adjudicarManualmente(entrada);

    expect(servicio).toHaveBeenCalledWith(
      expect.objectContaining({ ventaAbiertaAlDecidir: false }),
    );
  });

  it("invalida el lote y su convocatoria al adjudicar", async () => {
    await adjudicarManualmente(entrada);

    expect(vi.mocked(updateTag).mock.calls.map(([t]) => t)).toEqual([
      etiqueta.lote("L1"),
      etiqueta.convocatoria("C1"),
    ]);
  });

  it("no invalida nada si el servicio falla", async () => {
    // Invalidar tras un fallo tiraria cache buena y haria releer a todos por
    // una adjudicacion que no ocurrio.
    servicio.mockResolvedValue({ ok: false, error: "limite_alcanzado" });

    const resultado = await adjudicarManualmente(entrada);

    expect(resultado).toEqual({ ok: false, error: "limite_alcanzado" });
    expect(updateTag).not.toHaveBeenCalled();
  });
});
