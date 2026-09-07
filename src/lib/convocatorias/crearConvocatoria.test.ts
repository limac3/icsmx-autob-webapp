// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  comandoDe,
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import type { ActorUsuario } from "@/types/auditoria";
import type { DatosConvocatoria } from "@/types/convocatoria";
import { crearConvocatoria } from "./crearConvocatoria";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-09-07T18:30:00.000Z");
const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Administrar_Convocatorias"],
};

const datos: DatosConvocatoria = {
  tipo: "EMPLEADOS",
  descripcionParticipacion: "Abierta al personal de flotilla.",
  publicadaEn: "2026-10-01T15:00:00.000Z",
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  horasLiquidacion: 48,
};

const deps = (falso: ClienteFalso) => ({
  cliente: falso.cliente,
  ahora: () => AHORA,
  nuevoId: () => ID,
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

describe("alta correcta", () => {
  it("devuelve el identificador generado", async () => {
    const falso = crearClienteFalso();
    const resultado = await crearConvocatoria({ datos, actor }, deps(falso));

    expect(resultado).toEqual({ ok: true, data: { convocatoriaId: ID } });
  });

  it("nace en BORRADOR, el unico estado inicial de la maquina", async () => {
    const falso = crearClienteFalso();
    await crearConvocatoria({ datos, actor }, deps(falso));

    const item = itemsDeTransaccion(falso)[0]?.Put?.Item;
    expect(item?.estatus).toBe("BORRADOR");
  });

  it("escribe las claves de la particion de la convocatoria", async () => {
    const falso = crearClienteFalso();
    await crearConvocatoria({ datos, actor }, deps(falso));

    const item = itemsDeTransaccion(falso)[0]?.Put?.Item;
    expect(item?.PK).toBe(`CONV#${ID}`);
    expect(item?.SK).toBe("META");
  });

  it("indexa por estatus con la fecha de creacion (PA-05)", async () => {
    const falso = crearClienteFalso();
    await crearConvocatoria({ datos, actor }, deps(falso));

    const item = itemsDeTransaccion(falso)[0]?.Put?.Item;
    expect(item?.GSI2PK).toBe("CONV_ESTATUS#BORRADOR");
    expect(item?.GSI2SK).toBe(`${AHORA.toISOString()}#${ID}`);
  });

  it("condiciona el alta a que la clave no exista", async () => {
    const falso = crearClienteFalso();
    await crearConvocatoria({ datos, actor }, deps(falso));

    expect(itemsDeTransaccion(falso)[0]?.Put?.ConditionExpression).toBe(
      "attribute_not_exists(PK)",
    );
  });

  it("escribe el evento en la misma transaccion (regla 4)", async () => {
    const falso = crearClienteFalso();
    await crearConvocatoria({ datos, actor }, deps(falso));

    const items = itemsDeTransaccion(falso);
    expect(items).toHaveLength(2);

    const evento = items[1]?.Put?.Item;
    expect(evento?.tipo).toBe("CONVOCATORIA_CREADA");
    expect(evento?.convocatoriaId).toBe(ID);
    expect(evento?.actorId).toBe("P1");
    // Append-only: el evento no se puede sobrescribir (regla 5).
    expect(items[1]?.Put?.ConditionExpression).toBe("attribute_not_exists(PK)");
  });

  it("guarda la descripcion normalizada, no la cruda", async () => {
    const falso = crearClienteFalso();
    await crearConvocatoria(
      {
        datos: { ...datos, descripcionParticipacion: "  Con espacios  " },
        actor,
      },
      deps(falso),
    );

    const item = itemsDeTransaccion(falso)[0]?.Put?.Item;
    expect(item?.descripcionParticipacion).toBe("Con espacios");
  });
});

describe("datos invalidos", () => {
  it("no toca DynamoDB si las fechas no cumplen R-14", async () => {
    const falso = crearClienteFalso();
    const resultado = await crearConvocatoria(
      { datos: { ...datos, finVenta: datos.inicioVenta }, actor },
      deps(falso),
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.error).toBe("validation_failed");
      expect(resultado.detalles?.finVenta).toBe("orden_de_fechas");
    }
    // Validar antes de escribir no es solo eficiencia: una transaccion que se
    // manda para que falle deja ruido en las metricas de la tabla.
    expect(falso.comandos).toHaveLength(0);
  });

  it("devuelve el motivo por campo, no un mensaje suelto", async () => {
    const falso = crearClienteFalso();
    const resultado = await crearConvocatoria(
      { datos: { ...datos, horasLiquidacion: 0 }, actor },
      deps(falso),
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.detalles).toEqual({
        horasLiquidacion: "fuera_de_rango",
      });
    }
  });
});
