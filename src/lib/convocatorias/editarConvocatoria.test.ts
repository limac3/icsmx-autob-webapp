// @vitest-environment node
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { camposModificados, editarConvocatoria } from "./editarConvocatoria";
import {
  comandoDe,
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import type { ActorUsuario } from "@/types/auditoria";
import type { Convocatoria } from "@/types/convocatoria";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-09-07T18:30:00.000Z");

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Administrar_Convocatorias"],
};

const actual: Convocatoria = {
  convocatoriaId: "C1",
  folio: "CONV-2026-001",
  nombre: "Venta de octubre",
  tipo: "EMPLEADOS",
  descripcionParticipacion: "Abierta al personal de flotilla.",
  publicadaEn: "2026-10-01T15:00:00.000Z",
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  horasLiquidacion: 48,
  estatus: "BORRADOR",
  creadoEn: "2026-09-01T10:00:00.000Z",
  creadoPor: "P0",
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

describe("camposModificados", () => {
  it("solo lista lo que de verdad cambio", () => {
    expect(camposModificados(actual, { ...actual, nombre: "Otro" })).toEqual([
      "nombre",
    ]);
  });

  it("no lista un campo reasignado al mismo valor", () => {
    expect(camposModificados(actual, { ...actual })).toEqual([]);
  });
});

describe("edicion sin tocar el folio", () => {
  it("manda dos items: la actualizacion y su evento (regla 4)", async () => {
    const falso = crearClienteFalso();
    await editarConvocatoria(
      { actual, cambios: { horasLiquidacion: 24 }, actor },
      deps(falso),
    );

    const items = itemsDeTransaccion(falso);
    expect(items).toHaveLength(2);
    // Ningun centinela: reservar el mismo folio otra vez fallaria por
    // `attribute_not_exists`, y una edicion de horas no puede depender de eso.
    expect(items.some((item) => item.Delete !== undefined)).toBe(false);
    expect(items[1]?.Put?.Item).toMatchObject({
      PK: "AUDIT#CONVOCATORIA#C1",
      tipo: "CONVOCATORIA_EDITADA",
      datos: { campos: ["horasLiquidacion"] },
    });
  });

  it("condiciona la escritura a que siga en BORRADOR", async () => {
    // Entre la lectura que decidio el permiso y esta escritura, otra persona
    // pudo mandarla a aprobacion.
    const falso = crearClienteFalso();
    await editarConvocatoria(
      { actual, cambios: { horasLiquidacion: 24 }, actor },
      deps(falso),
    );

    expect(itemsDeTransaccion(falso)[0]?.Update?.ConditionExpression).toBe(
      "#estatus = :borrador",
    );
  });

  it("no escribe nada cuando nada cambia", async () => {
    const falso = crearClienteFalso();
    const resultado = await editarConvocatoria(
      { actual, cambios: { nombre: "Venta de octubre" }, actor },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: true, data: { convocatoriaId: "C1" } });
    expect(falso.comandos).toHaveLength(0);
  });
});

describe("renombrar el folio", () => {
  it("reserva el nuevo y libera el viejo en la misma transaccion", async () => {
    // Partirlo en dos pasos dejaria, si el segundo falla, o un folio reservado
    // que nadie puede volver a usar, o dos convocatorias con el mismo.
    const falso = crearClienteFalso();
    await editarConvocatoria(
      { actual, cambios: { folio: "CONV-2026-777" }, actor },
      deps(falso),
    );

    const items = itemsDeTransaccion(falso);
    expect(items).toHaveLength(4);
    expect(items[0]?.Put).toMatchObject({
      Item: {
        PK: "FOLIO_CONV#CONV-2026-777",
        SK: "CENTINELA",
        convocatoriaId: "C1",
      },
      ConditionExpression: "attribute_not_exists(SK)",
    });
    expect(items[1]?.Delete).toMatchObject({
      Key: { PK: "FOLIO_CONV#CONV-2026-001", SK: "CENTINELA" },
      // Exige que exista: borrar a ciegas dejaria reservado un folio que nadie
      // podria volver a usar si el atributo y su centinela se desincronizaran.
      ConditionExpression: "attribute_exists(SK)",
    });
  });

  it("el ancla de la bitacora sigue siendo el identificador interno", async () => {
    // Es lo que hace corregible un typo: cambiar el folio no parte la historia
    // de la convocatoria en dos.
    const falso = crearClienteFalso();
    await editarConvocatoria(
      { actual, cambios: { folio: "CONV-2026-777" }, actor },
      deps(falso),
    );

    expect(itemsDeTransaccion(falso)[3]?.Put?.Item).toMatchObject({
      PK: "AUDIT#CONVOCATORIA#C1",
      tipo: "CONVOCATORIA_EDITADA",
      datos: { campos: ["folio"] },
    });
  });

  it("usa el folio normalizado en la clave del centinela", async () => {
    const falso = crearClienteFalso();
    await editarConvocatoria(
      { actual, cambios: { folio: "  conv-2026-777  " }, actor },
      deps(falso),
    );

    expect(itemsDeTransaccion(falso)[0]?.Put?.Item?.PK).toBe(
      "FOLIO_CONV#CONV-2026-777",
    );
  });

  it("reporta el folio duplicado en su campo, no como conflicto", async () => {
    // Es un dato mal capturado y hay que corregirlo; un "conflicto de
    // concurrencia" invitaria a reintentar con el mismo valor.
    const falso = crearClienteFalso({
      lanza: new TransactionCanceledException({
        message: "cancelada",
        $metadata: {},
        CancellationReasons: [
          { Code: "ConditionalCheckFailed" },
          { Code: "None" },
          { Code: "None" },
          { Code: "None" },
        ],
      }),
    });

    await expect(
      editarConvocatoria(
        { actual, cambios: { folio: "CONV-2026-777" }, actor },
        deps(falso),
      ),
    ).resolves.toEqual({
      ok: false,
      error: "validation_failed",
      detalles: { folio: "duplicado" },
    });
  });

  it("una cancelacion del Update sigue siendo invalid_state", async () => {
    // El indice 0 es el centinela solo cuando hay renombrado; sin distinguirlo,
    // un cambio de estatus bajo los pies se reportaria como folio duplicado.
    const falso = crearClienteFalso({
      lanza: new TransactionCanceledException({
        message: "cancelada",
        $metadata: {},
        CancellationReasons: [
          { Code: "None" },
          { Code: "None" },
          { Code: "ConditionalCheckFailed" },
          { Code: "None" },
        ],
      }),
    });

    await expect(
      editarConvocatoria(
        { actual, cambios: { folio: "CONV-2026-777" }, actor },
        deps(falso),
      ),
    ).resolves.toEqual({ ok: false, error: "invalid_state" });
  });

  it("un folio con un caracter fuera del alfabeto se rechaza antes de escribir", async () => {
    // El valor entra en la PK del centinela: un "#" desplazaria el separador.
    const falso = crearClienteFalso();
    const resultado = await editarConvocatoria(
      { actual, cambios: { folio: "CONV#777" }, actor },
      deps(falso),
    );

    expect(resultado).toEqual({
      ok: false,
      error: "validation_failed",
      detalles: { folio: "caracter_no_permitido" },
    });
    expect(falso.comandos).toHaveLength(0);
  });
});
