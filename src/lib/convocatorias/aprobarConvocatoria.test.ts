// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  comandoDe,
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import type { ActorUsuario } from "@/types/auditoria";
import type { Convocatoria } from "@/types/convocatoria";
import { aprobarConvocatoria } from "./aprobarConvocatoria";
import { rechazarConvocatoria } from "./rechazarConvocatoria";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-09-07T18:30:00.000Z");

const CREADORA = "P9";

const aprobador: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Aprobar_Convocatorias"],
};

/** Quien la creo, con el permiso de aprobar tambien. */
const creadoraConPermiso: ActorUsuario = {
  tipo: "USUARIO",
  id: CREADORA,
  permisos: ["Autob_Aprobar_Convocatorias", "Autob_Administrar_Convocatorias"],
};

const enAprobacion: Convocatoria = {
  folio: "CONV-001",
  nombre: "Venta de octubre",
  convocatoriaId: "C1",
  tipo: "EMPLEADOS",
  descripcionParticipacion: "Abierta al personal.",
  publicadaEn: "2026-10-01T15:00:00.000Z",
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  horasLiquidacion: 48,
  estatus: "EN_APROBACION",
  creadoEn: "2026-09-01T10:00:00.000Z",
  creadoPor: CREADORA,
};

const deps = (falso: ClienteFalso) => ({
  cliente: falso.cliente,
  ahora: () => AHORA,
});

const itemsDeTransaccion = (
  falso: ClienteFalso,
): Record<string, Record<string, Record<string, unknown>>>[] =>
  (comandoDe(falso, "TransactWriteCommand")?.TransactItems ?? []) as Record<
    string,
    Record<string, Record<string, unknown>>
  >[];

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("R-05 — separacion de funciones", () => {
  it("deniega a quien creo la convocatoria, aunque tenga el permiso", async () => {
    // El permiso no basta: la regla es del recurso, no de la persona. Se
    // devuelve `forbidden` y no `invalid_state` porque el estado es correcto
    // —esta EN_APROBACION—; quien actua es el problema.
    const falso = crearClienteFalso();
    const resultado = await aprobarConvocatoria(
      { actual: enAprobacion, actor: creadoraConPermiso },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: false, error: "forbidden" });
    expect(falso.comandos).toHaveLength(0);
  });

  it("deja aprobar a alguien distinto", async () => {
    const falso = crearClienteFalso();
    const resultado = await aprobarConvocatoria(
      { actual: enAprobacion, actor: aprobador },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: true, data: { estatus: "APROBADA" } });
  });

  it("aplica la misma guarda al rechazo", async () => {
    // Si quien la creo pudiera rechazarla, tendria una via para retirarla del
    // dictamen sin que el aprobador se entere.
    const falso = crearClienteFalso();
    const resultado = await rechazarConvocatoria(
      { actual: enAprobacion, motivo: "Fechas mal", actor: creadoraConPermiso },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("escritura de la transicion", () => {
  it("mueve la convocatoria de particion en GSI2", async () => {
    // Sin reescribir las claves del indice, seguiria apareciendo en la bandeja
    // de EN_APROBACION para siempre.
    const falso = crearClienteFalso();
    await aprobarConvocatoria(
      { actual: enAprobacion, actor: aprobador },
      deps(falso),
    );

    const cambio = itemsDeTransaccion(falso)[0]?.Update;
    const valores = cambio?.ExpressionAttributeValues as Record<
      string,
      unknown
    >;
    expect(valores[":gsi2pk"]).toBe("CONV_ESTATUS#APROBADA");
    // La fecha del indice es la de creacion, no la de hoy.
    expect(valores[":gsi2sk"]).toBe(`${enAprobacion.creadoEn}#C1`);
  });

  it("condiciona al estatus de origen, no solo a que exista", async () => {
    // Es lo que impide que dos aprobadores actuando a la vez apliquen dos
    // transiciones sobre el mismo origen.
    const falso = crearClienteFalso();
    await aprobarConvocatoria(
      { actual: enAprobacion, actor: aprobador },
      deps(falso),
    );

    const cambio = itemsDeTransaccion(falso)[0]?.Update;
    expect(cambio?.ConditionExpression).toBe(
      "attribute_exists(PK) AND #estatus = :estatusEsperado",
    );
    const valores = cambio?.ExpressionAttributeValues as Record<
      string,
      unknown
    >;
    expect(valores[":estatusEsperado"]).toBe("EN_APROBACION");
  });

  it("escribe el evento en la misma transaccion", async () => {
    const falso = crearClienteFalso();
    await aprobarConvocatoria(
      { actual: enAprobacion, actor: aprobador },
      deps(falso),
    );

    const items = itemsDeTransaccion(falso);
    expect(items).toHaveLength(2);
    expect(items[1]?.Put?.Item?.tipo).toBe("CONVOCATORIA_APROBADA");
    expect(items[1]?.Put?.Item?.estadoAnterior).toBe("EN_APROBACION");
    expect(items[1]?.Put?.Item?.estadoNuevo).toBe("APROBADA");
  });

  it("rechaza una transicion que la maquina no contempla", async () => {
    const falso = crearClienteFalso();
    const resultado = await aprobarConvocatoria(
      { actual: { ...enAprobacion, estatus: "PUBLICADA" }, actor: aprobador },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(falso.comandos).toHaveLength(0);
  });
});

describe("rechazo", () => {
  it("devuelve a BORRADOR y guarda el motivo en la bitacora", async () => {
    // No hay estatus RECHAZADA: uno terminal obligaria a duplicar la
    // convocatoria para corregirla, y partiria el historial.
    const falso = crearClienteFalso();
    const resultado = await rechazarConvocatoria(
      { actual: enAprobacion, motivo: "Fechas incoherentes", actor: aprobador },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: true, data: { estatus: "BORRADOR" } });

    const evento = itemsDeTransaccion(falso)[1]?.Put?.Item;
    expect(evento?.tipo).toBe("CONVOCATORIA_RECHAZADA");
    expect(evento?.motivo).toBe("Fechas incoherentes");
  });

  it("exige motivo, que es obligatorio en el catalogo", async () => {
    const falso = crearClienteFalso();
    const resultado = await rechazarConvocatoria(
      { actual: enAprobacion, motivo: "  ", actor: aprobador },
      deps(falso),
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.detalles).toEqual({ motivo: "requerido" });
    }
    expect(falso.comandos).toHaveLength(0);
  });
});
