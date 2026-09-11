// @vitest-environment node
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { clave, PREFIJO, turnoDesdeClave } from "@/lib/data/claves";
import type { DepsDeServicio } from "@/lib/data/deps";
import type { ActorUsuario } from "@/types/auditoria";
import type { Lote } from "@/types/lote";
import { adjudicarLote } from "./adjudicarLote";
import { cancelarSolicitud } from "./cancelarSolicitud";
import { cerrarFilaDelLote } from "./cerrarFilaDelLote";
import { consultarMiLugar, leerMiSolicitud } from "./consultarMiLugar";
import { solicitarCompra } from "./solicitarCompra";
import { puedeUsarBackendReal } from "@/utils/backendUtilizable";

vi.mock("server-only", () => ({}));

/**
 * Prueba de concurrencia de la fila — **la regresion permanente de la regla
 * 16**, sobre el codigo de produccion y contra DynamoDB real.
 *
 * No sustituye al prototipo de la Etapa 4.1 ni lo repite: aquel comparaba tres
 * disenos para **decidir** cual implementar, y por eso vive detras de una
 * bandera. Este comprueba que el diseno elegido sigue cumpliendo lo que
 * prometio, y por eso corre en la compuerta.
 *
 * Lo que solo puede decidirse aqui, y no con un doble del cliente:
 *
 *  - que el contador atomico entregue turnos unicos bajo rafaga real;
 *  - que la escritura condicional deje pasar exactamente un ganador;
 *  - que N solicitudes simultaneas entren **las N**, sin cancelarse entre si;
 *  - que la reserva de turno cierre R18 con una pausa deliberada de por medio.
 *
 * Un doble solo comprobaria que el doble coincide consigo mismo.
 *
 * **Se omite —no falla— cuando no hay `amplify_outputs.json` ni credenciales**:
 * la compuerta tiene que poder correr en una maquina sin AWS, y una prueba que
 * falla por falta de infraestructura deja de distinguir "roto" de "no
 * desplegado".
 *
 *   npx ampx sandbox        # en otra terminal
 *   npx vitest run src/lib/fila/fila.integracion.test.ts
 *
 * Repeticiones de la rafaga: `FILA_REPETICIONES` (por omision 2). "Todo test de
 * concurrencia se ejecuta varias veces. Uno que pasa una vez no prueba nada"
 * (estrategia-aplicacion.md 7).
 */

// Margen amplio a proposito. La rafaga tarda unos 5 s contra el sandbox, pero
// una tabla bajo demanda que lleva rato fria estrangula la primera rafaga y el
// SDK reintenta con retroceso: se ha medido una de 60 s. Un limite ajustado
// convertiria esa lentitud transitoria en un fallo de la compuerta, que es
// justo el resultado intermitente que esta etapa no admite.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

type SalidasAutob = { tabla?: string; rolComputoSsr?: string };

const RUTA_SALIDAS = join(process.cwd(), "amplify_outputs.json");

const leerSalidas = (): SalidasAutob | null => {
  if (!existsSync(RUTA_SALIDAS)) return null;
  const salidas = JSON.parse(readFileSync(RUTA_SALIDAS, "utf8")) as {
    custom?: { autob?: SalidasAutob };
  };
  return salidas.custom?.autob ?? null;
};

const salidas = leerSalidas();
const hayBackend = puedeUsarBackendReal(salidas);

const REPETICIONES = Number(process.env.FILA_REPETICIONES ?? "2");
const PARTICIPANTES = 6;
const HORAS_LIQUIDACION = 48;

const actorDe = (participanteId: string): ActorUsuario => ({
  tipo: "USUARIO",
  id: participanteId,
  permisos: ["Autob_Venta_a_empleados"],
});

/**
 * Sufijo de la corrida. **Ningun identificador de participante se repite entre
 * ejecuciones**, y no es cosmetico: el centinela
 * `PART#<id> / ADJUDICACION_ACTIVA` sobrevive al lote —tiene que hacerlo, es lo
 * que garantiza R-09— asi que reutilizar un identificador hace que la corrida
 * siguiente encuentre a ese participante con una adjudicacion activa y lo
 * congele. Paso: la prueba fallaba con `fila_agotada` mientras el sistema hacia
 * exactamente lo correcto.
 */
const CORRIDA = randomUUID().slice(0, 8);

