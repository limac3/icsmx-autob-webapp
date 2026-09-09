// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import {
  consultarBitacoraGlobal,
  consultarPorTipoDeEvento,
  LIMITE_DE_EVENTOS_GLOBAL,
} from "./consultarBitacoraGlobal";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const evento = (
  eventoId: string,
  ocurridoEn: string,
  extras: Record<string, unknown> = {},
) => ({
  PK: "AUDIT#LOTE#L1",
  SK: `${ocurridoEn}#${eventoId}`,
  eventoId,
  tipo: "SOLICITUD_CREADA",
  ocurridoEn,
  actorTipo: "USUARIO",
  actorId: "P1",
  correlacionId: "COR1",
  ...extras,
});

/** Dia de negocio pedido por un comando, leido de su clave de particion. */
const diaDe = (comando: ComandoEnviado): string =>
  String(
    (comando.input.ExpressionAttributeValues as Record<string, unknown>)[":pk"],
  ).replace("AUDIT#", "");

describe("consultarBitacoraGlobal — PA-13", () => {
  it("consulta una particion por dia del rango, sobre GSI2", async () => {
    const falso = crearClienteFalso({ responder: () => ({ Items: [] }) });

    await consultarBitacoraGlobal(
      { desde: "2026-09-06", hasta: "2026-09-08" },
      { cliente: falso.cliente as never },
    );

    expect(falso.comandos).toHaveLength(3);
    // Del mas nuevo al mas viejo: es lo que permite dejar de leer en cuanto se
    // llena el cupo, y que lo descartado sea lo mas viejo.
    expect(falso.comandos.map(diaDe)).toEqual([
      "2026-09-08",
      "2026-09-07",
      "2026-09-06",
    ]);
    expect(falso.comandos[0]?.input).toMatchObject({
      IndexName: "GSI2",
      KeyConditionExpression: "GSI2PK = :pk",
      ScanIndexForward: false,
    });
  });

  it("devuelve los eventos en orden cronologico ascendente, aunque se lean al reves", async () => {
    // Se lee de nuevo a viejo y se voltea al final; no se ordena en memoria.
    const falso = crearClienteFalso({
      responder: (comando) =>
        diaDe(comando) === "2026-09-06"
          ? { Items: [evento("E1", "2026-09-06T18:00:00.000Z")] }
          : { Items: [evento("E2", "2026-09-07T18:00:00.000Z")] },
    });

    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-09-06", hasta: "2026-09-07" },
      { cliente: falso.cliente as never },
    );

    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["E1", "E2"]);
  });

  it("dentro de un dia tambien devuelve ascendente lo que DynamoDB entrego descendente", async () => {
    const falso = crearClienteFalso({
      responder: () => ({
        Items: [
          evento("E-TARDE", "2026-09-08T20:00:00.000Z"),
          evento("E-MEDIO", "2026-09-08T19:00:00.000Z"),
          evento("E-TEMPRANO", "2026-09-08T18:00:00.000Z"),
        ],
      }),
    });

    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-09-08", hasta: "2026-09-08" },
      { cliente: falso.cliente as never },
    );

    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["E-TEMPRANO", "E-MEDIO", "E-TARDE"]);
  });

  it("cada evento sabe de que agregado es historia, que es lo unico que lo hace legible en el modo global", async () => {
    const falso = crearClienteFalso({
      responder: () => ({
        Items: [
          {
            ...evento("E1", "2026-09-06T18:00:00.000Z"),
            PK: "AUDIT#SOLICITUD#L1-7",
          },
        ],
      }),
    });

    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-09-06", hasta: "2026-09-06" },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok && resultado.data.eventos[0]).toMatchObject({
      agregado: "SOLICITUD",
      agregadoId: "L1-7",
    });
  });

  it("filtra por tipo en DynamoDB y no en memoria", async () => {
    // Una particion de dia puede traer todos los eventos del sistema de ese
    // dia: traerla entera para descartarla en el proceso es transferencia
    // pagada por nada.
    const falso = crearClienteFalso({ responder: () => ({ Items: [] }) });

    await consultarBitacoraGlobal(
      { desde: "2026-09-08", hasta: "2026-09-08", tipo: "PAGO_RECHAZADO" },
      { cliente: falso.cliente as never },
    );

    expect(falso.comandos[0]?.input).toMatchObject({
      FilterExpression: "#tipo = :tipo",
      ExpressionAttributeNames: { "#tipo": "tipo" },
    });
    expect(
      (
        falso.comandos[0]?.input.ExpressionAttributeValues as Record<
          string,
          unknown
        >
      )[":tipo"],
    ).toBe("PAGO_RECHAZADO");
  });

  it("combina tipo y actor en una sola condicion", async () => {
    const falso = crearClienteFalso({ responder: () => ({ Items: [] }) });

    await consultarBitacoraGlobal(
      {
        desde: "2026-09-08",
        hasta: "2026-09-08",
        tipo: "PAGO_RECHAZADO",
        actorId: "okta|1",
      },
      { cliente: falso.cliente as never },
    );

    expect(falso.comandos[0]?.input.FilterExpression).toBe(
      "#tipo = :tipo AND #actorId = :actorId",
    );
  });

  it("sin filtros no manda FilterExpression", async () => {
    const falso = crearClienteFalso({ responder: () => ({ Items: [] }) });

    await consultarBitacoraGlobal(
      { desde: "2026-09-08", hasta: "2026-09-08" },
      { cliente: falso.cliente as never },
    );

    expect(falso.comandos[0]?.input.FilterExpression).toBeUndefined();
    expect(falso.comandos[0]?.input.ExpressionAttributeNames).toBeUndefined();
  });

  it("pagina un dia hasta agotarlo", async () => {
    let llamadas = 0;
    const falso = crearClienteFalso({
      responder: () => {
        llamadas += 1;
        return llamadas === 1
          ? {
              Items: [evento("E1", "2026-09-08T18:00:00.000Z")],
              LastEvaluatedKey: { PK: "x", SK: "y" },
            }
          : { Items: [evento("E2", "2026-09-08T19:00:00.000Z")] };
      },
    });

    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-09-08", hasta: "2026-09-08" },
      { cliente: falso.cliente as never },
    );

    expect(llamadas).toBe(2);
    expect(resultado.ok && resultado.data.eventos).toHaveLength(2);
    expect(resultado.ok && resultado.data.truncada).toBe(false);
  });

  it("avisa cuando trunca, en vez de entregar una lista incompleta que parece completa", async () => {
    const muchos = Array.from(
      { length: LIMITE_DE_EVENTOS_GLOBAL + 5 },
      (_, i) => evento(`E${i}`, "2026-09-08T18:00:00.000Z"),
    );
    const falso = crearClienteFalso({ responder: () => ({ Items: muchos }) });

    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-09-08", hasta: "2026-09-08" },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok && resultado.data.eventos).toHaveLength(
      LIMITE_DE_EVENTOS_GLOBAL,
    );
    expect(resultado.ok && resultado.data.truncada).toBe(true);
  });

  it("un rango que llena el tope exacto no se reporta como truncado", async () => {
    // La frontera importa: reportar truncamiento sin haberlo mandaria al
    // auditor a acotar un rango que ya estaba completo.
    const justos = Array.from({ length: LIMITE_DE_EVENTOS_GLOBAL }, (_, i) =>
      evento(`E${i}`, "2026-09-08T18:00:00.000Z"),
    );
    const falso = crearClienteFalso({ responder: () => ({ Items: justos }) });

    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-09-08", hasta: "2026-09-08" },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok && resultado.data.eventos).toHaveLength(
      LIMITE_DE_EVENTOS_GLOBAL,
    );
    expect(resultado.ok && resultado.data.truncada).toBe(false);
  });

  it("**el truncamiento descarta lo mas viejo, no lo mas reciente**", async () => {
    // El defecto que encontraron los datos del sandbox: un dia de prueba de
    // carga con 3 069 eventos consumia el cupo entero y, leyendo en orden
    // ascendente, lo que se descartaba era justo lo de hoy. Las opciones de
    // los selects se ordenan por actividad reciente, asi que se armaban del
    // dia anterior.
    const viejos = Array.from({ length: LIMITE_DE_EVENTOS_GLOBAL }, (_, i) =>
      evento(`VIEJO-${i}`, "2026-09-07T18:00:00.000Z"),
    );
    const falso = crearClienteFalso({
      responder: (comando) =>
        diaDe(comando) === "2026-09-08"
          ? { Items: [evento("HOY", "2026-09-08T18:00:00.000Z")] }
          : { Items: viejos },
    });

    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-09-07", hasta: "2026-09-08" },
      { cliente: falso.cliente as never },
    );

    const ids = resultado.ok
      ? resultado.data.eventos.map((e) => e.eventoId)
      : [];
    expect(ids).toContain("HOY");
    expect(ids).toHaveLength(LIMITE_DE_EVENTOS_GLOBAL);
    expect(resultado.ok && resultado.data.truncada).toBe(true);
    // Y el mas reciente sigue siendo el ultimo, porque se presenta ascendente.
    expect(ids.at(-1)).toBe("HOY");
  });

  it("deja de leer los dias mas viejos en cuanto se llena el cupo", async () => {
    // La razon de leer en secuencia y no en paralelo: los dias que no caben no
    // se consultan siquiera.
    const muchos = Array.from(
      { length: LIMITE_DE_EVENTOS_GLOBAL + 1 },
      (_, i) => evento(`E${i}`, "2026-09-08T18:00:00.000Z"),
    );
    const falso = crearClienteFalso({
      responder: (comando) =>
        diaDe(comando) === "2026-09-08" ? { Items: muchos } : { Items: [] },
    });

    await consultarBitacoraGlobal(
      { desde: "2026-08-09", hasta: "2026-09-08" },
      { cliente: falso.cliente as never },
    );

    // Un solo dia consultado, de los 31 del rango.
    expect(falso.comandos).toHaveLength(1);
    expect(diaDe(falso.comandos[0] as never)).toBe("2026-09-08");
  });

  it("deja de paginar un dia que ya agoto el cupo por si solo", async () => {
    const muchos = Array.from(
      { length: LIMITE_DE_EVENTOS_GLOBAL + 1 },
      (_, i) => evento(`E${i}`, "2026-09-08T18:00:00.000Z"),
    );
    let llamadas = 0;
    const falso = crearClienteFalso({
      responder: () => {
        llamadas += 1;
        return { Items: muchos, LastEvaluatedKey: { PK: "x", SK: "y" } };
      },
    });

    await consultarBitacoraGlobal(
      { desde: "2026-09-08", hasta: "2026-09-08" },
      { cliente: falso.cliente as never },
    );

    expect(llamadas).toBe(1);
  });

  it("rechaza un rango invalido sin consultar nada", async () => {
    const falso = crearClienteFalso();

    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-09-08", hasta: "2026-09-01" },
      { cliente: falso.cliente as never },
    );

    expect(resultado).toEqual({
      ok: false,
      error: "validation_failed",
      detalles: { campo: "rango" },
    });
    expect(falso.comandos).toHaveLength(0);
  });

  it("se niega a recorrer mas particiones de las permitidas, aunque quien llame no haya validado", async () => {
    // Segunda linea de defensa: una action nueva que olvide validar no puede
    // conseguir que este servicio lance cien Query.
    const falso = crearClienteFalso();

    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-06-01", hasta: "2026-09-08" },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok).toBe(false);
    expect(falso.comandos).toHaveLength(0);
  });

  it("omite un item que no se puede interpretar en vez de fabricarlo a medias", async () => {
    const falso = crearClienteFalso({
      responder: () => ({
        Items: [
          { PK: "AUDIT#LOTE#L1", SK: "x", eventoId: "E1" },
          evento("E2", "2026-09-08T18:00:00.000Z"),
        ],
      }),
    });

    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-09-08", hasta: "2026-09-08" },
      { cliente: falso.cliente as never },
    );

    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["E2"]);
  });
});

