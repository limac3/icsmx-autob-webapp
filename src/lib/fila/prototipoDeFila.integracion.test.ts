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
import {
  adjudicar,
  registrarSolicitud,
  reservarTurno,
  type DepsDeFila,
  type ResultadoDeAdjudicacion,
  type Variante,
} from "./prototipoDeFila";

vi.mock("server-only", () => ({}));

/**
 * Prototipo concurrente de la fila — riesgo R18.
 *
 * `plan-ejecucion.md` lo pone antes de la Etapa 8 con una condicion explicita:
 *
 * > **La prueba tiene que intercalar solicitud y adjudicacion.** Adjudicar solo
 * > despues de que todas las solicitudes terminaron no ejerce la carrera: con
 * > esa forma de prueba, el defecto pasa.
 *
 * Este arnes lo hace de dos maneras que se complementan:
 *
 *  1. **Carrera controlada.** Una pausa deliberada entre el paso 1 y el paso 2
 *     abre la ventana de R18 de par en par. Es determinista, asi que puede
 *     **afirmarse que la variante ingenua falla**. Sin esa afirmacion no habria
 *     manera de saber si el arnes ejerce la carrera o solo la esquiva.
 *  2. **Rafaga real.** N participantes concurrentes, cada uno adjudicando en
 *     cuanto termina. Mide la carrera con los tiempos que de verdad ocurren, y
 *     ademas somete cada variante a la contencion de escritura que solo
 *     aparece con concurrencia de verdad.
 *
 * La pausa no inventa una condicion imposible: representa una pausa de GC, un
 * reintento del SDK o un arranque en frio, y el momento de maxima concurrencia
 * es exactamente `inicioVenta`. Lo que la pausa cambia es la probabilidad, no
 * la posibilidad — y eso es justamente lo que la rafaga mide aparte.
 *
 * Corre contra el sandbox personal:
 *
 *   npx ampx sandbox        # en otra terminal
 *   npm run prototipo:fila
 *
 * **Se omite salvo que se pida con `PROTOTIPO_R18=1`**, y tambien cuando no hay
 * `amplify_outputs.json` o credenciales. Las dos omisiones tienen motivos
 * distintos y los dos importan:
 *
 *  - Sin AWS, la compuerta tiene que poder correr igual: una prueba que falla
 *    por falta de infraestructura deja de distinguir "roto" de "no desplegado".
 *  - Con AWS, tarda unos dos minutos. Meterla en `npm run verify:rapido`
 *    —que existe justamente porque 145 s se juzgo demasiado para cada
 *    iteracion— seria deshacer esa decision. Y no es una prueba de regresion:
 *    es el registro reproducible de una **decision de diseno**. La regresion
 *    permanente la aporta la prueba de concurrencia de la Etapa 8, sobre el
 *    `solicitarCompra.ts` de verdad, que si vive en la compuerta.
 *
 * Repeticiones de la rafaga: `PROTOTIPO_REPETICIONES` (por omision 3).
 * "Todo test de concurrencia se ejecuta varias veces. Uno que pasa una vez no
 * prueba nada" — estrategia-aplicacion.md seccion 7.
 */

vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });

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
const hayBackend = Boolean(salidas?.tabla && salidas?.rolComputoSsr);
const seSolicito = process.env.PROTOTIPO_R18 === "1";

const REPETICIONES = Number(process.env.PROTOTIPO_REPETICIONES ?? "3");
const PARTICIPANTES_EN_RAFAGA = 10;
const HORAS_LIQUIDACION = 48;

/** Holgado frente al viaje de red, corto frente a la paciencia de la prueba. */
const UMBRAL_AMPLIO_MS = 15_000;
/** Deliberadamente menor que la pausa, para provocar la depuracion. */
const UMBRAL_ESTRECHO_MS = 250;
const PAUSA_MS = 1_200;

const CON_RESERVA = ["reservas_en_lote", "reservas_por_item"] as const;

const esperar = (ms: number): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));