/**
 * Cliente que retrasa **solo** la transaccion, para abrir la ventana de R18 a
 * voluntad.
 *
 * Se envuelve el cliente en vez de exponer un gancho de pausa en
 * `solicitarCompra`: el codigo de produccion no debe tener parametros que solo
 * existan para las pruebas, y la pausa que interesa esta entre dos llamadas al
 * SDK, que es justo donde este envoltorio puede ponerla.
 */
const clienteConPausa = (
  original: DynamoDBDocumentClient,
  ms: number,
): DynamoDBDocumentClient => {
  const enviar = original.send.bind(original);
  return {
    send: async (comando: object): Promise<unknown> => {
      if (comando.constructor.name === "TransactWriteCommand") {
        await new Promise((continuar) => setTimeout(continuar, ms));
      }
      return enviar(comando as never);
    },
  } as unknown as DynamoDBDocumentClient;
};

describe.skipIf(!hayBackend)("motor de fila contra DynamoDB real", () => {
  let dynamo: DynamoDBClient;
  let cliente: DynamoDBDocumentClient;
  let deps: DepsDeServicio;
  const particionesCreadas = new Set<string>();

  beforeAll(async () => {
    vi.stubEnv("AUTOB_TABLE_NAME", salidas!.tabla!);

    // Se asume el rol real de computo SSR y no las credenciales del
    // desarrollador: asi la prueba ejerce **la politica IAM que corre en
    // produccion**, incluida la que deniega tocar la bitacora.
    const sesion = await new STSClient({}).send(
      new AssumeRoleCommand({
        RoleArn: salidas!.rolComputoSsr!,
        RoleSessionName: "prueba-fila-etapa8",
        DurationSeconds: 3600,
      }),
    );

    const credenciales = sesion.Credentials;
    if (!credenciales?.AccessKeyId || !credenciales.SecretAccessKey) {
      throw new Error(
        "STS no devolvio credenciales para el rol de computo SSR.",
      );
    }

    dynamo = new DynamoDBClient({
      credentials: {
        accessKeyId: credenciales.AccessKeyId,
        secretAccessKey: credenciales.SecretAccessKey,
        sessionToken: credenciales.SessionToken,
      },
    });
    cliente = DynamoDBDocumentClient.from(dynamo, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: false,
      },
      unmarshallOptions: { wrapNumbers: false },
    });
    deps = { cliente };
  });

  afterAll(async () => {
    // Los items `AUDIT#` **no** se purgan: el rol tiene denegado `DeleteItem`
    // sobre ellos, que es justo la garantia de la Etapa 3. Quedan como rastro
    // de las corridas, que es lo que una bitacora debe hacer.
    await Promise.all(
      [...particionesCreadas].map(async (pk) => {
        const items = await cliente.send(
          new QueryCommand({
            TableName: process.env.AUTOB_TABLE_NAME,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": pk },
            ConsistentRead: true,
          }),
        );
        await Promise.all(
          (items.Items ?? []).map(async (item) =>
            cliente.send(
              new DeleteCommand({
                TableName: process.env.AUTOB_TABLE_NAME,
                Key: { PK: item.PK, SK: item.SK },
              }),
            ),
          ),
        );
      }),
    );
    dynamo?.destroy();
    vi.unstubAllEnvs();
  });

  /**
   * Un participante de esta corrida, con su particion registrada para la
   * purga: el centinela de adjudicacion vive en `PART#<id>`, fuera de las
   * particiones del lote.
   */
  const participante = (nombre: string): string => {
    const id = `e8-${nombre}-${CORRIDA}`;
    particionesCreadas.add(clave.centinelaAdjudicacion(id).PK);
    return id;
  };

  // --- Escenario -------------------------------------------------------------

  /**
   * Convocatoria publicada, con la venta abierta y un lote con su vehiculo.
   *
   * El lote lleva los atributos desnormalizados de la convocatoria porque son
   * los que mira la condicion del paso 1 de T1: leer la convocatoria y decidir
   * despues seria la carrera que el diseno evita (modelo-datos 1).
   */
  const crearEscenario = async (): Promise<Lote> => {
    const tabla = process.env.AUTOB_TABLE_NAME;
    const sufijo = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const convocatoriaId = `e8-conv-${sufijo}`;
    const loteId = `e8-lote-${sufijo}`;
    const vehiculoId = `e8-veh-${sufijo}`;
    const ahora = new Date();

    const ventana = {
      publicadaEn: new Date(ahora.getTime() - 7_200_000).toISOString(),
      inicioVenta: new Date(ahora.getTime() - 3_600_000).toISOString(),
      finVenta: new Date(ahora.getTime() + 86_400_000).toISOString(),
    };

    await cliente.send(
      new PutCommand({
        TableName: tabla,
        Item: {
          ...clave.convocatoria(convocatoriaId),
          estatus: "PUBLICADA",
          tipo: "EMPLEADOS",
          ...ventana,
        },
      }),
    );
    await cliente.send(
      new PutCommand({
        TableName: tabla,
        Item: {
          ...clave.vehiculo(vehiculoId),
          vehiculoId,
          marca: "Nissan",
          version: "NP300",
          modelo: 2019,
          kilometraje: 120_000,
          estatus: "EN_CONVOCATORIA",
          convocatoriaId,
          creadoEn: ventana.publicadaEn,
          creadoPor: "ADMIN",
        },
      }),
    );

    const lote: Lote = {
      loteId,
      convocatoriaId,
      vehiculoId,
      precio: 180_000,
      estatus: "EN_OFERTA",
      contadorTurnos: 0,
      inicioVenta: ventana.inicioVenta,
      finVenta: ventana.finVenta,
      tipoConvocatoria: "EMPLEADOS",
      estatusConvocatoria: "PUBLICADA",
      horasLiquidacion: HORAS_LIQUIDACION,
      creadoEn: ventana.publicadaEn,
      creadoPor: "ADMIN",
    };

    await cliente.send(
      new PutCommand({
        TableName: tabla,
        Item: { ...clave.lote(convocatoriaId, loteId), ...lote },
      }),
    );

    particionesCreadas.add(clave.convocatoria(convocatoriaId).PK);
    particionesCreadas.add(clave.vehiculo(vehiculoId).PK);
    particionesCreadas.add(clave.solicitud(loteId, 0).PK);
    return lote;
  };

  /** La fila tal como la ve PA-07: turnos en orden, con su estado. */
  const leerFila = async (loteId: string) => {
    const salida = await cliente.send(
      new QueryCommand({
        TableName: process.env.AUTOB_TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefijo)",
        ExpressionAttributeValues: {
          ":pk": clave.solicitud(loteId, 0).PK,
          ":prefijo": PREFIJO.solicitud,
        },
        ScanIndexForward: true,
        ConsistentRead: true,
      }),
    );
    return (salida.Items ?? []).map((item) => ({
      turno: turnoDesdeClave(String(item.SK)),
      estatus: String(item.estatus),
      participanteId: String(item.participanteId),
    }));
  };

  const leerLote = async (lote: Lote) => {
    const salida = await cliente.send(
      new GetCommand({
        TableName: process.env.AUTOB_TABLE_NAME,
        Key: clave.lote(lote.convocatoriaId, lote.loteId),
        ConsistentRead: true,
      }),
    );
    return salida.Item ?? {};
  };

  const leerBitacora = async (loteId: string) => {
    const salida = await cliente.send(
      new QueryCommand({
        TableName: process.env.AUTOB_TABLE_NAME,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `AUDIT#LOTE#${loteId}` },
        ConsistentRead: true,
      }),
    );
    return (salida.Items ?? []).map((item) => String(item.tipo));
  };

  /**
   * Rafaga: N participantes solicitan a la vez, cada uno adjudicando al final.
   *
   * `grupo` distingue a los participantes de cada ronda. **Sin el, la ronda 2
   * reusaria a los de la ronda 1 y el ganador anterior llegaria con una
   * adjudicacion activa**: R-09 lo congelaria y el lote pasaria al turno
   * siguiente, que es lo correcto y no lo que esta prueba mide.
   */
  const rafaga = async (lote: Lote, grupo: string, cuantos = PARTICIPANTES) =>
    Promise.all(
      Array.from({ length: cuantos }, async (_, i) => {
        const participanteId = participante(`${grupo}-${String(i)}`);
        return solicitarCompra(
          { lote, participanteId, actor: actorDe(participanteId) },
          deps,
        );
      }),
    );

  // --- Las invariantes obligatorias -----------------------------------------

  describe.each(Array.from({ length: REPETICIONES }, (_, i) => i + 1))(
    "rafaga %i — participantes simultaneos sobre el mismo lote",
    (ronda: number) => {
      let lote: Lote;
      let resultados: Awaited<ReturnType<typeof rafaga>>;

      beforeAll(async () => {
        // **La rafaga entrelaza solicitud y adjudicacion por construccion**:
        // cada participante intenta adjudicar en cuanto termina, que es lo que
        // ocurre de verdad en `inicioVenta`.
        lote = await crearEscenario();
        resultados = await rafaga(lote, `r${String(ronda)}`);
      });

      it("entran las N: un rechazo por contencion seria un defecto de diseno", async () => {
        // Un participante rechazado con `conflicto_concurrencia` en el unico
        // instante en que todos llegan a la vez no es una carrera aceptable. Es
        // lo que hundio a la variante descartada de R18, que perdia entre 5 y 9
        // de cada 10.
        expect(resultados.filter((r) => !r.ok)).toEqual([]);
        expect(await leerFila(lote.loteId)).toHaveLength(PARTICIPANTES);
      });

      it("los turnos son unicos", async () => {
        // Dos participantes con el mismo turno serian dos duenos del mismo
        // lugar en la fila.
        const turnos = resultados.map((r) => (r.ok ? r.data.turno : 0));
        expect(new Set(turnos).size).toBe(turnos.length);
      });

      it("la fila se lee en orden estricto de turno", async () => {
        // La `Query` la devuelve ordenada por construccion —el relleno de ceros
        // de la `SK`—, asi que esto comprueba que las claves se armaron bien.
        // Los huecos son legitimos; el desorden y los repetidos no.
        const enFila = (await leerFila(lote.loteId)).map((s) => s.turno ?? 0);
        expect([...enFila].sort((a, b) => a - b)).toEqual(enFila);
        expect(new Set(enFila).size).toBe(enFila.length);
      });

      it("exactamente un participante gana el lote", async () => {
        const ganadores = resultados.filter(
          (r) => r.ok && r.data.adjudicacion.estado === "adjudicado",
        );
        expect(ganadores).toHaveLength(1);

        const fila = await leerFila(lote.loteId);
        expect(fila.filter((s) => s.estatus === "ADJUDICADA")).toHaveLength(1);

        const item = await leerLote(lote);
        expect(item.estatus).toBe("ADJUDICADO");
        expect(typeof item.adjudicacionActual).toBe("string");
      });

      it("gana el turno menor de la fila", async () => {
        const fila = await leerFila(lote.loteId);
        const adjudicada = fila.find((s) => s.estatus === "ADJUDICADA");
        const menor = Math.min(...fila.map((s) => s.turno ?? 0));
        expect(adjudicada?.turno).toBe(menor);
      });

      it("intentar adjudicar de nuevo no produce un segundo ganador", async () => {
        // La exclusion mutua no depende de que nadie vuelva a intentarlo.
        const intentos = await Promise.all(
          Array.from({ length: PARTICIPANTES }, async () =>
            adjudicarLote({ lote, motivo: "PRIMERA_ADJUDICACION" }, deps),
          ),
        );

        expect(intentos.every((r) => r.estado === "no_adjudicable")).toBe(true);
        const fila = await leerFila(lote.loteId);
        expect(fila.filter((s) => s.estatus === "ADJUDICADA")).toHaveLength(1);
      });
    },
  );

  it("gana el turno menor, no el que solicito antes en el reloj (R-08)", async () => {
    // Los dos `solicitadoEn` se escriben deliberadamente al reves del turno.
    // Si algo del sistema ordenara por tiempo, ganaria el segundo.
    const lote = await crearEscenario();
    const ahora = new Date();
    const enElFuturo = new Date(ahora.getTime() + 600_000);

    const primero = await solicitarCompra(
      {
        lote,
        participanteId: participante("tarde"),
        actor: actorDe(participante("tarde")),
      },
      { ...deps, ahora: () => enElFuturo },
    );
    const segundo = await solicitarCompra(
      {
        lote,
        participanteId: participante("temprano"),
        actor: actorDe(participante("temprano")),
      },
      { ...deps, ahora: () => ahora },
    );

    if (!primero.ok || !segundo.ok) throw new Error("se esperaban dos turnos");
    expect(primero.data.turno).toBeLessThan(segundo.data.turno);

    const item = await leerLote(lote);
    expect(item.turnoAdjudicado).toBe(primero.data.turno);
    expect(item.adjudicacionActual).toBe(primero.data.solicitudId);
  });

  it("R18: un turno en vuelo detiene la adjudicacion hasta que aterriza", async () => {
    // **La prueba tiene que intercalar solicitud y adjudicacion.** Adjudicar
    // despues de que todas terminaron no ejerce la carrera: el prototipo lo
    // midio —en once rondas de rafaga contra el diseno defectuoso, gano el
    // turno 1 todas las veces— y por eso aqui hay una pausa deliberada.
    //
    // La pausa no inventa una condicion imposible: representa una pausa de GC,
    // un reintento del SDK o un arranque en frio.
    const lote = await crearEscenario();

    const lento = clienteConPausa(cliente, 1_500);
    const primeroLento = solicitarCompra(
      {
        lote,
        participanteId: participante("lento"),
        actor: actorDe(participante("lento")),
      },
      { cliente: lento },
    );

    // Se le da ventaja al segundo: pide su turno y completa su solicitud
    // mientras el primero sigue en vuelo.
    await new Promise((continuar) => setTimeout(continuar, 300));
    const segundoRapido = await solicitarCompra(
      {
        lote,
        participanteId: participante("rapido"),
        actor: actorDe(participante("rapido")),
      },
      deps,
    );

    const primero = await primeroLento;
    if (!primero.ok || !segundoRapido.ok) {
      throw new Error("se esperaban dos solicitudes");
    }

    expect(primero.data.turno).toBeLessThan(segundoRapido.data.turno);

    // Que el rapido se **abstuviera** es la prueba de que el mecanismo actuo, y
    // no de que la carrera simplemente no ocurrio esta vez.
    expect(segundoRapido.data.adjudicacion.estado).toBe("abstenido");

    // Y el vehiculo termina en el turno menor, que es lo que R-08 promete.
    const item = await leerLote(lote);
    expect(item.turnoAdjudicado).toBe(primero.data.turno);
  });

  it("la fila sigue abierta con el lote adjudicado (R-17)", async () => {
    const lote = await crearEscenario();
    const ganador = await solicitarCompra(
      {
        lote,
        participanteId: participante("ganador"),
        actor: actorDe(participante("ganador")),
      },
      deps,
    );
    if (!ganador.ok) throw new Error("se esperaba turno");
    expect(ganador.data.adjudicacion.estado).toBe("adjudicado");

    // Con `estatus = EN_OFERTA` a secas en la condicion del paso 1, esto
    // fallaria: la fila se habria cerrado en la primera adjudicacion y
    // `miPosicion`, `tamanoFila` y la reasignacion de R-15 no tendrian sentido.
    const tardio = await solicitarCompra(
      {
        lote,
        participanteId: participante("tardio"),
        actor: actorDe(participante("tardio")),
      },
      deps,
    );
    if (!tardio.ok) throw new Error("la fila deberia seguir abierta");
    expect(tardio.data.turno).toBe(ganador.data.turno + 1);
  });

  it("el DTO del lugar propio no contiene identidad de nadie (R-12)", async () => {
    const lote = await crearEscenario();
    await solicitarCompra(
      {
        lote,
        participanteId: participante("otro"),
        actor: actorDe(participante("otro")),
      },
      deps,
    );
    await solicitarCompra(
      {
        lote,
        participanteId: participante("yo"),
        actor: actorDe(participante("yo")),
      },
      deps,
    );

    const miLugar = await consultarMiLugar(
      { loteId: lote.loteId, participanteId: participante("yo") },
      deps,
    );
    if (!miLugar.ok || !miLugar.data) throw new Error("se esperaba un lugar");

    const serializado = JSON.stringify(miLugar.data);
    expect(serializado).not.toContain(participante("otro"));
    expect(serializado).not.toContain(participante("yo"));
    expect(miLugar.data.tamanoFila).toBe(2);
    expect(miLugar.data.miPosicion).toBe(2);
  });

  it("cada solicitud y cada adjudicacion dejan su evento", async () => {
    const lote = await crearEscenario();
    await rafaga(lote, "bitacora", 3);

    const eventos = await leerBitacora(lote.loteId);
    expect(eventos.filter((tipo) => tipo === "SOLICITUD_CREADA")).toHaveLength(
      3,
    );
    expect(eventos.filter((tipo) => tipo === "LOTE_ADJUDICADO")).toHaveLength(
      1,
    );
  });

  it("una transaccion cancelada no deja ni la mutacion ni su evento", async () => {
    // La otra cara de la regla 4: si la mutacion no ocurre, su evento tampoco.
    // Van en la misma `TransactWriteItems`, asi que la atomicidad no depende de
    // que nadie se olvide de nada.
    const lote = await crearEscenario();
    const participanteId = participante("duplicado");

    const primera = await solicitarCompra(
      { lote, participanteId, actor: actorDe(participanteId) },
      deps,
    );
    if (!primera.ok) throw new Error("se esperaba la primera solicitud");

    const segunda = await solicitarCompra(
      { lote, participanteId, actor: actorDe(participanteId) },
      deps,
    );

    // R-07: una sola solicitud viva por participante y lote.
    expect(segunda).toEqual({ ok: false, error: "already_in_queue" });

    const eventos = await leerBitacora(lote.loteId);
    expect(eventos.filter((tipo) => tipo === "SOLICITUD_CREADA")).toHaveLength(
      1,
    );

    // El turno consumido queda como hueco, que el diseno acepta: `ADD` es
    // atomico justamente porque no se puede deshacer.
    const fila = await leerFila(lote.loteId);
    expect(fila).toHaveLength(1);
  });

  it("cancelar una adjudicacion la reasigna al siguiente turno vivo", async () => {
    const lote = await crearEscenario();
    const ganador = await solicitarCompra(
      {
        lote,
        participanteId: participante("cancela"),
        actor: actorDe(participante("cancela")),
      },
      deps,
    );
    const siguiente = await solicitarCompra(
      {
        lote,
        participanteId: participante("hereda"),
        actor: actorDe(participante("hereda")),
      },
      deps,
    );
    if (!ganador.ok || !siguiente.ok)
      throw new Error("se esperaban dos turnos");

    const propia = await leerMiSolicitud(
      { loteId: lote.loteId, participanteId: participante("cancela") },
      deps,
    );
    if (!propia.ok || !propia.data) throw new Error("se esperaba la solicitud");
    expect(propia.data.estatus).toBe("ADJUDICADA");

    const cancelacion = await cancelarSolicitud(
      {
        lote: { ...lote, estatus: "ADJUDICADO" },
        solicitud: propia.data,
        actor: actorDe(participante("cancela")),
      },
      deps,
    );
    if (!cancelacion.ok) throw new Error("se esperaba cancelar");

    expect(cancelacion.data.liberoElLote).toBe(true);
    expect(cancelacion.data.reasignacion).toMatchObject({
      estado: "adjudicado",
      turno: siguiente.data.turno,
    });

    const item = await leerLote(lote);
    expect(item.turnoAdjudicado).toBe(siguiente.data.turno);

    // El centinela del que cancelo se retiro: puede volver a formarse, y
    // recibira un turno nuevo (R-07).
    const yaNo = await leerMiSolicitud(
      { loteId: lote.loteId, participanteId: participante("cancela") },
      deps,
    );
    if (!yaNo.ok) throw new Error("se esperaba lectura");
    expect(yaNo.data).toBeNull();
  });

  it("concluir cierra las filas y respeta la adjudicacion vigente (R-18)", async () => {
    const lote = await crearEscenario();
    const ganador = await solicitarCompra(
      {
        lote,
        participanteId: participante("gano"),
        actor: actorDe(participante("gano")),
      },
      deps,
    );
    const espera = await solicitarCompra(
      {
        lote,
        participanteId: participante("espera"),
        actor: actorDe(participante("espera")),
      },
      deps,
    );
    if (!ganador.ok || !espera.ok) throw new Error("se esperaban dos turnos");

    const cierre = await cerrarFilaDelLote(
      { lote, actor: actorDe("ADMIN") },
      deps,
    );
    if (!cierre.ok) throw new Error("se esperaba cerrar");
    expect(cierre.data).toBe(1);

    const fila = await leerFila(lote.loteId);
    const porTurno = new Map(fila.map((s) => [s.turno, s.estatus]));
    expect(porTurno.get(ganador.data.turno)).toBe("ADJUDICADA");
    expect(porTurno.get(espera.data.turno)).toBe("NO_ADJUDICADA");
  });
});
