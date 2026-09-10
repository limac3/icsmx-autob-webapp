// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import {
  identificadoresConActividad,
  MAXIMO_DE_VALORES,
  participantesConActividad,
} from "./valoresConActividad";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Un simulador **del ordenamiento del indice**, y no un simulador de DynamoDB.
 *
 * Es la excepcion al criterio de `clienteDynamoFalso` —capturar comandos en vez
 * de simular la base— y tiene una razon concreta: lo que hay que probar aqui es
 * un **algoritmo de recorrido**. El salto por `ExclusiveStartKey` depende de que
 * `"LOTE#<id>"` ordene antes que `"LOTE#<id>#<crono>"`, de que la lectura sea
 * descendente y de que el cursor sintetizado deje atras el grupo entero. Sin
 * reproducir ese orden, una prueba solo podria afirmar que se mandaron consultas
 * —no que el recorrido termina, ni que no repite, ni que no se salta valores—, y
 * los tres son modos de fallar reales: un cursor mal armado produce un ciclo
 * infinito o una lista incompleta.
 *
 * Que DynamoDB de verdad acepte un `ExclusiveStartKey` sintetizado ya se
 * verifico contra la tabla real: 10 lotes distintos en 11 consultas.
 */
type Entrada = { diaPK: string; orden: string; item: Record<string, unknown> };

const simuladorDeIndice = (entradas: readonly Entrada[]) =>
  crearClienteFalso({
    responder: (comando: ComandoEnviado) => {
      const valores = comando.input.ExpressionAttributeValues as Record<
        string,
        string
      >;
      const cursor = comando.input.ExclusiveStartKey as
        Record<string, string> | undefined;
      const atributo = String(comando.input.KeyConditionExpression).includes(
        "agregadoSK",
      )
        ? "agregadoSK"
        : "actorSK";

      const candidatas = entradas
        .filter(
          (entrada) =>
            entrada.diaPK === valores[":particion"] &&
            entrada.orden.startsWith(valores[":prefijo"]!),
        )
        // Descendente, como pide `ScanIndexForward: false`, y comparando por
        // **punto de codigo**: `localeCompare` usa la colacion del idioma, que
        // ordena distinto —ignora mayusculas y trata aparte la puntuacion— y no
        // es lo que hace DynamoDB, que compara bytes. Con `localeCompare` este
        // simulador se contradecia con su propio filtro de cursor y perdia
        // valores.
        .sort((a, b) => (a.orden < b.orden ? 1 : a.orden > b.orden ? -1 : 0))
        .filter((entrada) =>
          cursor ? entrada.orden < cursor[atributo]! : true,
        );

      const limite = Number(comando.input.Limit ?? candidatas.length);
      return {
        Items: candidatas.slice(0, limite).map((entrada) => ({
          ...entrada.item,
          [atributo]: entrada.orden,
          diaPK: entrada.diaPK,
        })),
      };
    },
  });

const evento = (
  eventoId: string,
  agregado: string,
  agregadoId: string,
  extras: Record<string, unknown> = {},
) => ({
  PK: `AUDIT#${agregado}#${agregadoId}`,
  SK: `2026-09-08T18:00:00.000Z#${eventoId}`,
  eventoId,
  tipo: "SOLICITUD_CREADA",
  ocurridoEn: "2026-09-08T18:00:00.000Z",
  actorTipo: "USUARIO",
  actorId: "okta|ana",
  correlacionId: "COR1",
  ...extras,
});

/** N eventos del mismo lote en el mismo dia: el caso que el salto resuelve. */
const grupoDeLote = (dia: string, loteId: string, cuantos: number): Entrada[] =>
  Array.from({ length: cuantos }, (_, i) => ({
    diaPK: `DIA#${dia}`,
    orden: `LOTE#${loteId}#2026-09-08T18:00:${String(i).padStart(2, "0")}.000Z#E${loteId}${i}`,
    item: evento(`E${loteId}${i}`, "LOTE", loteId, { convocatoriaId: "C1" }),
  }));

const cliente = (falso: ReturnType<typeof crearClienteFalso>) => ({
  cliente: falso.cliente as never,
});

