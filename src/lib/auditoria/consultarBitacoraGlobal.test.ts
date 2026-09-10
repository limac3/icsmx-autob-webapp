// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import {
  consultarBitacoraGlobal,
  LIMITE_DE_EVENTOS_GLOBAL,
  type BusquedaGlobal,
} from "./consultarBitacoraGlobal";

vi.mock("server-only", () => ({}));

// Lo que estas pruebas vigilan, y por que en este orden:
//
//   1. **Que indice y que particion** resuelve cada criterio. Es la propiedad
//      central de la Etapa 11.2: si un criterio cae en un `FilterExpression`
//      sobre la bitacora entera, la pantalla vuelve a ser lenta y a responder
//      de menos sin avisar. Un indice equivocado no falla: devuelve cero.
//   2. **La cota del rango**, en hora de negocio y con limite superior
//      exclusivo. Es el defecto de la seccion 44: la misma pregunta devolvia
//      dos conjuntos distintos segun el modo de consulta.
//   3. **La direccion de la lectura.** Seccion 46: el truncamiento tiene que
//      llevarse lo mas viejo, y para eso se lee de nuevo a viejo.

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

/** La particion que pidio un comando. */
const particionDe = (comando: ComandoEnviado): string =>
  String(
    (comando.input.ExpressionAttributeValues as Record<string, unknown>)[
      ":particion"
    ],
  );

const valoresDe = (comando: ComandoEnviado): Record<string, unknown> =>
  comando.input.ExpressionAttributeValues as Record<string, unknown>;

const cliente = (falso: ReturnType<typeof crearClienteFalso>) => ({
  cliente: falso.cliente as never,
});

const vacio = () => crearClienteFalso({ responder: () => ({ Items: [] }) });

describe("la cota del rango, comun a las cuatro consultas", () => {
  // Se prueba sobre GSI6 porque el rango se acota igual en los tres indices que
  // particionan por mes, y `condicionDeRango` es un solo lugar. Lo que se
  // afirma aqui es la **cota**, no el indice.
  const conTipo = {
    desde: "2026-09-06",
    hasta: "2026-09-08",
    tipo: "LOTE_ADJUDICADO",
  } as const;

  it("un rango de tres dias dentro de un mes es una sola consulta", async () => {
    // Antes eran tres —una por dia—, y con 90 dias serian 90. Es el cambio que
    // vuelve sostenible el tope nuevo.
    const falso = vacio();

    await consultarBitacoraGlobal(conTipo, cliente(falso));

    expect(falso.comandos).toHaveLength(1);
  });

  it("recorre los meses del mas nuevo al mas viejo", async () => {
    const falso = vacio();

    await consultarBitacoraGlobal(
      { desde: "2026-08-20", hasta: "2026-10-05", tipo: "LOTE_ADJUDICADO" },
      cliente(falso),
    );

    expect(falso.comandos.map(particionDe)).toEqual([
      "TIPO#LOTE_ADJUDICADO#2026-10",
      "TIPO#LOTE_ADJUDICADO#2026-09",
      "TIPO#LOTE_ADJUDICADO#2026-08",
    ]);
  });

  it("acota con la medianoche de Mexico, no con la de UTC", async () => {
    // Mexico esta seis horas detras de UTC, asi que el dia de negocio del 6 de
    // septiembre empieza a las 06:00Z. Comparar contra `2026-09-06T00:00:00Z`
    // metería en el rango seis horas del dia anterior — y devolveria un
    // conjunto distinto al de la busqueda por identificador, que compara en
    // dias de negocio (seccion 44).
    const falso = vacio();

    await consultarBitacoraGlobal(
      { desde: "2026-09-06", hasta: "2026-09-07", tipo: "LOTE_ADJUDICADO" },
      cliente(falso),
    );

    expect(valoresDe(falso.comandos[0]!)).toMatchObject({
      ":desdeCrono": "2026-09-06T06:00:00.000Z",
      // Exclusivo del instante, y por eso es la medianoche del **8**: el ultimo
      // dia del rango entra completo.
      ":hastaCrono": "2026-09-08T06:00:00.000Z",
    });
  });

  it("es BETWEEN, porque DynamoDB admite una sola condicion por clave", async () => {
    // `cronoSK >= :a AND cronoSK < :b` se rechaza con ValidationException, y un
    // doble de cliente no lo detecta: acepta cualquier cadena. Ver
    // `desafios-implementacion.md` 51.
    //
    // `BETWEEN` es inclusivo y aun asi la cota queda exclusiva del instante:
    // `cronoSK` es `<ocurridoEn>#<eventoId>` y toda cadena ordena despues que
    // su prefijo. Por eso no hace falta ningun centinela `U+FFFF`.
    const falso = vacio();

    await consultarBitacoraGlobal(conTipo, cliente(falso));

    const condicion = String(falso.comandos[0]?.input.KeyConditionExpression);
    expect(condicion).toContain("cronoSK BETWEEN :desdeCrono AND :hastaCrono");
    expect(condicion).not.toContain(">=");
    expect(String(valoresDe(falso.comandos[0]!)[":hastaCrono"])).not.toContain(
      "￿",
    );
  });
});

