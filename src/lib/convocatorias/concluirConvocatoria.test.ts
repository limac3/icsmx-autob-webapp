// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import type { ActorUsuario } from "@/types/auditoria";
import type { ConvocatoriaConLotes } from "@/types/convocatoria";
import type { EstatusLote, Lote } from "@/types/lote";
import { concluirConvocatoria } from "./concluirConvocatoria";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-11-01T18:30:00.000Z");

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Administrar_Convocatorias"],
};

const lote = (loteId: string, estatus: EstatusLote = "EN_OFERTA"): Lote => ({
  loteId,
  convocatoriaId: "C1",
  vehiculoId: `V-${loteId}`,
  precio: 180_000,
  estatus,
  contadorTurnos: 0,
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
});

const publicada: ConvocatoriaConLotes = {
  convocatoriaId: "C1",
  tipo: "EMPLEADOS",
  descripcionParticipacion: "Abierta al personal.",
  publicadaEn: "2026-10-01T15:00:00.000Z",
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  horasLiquidacion: 48,
  estatus: "PUBLICADA",
  creadoEn: "2026-09-01T10:00:00.000Z",
  creadoPor: "P9",
  lotes: [lote("L1"), lote("L2")],
};

const deps = (falso: ClienteFalso) => ({
  cliente: falso.cliente,
  ahora: () => AHORA,
});