describe("identificadoresConActividad — el salto de GSI7", () => {
  it("un grupo grande cuesta una consulta, no una por evento", async () => {
    // Es el numero que justifica el diseno entero: tres lotes con cien eventos
    // cada uno se resuelven con cuatro consultas —tres saltos y el que devuelve
    // vacio—, no con trescientas lecturas.
    const falso = simuladorDeIndice([
      ...grupoDeLote("2026-09-08", "L1", 100),
      ...grupoDeLote("2026-09-08", "L2", 100),
      ...grupoDeLote("2026-09-08", "L3", 100),
    ]);

    const resultado = await identificadoresConActividad(
      { desde: "2026-09-08", hasta: "2026-09-08", agregado: "LOTE" },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.map((v) => v.valor).sort()).toEqual([
      "L1",
      "L2",
      "L3",
    ]);
    expect(falso.comandos).toHaveLength(4);
  });

  it("no repite un valor que aparece en varios dias", async () => {
    const falso = simuladorDeIndice([
      ...grupoDeLote("2026-09-07", "L1", 3),
      ...grupoDeLote("2026-09-08", "L1", 3),
    ]);

    const resultado = await identificadoresConActividad(
      { desde: "2026-09-07", hasta: "2026-09-08", agregado: "LOTE" },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.map((v) => v.valor)).toEqual(["L1"]);
  });

  it("conserva el evento del dia mas reciente, que es lo que ordena las opciones", async () => {
    const falso = simuladorDeIndice([
      {
        diaPK: "DIA#2026-09-07",
        orden: "LOTE#L1#2026-09-07T18:00:00.000Z#VIEJO",
        item: evento("VIEJO", "LOTE", "L1", { convocatoriaId: "C1" }),
      },
      {
        diaPK: "DIA#2026-09-08",
        orden: "LOTE#L1#2026-09-08T18:00:00.000Z#NUEVO",
        item: evento("NUEVO", "LOTE", "L1", { convocatoriaId: "C1" }),
      },
    ]);

    const resultado = await identificadoresConActividad(
      { desde: "2026-09-07", hasta: "2026-09-08", agregado: "LOTE" },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data[0]?.evento.eventoId).toBe("NUEVO");
  });

  it("recorre los dias de nuevo a viejo", async () => {
    const falso = simuladorDeIndice([]);

    await identificadoresConActividad(
      { desde: "2026-09-06", hasta: "2026-09-08", agregado: "VEHICULO" },
      cliente(falso),
    );

    expect(
      falso.comandos.map((c) =>
        String(
          (c.input.ExpressionAttributeValues as Record<string, string>)[
            ":particion"
          ],
        ),
      ),
    ).toEqual(["DIA#2026-09-08", "DIA#2026-09-07", "DIA#2026-09-06"]);
  });

  it("acota a su tipo de registro con el prefijo de la clave de ordenamiento", async () => {
    // Sin el prefijo, el sondeo devolveria el ultimo evento del dia sea de
    // quien sea, y el select de vehiculos ofreceria lotes.
    const falso = simuladorDeIndice([
      ...grupoDeLote("2026-09-08", "L1", 2),
      {
        diaPK: "DIA#2026-09-08",
        orden: "VEHICULO#V1#2026-09-08T18:00:00.000Z#EV1",
        item: evento("EV1", "VEHICULO", "V1"),
      },
    ]);

    const resultado = await identificadoresConActividad(
      { desde: "2026-09-08", hasta: "2026-09-08", agregado: "VEHICULO" },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.map((v) => v.valor)).toEqual(["V1"]);
  });

  it("devuelve el item completo, que es de donde salen las etiquetas", async () => {
    // Los cinco indices proyectan `ALL`, asi que el sondeo ya trajo el evento
    // entero: sin su `convocatoriaId` no se podria ni armar la clave del lote.
    const falso = simuladorDeIndice(grupoDeLote("2026-09-08", "L1", 2));

    const resultado = await identificadoresConActividad(
      { desde: "2026-09-08", hasta: "2026-09-08", agregado: "LOTE" },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data[0]?.evento.convocatoriaId).toBe("C1");
  });

  it("corta a los MAXIMO_DE_VALORES valores distintos", async () => {
    const falso = simuladorDeIndice(
      Array.from({ length: MAXIMO_DE_VALORES + 20 }, (_, i) => ({
        diaPK: "DIA#2026-09-08",
        orden: `LOTE#L${String(i).padStart(4, "0")}#2026-09-08T18:00:00.000Z#E${i}`,
        item: evento(`E${i}`, "LOTE", `L${String(i).padStart(4, "0")}`, {
          convocatoriaId: "C1",
        }),
      })),
    );

    const resultado = await identificadoresConActividad(
      { desde: "2026-09-08", hasta: "2026-09-08", agregado: "LOTE" },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data).toHaveLength(MAXIMO_DE_VALORES);
  });

  it("un item ilegible corta el dia en vez de girar en falso", async () => {
    // Si no se puede leer de que valor es, no se puede saltar su grupo: seguir
    // sondeando devolveria el mismo item para siempre.
    const falso = crearClienteFalso({
      responder: () => ({ Items: [{ PK: "AUDIT#LOTE#L1", SK: "corrupto" }] }),
    });

    const resultado = await identificadoresConActividad(
      { desde: "2026-09-08", hasta: "2026-09-08", agregado: "LOTE" },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data).toEqual([]);
    expect(falso.comandos).toHaveLength(1);
  });

  it("rechaza un rango que no se puede recorrer, sin tocar DynamoDB", async () => {
    const falso = simuladorDeIndice([]);
    const resultado = await identificadoresConActividad(
      { desde: "2026-09-08", hasta: "2026-09-06", agregado: "LOTE" },
      cliente(falso),
    );

    expect(resultado.ok).toBe(false);
    expect(falso.comandos).toHaveLength(0);
  });
});