describe("el criterio es obligatorio", () => {
  it("un rango sin criterio no compila", () => {
    // No hay indice que responda "todo el rango": el cronologico se borro por
    // no tener lector. Que el tipo lo impida es lo que evita descubrirlo como
    // un ValidationException en runtime sobre codigo que compilaba.
    //
    // @ts-expect-error -- falta tipo, actorId o agregado. Si algun dia esto
    // deja de ser un error, el servicio volvio a aceptar una busqueda que no
    // puede responder.
    const sinCriterio: BusquedaGlobal = {
      desde: "2026-09-06",
      hasta: "2026-09-08",
    };

    expect(sinCriterio.desde).toBe("2026-09-06");
  });
});

describe("por tipo de evento: GSI6", () => {
  it("el tipo es parte de la particion, no un filtro", async () => {
    // Esta es la diferencia que corrige el defecto de las 483 filas contra
    // 841: con el tipo en la clave, la consulta no puede responder de menos.
    const falso = vacio();

    await consultarBitacoraGlobal(
      { desde: "2026-09-06", hasta: "2026-09-08", tipo: "LOTE_ADJUDICADO" },
      cliente(falso),
    );

    expect(falso.comandos[0]?.input).toMatchObject({
      IndexName: "GSI6",
      KeyConditionExpression:
        "tipoPK = :particion AND cronoSK BETWEEN :desdeCrono AND :hastaCrono",
    });
    expect(particionDe(falso.comandos[0]!)).toBe(
      "TIPO#LOTE_ADJUDICADO#2026-09",
    );
    expect(falso.comandos[0]?.input.FilterExpression).toBeUndefined();
  });
});

describe("por persona que firmo: GSI9", () => {
  it("la persona y el mes son la particion", async () => {
    const falso = vacio();

    await consultarBitacoraGlobal(
      { desde: "2026-09-06", hasta: "2026-09-08", actorId: "P7" },
      cliente(falso),
    );

    expect(falso.comandos[0]?.input).toMatchObject({
      IndexName: "GSI9",
      KeyConditionExpression:
        "actorMesPK = :particion AND cronoSK BETWEEN :desdeCrono AND :hastaCrono",
    });
    expect(particionDe(falso.comandos[0]!)).toBe("ACTOR#P7#2026-09");
    expect(falso.comandos[0]?.input.FilterExpression).toBeUndefined();
  });
});

