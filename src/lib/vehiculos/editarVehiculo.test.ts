// @vitest-environment node
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActorUsuario } from "./deps";
import { camposModificados, editarVehiculo } from "./editarVehiculo";
import {
  comandoDe,
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import type { Vehiculo } from "@/types/vehiculo";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-09-05T18:30:00.000Z");

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Administrar_Vehiculos"],
};

const actual: Vehiculo = {
  vehiculoId: "V1",
  numeroEconomico: "VEH-001",
  numeroDeSerie: "3N6AD33A9KK870001",
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 148_320,
  nivelEquipamiento: "Base",
  estatus: "DISPONIBLE",
  creadoEn: "2026-01-10T10:00:00.000Z",
  creadoPor: "P0",
  actualizadoEn: "2026-01-10T10:00:00.000Z",
  actualizadoPor: "P0",
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
    expect(
      camposModificados(actual, { ...actual, kilometraje: 150_000 }),
    ).toEqual(["kilometraje"]);
  });

  it("no lista un campo reasignado al mismo valor", () => {
    expect(camposModificados(actual, { ...actual })).toEqual([]);
  });

  it("cuenta como cambio pasar de un opcional con valor a ausente", () => {
    expect(
      camposModificados(actual, { ...actual, nivelEquipamiento: undefined }),
    ).toEqual(["nivelEquipamiento"]);
  });
});

describe("edicion correcta", () => {
  it("actualiza solo los campos modificados", async () => {
    const falso = crearClienteFalso();
    await editarVehiculo(
      { actual, cambios: { kilometraje: 150_000 }, actor },
      deps(falso),
    );

    const update = itemsDeTransaccion(falso)[0]?.Update;
    expect(update?.UpdateExpression).toBe(
      "SET #actualizadoEn = :actualizadoEn, #actualizadoPor = :actualizadoPor, #kilometraje = :kilometraje",
    );
    expect(update?.ExpressionAttributeValues).toMatchObject({
      ":kilometraje": 150_000,
      ":actualizadoPor": "P1",
    });
    // No toca marca ni version aunque las reciba en `actual`.
    expect(String(update?.UpdateExpression)).not.toContain("#marca");
  });

  it("nombra todos los atributos con marcador, incluida la palabra reservada version", async () => {
    // `version` es palabra reservada de DynamoDB: nombrarla directamente en una
    // expresion falla con ValidationException. Se usa marcador siempre, para no
    // tener que recordar cual de los ocho campos lo es.
    const falso = crearClienteFalso();
    await editarVehiculo(
      { actual, cambios: { version: "NP300 Doble Cabina" }, actor },
      deps(falso),
    );

    const update = itemsDeTransaccion(falso)[0]?.Update;
    expect(update?.ExpressionAttributeNames).toMatchObject({
      "#version": "version",
    });
    expect(String(update?.UpdateExpression)).toContain("#version = :version");
  });

  it("elimina el atributo cuando un opcional se vacia", async () => {
    // Guardar cadena vacia haria indistinguible "se borro" de "se capturo en
    // blanco", y ademas dejaria el atributo ocupando espacio para siempre.
    const falso = crearClienteFalso();
    await editarVehiculo(
      { actual, cambios: { nivelEquipamiento: "   " }, actor },
      deps(falso),
    );

    const update = itemsDeTransaccion(falso)[0]?.Update;
    expect(String(update?.UpdateExpression)).toContain(
      "REMOVE #nivelEquipamiento",
    );
    expect(update?.ExpressionAttributeValues).not.toHaveProperty(
      ":nivelEquipamiento",
    );
  });

  it("condiciona la escritura al estatus que se leyo", async () => {
    // Entre la lectura que decidio el permiso y esta escritura, el vehiculo pudo
    // entrar a una convocatoria o venderse. Sin la condicion, la edicion se
    // aplicaria sobre una decision de permiso ya caduca.
    const falso = crearClienteFalso();
    await editarVehiculo(
      { actual, cambios: { kilometraje: 150_000 }, actor },
      deps(falso),
    );

    const update = itemsDeTransaccion(falso)[0]?.Update;
    expect(update?.ConditionExpression).toBe(
      "attribute_exists(PK) AND #estatus = :estatusEsperado",
    );
    expect(update?.ExpressionAttributeValues).toMatchObject({
      ":estatusEsperado": "DISPONIBLE",
    });
  });

  it("registra en el evento que campos cambiaron", async () => {
    const falso = crearClienteFalso();
    await editarVehiculo(
      { actual, cambios: { kilometraje: 150_000, marca: "NISSAN" }, actor },
      deps(falso),
    );

    expect(itemsDeTransaccion(falso)[1]?.Put?.Item).toMatchObject({
      PK: "AUDIT#VEHICULO#V1",
      tipo: "VEHICULO_EDITADO",
      estadoAnterior: "DISPONIBLE",
      estadoNuevo: "DISPONIBLE",
      datos: {
        campos: ["marca", "kilometraje"],
        valores: { marca: "NISSAN", kilometraje: 150_000 },
      },
    });
  });
});

describe("sin cambios", () => {
  it("no escribe nada cuando nada cambia", async () => {
    // Una bitacora con "editado" sin cambios entrena a quien la lee a
    // ignorarla, que es peor que no tenerla.
    const falso = crearClienteFalso();
    const resultado = await editarVehiculo(
      { actual, cambios: { marca: "Nissan" }, actor },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: true, data: { vehiculoId: "V1" } });
    expect(falso.comandos).toHaveLength(0);
  });

  it("tampoco escribe cuando el cambio es solo espacios", async () => {
    const falso = crearClienteFalso();
    await editarVehiculo(
      { actual, cambios: { marca: "  Nissan  " }, actor },
      deps(falso),
    );
    expect(falso.comandos).toHaveLength(0);
  });
});

