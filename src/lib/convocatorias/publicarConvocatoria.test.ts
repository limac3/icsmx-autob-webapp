// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import type { ActorUsuario } from "@/types/auditoria";
import type { ConvocatoriaConLotes } from "@/types/convocatoria";
import type { Lote } from "@/types/lote";
import { ocultarConvocatoria } from "./ocultarConvocatoria";
import { publicarConvocatoria } from "./publicarConvocatoria";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-09-07T18:30:00.000Z");

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Administrar_Convocatorias"],
};

const lote = (loteId: string): Lote => ({
  loteId,
  convocatoriaId: "C1",
  vehiculoId: `V-${loteId}`,
  precio: 180_000,
  estatus: "EN_OFERTA",
  contadorTurnos: 0,
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "APROBADA",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
});

const aprobada: ConvocatoriaConLotes = {
  folio: "CONV-001",
  nombre: "Venta de octubre",
  convocatoriaId: "C1",
  tipo: "EMPLEADOS",
  descripcionParticipacion: "Abierta al personal.",
  publicadaEn: "2026-10-01T15:00:00.000Z",
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  estatus: "APROBADA",
  creadoEn: "2026-09-01T10:00:00.000Z",
  creadoPor: "P9",
  lotes: [lote("L1"), lote("L2")],
};

const deps = (falso: ClienteFalso) => ({
  cliente: falso.cliente,
  ahora: () => AHORA,
});

/** Los `TransactItems` del comando en la posicion dada. */
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

describe("publicar: primero la convocatoria, despues los lotes", () => {
  it("marca la convocatoria en el primer comando", async () => {
    const falso = crearClienteFalso();
    await publicarConvocatoria({ actual: aprobada, actor }, deps(falso));

    // El orden **es** la garantia. Una interrupcion entre los dos comandos deja
    // la convocatoria publicada con lotes que aun dicen APROBADA: el paso 1 de
    // T1 exige `estatusConvocatoria = PUBLICADA` en el lote, asi que no se
    // pueden comprar. Al reves, serian comprables bajo una convocatoria sin
    // publicar, que es el defecto que este orden cierra.
    const primero = itemsDe(falso, 0)[0]?.Update as Record<string, unknown>;
    expect(primero.Key).toEqual({ PK: "CONV#C1", SK: "META" });

    const valores = primero.ExpressionAttributeValues as Record<
      string,
      unknown
    >;
    expect(valores[":destino"]).toBe("PUBLICADA");
    expect(valores[":estatusEsperado"]).toBe("APROBADA");
  });

  it("propaga a los lotes en el segundo comando", async () => {
    const falso = crearClienteFalso();
    await publicarConvocatoria({ actual: aprobada, actor }, deps(falso));

    expect(falso.comandos).toHaveLength(2);

    const propagacion = itemsDe(falso, 1);
    expect(propagacion).toHaveLength(2);

    const primero = propagacion[0]?.Update as Record<string, unknown>;
    expect(primero.Key).toEqual({ PK: "CONV#C1", SK: "LOTE#L1" });
    const valores = primero.ExpressionAttributeValues as Record<
      string,
      unknown
    >;
    expect(valores[":estatusConvocatoria"]).toBe("PUBLICADA");
  });

  it("informa si la propagacion quedo a medias, sin decir que fallo", async () => {
    // La convocatoria si quedo publicada y su evento escrito. Devolver error
    // haria que la interfaz dijera "no se publico" sobre algo publicado, y
    // reintentar daria invalid_state porque ya no esta en APROBADA.
    let llamadas = 0;
    const falso = crearClienteFalso({
      responder: () => {
        llamadas += 1;
        if (llamadas === 2) throw new Error("red caida");
        return {};
      },
    });

    const resultado = await publicarConvocatoria(
      { actual: aprobada, actor },
      deps(falso),
    );

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.data.estatus).toBe("PUBLICADA");
      expect(resultado.data.propagacionCompleta).toBe(false);
    }
  });

  it("no propaga a los lotes retirados", async () => {
    const falso = crearClienteFalso();
    await publicarConvocatoria(
      {
        actual: {
          ...aprobada,
          lotes: [lote("L1"), { ...lote("L2"), estatus: "RETIRADO" }],
        },
        actor,
      },
      deps(falso),
    );

    expect(itemsDe(falso, 1)).toHaveLength(1);
  });

  it("rechaza publicar desde un estatus que no es APROBADA", async () => {
    const falso = crearClienteFalso();
    const resultado = await publicarConvocatoria(
      { actual: { ...aprobada, estatus: "BORRADOR" }, actor },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(falso.comandos).toHaveLength(0);
  });
});