describe("por tipo de registro: GSI7, un dia por particion", () => {
  it("usa begins_with sobre la clave de ordenamiento del dia", async () => {
    // Por dia y no por mes, y no es rendimiento: una opcion "activa en el mes
    // pero no en el rango" devolveria una tabla vacia, que es justo lo que
    // estas listas existen para evitar.
    const falso = vacio();

    await consultarBitacoraGlobal(
      { desde: "2026-09-06", hasta: "2026-09-08", agregado: "VEHICULO" },
      cliente(falso),
    );

    expect(falso.comandos).toHaveLength(3);
    expect(falso.comandos.map(particionDe)).toEqual([
      "DIA#2026-09-08",
      "DIA#2026-09-07",
      "DIA#2026-09-06",
    ]);
    expect(falso.comandos[0]?.input).toMatchObject({
      IndexName: "GSI7",
      KeyConditionExpression:
        "diaPK = :particion AND begins_with(agregadoSK, :prefijo)",
    });
    expect(valoresDe(falso.comandos[0]!)[":prefijo"]).toBe("VEHICULO#");
  });

  it("ordena en memoria, porque el indice ordena por identificador y no por tiempo", async () => {
    // GSI7 agrupa por valor antes que por tiempo — es lo que permite el salto
    // de las opciones—, asi que dentro de un dia los eventos **no** vienen
    // cronologicos. Es el unico indice donde hay que ordenar, y hay que
    // decirlo: sin este orden la tabla mezclaria las horas.
    const falso = crearClienteFalso({
      responder: () => ({
        Items: [
          evento("E9", "2026-09-06T20:00:00.000Z"),
          evento("E1", "2026-09-06T08:00:00.000Z"),
          evento("E5", "2026-09-06T12:00:00.000Z"),
        ],
      }),
    });

    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-09-06", hasta: "2026-09-06", agregado: "LOTE" },
      cliente(falso),
    );

    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["E1", "E5", "E9"]);
  });

  it("el tipo de evento es el unico filtro residual legitimo", async () => {
    // GSI7 particiona por dia y ordena por agregado: el tipo de evento no cabe
    // en su clave. El filtro se aplica sobre una lectura ya restringida a un
    // dia y a un tipo de registro, no sobre la bitacora entera.
    const falso = vacio();

    await consultarBitacoraGlobal(
      {
        desde: "2026-09-06",
        hasta: "2026-09-06",
        agregado: "LOTE",
        tipo: "LOTE_ADJUDICADO",
      },
      cliente(falso),
    );

    expect(falso.comandos[0]?.input).toMatchObject({
      IndexName: "GSI7",
      FilterExpression: "#tipo = :tipoResidual",
    });
    expect(valoresDe(falso.comandos[0]!)[":tipoResidual"]).toBe(
      "LOTE_ADJUDICADO",
    );
  });
});