describe("participantesConActividad — el salto de GSI8", () => {
  const actor = (dia: string, actorId: string, eventoId: string): Entrada => ({
    diaPK: `DIA#${dia}`,
    orden: `ACTOR#${actorId}#2026-09-08T18:00:00.000Z#${eventoId}`,
    item: {
      ...evento(eventoId, "LOTE", "L1"),
      actorId,
      actorTipo: actorId === "SISTEMA" ? "SISTEMA" : "USUARIO",
    },
  });

  it("devuelve las personas distintas del rango", async () => {
    const falso = simuladorDeIndice([
      actor("2026-09-08", "okta|ana", "E1"),
      actor("2026-09-08", "okta|ana", "E2"),
      actor("2026-09-08", "okta|beto", "E3"),
    ]);

    const resultado = await participantesConActividad(
      { desde: "2026-09-08", hasta: "2026-09-08" },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.map((v) => v.valor).sort()).toEqual([
      "okta|ana",
      "okta|beto",
    ]);
  });

  it("deja fuera a SISTEMA", async () => {
    // Firma los vencimientos de todo el mundo, asi que como opcion de un select
    // de participantes no distingue nada — y no es una persona a la que
    // rastrear.
    const falso = simuladorDeIndice([
      actor("2026-09-08", "SISTEMA", "E1"),
      actor("2026-09-08", "okta|ana", "E2"),
    ]);

    const resultado = await participantesConActividad(
      { desde: "2026-09-08", hasta: "2026-09-08" },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.map((v) => v.valor)).toEqual([
      "okta|ana",
    ]);
  });

  it("consulta GSI8 con el prefijo de actor", async () => {
    const falso = simuladorDeIndice([]);

    await participantesConActividad(
      { desde: "2026-09-08", hasta: "2026-09-08" },
      cliente(falso),
    );

    expect(falso.comandos[0]?.input).toMatchObject({
      IndexName: "GSI8",
      KeyConditionExpression:
        "diaPK = :particion AND begins_with(actorSK, :prefijo)",
      ScanIndexForward: false,
    });
  });
});

describe("el costo del recorrido", () => {
  it("muchos valores con pocos eventos caben en una sola consulta", async () => {
    // La correccion medida: la primera version sondeaba de a **un** item, lo
    // que es optimo con grupos enormes y pesimo con muchos grupos chicos —200
    // vehiculos distintos costaban 200 viajes de red en serie y la pantalla
    // tardaba 20 segundos. Con una pagina, cada lectura aporta todos los
    // valores que quepan en ella.
    const falso = simuladorDeIndice(
      Array.from({ length: 60 }, (_, i) => ({
        diaPK: "DIA#2026-09-08",
        orden: `VEHICULO#V${String(i).padStart(3, "0")}#2026-09-08T18:00:00.000Z#E${i}`,
        item: evento(`E${i}`, "VEHICULO", `V${String(i).padStart(3, "0")}`),
      })),
    );

    const resultado = await identificadoresConActividad(
      { desde: "2026-09-08", hasta: "2026-09-08", agregado: "VEHICULO" },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data).toHaveLength(60);
    // Una lectura trae los 60 y la segunda confirma que no hay mas.
    expect(falso.comandos).toHaveLength(2);
  });

  it("consulta los dias en tandas concurrentes, sin perder el orden", async () => {
    // En serie, 90 dias con casi nada dentro cuestan 90 viajes encadenados. Las
    // tandas dividen la espera y **se procesan en orden**: si se mezclaran, el
    // orden de las opciones —ultimo dia con actividad primero— dejaria de
    // significar nada.
    const falso = simuladorDeIndice([
      {
        diaPK: "DIA#2026-09-01",
        orden: "VEHICULO#VIEJO#2026-09-01T18:00:00.000Z#E1",
        item: evento("E1", "VEHICULO", "VIEJO"),
      },
      {
        diaPK: "DIA#2026-09-20",
        orden: "VEHICULO#NUEVO#2026-09-20T18:00:00.000Z#E2",
        item: evento("E2", "VEHICULO", "NUEVO"),
      },
    ]);

    const resultado = await identificadoresConActividad(
      { desde: "2026-09-01", hasta: "2026-09-20", agregado: "VEHICULO" },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.map((v) => v.valor)).toEqual([
      "NUEVO",
      "VIEJO",
    ]);
  });
});
