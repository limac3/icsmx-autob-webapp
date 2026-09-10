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
const ID = "1K2M3N4P5Q6R";

/**
 * Posiciones de la transaccion. Van con nombre porque los centinelas de
 * unicidad van **primero** y todo lo demas se corrio dos lugares: un indice
 * literal en cada expect haria que agregar un centinela mas dejara las pruebas
 * verdes comprobando el item equivocado.
 */
const CENTINELA_NUMERO_ECONOMICO = 0;
const CENTINELA_NUMERO_DE_SERIE = 1;
const VEHICULO = 2;
const EVENTO = 3;

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Administrar_Vehiculos"],
};

const datos: DatosVehiculo = {
  numeroEconomico: "VEH-001",
  numeroDeSerie: "3N6AD33A9KK870001",
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

/**
 * Cancelacion con el fallo en la posicion indicada y `None` en el resto.
 *
 * DynamoDB devuelve una razon **por item y en orden**, y es lo unico que
 * distingue "el numero economico ya existe" de "el de serie ya existe".
 */
const canceladaEn = (indice: number) =>
  new TransactionCanceledException({
    message: "cancelada",
    $metadata: {},
    CancellationReasons: Array.from({ length: 4 }, (_, i) => ({
      Code: i === indice ? "ConditionalCheckFailed" : "None",
    })),
  });

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

    expect(itemsDeTransaccion(falso)[VEHICULO]?.Put?.Item).toMatchObject({
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

    expect(itemsDeTransaccion(falso)[VEHICULO]?.Put?.Item).toMatchObject({
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

    const item = itemsDeTransaccion(falso)[VEHICULO]?.Put?.Item;
    expect(item?.marca).toBe("Nissan");
    expect(item?.nivelEquipamiento).toBeUndefined();
  });

  it("usa el mismo instante en el item y en el evento", async () => {
    // Dos llamadas al reloj producirian un `creadoEn` y un `ocurridoEn`
    // distintos por milisegundos, y la bitacora contaria una historia que no
    // coincide con el dato.
    const falso = crearClienteFalso();
    await crearVehiculo({ datos, actor }, deps(falso));

    const items = itemsDeTransaccion(falso);
    expect(items[EVENTO]?.Put?.Item?.ocurridoEn).toBe(
      items[VEHICULO]?.Put?.Item?.creadoEn,
    );
  });
});

describe("auditoria en la misma transaccion (regla 4)", () => {
  it("manda exactamente cuatro items: dos centinelas, el vehiculo y su evento", async () => {
    const falso = crearClienteFalso();
    await crearVehiculo({ datos, actor }, deps(falso));

    const items = itemsDeTransaccion(falso);
    expect(items).toHaveLength(4);
    expect(items[EVENTO]?.Put?.Item).toMatchObject({
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

    expect(itemsDeTransaccion(falso)[EVENTO]?.Put?.ConditionExpression).toBe(
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
    const falso = crearClienteFalso({ lanza: canceladaEn(VEHICULO) });

    await expect(crearVehiculo({ datos, actor }, deps(falso))).resolves.toEqual(
      { ok: false, error: "conflicto_concurrencia" },
    );
  });

  it("protege contra una sobrescritura si el identificador se repitiera", async () => {
    const falso = crearClienteFalso();
    await crearVehiculo({ datos, actor }, deps(falso));

    expect(itemsDeTransaccion(falso)[VEHICULO]?.Put?.ConditionExpression).toBe(
      "attribute_not_exists(PK)",
    );
  });
});

describe("unicidad de los identificadores de negocio", () => {
  it("reserva los dos numeros con una escritura condicional, no con una lectura previa", async () => {
    // La diferencia importa: dos altas simultaneas con el mismo numero pasarian
    // las dos si la unicidad se comprobara leyendo antes (regla 6).
    const falso = crearClienteFalso();
    await crearVehiculo({ datos, actor }, deps(falso));

    const items = itemsDeTransaccion(falso);
    expect(items[CENTINELA_NUMERO_ECONOMICO]?.Put).toMatchObject({
      Item: { PK: "NUMECO_VEH#VEH-001", SK: "CENTINELA", vehiculoId: ID },
      ConditionExpression: "attribute_not_exists(SK)",
    });
    expect(items[CENTINELA_NUMERO_DE_SERIE]?.Put).toMatchObject({
      Item: {
        PK: "SERIE_VEH#3N6AD33A9KK870001",
        SK: "CENTINELA",
        vehiculoId: ID,
      },
      ConditionExpression: "attribute_not_exists(SK)",
    });
  });

  it("normaliza el valor antes de armar la clave del centinela", async () => {
    // Sin esto, "  veh-001  " y "VEH-001" ocuparian claves distintas y la
    // unicidad seria una creencia: el centinela solo protege lo que compara.
    const falso = crearClienteFalso();
    await crearVehiculo(
      { datos: { ...datos, numeroEconomico: "  veh-001  " }, actor },
      deps(falso),
    );

    expect(
      itemsDeTransaccion(falso)[CENTINELA_NUMERO_ECONOMICO]?.Put?.Item?.PK,
    ).toBe("NUMECO_VEH#VEH-001");
  });

  it("dice cual de los dos numeros estaba tomado", async () => {
    // Sin el indice, la pantalla solo podria decir "revisa los datos" y quien
    // captura tendria que adivinar cual de los dos repitio.
    for (const [indice, campo] of [
      [CENTINELA_NUMERO_ECONOMICO, "numeroEconomico"],
      [CENTINELA_NUMERO_DE_SERIE, "numeroDeSerie"],
    ] as const) {
      const falso = crearClienteFalso({ lanza: canceladaEn(indice) });

      await expect(
        crearVehiculo({ datos, actor }, deps(falso)),
      ).resolves.toEqual({
        ok: false,
        error: "validation_failed",
        detalles: { [campo]: "duplicado" },
      });
    }
  });
});