describe("orden y truncamiento", () => {
  it("devuelve ascendente lo que se leyo descendente", async () => {
    const falso = crearClienteFalso({
      responder: () => ({
        Items: [
          evento("E2", "2026-09-07T18:00:00.000Z"),
          evento("E1", "2026-09-06T18:00:00.000Z"),
        ],
      }),
    });

    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-09-06", hasta: "2026-09-07", tipo: "LOTE_ADJUDICADO" },
      cliente(falso),
    );

    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["E1", "E2"]);
  });

  it("cuando trunca conserva lo mas reciente y descarta lo mas viejo", async () => {
    // Seccion 46: la primera version leia ascendente y el corte escondia
    // justamente lo de hoy. Una prueba que solo cuente cuantos sobreviven no
    // detecta eso; hay que afirmar **cuales**.
    const porMes = new Map<string, unknown[]>([
      [
        "TIPO#LOTE_ADJUDICADO#2026-10",
        Array.from({ length: LIMITE_DE_EVENTOS_GLOBAL }, (_, i) =>
          evento(`NUEVO${i}`, "2026-10-05T18:00:00.000Z"),
        ),
      ],
      [
        "TIPO#LOTE_ADJUDICADO#2026-09",
        [evento("VIEJO", "2026-09-20T18:00:00.000Z")],
      ],
    ]);
    const falso = crearClienteFalso({
      responder: (comando) => ({
        Items: porMes.get(particionDe(comando)) ?? [],
      }),
    });

    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-09-20", hasta: "2026-10-05", tipo: "LOTE_ADJUDICADO" },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.truncada).toBe(true);
    const ids = resultado.ok
      ? resultado.data.eventos.map((e) => e.eventoId)
      : [];
    expect(ids).toHaveLength(LIMITE_DE_EVENTOS_GLOBAL);
    expect(ids).not.toContain("VIEJO");
  });

  it("un rango que cabe justo no se reporta como truncado", async () => {
    // Se pide un evento mas que el cupo para poder distinguir los dos casos.
    const falso = crearClienteFalso({
      responder: () => ({
        Items: Array.from({ length: LIMITE_DE_EVENTOS_GLOBAL }, (_, i) =>
          evento(`E${i}`, "2026-09-06T18:00:00.000Z"),
        ),
      }),
    });

    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-09-06", hasta: "2026-09-06", tipo: "LOTE_ADJUDICADO" },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.truncada).toBe(false);
    expect(resultado.ok && resultado.data.eventos).toHaveLength(
      LIMITE_DE_EVENTOS_GLOBAL,
    );
  });

  it("deja de consultar particiones en cuanto se llena el cupo", async () => {
    // En secuencia y no en paralelo: leerlas a la vez obligaria a traer hasta
    // el cupo de cada una para quedarse con el cupo total.
    const falso = crearClienteFalso({
      responder: () => ({
        Items: Array.from({ length: LIMITE_DE_EVENTOS_GLOBAL + 1 }, (_, i) =>
          evento(`E${i}`, "2026-10-05T18:00:00.000Z"),
        ),
      }),
    });

    // 88 dias: cuatro meses distintos y dentro del maximo de 90.
    await consultarBitacoraGlobal(
      { desde: "2026-07-10", hasta: "2026-10-05", tipo: "LOTE_ADJUDICADO" },
      cliente(falso),
    );

    // Cuatro particiones en el rango y una sola consulta gastada.
    expect(falso.comandos).toHaveLength(1);
  });

  it("descarta un item que no se puede interpretar, sin perder los demas", async () => {
    const falso = crearClienteFalso({
      responder: () => ({
        Items: [
          evento("E2", "2026-09-06T18:00:00.000Z"),
          { PK: "AUDIT#LOTE#L1", SK: "corrupto" },
        ],
      }),
    });

    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-09-06", hasta: "2026-09-06", tipo: "LOTE_ADJUDICADO" },
      cliente(falso),
    );

    expect(
      resultado.ok && resultado.data.eventos.map((e) => e.eventoId),
    ).toEqual(["E2"]);
  });
});

describe("rangos que no se ejecutan", () => {
  it("rechaza un rango invertido sin tocar DynamoDB", async () => {
    const falso = vacio();
    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-09-08", hasta: "2026-09-06", tipo: "LOTE_ADJUDICADO" },
      cliente(falso),
    );

    expect(resultado.ok).toBe(false);
    expect(falso.comandos).toHaveLength(0);
  });

  it("rechaza un dia que no existe", async () => {
    const falso = vacio();
    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-02-30", hasta: "2026-03-02", tipo: "LOTE_ADJUDICADO" },
      cliente(falso),
    );

    expect(resultado.ok).toBe(false);
    expect(falso.comandos).toHaveLength(0);
  });

  it("rechaza un rango mas largo que el maximo, aunque quien llame no valide", async () => {
    // Segunda linea de defensa: una action nueva que olvide validar no puede
    // convertir la pantalla en cientos de consultas.
    const falso = vacio();
    const resultado = await consultarBitacoraGlobal(
      { desde: "2026-01-01", hasta: "2026-12-31", tipo: "LOTE_ADJUDICADO" },
      cliente(falso),
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("validation_failed");
    expect(falso.comandos).toHaveLength(0);
  });
});
