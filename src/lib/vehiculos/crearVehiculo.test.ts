// @vitest-environment node
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crearVehiculo } from "./crearVehiculo";
import type { ActorUsuario } from "./deps";
import {
  comandoDe,
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import type { DatosVehiculo } from "@/types/vehiculo";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-09-05T18:30:00.000Z");
const ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Administrar_Vehiculos"],
};

const datos: DatosVehiculo = {
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 148_320,
};

const deps = (falso: ClienteFalso) => ({
  cliente: falso.cliente,
  ahora: () => AHORA,
  nuevoId: () => ID,
});

/** Los items de la `TransactWriteItems`, tal como se enviaron. */
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
    await expect(crearVehiculo({ datos, actor }, deps(falso))).resolves.toEqual(
      {
        ok: true,
        data: { vehiculoId: ID },
      },
    );
  });

  it("escribe el vehiculo en su clave, DISPONIBLE", async () => {
    const falso = crearClienteFalso();
    await crearVehiculo({ datos, actor }, deps(falso));

    expect(itemsDeTransaccion(falso)[0]?.Put?.Item).toMatchObject({
      PK: `VEH#${ID}`,
      SK: "META",
      vehiculoId: ID,
      estatus: "DISPONIBLE",
      marca: "Nissan",
      creadoEn: "2026-09-05T18:30:00.000Z",
      creadoPor: "P1",
      actualizadoEn: "2026-09-05T18:30:00.000Z",
      actualizadoPor: "P1",
    });
  });

  it("escribe las claves de GSI2 para que aparezca en PA-03", async () => {
    // Sin ellas el vehiculo existe pero no sale en ningun listado: quedaria
    // accesible solo por su identificador, que nadie conoce.
    const falso = crearClienteFalso();
    await crearVehiculo({ datos, actor }, deps(falso));

    expect(itemsDeTransaccion(falso)[0]?.Put?.Item).toMatchObject({
      GSI2PK: "VEH_ESTATUS#DISPONIBLE",
      GSI2SK: `2026-09-05T18:30:00.000Z#${ID}`,
    });
  });

  it("persiste los datos ya normalizados", async () => {
    const falso = crearClienteFalso();
    await crearVehiculo(
      {
        datos: { ...datos, marca: "  Nissan  ", nivelEquipamiento: "   " },
        actor,
      },
      deps(falso),
    );

    const item = itemsDeTransaccion(falso)[0]?.Put?.Item;
    expect(item?.marca).toBe("Nissan");
    expect(item?.nivelEquipamiento).toBeUndefined();
  });

  it("usa el mismo instante en el item y en el evento", async () => {
    // Dos llamadas al reloj producirian un `creadoEn` y un `ocurridoEn`
    // distintos por milisegundos, y la bitacora contaria una historia que no
    // coincide con el dato.
    const falso = crearClienteFalso();
    await crearVehiculo({ datos, actor }, deps(falso));

    const [vehiculo, evento] = itemsDeTransaccion(falso);
    expect(evento?.Put?.Item?.ocurridoEn).toBe(vehiculo?.Put?.Item?.creadoEn);
  });
});

describe("auditoria en la misma transaccion (regla 4)", () => {
  it("manda exactamente dos items: el vehiculo y su evento", async () => {
    const falso = crearClienteFalso();
    await crearVehiculo({ datos, actor }, deps(falso));

    const items = itemsDeTransaccion(falso);
    expect(items).toHaveLength(2);
    expect(items[1]?.Put?.Item).toMatchObject({
      PK: `AUDIT#VEHICULO#${ID}`,
      tipo: "VEHICULO_REGISTRADO",
      actorId: "P1",
      actorPermisos: ["Autob_Administrar_Vehiculos"],
      estadoNuevo: "DISPONIBLE",
    });
  });

  it("el evento lleva la condicion append-only", async () => {
    const falso = crearClienteFalso();
    await crearVehiculo({ datos, actor }, deps(falso));

    expect(itemsDeTransaccion(falso)[1]?.Put?.ConditionExpression).toBe(
      "attribute_not_exists(PK)",
    );
  });

  it("una sola llamada al cliente: no hay escritura fuera de la transaccion", async () => {
    const falso = crearClienteFalso();
    await crearVehiculo({ datos, actor }, deps(falso));

    expect(falso.comandos.map((c) => c.nombre)).toEqual([
      "TransactWriteCommand",
    ]);
  });
});

describe("rechazos", () => {
  it("no escribe nada si los datos son invalidos", async () => {
    const falso = crearClienteFalso();
    const resultado = await crearVehiculo(
      { datos: { ...datos, marca: "", kilometraje: -1 }, actor },
      deps(falso),
    );

    expect(resultado).toEqual({
      ok: false,
      error: "validation_failed",
      detalles: { marca: "requerido", kilometraje: "fuera_de_rango" },
    });
    expect(falso.comandos).toHaveLength(0);
  });

  it("traduce una cancelacion de la transaccion a un error de dominio", async () => {
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

    await expect(crearVehiculo({ datos, actor }, deps(falso))).resolves.toEqual(
      { ok: false, error: "conflicto_concurrencia" },
    );
  });

  it("protege contra una sobrescritura si el identificador se repitiera", async () => {
    const falso = crearClienteFalso();
    await crearVehiculo({ datos, actor }, deps(falso));

    expect(itemsDeTransaccion(falso)[0]?.Put?.ConditionExpression).toBe(
      "attribute_not_exists(PK)",
    );
  });
});