describe("ocultar: primero los lotes, despues la convocatoria", () => {
  const publicada: ConvocatoriaConLotes = {
    ...aprobada,
    estatus: "PUBLICADA",
    lotes: [
      { ...lote("L1"), estatusConvocatoria: "PUBLICADA" },
      { ...lote("L2"), estatusConvocatoria: "PUBLICADA" },
    ],
  };

  it("cierra los lotes antes de ocultar la convocatoria", async () => {
    // El orden inverso al de publicar, por la misma razon: una interrupcion
    // deja lotes ya cerrados bajo una convocatoria todavia visible. Quien entre
    // no podra comprar, que es el lado seguro.
    const falso = crearClienteFalso();
    await ocultarConvocatoria(
      {
        actual: publicada,
        motivo: "Error en las fechas",
        existeAlgunaSolicitud: false,
        actor,
      },
      deps(falso),
    );

    expect(falso.comandos).toHaveLength(2);

    const primero = itemsDe(falso, 0)[0]?.Update as Record<string, unknown>;
    expect(primero.Key).toEqual({ PK: "CONV#C1", SK: "LOTE#L1" });

    const segundo = itemsDe(falso, 1)[0]?.Update as Record<string, unknown>;
    expect(segundo.Key).toEqual({ PK: "CONV#C1", SK: "META" });
  });

  it("deniega si existe alguna solicitud (R-06)", async () => {
    const falso = crearClienteFalso();
    const resultado = await ocultarConvocatoria(
      {
        actual: publicada,
        motivo: "Error en las fechas",
        existeAlgunaSolicitud: true,
        actor,
      },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(falso.comandos).toHaveLength(0);
  });

  it("deniega si nadie dijo si hay solicitudes (regla 18)", async () => {
    // Cerrado por omision. Con `=== false` en vez de `!== false`, un dato que
    // quien invoca olvido pasar se convertiria en permiso concedido, y se
    // ocultaria una convocatoria dejando a gente en una fila invisible.
    const falso = crearClienteFalso();
    const resultado = await ocultarConvocatoria(
      { actual: publicada, motivo: "Error en las fechas", actor },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(falso.comandos).toHaveLength(0);
  });

  it("desde BORRADOR no propaga: no hay lotes comprables que cerrar", async () => {
    const falso = crearClienteFalso();
    await ocultarConvocatoria(
      {
        actual: { ...aprobada, estatus: "BORRADOR" },
        motivo: "Se cancela",
        actor,
      },
      deps(falso),
    );

    expect(falso.comandos).toHaveLength(1);
    const item = itemsDe(falso, 0)[0]?.Update as Record<string, unknown>;
    expect(item.Key).toEqual({ PK: "CONV#C1", SK: "META" });
  });

  it("exige motivo, que es obligatorio en el catalogo de eventos", async () => {
    const falso = crearClienteFalso();
    const resultado = await ocultarConvocatoria(
      { actual: { ...aprobada, estatus: "BORRADOR" }, motivo: "   ", actor },
      deps(falso),
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.detalles).toEqual({ motivo: "requerido" });
    }
  });
});