const itemsDe = (
  falso: ClienteFalso,
  posicion: number,
): Record<string, Record<string, unknown>>[] =>
  (falso.comandos[posicion]?.input.TransactItems ?? []) as Record<
    string,
    Record<string, unknown>
  >[];

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("guarda de conclusion", () => {
  it("deniega si no se confirma ninguna de las dos condiciones", async () => {
    // Cerrado por omision: hace falta que **una** este en `true`. Un
    // `undefined` no confirma nada, y concluir antes de tiempo cerraria filas
    // vivas.
    const falso = crearClienteFalso();
    const resultado = await concluirConvocatoria(
      { actual: publicada, actor },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(falso.comandos).toHaveLength(0);
  });

  it("basta con que la venta haya finalizado", async () => {
    const falso = crearClienteFalso();
    const resultado = await concluirConvocatoria(
      { actual: publicada, ventaFinalizada: true, actor },
      deps(falso),
    );

    expect(resultado.ok).toBe(true);
  });

  it("basta con que no queden solicitudes vivas", async () => {
    const falso = crearClienteFalso();
    const resultado = await concluirConvocatoria(
      { actual: publicada, sinSolicitudesVivas: true, actor },
      deps(falso),
    );

    expect(resultado.ok).toBe(true);
  });
});

describe("cierre de los lotes", () => {
  it("cierra los lotes antes de marcar la convocatoria", async () => {
    // El `estatusConvocatoria` del lote es una copia: marcar la convocatoria
    // primero dejaria lotes cuya copia sigue diciendo PUBLICADA y que el paso 1
    // de T1 aceptaria comprar, bajo una convocatoria ya concluida.
    const falso = crearClienteFalso();
    await concluirConvocatoria(
      { actual: publicada, ventaFinalizada: true, actor },
      deps(falso),
    );

    expect(falso.comandos).toHaveLength(2);

    const primero = itemsDe(falso, 0)[0]?.Update as Record<string, unknown>;
    expect(primero.Key).toEqual({ PK: "CONV#C1", SK: "LOTE#L1" });

    const ultimo = itemsDe(falso, 1)[0]?.Update as Record<string, unknown>;
    expect(ultimo.Key).toEqual({ PK: "CONV#C1", SK: "META" });
  });

  it("cada lote cuesta tres escrituras y ninguna es un evento", async () => {
    // `trazabilidad-auditoria.md` dice que CONVOCATORIA_CONCLUIDA lleva el
    // resumen; un evento por lote repetiria N veces el mismo hecho.
    const falso = crearClienteFalso();
    await concluirConvocatoria(
      { actual: publicada, ventaFinalizada: true, actor },
      deps(falso),
    );

    expect(itemsDe(falso, 0)).toHaveLength(6);
  });

  it("libera el centinela y devuelve el vehiculo a DISPONIBLE (R-11)", async () => {
    const falso = crearClienteFalso();
    await concluirConvocatoria(
      { actual: publicada, ventaFinalizada: true, actor },
      deps(falso),
    );

    const items = itemsDe(falso, 0);

    const centinela = items[1]?.Delete as Record<string, unknown>;
    expect(centinela.Key).toEqual({ PK: "VEH#V-L1", SK: "ACTIVO" });

    const vehiculo = items[2]?.Update as Record<string, unknown>;
    expect(vehiculo.Key).toEqual({ PK: "VEH#V-L1", SK: "META" });
    const valores = vehiculo.ExpressionAttributeValues as Record<
      string,
      unknown
    >;
    expect(valores[":disponible"]).toBe("DISPONIBLE");
    expect(valores[":estatusEsperado"]).toBe("EN_CONVOCATORIA");
    expect(valores[":gsi2pk"]).toBe("VEH_ESTATUS#DISPONIBLE");
  });

  it("no toca los lotes vendidos ni adjudicados", async () => {
    // Un lote ADJUDICADO sobrevive a la conclusion con su plazo intacto
    // (R-18): quien gano antes del cierre tiene derecho a terminar de pagar, y
    // su vehiculo sigue comprometido, asi que su centinela no se libera.
    const falso = crearClienteFalso();
    await concluirConvocatoria(
      {
        actual: {
          ...publicada,
          lotes: [lote("L1"), lote("L2", "VENDIDO"), lote("L3", "ADJUDICADO")],
        },
        ventaFinalizada: true,
        actor,
      },
      deps(falso),
    );

    const items = itemsDe(falso, 0);
    expect(items).toHaveLength(3);

    const claves = JSON.stringify(items);
    expect(claves).toContain("LOTE#L1");
    expect(claves).not.toContain("LOTE#L2");
    expect(claves).not.toContain("LOTE#L3");
    expect(claves).not.toContain("VEH#V-L3");
  });

  it("cuenta vendidos y no vendidos en el resultado y en el evento", async () => {
    const falso = crearClienteFalso();
    const resultado = await concluirConvocatoria(
      {
        actual: {
          ...publicada,
          lotes: [lote("L1"), lote("L2", "VENDIDO"), lote("L3", "VENDIDO")],
        },
        ventaFinalizada: true,
        actor,
      },
      deps(falso),
    );

    expect(resultado).toEqual({
      ok: true,
      data: { estatus: "CONCLUIDA", vendidos: 2, noVendidos: 1 },
    });

    const evento = itemsDe(falso, 1)[1]?.Put as Record<string, unknown>;
    const item = evento.Item as Record<string, unknown>;
    expect(item.tipo).toBe("CONVOCATORIA_CONCLUIDA");
    expect(item.datos).toEqual({ vendidos: 2, noVendidos: 1 });
  });

  it("una convocatoria sin lotes en oferta solo marca la convocatoria", async () => {
    const falso = crearClienteFalso();
    const resultado = await concluirConvocatoria(
      {
        actual: { ...publicada, lotes: [lote("L1", "VENDIDO")] },
        ventaFinalizada: true,
        actor,
      },
      deps(falso),
    );

    expect(resultado.ok).toBe(true);
    expect(falso.comandos).toHaveLength(1);
  });

  it("no marca la convocatoria si el cierre de lotes falla", async () => {
    // El estado a medias son lotes ya cerrados bajo una convocatoria todavia
    // publicada: no comprables, que es el lado seguro. Marcarla igual dejaria
    // lotes comprables bajo una convocatoria concluida.
    const falso = crearClienteFalso({ lanza: new Error("red caida") });
    const resultado = await concluirConvocatoria(
      { actual: publicada, ventaFinalizada: true, actor },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: false, error: "conflicto_concurrencia" });
    expect(falso.comandos).toHaveLength(1);
  });
});