describe("rechazos", () => {
  it("valida el vehiculo completo, no solo el fragmento que llega", async () => {
    // Un cambio parcial puede dejar el registro invalido en conjunto; validar
    // solo lo recibido no lo detectaria.
    const falso = crearClienteFalso();
    const resultado = await editarVehiculo(
      { actual, cambios: { modelo: 1800 }, actor },
      deps(falso),
    );

    expect(resultado).toEqual({
      ok: false,
      error: "validation_failed",
      detalles: { modelo: "fuera_de_rango" },
    });
    expect(falso.comandos).toHaveLength(0);
  });

  it("devuelve invalid_state si el estatus cambio bajo los pies", async () => {
    const falso = crearClienteFalso({
      lanza: new TransactionCanceledException({
        message: "cancelada",
        $metadata: {},
        CancellationReasons: [
          { Code: "ConditionalCheckFailed" },
          { Code: "None" },
        ],
      }),
    });

    await expect(
      editarVehiculo(
        { actual, cambios: { kilometraje: 150_000 }, actor },
        deps(falso),
      ),
    ).resolves.toEqual({ ok: false, error: "invalid_state" });
  });
});

describe("renombrar un identificador de negocio", () => {
  it("no toca los centinelas si los dos numeros siguen igual", async () => {
    // La transaccion normal son dos items. Reservar el mismo valor otra vez
    // fallaria por `attribute_not_exists`: una edicion de kilometraje no puede
    // depender de eso.
    const falso = crearClienteFalso();
    await editarVehiculo(
      { actual, cambios: { kilometraje: 150_000 }, actor },
      deps(falso),
    );

    const items = itemsDeTransaccion(falso);
    expect(items).toHaveLength(2);
    expect(items.some((item) => item.Delete !== undefined)).toBe(false);
  });

  it("reserva el nuevo y libera el viejo en la misma transaccion", async () => {
    // Partirlo en dos pasos dejaria, si el segundo falla, o un numero reservado
    // que nadie puede volver a usar, o dos vehiculos con el mismo.
    const falso = crearClienteFalso();
    await editarVehiculo(
      { actual, cambios: { numeroEconomico: "VEH-777" }, actor },
      deps(falso),
    );

    const items = itemsDeTransaccion(falso);
    expect(items).toHaveLength(4);
    expect(items[0]?.Put).toMatchObject({
      Item: { PK: "NUMECO_VEH#VEH-777", SK: "CENTINELA", vehiculoId: "V1" },
      ConditionExpression: "attribute_not_exists(SK)",
    });
    expect(items[1]?.Delete).toMatchObject({
      Key: { PK: "NUMECO_VEH#VEH-001", SK: "CENTINELA" },
      // Exige que exista: borrar a ciegas dejaria reservado un valor que nadie
      // podria volver a usar si el atributo y su centinela se desincronizaran.
      ConditionExpression: "attribute_exists(SK)",
    });
  });

  it("renombra los dos numeros a la vez sin mezclar los ambitos", async () => {
    const falso = crearClienteFalso();
    await editarVehiculo(
      {
        actual,
        cambios: { numeroEconomico: "VEH-777", numeroDeSerie: "VIN-NUEVO" },
        actor,
      },
      deps(falso),
    );

    const items = itemsDeTransaccion(falso);
    expect(items).toHaveLength(6);
    expect(items[0]?.Put?.Item?.PK).toBe("NUMECO_VEH#VEH-777");
    expect(items[1]?.Delete?.Key?.PK).toBe("NUMECO_VEH#VEH-001");
    expect(items[2]?.Put?.Item?.PK).toBe("SERIE_VEH#VIN-NUEVO");
    expect(items[3]?.Delete?.Key?.PK).toBe("SERIE_VEH#3N6AD33A9KK870001");
  });

  it("el ancla de la bitacora sigue siendo el identificador interno", async () => {
    // Es lo que hace corregible un typo: renombrar el numero economico no
    // parte la historia del vehiculo en dos.
    const falso = crearClienteFalso();
    await editarVehiculo(
      { actual, cambios: { numeroEconomico: "VEH-777" }, actor },
      deps(falso),
    );

    const items = itemsDeTransaccion(falso);
    expect(items[3]?.Put?.Item).toMatchObject({
      PK: "AUDIT#VEHICULO#V1",
      tipo: "VEHICULO_EDITADO",
      datos: {
        campos: ["numeroEconomico"],
        valores: { numeroEconomico: "VEH-777" },
      },
    });
  });

  it("dice cual numero estaba tomado si el centinela nuevo cancela", async () => {
    const falso = crearClienteFalso({
      lanza: new TransactionCanceledException({
        message: "cancelada",
        $metadata: {},
        CancellationReasons: [
          { Code: "None" },
          { Code: "None" },
          { Code: "ConditionalCheckFailed" },
          { Code: "None" },
          { Code: "None" },
          { Code: "None" },
        ],
      }),
    });

    await expect(
      editarVehiculo(
        {
          actual,
          cambios: { numeroEconomico: "VEH-777", numeroDeSerie: "VIN-NUEVO" },
          actor,
        },
        deps(falso),
      ),
    ).resolves.toEqual({
      ok: false,
      error: "validation_failed",
      detalles: { numeroDeSerie: "duplicado" },
    });
  });
});