describe("consultarPorTipoDeEvento", () => {
  const dto = (eventoId: string, tipo: string) => ({
    eventoId,
    tipo,
    ocurridoEn: "2026-09-08T18:00:00.000Z",
    actorTipo: "USUARIO" as const,
    actorId: "P1",
    correlacionId: "COR1",
  });

  it("reusa la lectura previa cuando fue completa, sin consultar nada", async () => {
    // Si no trunco, contiene todo el rango: preguntarle otra vez a DynamoDB
    // daria el mismo conjunto y seria gasto puro.
    const falso = crearClienteFalso();

    const resultado = await consultarPorTipoDeEvento(
      {
        desde: "2026-09-08",
        hasta: "2026-09-08",
        tipo: "LOTE_ADJUDICADO",
        yaLeido: {
          eventos: [
            dto("E1", "LOTE_ADJUDICADO"),
            dto("E2", "SOLICITUD_CREADA"),
            dto("E3", "LOTE_ADJUDICADO"),
          ] as never,
          truncada: false,
        },
      },
      { cliente: falso.cliente as never },
    );

    expect(falso.comandos).toHaveLength(0);
    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["E1", "E3"]);
    expect(resultado.ok && resultado.data.truncada).toBe(false);
  });

  it("**no reusa una lectura truncada**: vuelve a preguntar con el filtro", async () => {
    // El defecto que midio el sandbox: reusando la lectura truncada,
    // `LOTE_ADJUDICADO` devolvia 483 filas de las 841 que hay en el rango, y
    // encima marcadas como truncadas — que le dice al auditor "acota el
    // rango" cuando lo que faltaba era ampliar la lectura.
    const falso = crearClienteFalso({
      responder: () => ({
        Items: [
          {
            PK: "AUDIT#LOTE#L1",
            SK: "2026-09-08T18:00:00.000Z#E-VIEJO",
            eventoId: "E-VIEJO",
            tipo: "LOTE_ADJUDICADO",
            ocurridoEn: "2026-09-08T18:00:00.000Z",
            actorTipo: "USUARIO",
            actorId: "P1",
            correlacionId: "COR1",
          },
        ],
      }),
    });

    const resultado = await consultarPorTipoDeEvento(
      {
        desde: "2026-09-08",
        hasta: "2026-09-08",
        tipo: "LOTE_ADJUDICADO",
        yaLeido: {
          eventos: [dto("E-RECIENTE", "LOTE_ADJUDICADO")] as never,
          truncada: true,
        },
      },
      { cliente: falso.cliente as never },
    );

    expect(falso.comandos).toHaveLength(1);
    expect(falso.comandos[0]?.input.FilterExpression).toBe("#tipo = :tipo");
    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["E-VIEJO"]);
  });

  it("sin lectura previa consulta con el filtro", async () => {
    const falso = crearClienteFalso({ responder: () => ({ Items: [] }) });

    await consultarPorTipoDeEvento(
      { desde: "2026-09-08", hasta: "2026-09-08", tipo: "PAGO_RECHAZADO" },
      { cliente: falso.cliente as never },
    );

    expect(falso.comandos).toHaveLength(1);
    expect(falso.comandos[0]?.input.FilterExpression).toBe("#tipo = :tipo");
  });
});