// `skipIf` y no un archivo aparte: asi el prototipo sigue apareciendo en el
// reporte, con su nombre, aunque no se haya pedido. Lo que no se ve, se olvida.
describe.skipIf(!hayBackend || !seSolicito)(
  "prototipo concurrente de la fila (R18)",
  () => {
    let dynamo: DynamoDBClient;
    let deps: DepsDeFila;
    /** Particiones creadas por las pruebas, para purgarlas al final. */
    const particionesCreadas = new Set<string>();

    beforeAll(async () => {
      const tabla = salidas!.tabla!;
      vi.stubEnv("AUTOB_TABLE_NAME", tabla);

      // Se asume el rol real de computo SSR y no las credenciales del
      // desarrollador: asi el prototipo comprueba de paso que la politica IAM que
      // corre en produccion permite todo lo que el mecanismo necesita, incluido
      // crear y borrar items de reserva y escribir el evento en la bitacora.
      const sesion = await new STSClient({}).send(
        new AssumeRoleCommand({
          RoleArn: salidas!.rolComputoSsr!,
          RoleSessionName: "prototipo-fila-concurrente",
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

      deps = {
        cliente: DynamoDBDocumentClient.from(dynamo, {
          marshallOptions: {
            removeUndefinedValues: true,
            convertClassInstanceToMap: false,
          },
          unmarshallOptions: { wrapNumbers: false },
        }),
      };
    });

    afterAll(async () => {
      // Los items `AUDIT#` **no** se purgan: el rol de computo SSR tiene denegado
      // `DeleteItem` sobre ellos, que es justo la garantia que comprueba
      // `amplify/auditoriaInmutable.integracion.test.ts`. Quedan en el sandbox
      // como rastro de las corridas, que es lo que una bitacora debe hacer.
      for (const pk of particionesCreadas) {
        const items = await deps.cliente.send(
          new QueryCommand({
            TableName: process.env.AUTOB_TABLE_NAME,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": pk },
            ConsistentRead: true,
          }),
        );
        for (const item of items.Items ?? []) {
          await deps.cliente.send(
            new DeleteCommand({
              TableName: process.env.AUTOB_TABLE_NAME,
              Key: { PK: item.PK, SK: item.SK },
            }),
          );
        }
      }
      dynamo?.destroy();
      vi.unstubAllEnvs();
    });

    // --- Utilidades del escenario ---------------------------------------------

    type Escenario = {
      convocatoriaId: string;
      loteId: string;
      ahora: Date;
      horasLiquidacion: number;
    };

    const crearEscenario = async (lotes = 1): Promise<Escenario[]> => {
      const tabla = process.env.AUTOB_TABLE_NAME;
      const sufijo = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      const convocatoriaId = `proto-conv-${sufijo}`;
      const ahora = new Date();

      const ventana = {
        publicadaEn: new Date(ahora.getTime() - 7_200_000).toISOString(),
        inicioVenta: new Date(ahora.getTime() - 3_600_000).toISOString(),
        finVenta: new Date(ahora.getTime() + 86_400_000).toISOString(),
      };

      await deps.cliente.send(
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
      particionesCreadas.add(clave.convocatoria(convocatoriaId).PK);

      const escenarios: Escenario[] = [];
      for (let i = 0; i < lotes; i += 1) {
        const loteId = `proto-lote-${sufijo}-${i}`;
        await deps.cliente.send(
          new PutCommand({
            TableName: tabla,
            Item: {
              ...clave.lote(convocatoriaId, loteId),
              estatus: "EN_OFERTA",
              // Atributos desnormalizados de la convocatoria: son los que mira la
              // condicion del paso 1 (modelo-datos seccion 1).
              estatusConvocatoria: "PUBLICADA",
              inicioVenta: ventana.inicioVenta,
              finVenta: ventana.finVenta,
              contadorTurnos: 0,
              // Sin este mapa vacio, `SET reservas.#id = :v` falla con
              // ValidationException: la ruta padre tiene que existir. Lo necesita
              // la variante `reservas_en_lote`.
              reservas: {},
            },
          }),
        );
        particionesCreadas.add(clave.solicitud(loteId, 0).PK);
        escenarios.push({
          convocatoriaId,
          loteId,
          ahora,
          horasLiquidacion: HORAS_LIQUIDACION,
        });
      }
      return escenarios;
    };

    const participante = (escenario: Escenario, etiqueta: string): string => {
      const id = `proto-part-${escenario.loteId}-${etiqueta}`;
      particionesCreadas.add(clave.centinelaAdjudicacion(id).PK);
      return id;
    };

    const leerLote = async (
      escenario: Escenario,
    ): Promise<Record<string, unknown>> => {
      const salida = await deps.cliente.send(
        new GetCommand({
          TableName: process.env.AUTOB_TABLE_NAME,
          Key: clave.lote(escenario.convocatoriaId, escenario.loteId),
          ConsistentRead: true,
        }),
      );
      return salida.Item ?? {};
    };

    type EnLaFila = {
      turno: number;
      estatus: string;
      participanteId: string;
      solicitadoEn: string;
    };

    /** PA-07 tal cual la lee la aplicacion: sin ordenar en memoria. */
    const leerFila = async (escenario: Escenario): Promise<EnLaFila[]> => {
      const salida = await deps.cliente.send(
        new QueryCommand({
          TableName: process.env.AUTOB_TABLE_NAME,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefijo)",
          ExpressionAttributeValues: {
            ":pk": clave.solicitud(escenario.loteId, 0).PK,
            ":prefijo": PREFIJO.solicitud,
          },
          ConsistentRead: true,
        }),
      );
      return (salida.Items ?? []).map((item) => ({
        // El turno se toma de la **clave**, no del atributo: la clave es lo que
        // define el orden y es lo unico que no puede desincronizarse.
        turno: turnoDesdeClave(String(item.SK)) ?? -1,
        estatus: String(item.estatus),
        participanteId: String(item.participanteId),
        solicitadoEn: String(item.solicitadoEn),
      }));
    };

    /** Reservas que quedaron colgadas en la particion del lote. */
    const leerReservas = async (escenario: Escenario): Promise<string[]> => {
      const salida = await deps.cliente.send(
        new QueryCommand({
          TableName: process.env.AUTOB_TABLE_NAME,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefijo)",
          ExpressionAttributeValues: {
            ":pk": clave.reservaDeTurno(escenario.loteId, "x").PK,
            ":prefijo": PREFIJO.reservaDeTurno,
          },
          ConsistentRead: true,
        }),
      );
      return (salida.Items ?? []).map((item) => String(item.SK));
    };

    type Intento = {
      turno?: number;
      errorPaso1?: string;
      errorPaso2?: string;
      detallePaso2?: string;
      adjudicacion?: ResultadoDeAdjudicacion;
    };

    /**
     * Una solicitud completa: los dos pasos mas el intento de adjudicar.
     *
     * Adjudicar aqui dentro, y no al final de todas, es lo que hace que la prueba
     * intercale. `solicitadoEn` se escribe **inverso al turno** para que la
     * invariante 4 se afirme en su forma mas fuerte: el ganador es el turno menor
     * aunque sea el de marca de tiempo mas tardia (R-08).
     */
    type Opciones = {
      umbralDeReservaMs?: number;
      verificarConvocatoriaEnTransaccion?: boolean;
    };

    const solicitarYAdjudicar = async (
      variante: Variante,
      escenario: Escenario,
      participanteId: string,
      opciones: Opciones = {},
    ): Promise<Intento> => {
      const paso1 = await reservarTurno(variante, escenario, deps);
      if (!paso1.ok) return { errorPaso1: paso1.error };

      const { turno, reservaId } = paso1.datos;
      const paso2 = await registrarSolicitud(
        variante,
        {
          ...escenario,
          participanteId,
          turno,
          reservaId,
          solicitadoEn: new Date(escenario.ahora.getTime() - turno * 60_000),
          verificarConvocatoriaEnTransaccion:
            opciones.verificarConvocatoriaEnTransaccion,
        },
        deps,
      );
      if (!paso2.ok) {
        return { turno, errorPaso2: paso2.error, detallePaso2: paso2.detalle };
      }

      const adjudicacion = await adjudicar(
        variante,
        {
          ...escenario,
          ahora: new Date(),
          umbralDeReservaMs: opciones.umbralDeReservaMs,
        },
        deps,
      );
      return { turno, adjudicacion };
    };

    /**
     * La carrera de R18, abierta a proposito.
     *
     * A obtiene el turno 1 y se detiene antes del paso 2. B obtiene el turno 2,
     * lo completa y dispara la adjudicacion. Solo entonces A completa el suyo.
     */
    const carreraControlada = async (
      variante: Variante,
      umbralDeReservaMs: number,
    ) => {
      const [escenario] = await crearEscenario();
      const a = participante(escenario!, "a");
      const b = participante(escenario!, "b");
      const opciones = { umbralDeReservaMs };

      const paso1A = await reservarTurno(variante, escenario!, deps);
      expect(paso1A.ok).toBe(true);
      if (!paso1A.ok) throw new Error("el paso 1 de A debia tener exito");

      await esperar(PAUSA_MS); // <- la ventana de R18

      const resultadoB = await solicitarYAdjudicar(
        variante,
        escenario!,
        b,
        opciones,
      );

      const paso2A = await registrarSolicitud(
        variante,
        {
          ...escenario!,
          participanteId: a,
          turno: paso1A.datos.turno,
          reservaId: paso1A.datos.reservaId,
          solicitadoEn: new Date(),
        },
        deps,
      );
      const adjudicacionA = paso2A.ok
        ? await adjudicar(
            variante,
            { ...escenario!, ahora: new Date(), ...opciones },
            deps,
          )
        : undefined;

      return {
        escenario: escenario!,
        turnoA: paso1A.datos.turno,
        turnoB: resultadoB.turno,
        paso2A,
        resultadoB,
        adjudicacionA,
        lote: await leerLote(escenario!),
        fila: await leerFila(escenario!),
      };
    };

    const rafaga = async (
      variante: Variante,
      escenario: Escenario,
      opciones: Opciones = {},
    ) => {
      const resultados = await Promise.all(
        Array.from({ length: PARTICIPANTES_EN_RAFAGA }, (_, i) =>
          solicitarYAdjudicar(
            variante,
            escenario,
            participante(escenario, `${variante[0]}${i}`),
            opciones,
          ),
        ),
      );
      return {
        resultados,
        fila: await leerFila(escenario),
        lote: await leerLote(escenario),
      };
    };

    // --- 1. El defecto existe --------------------------------------------------

    it("ingenuo: el turno 2 gana el vehiculo del turno 1 — el defecto R18", async () => {
      const r = await carreraControlada("ingenuo", UMBRAL_AMPLIO_MS);

      expect(r.turnoA).toBe(1);
      expect(r.turnoB).toBe(2);

      // Esta es la afirmacion que da valor a todo lo demas. Si algun dia deja de
      // cumplirse, el arnes dejo de ejercer la carrera y las pruebas de las
      // variantes corregidas ya no demuestran nada.
      expect(r.resultadoB.adjudicacion).toEqual({
        estado: "adjudicado",
        turno: 2,
        participanteId: expect.stringContaining("-b"),
      });
      expect(r.lote.turnoAdjudicado).toBe(2);

      // Y el turno 1 llega tarde a una fila que ya se cerro: existe, es menor,
      // esta vivo y no gano nada. Viola R-08 y la invariante 4.
      expect(r.paso2A.ok).toBe(true);
      expect(r.adjudicacionA).toEqual({ estado: "ya_adjudicado" });
      expect(r.fila).toEqual([
        expect.objectContaining({ turno: 1, estatus: "EN_FILA" }),
        expect.objectContaining({ turno: 2, estatus: "ADJUDICADA" }),
      ]);
    });

    // --- 2. Las dos variantes con reserva cierran la carrera -------------------

    it.each(CON_RESERVA)(
      "%s: la adjudicacion se abstiene y gana el turno 1",
      async (variante) => {
        const r = await carreraControlada(variante, UMBRAL_AMPLIO_MS);

        expect(r.turnoA).toBe(1);
        expect(r.turnoB).toBe(2);

        // B ve la reserva de A y no adjudica, aunque la fila solo lo muestre a el.
        expect(r.resultadoB.adjudicacion).toEqual({
          estado: "abstenido",
          reservasVigentes: 1,
        });

        expect(r.paso2A.ok).toBe(true);
        expect(r.adjudicacionA).toEqual({
          estado: "adjudicado",
          turno: 1,
          participanteId: expect.stringContaining("-a"),
        });
        expect(r.lote.turnoAdjudicado).toBe(1);
      },
    );

    it.each(CON_RESERVA)(
      "%s: una reserva muerta pierde su turno, no lo cuela tarde",
      async (variante) => {
        const r = await carreraControlada(variante, UMBRAL_ESTRECHO_MS);

        // La pausa de A supera el umbral, asi que B la depura y adjudica. Hasta
        // aqui es lo esperado: A abandono.
        expect(r.resultadoB.adjudicacion).toEqual({
          estado: "adjudicado",
          turno: 2,
          participanteId: expect.stringContaining("-b"),
        });

        // Lo que hace seguro el umbral es esto: A **no puede** escribir su
        // solicitud despues, porque su reserva ya no existe. Sin la condicion de
        // existencia en el paso 2, el turno 1 apareceria en la fila detras de un
        // ganador con turno mayor y R18 seguiria abierto, solo que mas dificil de
        // reproducir.
        expect(r.paso2A).toMatchObject({
          ok: false,
          error: "conflicto_concurrencia",
        });
        expect(r.fila).toEqual([
          expect.objectContaining({ turno: 2, estatus: "ADJUDICADA" }),
        ]);

        // El turno 1 se consumio y quedo como hueco. El diseno lo acepta: la
        // equidad depende del orden relativo, no de la contiguidad.
        expect(r.lote.contadorTurnos).toBe(2);
      },
    );

    it("reservas_por_item: un paso 2 rechazado libera su reserva", async () => {
      const [escenario] = await crearEscenario();
      const unico = participante(escenario!, "unico");

      const primera = await solicitarYAdjudicar(
        "reservas_por_item",
        escenario!,
        unico,
      );
      expect(primera.turno).toBe(1);
      expect(primera.adjudicacion).toMatchObject({ estado: "adjudicado" });

      // Segunda solicitud del mismo participante en el mismo lote: R-07 la
      // rechaza en el centinela. El turno 2 se consumio igual.
      const repetida = await solicitarYAdjudicar(
        "reservas_por_item",
        escenario!,
        unico,
      );
      expect(repetida).toMatchObject({
        turno: 2,
        errorPaso2: "already_in_queue",
      });

      // Y la reserva del intento fallido no quedo colgada: si quedara, cualquier
      // adjudicacion posterior se abstendria hasta el umbral.
      expect(await leerReservas(escenario!)).toEqual([]);
      expect((await leerLote(escenario!)).contadorTurnos).toBe(2);
    });

    // --- 3. La fila sigue abierta despues de adjudicar (R-17) ------------------

    it("la fila admite a quien llega despues de la primera adjudicacion", async () => {
      const [escenario] = await crearEscenario();
      const a = participante(escenario!, "a");
      const b = participante(escenario!, "b");

      const primero = await solicitarYAdjudicar(
        "reservas_por_item",
        escenario!,
        a,
      );
      expect(primero.adjudicacion).toMatchObject({
        estado: "adjudicado",
        turno: 1,
      });
      expect((await leerLote(escenario!)).estatus).toBe("ADJUDICADO");

      // B llega con el lote ya `ADJUDICADO` y aun asi entra a la fila. Con la
      // condicion `estatus = EN_OFERTA` que trae escrita T1 esto devolveria
      // `lote_no_disponible`, y R-17 —"sigue disponible para quien solicite
      // despues, mientras la venta siga abierta"— seria inalcanzable, igual que
      // la reasignacion de R-15 y todo el concepto de `miPosicion`.
      const segundo = await solicitarYAdjudicar(
        "reservas_por_item",
        escenario!,
        b,
      );
      expect(segundo.errorPaso1).toBeUndefined();
      expect(segundo.turno).toBe(2);
      expect(segundo.adjudicacion).toEqual({ estado: "ya_adjudicado" });

      expect(
        (await leerFila(escenario!)).map((s) => [s.turno, s.estatus]),
      ).toEqual([
        [1, "ADJUDICADA"],
        [2, "EN_FILA"],
      ]);
    });

    // --- 4. Invariante 5: una sola adjudicacion activa (R-09) ------------------

    it("el mismo participante no gana dos lotes a la vez", async () => {
      const [uno, dos] = await crearEscenario(2);
      const x = participante(uno!, "x");
      const y = participante(uno!, "y");

      // X se forma primero en los dos lotes; Y despues. X tiene el turno 1 en
      // ambos, asi que sin el centinela ganaria los dos.
      for (const lote of [uno!, dos!]) {
        for (const quien of [x, y]) {
          const paso1 = await reservarTurno("reservas_por_item", lote, deps);
          expect(paso1.ok).toBe(true);
          if (!paso1.ok) return;
          const paso2 = await registrarSolicitud(
            "reservas_por_item",
            {
              ...lote,
              participanteId: quien,
              turno: paso1.datos.turno,
              reservaId: paso1.datos.reservaId,
              solicitadoEn: new Date(),
            },
            deps,
          );
          expect(paso2.ok).toBe(true);
        }
      }

      expect(
        await adjudicar(
          "reservas_por_item",
          { ...uno!, ahora: new Date() },
          deps,
        ),
      ).toEqual({ estado: "adjudicado", turno: 1, participanteId: x });

      // En el segundo lote falla el item 3 de T2 —el centinela de X ya existe— y
      // el bucle continua con el turno siguiente en lugar de abortar. Distinguir
      // ese caso de "el lote ya se adjudico" es exactamente para lo que
      // `transacciones.ts` traduce `CancellationReasons` por posicion.
      expect(
        await adjudicar(
          "reservas_por_item",
          { ...dos!, ahora: new Date() },
          deps,
        ),
      ).toEqual({ estado: "adjudicado", turno: 2, participanteId: y });
    });

    // --- 5. Rafaga real, repetida ----------------------------------------------

    const rondas = Array.from({ length: REPETICIONES }, (_, i) => i + 1);

    it.each(rondas)(
      "reservas_por_item: rafaga - turnos unicos, orden estricto y un solo ganador (ronda %i)",
      async () => {
        const [escenario] = await crearEscenario();
        const { resultados, fila, lote } = await rafaga(
          "reservas_por_item",
          escenario!,
        );

        // Invariante 1 — unicidad de turno.
        const turnos = resultados.map((r) => r.turno);
        expect(resultados.filter((r) => r.errorPaso1 ?? r.errorPaso2)).toEqual(
          [],
        );
        expect(new Set(turnos).size).toBe(PARTICIPANTES_EN_RAFAGA);

        // Invariante 2 — orden estricto, tal como lo devuelve la Query.
        const enOrden = fila.map((s) => s.turno);
        expect(enOrden).toEqual([...enOrden].sort((a, b) => a - b));
        expect(new Set(enOrden).size).toBe(enOrden.length);
        expect(enOrden).toHaveLength(PARTICIPANTES_EN_RAFAGA);

        // Invariante 3 — adjudicacion unica.
        expect(
          resultados.filter((r) => r.adjudicacion?.estado === "adjudicado"),
        ).toHaveLength(1);
        expect(fila.filter((s) => s.estatus === "ADJUDICADA")).toHaveLength(1);

        // Invariante 4 — el orden manda sobre el tiempo. `solicitadoEn` se
        // escribio inverso al turno, asi que el ganador es el de marca de tiempo
        // **mas tardia**: si alguien ordenara la fila por fecha, esto fallaria.
        const menorTurno = Math.min(...enOrden);
        expect(lote.turnoAdjudicado).toBe(menorTurno);
        const masTardia = fila.reduce((a, b) =>
          a.solicitadoEn >= b.solicitadoEn ? a : b,
        );
        expect(masTardia.turno).toBe(menorTurno);

        // Y no quedan reservas colgadas: cada paso 2 borro la suya dentro de su
        // transaccion.
        expect(await leerReservas(escenario!)).toEqual([]);
      },
    );

    it.each(rondas)(
      "reservas_en_lote: la reserva en el item del lote se cancela sola bajo rafaga (ronda %i)",
      async () => {
        const [escenario] = await crearEscenario();
        const { resultados, fila } = await rafaga(
          "reservas_en_lote",
          escenario!,
        );

        const rechazadas = resultados.filter((r) => r.errorPaso2);
        console.info(
          `[R18] reservas_en_lote: ${rechazadas.length} de ` +
            `${PARTICIPANTES_EN_RAFAGA} solicitudes perdidas en el paso 2 ` +
            `(${[...new Set(rechazadas.map((r) => r.detallePaso2))].join(", ")}).`,
        );

        // Este es el motivo documentado del descarte, aislado: esta rafaga corre
        // **sin** el `ConditionCheck` de la convocatoria, asi que el unico item
        // compartido es el del lote. La variante lo mete dentro de la
        // `TransactWriteItems` de **toda** solicitud, y DynamoDB no serializa las
        // transacciones que tocan un mismo item: las cancela con
        // `TransactionConflict`. En el momento de maxima concurrencia
        // —`inicioVenta`— eso convierte a la mayoria de los participantes en
        // rechazados.
        expect(
          rechazadas.length,
          "Si esto falla, DynamoDB dejo de cancelar por conflicto y conviene" +
            " reevaluar el mecanismo descartado en el prototipo de R18",
        ).toBeGreaterThan(0);

        // Lo que si conserva: los turnos entregados siguen siendo unicos y la
        // fila ordenada. Lo que pierde es a los participantes.
        expect(new Set(resultados.map((r) => r.turno)).size).toBe(
          PARTICIPANTES_EN_RAFAGA,
        );
        const enOrden = fila.map((s) => s.turno);
        expect(enOrden).toEqual([...enOrden].sort((a, b) => a - b));
      },
    );

    it.each(rondas)(
      "el ConditionCheck sobre la convocatoria cancela solicitudes legitimas (ronda %i)",
      async () => {
        const [escenario] = await crearEscenario();
        const { resultados } = await rafaga("reservas_por_item", escenario!, {
          verificarConvocatoriaEnTransaccion: true,
        });

        const rechazadas = resultados.filter((r) => r.errorPaso2);
        console.info(
          `[R18] ConditionCheck de convocatoria: ${rechazadas.length} de ` +
            `${PARTICIPANTES_EN_RAFAGA} solicitudes canceladas ` +
            `(${[...new Set(rechazadas.map((r) => r.detallePaso2))].join(", ")}).`,
        );

        // Hallazgo independiente de R18. El `ConditionCheck` se agrego en la
        // Etapa 2.1 contra la publicacion parcial (hallazgo 4), y es correcto:
        // devuelve la autoridad a la convocatoria en el momento del commit. Pero
        // apunta a **un solo item que comparten todas las solicitudes de la
        // convocatoria entera**, y dentro de una transaccion un `ConditionCheck`
        // retiene el item igual que una escritura. El resultado es que en
        // `inicioVenta` la mayoria de los participantes recibe una cancelacion
        // por conflicto: la garantia se paga rechazando a quien llega puntual.
        //
        // El costo no se paga con un reintento: el item caliente esta en el
        // camino de toda solicitud, justo en el instante de maxima concurrencia.
        // La alternativa sin item caliente es ordenar la propagacion de T8 para
        // que el estado intermedio sea siempre el mas restrictivo.
        expect(
          rechazadas.length,
          "Si esto falla, un ConditionCheck dejo de retener el item y conviene" +
            " reevaluar el descarte de esta guarda en el prototipo de R18",
        ).toBeGreaterThan(0);
        expect(
          rechazadas.map((r) => r.detallePaso2),
          "las cancelaciones deben venir del item de la convocatoria",
        ).toEqual(
          rechazadas.map(() => "convocatoria publicada (publicacion parcial)"),
        );
      },
    );

    it.each(rondas)(
      "medicion: la rafaga sola no detecta el defecto de forma fiable (ronda %i)",
      async () => {
        const [escenario] = await crearEscenario();
        const { resultados, fila, lote } = await rafaga("ingenuo", escenario!);

        const menorTurno = Math.min(...fila.map((s) => s.turno));
        const detectado = lote.turnoAdjudicado !== menorTurno;

        // Sin afirmacion a proposito: el resultado es la medicion, no el juicio.
        // Si esta prueba se convirtiera en `expect(detectado).toBe(true)` seria
        // intermitente, y si fuera `toBe(false)` afirmaria que el defecto no
        // existe. Lo que si esta afirmado —de forma determinista— es la carrera
        // controlada de la primera prueba.
        console.info(
          `[R18] rafaga ingenua de ${PARTICIPANTES_EN_RAFAGA}: ganador turno ` +
            `${String(lote.turnoAdjudicado)}, menor turno en fila ${menorTurno}. ` +
            `Defecto ${detectado ? "DETECTADO" : "no detectado"} en esta ronda.`,
        );

        // Lo unico que si se afirma aqui vale para las tres variantes: los turnos
        // son unicos y la fila esta ordenada. El `ADD` atomico nunca estuvo en
        // duda; lo que R18 rompe es quien gana, no como se numera.
        expect(new Set(resultados.map((r) => r.turno)).size).toBe(
          PARTICIPANTES_EN_RAFAGA,
        );
        const enOrden = fila.map((s) => s.turno);
        expect(enOrden).toEqual([...enOrden].sort((a, b) => a - b));
      },
    );
  },
);