describe("consultarBitacoraGlobal acotada a un tipo de registro", () => {
  it("filtra por el prefijo de la PK, que es donde vive el tipo", async () => {
    // El tipo de agregado no es un atributo del evento: esta en la clave de la
    // particion. `begins_with(PK, ...)` es la unica forma de acotarlo sin
    // traerse el dia entero.
    const falso = crearClienteFalso({ responder: () => ({ Items: [] }) });

    await consultarBitacoraGlobal(
      { desde: "2026-09-08", hasta: "2026-09-08", agregado: "VEHICULO" },
      { cliente: falso.cliente as never },
    );

    expect(falso.comandos[0]?.input.FilterExpression).toBe(
      "begins_with(#PK, :prefijoDeAgregado)",
    );
    expect(falso.comandos[0]?.input.ExpressionAttributeNames).toEqual({
      "#PK": "PK",
    });
    expect(
      (
        falso.comandos[0]?.input.ExpressionAttributeValues as Record<
          string,
          unknown
        >
      )[":prefijoDeAgregado"],
    ).toBe("AUDIT#VEHICULO#");
  });

  it("el prefijo lleva el # final, para no casar con un tipo que empiece igual", async () => {
    const falso = crearClienteFalso({ responder: () => ({ Items: [] }) });

    await consultarBitacoraGlobal(
      { desde: "2026-09-08", hasta: "2026-09-08", agregado: "SOLICITUD" },
      { cliente: falso.cliente as never },
    );

    expect(
      (
        falso.comandos[0]?.input.ExpressionAttributeValues as Record<
          string,
          unknown
        >
      )[":prefijoDeAgregado"],
    ).toBe("AUDIT#SOLICITUD#");
  });

  it("se combina con el filtro de tipo de evento", async () => {
    const falso = crearClienteFalso({ responder: () => ({ Items: [] }) });

    await consultarBitacoraGlobal(
      {
        desde: "2026-09-08",
        hasta: "2026-09-08",
        tipo: "VEHICULO_EDITADO",
        agregado: "VEHICULO",
      },
      { cliente: falso.cliente as never },
    );

    expect(falso.comandos[0]?.input.FilterExpression).toBe(
      "#tipo = :tipo AND begins_with(#PK, :prefijoDeAgregado)",
    );
  });
});
