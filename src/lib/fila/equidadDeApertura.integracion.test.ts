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

import { clave, PREFIJO } from "@/lib/data/claves";
import type { DepsDeServicio } from "@/lib/data/deps";
import type { ActorUsuario } from "@/types/auditoria";
import type { Lote } from "@/types/lote";
import { fallo, type Resultado } from "@/types/resultado";
import { INTENTOS_POR_VENTANA, registrarIntento } from "./limiteDeTasa";
import { solicitarCompra, type SolicitudRegistrada } from "./solicitarCompra";
import { puedeUsarBackendReal } from "@/utils/backendUtilizable";

vi.mock("server-only", () => ({}));

/**
 * Medicion de la ventaja de automatizar la apertura — Etapa 16, primer paso.
 *
 * **Que pregunta responde, y por que no la responde ninguna de las otras dos
 * pruebas contra el sandbox.** `fila.integracion.test.ts` pregunta por la
 * correccion de un lote y `carga.integracion.test.ts` por la capacidad de una
 * convocatoria entera; las dos abren la venta **en el pasado** y disparan a
 * todo el mundo a la vez, que es justo lo que borra la pregunta de esta:
 * **cuanto turno gana quien dispara en el milisegundo exacto de `inicioVenta`
 * frente a quien tarda los 200-400 ms de una reaccion humana**.
 *
 * Sin ese numero, el umbral de la limitacion de tasa que sigue en la Etapa 16
 * seria una intuicion disfrazada de constante — el proyecto ya tiene el
 * precedente de `UMBRAL_CONFLICTOS_POR_PERIODO`, que quedo sin calibrar por lo
 * mismo. Y el riesgo R26 dice que la limitacion **se paga en el camino mas
 * caliente del sistema**, asi que esta corrida es tambien la linea base de
 * latencia contra la que se compara la de despues.
 *
 * **Tres perfiles por lote, que son las tres formas reales de llegar:**
 *
 *   - `RELOJ` — un script que conoce `inicioVenta` y dispara una vez, exacto.
 *     Es el techo de la ventaja: no reintenta, solo tiene mejor reloj.
 *   - `BUCLE` — un script que empieza a disparar **antes** de la apertura y
 *     reintenta hasta que la condicion deja de rechazarlo, **esperando cada
 *     respuesta**. Produce los intentos rechazados por llegar antes que hoy no
 *     dejan rastro. Su tasa la acota el viaje de red, no su intencion: es el
 *     piso, no el techo.
 *   - `RAFAGA` — el mismo bucle **sin esperar las respuestas**. Es el techo, y
 *     el unico perfil que la limitacion de tasa puede cambiar de verdad: quien
 *     dispara en paralelo no necesita saber la hora exacta, le basta con cubrir
 *     el instante a base de intentos.
 *   - `HUMANO` — una persona con la pagina abierta que reacciona entre 200 y
 *     400 ms despues.
 *
 * **El informe es el entregable.** Las afirmaciones de abajo solo comprueban
 * que el escenario se monto de verdad; lo que decide el umbral son los numeros,
 * y por eso se imprimen siempre.
 *
 * **Lo que esta medicion no puede ver, y hay que decirlo al leerla.** Corre
 * desde una maquina de desarrollo contra `us-east-1` y con inspeccion TLS
 * corporativa de por medio (riesgo R11), asi que el viaje de red es mucho mas
 * largo y mas variable que el del SSR desplegado en la misma region. Un
 * disparo exacto y uno 200 ms mas tarde pueden aterrizar en desorden por puro
 * ruido de red, y eso **subestima** la ventaja: cuanto mas estable es la red,
 * mas decisivo es el reloj. De ahi que el informe publique el desfase real de
 * cada solicitud y el conteo de inversiones — para que quien lea sepa cuanto
 * ruido habia el dia de la medicion.
 *
 *   npx ampx sandbox        # en otra terminal
 *   npm run equidad:apertura
 */

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

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
const seSolicito = process.env.EQUIDAD_APERTURA === "1";

const numero = (nombre: string, omision: number): number =>
  Number(process.env[nombre] ?? String(omision));

const LOTES = numero("EQUIDAD_LOTES", 5);
/** Disparos exactos por lote: el techo de la ventaja. */
const RELOJ = numero("EQUIDAD_RELOJ", 2);
/** Bucles de reintento secuenciales por lote. Uno basta para medir su tasa. */
const BUCLE = numero("EQUIDAD_BUCLE", 1);
/** Rafagas en paralelo por lote. */
const RAFAGA = numero("EQUIDAD_RAFAGA", 1);
/** Personas por lote. */
const HUMANOS = numero("EQUIDAD_HUMANOS", 3);

/** La reaccion humana que el plan nombra: 200-400 ms. */
const REACCION_MIN_MS = numero("EQUIDAD_REACCION_MIN_MS", 200);
const REACCION_MAX_MS = numero("EQUIDAD_REACCION_MAX_MS", 400);

/** Cuanto antes de la apertura empieza a disparar el bucle. */
const ANTICIPACION_MS = numero("EQUIDAD_ANTICIPACION_MS", 1_000);
/** Cada cuanto reintenta el bucle mientras la condicion lo rechaza. */
const INTERVALO_REINTENTO_MS = numero("EQUIDAD_INTERVALO_MS", 25);
/** Cada cuanto lanza la rafaga un intento nuevo, sin esperar al anterior. */
const INTERVALO_RAFAGA_MS = numero("EQUIDAD_INTERVALO_RAFAGA_MS", 50);
/**
 * Tope de intentos del bucle y de la rafaga. **No es una limitacion de tasa**
 * —esa es lo que la Etapa 16 construye despues— sino una brida de la prueba:
 * sin ella, un cliente al que la condicion rechaza siempre correria sin fin.
 */
const TOPE_DE_INTENTOS = numero("EQUIDAD_TOPE_INTENTOS", 200);
const TOPE_DE_RAFAGA = numero("EQUIDAD_TOPE_RAFAGA", 60);

/**
 * Cuanto se adelanta `inicioVenta` respecto del arranque.
 *
 * Tiene que cubrir la creacion de la convocatoria, el precalentamiento de
 * sockets y el arranque del bucle. Si no alcanza, la prueba lo dice y falla en
 * vez de medir una apertura que ya ocurrio.
 */
const ESPERA_APERTURA_MS = numero("EQUIDAD_ESPERA_APERTURA_MS", 15_000);

/**
 * Corre **sin** la limitacion de tasa, para reproducir la medicion previa.
 *
 * Es lo que permite que las dos mediciones que la Etapa 16 exige —antes y
 * despues de instalar la limitacion— salgan del mismo arnes y del mismo codigo,
 * en vez de comparar contra el recuerdo de una corrida anterior. La verificacion
 * dice que la segunda no puede ser peor; con dos binarios distintos esa frase no
 * se podria sostener.
 *
 *   EQUIDAD_SIN_LIMITE=1 npm run equidad:apertura
 */
const SIN_LIMITE = process.env.EQUIDAD_SIN_LIMITE === "1";

const HORAS_LIQUIDACION = 48;
const CORRIDA = randomUUID().slice(0, 8);

const PERFILES = ["RELOJ", "BUCLE", "RAFAGA", "HUMANO"] as const;
type Perfil = (typeof PERFILES)[number];

const actorDe = (participanteId: string): ActorUsuario => ({
  tipo: "USUARIO",
  id: participanteId,
  permisos: ["Autob_Venta_a_empleados"],
});

const dormir = (ms: number): Promise<void> =>
  new Promise((listo) => setTimeout(listo, Math.max(0, ms)));

const percentil = (valores: readonly number[], p: number): number => {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.min(
    ordenados.length - 1,
    Math.ceil((p / 100) * ordenados.length) - 1,
  );
  return ordenados[Math.max(0, indice)] ?? 0;
};

/** Intentos por segundo que sostuvo cada cliente contra la ventana cerrada. */
const porSegundo = (intentos: number, clientes: number): number =>
  Math.round(
    (intentos / Math.max(1, clientes)) * (1000 / ANTICIPACION_MS) * 10,
  ) / 10;

const resumenDe = (
  valores: readonly number[],
): { n: number; min: number; mediana: number; max: number } => ({
  n: valores.length,
  min: valores.length ? Math.min(...valores) : 0,
  mediana: percentil(valores, 50),
  max: valores.length ? Math.max(...valores) : 0,
});

type Medicion = {
  perfil: Perfil;
  loteId: string;
  participanteId: string;
  /** Desfase **pretendido** respecto de la apertura, en ms. */
  desfasePlaneadoMs: number;
  /** Desfase **real** del disparo aceptado, medido por el reloj del proceso. */
  desfaseDisparoMs?: number;
  /**
   * Desfase derivado de lo **persistido**: `solicitadoEn - inicioVenta`. Es la
   * evidencia que el plan senala como ya disponible sin escribir nada nuevo, y
   * se publica para comprobar que coincide con el disparo medido.
   */
  desfasePersistidoMs?: number;
  intentos: number;
  /** Intentos rechazados por llegar antes de la apertura. */
  rechazadosAntesDeApertura: number;
  /** Intentos cortados por la limitacion de tasa, que no tocaron el motor. */
  estrangulados: number;
  turno?: number;
  turnoAdjudicado?: number;
  error?: string;
  /** Latencia del intento aceptado. Linea base de R26. */
  ms?: number;
};

describe.skipIf(!hayBackend || !seSolicito)(
  "equidad: ventaja de automatizar el instante de apertura",
  () => {
    let dynamo: DynamoDBClient;
    let cliente: DynamoDBDocumentClient;
    let deps: DepsDeServicio;
    const particionesCreadas = new Set<string>();

    let lotes: Lote[];
    let aperturaMs: number;
    let mediciones: Medicion[];
    /** `contadorTurnos` final de cada lote, por `loteId`. */
    let contadores: Map<string, number>;

    beforeAll(async () => {
      vi.stubEnv("AUTOB_TABLE_NAME", salidas!.tabla!);

      // El rol real de computo SSR, igual que la prueba de carga: lo que se
      // mide tiene que atravesar la misma politica de IAM que produccion.
      const sesion = await new STSClient({}).send(
        new AssumeRoleCommand({
          RoleArn: salidas!.rolComputoSsr!,
          RoleSessionName: "equidad-apertura-etapa16",
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
        // Cupo de sockets como en la prueba de carga y por lo mismo: sin el se
        // mediria la cola de sockets de este proceso en vez de la apertura.
        requestHandler: {
          httpsAgent: { maxSockets: 400 },
          connectionTimeout: 15_000,
          requestTimeout: 60_000,
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

      const arranque = Date.now();
      aperturaMs = arranque + ESPERA_APERTURA_MS;
      lotes = await crearConvocatoria(new Date(aperturaMs));

      // **Precalentar es parte de la medicion, no una trampa.** Sin sockets
      // abiertos, el primer disparo de cada cliente paga un apreton de manos
      // TLS de cientos de milisegundos (R11) y lo que se mediria seria la
      // suerte de cada conexion, no el reloj. Tanto el script como la persona
      // llegan a la apertura con su conexion ya abierta.
      await precalentar(totalDeClientes());

      const margen = aperturaMs - Date.now();
      if (margen < ANTICIPACION_MS + 500) {
        throw new Error(
          `El montaje consumio la ventana: quedan ${String(margen)} ms para la apertura` +
            ` y el bucle necesita al menos ${String(ANTICIPACION_MS + 500)}.` +
            " Sube EQUIDAD_ESPERA_APERTURA_MS.",
        );
      }

      mediciones = await apertura();
      await anotarDesfasePersistido();
      contadores = new Map(
        await Promise.all(
          lotes.map(async (lote): Promise<[string, number]> => [
            lote.loteId,
            await leerContadorDeTurnos(lote),
          ]),
        ),
      );

      informe();
    });

    afterAll(async () => {
      // Los `AUDIT#` no se purgan: el rol tiene `DeleteItem` denegado sobre
      // ellos, que es la garantia de la Etapa 3. Quedan como rastro.
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

    const totalDeClientes = (): number =>
      LOTES * (RELOJ + BUCLE + RAFAGA + HUMANOS);

    /**
     * Contabilidad de intentos por lote, para cuadrarla contra `contadorTurnos`.
     *
     * Es lo que permite afirmar que **un intento anterior a la apertura no
     * consume turno** sin depender de que la fila no tenga huecos: la rafaga si
     * los produce, y son legitimos (regla 16). El contraste correcto es contra
     * el contador del lote, que cuenta exactamente los `ADD` que pasaron la
     * condicion.
     *
     * **Se clasifica por el desenlace y no por el reloj del disparo**, y eso lo
     * corrigio la propia medicion. La condicion de la ventana se evalua con el
     * `ahora` que `solicitarCompra` toma al entrar, **no** cuando el cliente
     * decide disparar; con la limitacion de tasa por delante, entre los dos
     * instantes cabe un viaje de red entero. Un disparo lanzado 60 ms antes de
     * la apertura llega con la venta ya abierta y se lleva su turno con todo
     * derecho. Contarlo como "anterior a la apertura" hacia fallar la prueba
     * con el sistema comportandose bien.
     */
    type CuentaDeLote = {
      /** Intentos que llegaron al motor: los que la tasa no corto. */
      alcanzaronElMotor: number;
      /** De esos, los que la condicion de la ventana rechazo. */
      rechazadosPorLaVentana: number;
      /** Carreras perdidas, que hacen ambigua la cuenta. Deberian ser cero. */
      conflictos: number;
    };

    const intentosPorLote = new Map<string, CuentaDeLote>();

    const contarIntento = (
      loteId: string,
      resultado: Resultado<SolicitudRegistrada>,
    ): void => {
      const cuenta = intentosPorLote.get(loteId) ?? {
        alcanzaronElMotor: 0,
        rechazadosPorLaVentana: 0,
        conflictos: 0,
      };
      cuenta.alcanzaronElMotor += 1;
      if (!resultado.ok && resultado.error === "invalid_state") {
        cuenta.rechazadosPorLaVentana += 1;
      }
      if (!resultado.ok && resultado.error === "conflicto_concurrencia") {
        cuenta.conflictos += 1;
      }
      intentosPorLote.set(loteId, cuenta);
    };

    /** Una convocatoria publicada cuya venta **todavia no abre**. */
    const crearConvocatoria = async (inicioVenta: Date): Promise<Lote[]> => {
      const tabla = process.env.AUTOB_TABLE_NAME;
      const convocatoriaId = `equidad-conv-${CORRIDA}`;
      const ahora = new Date();
      const ventana = {
        // Publicada hace rato: la ventana de preparacion de R-03 es
        // precisamente lo que da tiempo a un script de armarse.
        publicadaEn: new Date(ahora.getTime() - 3_600_000).toISOString(),
        inicioVenta: inicioVenta.toISOString(),
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
      particionesCreadas.add(clave.convocatoria(convocatoriaId).PK);

      const creados = await Promise.all(
        Array.from({ length: LOTES }, async (_, i) => {
          const sufijo = `${CORRIDA}-${String(i)}`;
          const loteId = `equidad-lote-${sufijo}`;
          const vehiculoId = `equidad-veh-${sufijo}`;

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
            limiteAdjudicaciones: 1,
            limiteSolicitudes: 3,
            modalidadAdjudicacion: "AUTOMATICA",
            creadoEn: ventana.publicadaEn,
            creadoPor: "ADMIN",
          };

          await Promise.all([
            cliente.send(
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
            ),
            cliente.send(
              new PutCommand({
                TableName: tabla,
                Item: { ...clave.lote(convocatoriaId, loteId), ...lote },
              }),
            ),
          ]);

          particionesCreadas.add(clave.vehiculo(vehiculoId).PK);
          particionesCreadas.add(clave.solicitud(loteId, 0).PK);
          return lote;
        }),
      );

      return creados;
    };

    /** Abre tantas conexiones como clientes vayan a disparar a la vez. */
    const precalentar = async (conexiones: number): Promise<void> => {
      await Promise.all(
        Array.from({ length: conexiones }, async (_, i) =>
          cliente.send(
            new GetCommand({
              TableName: process.env.AUTOB_TABLE_NAME,
              Key: clave.vehiculo(`equidad-precalentar-${String(i)}`),
            }),
          ),
        ),
      );
    };

    /**
     * Barrera **unica** para el instante de apertura.
     *
     * Una espera por cliente no serviria: `setTimeout` en Windows tiene una
     * granularidad de varios milisegundos y un giro de espera por cliente
     * bloquearia el unico hilo de Node, de modo que los disparos "simultaneos"
     * saldrian en fila india. Un solo temporizador que gira los ultimos
     * milisegundos y libera a todos de golpe reproduce lo que de verdad hacen N
     * procesos distintos, y ademas da al script el mejor caso posible — que es
     * lo que interesa acotar.
     *
     * Se arma dentro de `apertura()` y no en el cuerpo del `describe`: alli
     * `aperturaMs` todavia no existe, porque lo fija `beforeAll`.
     */
    let barreraDeApertura: Promise<void>;

    const armarBarrera = (): Promise<void> =>
      (async (): Promise<void> => {
        await dormir(aperturaMs - Date.now() - 15);
        while (Date.now() < aperturaMs) {
          /* giro corto y acotado: solo los ultimos milisegundos */
        }
      })();

    /**
     * Un intento completo, **en el orden de la Server Action**.
     *
     * Primero la limitacion de tasa y despues el motor de fila, que es como
     * `src/app/actions/fila.ts` los encadena. El arnes no puede invocar la
     * action —necesitaria una sesion de Okta— asi que reproduce sus dos
     * primeros pasos: sin ellos, la medicion posterior mediria un camino que la
     * aplicacion ya no tiene.
     */
    const disparar = async (
      lote: Lote,
      participanteId: string,
    ): Promise<
      {
        ms: number;
        enMs: number;
        estrangulado: boolean;
      } & Resultado<SolicitudRegistrada>
    > => {
      const enMs = Date.now() - aperturaMs;
      const inicio = performance.now();
      const cerrar = (
        resultado: Resultado<SolicitudRegistrada>,
        estrangulado: boolean,
      ) => ({
        ...resultado,
        estrangulado,
        enMs,
        ms: Math.round(performance.now() - inicio),
      });

      if (!SIN_LIMITE) {
        const tasa = await registrarIntento(
          { participanteId, convocatoriaId: lote.convocatoriaId },
          deps,
        );
        if (!tasa.permitido) {
          // No se cuenta como intento contra el lote: no llego al `ADD` del
          // contador de turnos, que es justo lo que hay que poder afirmar.
          return cerrar(fallo("limite_de_tasa"), true);
        }
      }

      const resultado = await solicitarCompra(
        { lote, participanteId, actor: actorDe(participanteId) },
        deps,
      );
      contarIntento(lote.loteId, resultado);
      return cerrar(resultado, false);
    };

    const medir = (
      perfil: Perfil,
      lote: Lote,
      participanteId: string,
      desfasePlaneadoMs: number,
    ): Medicion => ({
      perfil,
      loteId: lote.loteId,
      participanteId,
      desfasePlaneadoMs,
      intentos: 0,
      rechazadosAntesDeApertura: 0,
      estrangulados: 0,
    });

    const anotarDesenlace = (
      medicion: Medicion,
      disparo: Awaited<ReturnType<typeof disparar>>,
    ): void => {
      medicion.ms = disparo.ms;
      medicion.desfaseDisparoMs = disparo.enMs;
      if (!disparo.ok) {
        medicion.error = disparo.error;
        return;
      }
      medicion.turno = disparo.data.turno;
      if (disparo.data.adjudicacion?.estado === "adjudicado") {
        // El turno **al que se adjudico el lote**, que no tiene por que ser el
        // propio: toda solicitud dispara `adjudicarLote` y esa funcion premia
        // al turno vivo menor, no a quien la invoco.
        medicion.turnoAdjudicado = disparo.data.adjudicacion.turno;
      }
    };

    /** Dispara una vez, en el instante exacto de la apertura. */
    const clienteDeReloj = async (
      lote: Lote,
      participanteId: string,
    ): Promise<Medicion> => {
      const medicion = medir("RELOJ", lote, participanteId, 0);
      await barreraDeApertura;
      medicion.intentos = 1;
      anotarDesenlace(medicion, await disparar(lote, participanteId));
      return medicion;
    };

    /** Reacciona entre `REACCION_MIN_MS` y `REACCION_MAX_MS` despues. */
    const clienteHumano = async (
      lote: Lote,
      participanteId: string,
      reaccionMs: number,
    ): Promise<Medicion> => {
      const medicion = medir("HUMANO", lote, participanteId, reaccionMs);
      await barreraDeApertura;
      await dormir(aperturaMs + reaccionMs - Date.now());
      medicion.intentos = 1;
      anotarDesenlace(medicion, await disparar(lote, participanteId));
      return medicion;
    };

    /**
     * Empieza antes de la apertura y reintenta hasta que la condicion deja de
     * rechazarlo.
     *
     * **Los rechazos previos son el dato.** Cuantos caben en el segundo anterior
     * a la apertura es lo que dice a que tasa hay que acotar, y hoy ninguno de
     * ellos deja rastro: el motor los devuelve como `invalid_state` y la ventana
     * de venta se cierra sin que nadie pueda contarlos despues.
     */
    const clienteDeBucle = async (
      lote: Lote,
      participanteId: string,
    ): Promise<Medicion> => {
      const medicion = medir("BUCLE", lote, participanteId, -ANTICIPACION_MS);
      await dormir(aperturaMs - ANTICIPACION_MS - Date.now());

      while (medicion.intentos < TOPE_DE_INTENTOS) {
        const antesDeAbrir = Date.now() < aperturaMs;
        medicion.intentos += 1;
        const disparo = await disparar(lote, participanteId);

        if (disparo.ok) {
          anotarDesenlace(medicion, disparo);
          return medicion;
        }
        if (disparo.estrangulado) medicion.estrangulados += 1;
        else if (antesDeAbrir) medicion.rechazadosAntesDeApertura += 1;
        // `invalid_state` antes de la apertura es el rechazo esperado; cualquier
        // otro codigo se conserva para que el informe lo muestre.
        medicion.error = disparo.error;
        await dormir(INTERVALO_REINTENTO_MS);
      }
      return medicion;
    };

    /**
     * El mismo bucle, **sin esperar las respuestas**.
     *
     * Es la diferencia que decide si la limitacion de tasa sirve de algo. El
     * bucle secuencial no puede superar un intento por viaje de red, asi que su
     * tasa la fija la latencia y no su intencion; la rafaga cubre el instante
     * de apertura a base de intentos en vuelo y **no necesita saber la hora**.
     * Si esta llega tan cerca de la apertura como el disparo exacto, entonces
     * conocer `inicioVenta` deja de ser la ventaja y acotar el bucle si cambia
     * quien gana.
     *
     * **Quema turnos y es correcto que los queme.** Cada intento que pasa la
     * condicion se lleva un `ADD` del contador, y solo el primero consigue
     * escribir la solicitud: el resto choca con el centinela de R-07 y deja un
     * hueco. Los huecos son legitimos (regla 16); lo que el informe publica es
     * cuantos, porque una fila con huecos en el primer segundo es justo la
     * senal que R25 pide vigilar.
     */
    const clienteDeRafaga = async (
      lote: Lote,
      participanteId: string,
    ): Promise<Medicion> => {
      const medicion = medir("RAFAGA", lote, participanteId, -ANTICIPACION_MS);
      await dormir(aperturaMs - ANTICIPACION_MS - Date.now());

      const enVuelo: Promise<Awaited<ReturnType<typeof disparar>>>[] = [];
      let alguienEntro = false;

      while (enVuelo.length < TOPE_DE_RAFAGA && !alguienEntro) {
        const disparo = disparar(lote, participanteId);
        enVuelo.push(disparo);
        void disparo.then((d) => {
          if (d.ok) alguienEntro = true;
        });
        await dormir(INTERVALO_RAFAGA_MS);
      }

      const disparos = await Promise.all(enVuelo);
      medicion.intentos = disparos.length;
      medicion.estrangulados = disparos.filter((d) => d.estrangulado).length;
      medicion.rechazadosAntesDeApertura = disparos.filter(
        (d) => !d.ok && !d.estrangulado && d.enMs < 0,
      ).length;
      // De los que entraron —normalmente uno solo, por R-07— se conserva el que
      // llego antes: es el que representa a este cliente en la fila.
      const entro = disparos
        .filter((d) => d.ok)
        .sort((a, b) => a.enMs - b.enMs)[0];
      anotarDesenlace(medicion, entro ?? disparos[disparos.length - 1]!);
      return medicion;
    };

    /** Todos los clientes de todos los lotes, a la vez. */
    const apertura = async (): Promise<Medicion[]> => {
      barreraDeApertura = armarBarrera();
      const clientes: Promise<Medicion>[] = [];

      for (const [l, lote] of lotes.entries()) {
        const nombre = (perfil: string, p: number): string => {
          const id = `equidad-p-${CORRIDA}-${String(l)}-${perfil}-${String(p)}`;
          particionesCreadas.add(clave.participante(id).PK);
          return id;
        };

        for (let p = 0; p < RELOJ; p += 1) {
          clientes.push(clienteDeReloj(lote, nombre("reloj", p)));
        }
        for (let p = 0; p < BUCLE; p += 1) {
          clientes.push(clienteDeBucle(lote, nombre("bucle", p)));
        }
        for (let p = 0; p < RAFAGA; p += 1) {
          clientes.push(clienteDeRafaga(lote, nombre("rafaga", p)));
        }
        for (let p = 0; p < HUMANOS; p += 1) {
          // Reparto uniforme del rango de reaccion: con pocas muestras, sortear
          // cada una dejaria el resultado a merced de la suerte.
          const reaccion =
            HUMANOS === 1
              ? Math.round((REACCION_MIN_MS + REACCION_MAX_MS) / 2)
              : Math.round(
                  REACCION_MIN_MS +
                    ((REACCION_MAX_MS - REACCION_MIN_MS) * p) / (HUMANOS - 1),
                );
          clientes.push(clienteHumano(lote, nombre("humano", p), reaccion));
        }
      }

      return Promise.all(clientes);
    };

    /**
     * Rellena `desfasePersistidoMs` leyendo la fila ya escrita.
     *
     * No es redundante con `desfaseDisparoMs`: comprueba en datos la afirmacion
     * del plan de que "a cuantos milisegundos de la apertura llego esta
     * persona" **ya es derivable hoy** de `solicitadoEn` y de `inicioVenta`,
     * sin escribir nada nuevo. Si los dos numeros coinciden, la evidencia que
     * la Etapa 16 quiere mostrar existe desde la Etapa 4.
     */
    const anotarDesdeLaFila = (items: Record<string, unknown>[]): void => {
      for (const item of items) {
        const medicion = mediciones.find(
          (m) => m.participanteId === item.participanteId,
        );
        if (!medicion) continue;
        const solicitadoEn = Date.parse(String(item.solicitadoEn));
        if (Number.isFinite(solicitadoEn)) {
          medicion.desfasePersistidoMs = solicitadoEn - aperturaMs;
        }
      }
    };

    const anotarDesfasePersistido = async (): Promise<void> => {
      for (const lote of lotes) {
        anotarDesdeLaFila(await leerFila(lote.loteId));
      }
    };

    /** `contadorTurnos` del lote: los `ADD` que pasaron la condicion. */
    const leerContadorDeTurnos = async (lote: Lote): Promise<number> => {
      const salida = await cliente.send(
        new GetCommand({
          TableName: process.env.AUTOB_TABLE_NAME,
          Key: clave.lote(lote.convocatoriaId, lote.loteId),
          ConsistentRead: true,
        }),
      );
      const contador = salida.Item?.contadorTurnos;
      return typeof contador === "number" ? contador : -1;
    };

    const leerFila = async (
      loteId: string,
    ): Promise<Record<string, unknown>[]> => {
      const salida = await cliente.send(
        new QueryCommand({
          TableName: process.env.AUTOB_TABLE_NAME,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
          ExpressionAttributeValues: {
            ":pk": clave.solicitud(loteId, 0).PK,
            ":sk": PREFIJO.solicitud,
          },
          ConsistentRead: true,
        }),
      );
      return salida.Items ?? [];
    };

    const deLote = (loteId: string): Medicion[] =>
      mediciones.filter((m) => m.loteId === loteId);

    const dePerfil = (perfil: Perfil): Medicion[] =>
      mediciones.filter((m) => m.perfil === perfil);

    const turnoMenorDe = (loteId: string): number | undefined => {
      const turnos = deLote(loteId)
        .map((m) => m.turno)
        .filter((t): t is number => t !== undefined);
      return turnos.length ? Math.min(...turnos) : undefined;
    };

    /**
     * Perfil que **encabeza** la fila del lote.
     *
     * Y no "el que gano", que es una pregunta distinta y peor: por R-08 el lote
     * le corresponde al turno vivo menor, asi que quien encabeza la fila es el
     * ganador con independencia de cuando se ejecute la adjudicacion. Si se
     * midiera solo a quien alcanzo a adjudicar en el acto, la rafaga podria
     * falsear el resultado sin ganar nada: sus intentos en vuelo hacen que la
     * adjudicacion se abstenga (R18) y el lote quede para el barrido — que
     * despues se lo dara igualmente al turno menor.
     */
    const perfilQueEncabeza = (loteId: string): Perfil | "ninguno" => {
      const turno = turnoMenorDe(loteId);
      if (turno === undefined) return "ninguno";
      return deLote(loteId).find((m) => m.turno === turno)?.perfil ?? "ninguno";
    };

    /**
     * Pares en los que el que disparo **antes** obtuvo un turno **mayor**.
     *
     * Es la medida directa de cuanto ruido de red hace falta para deshacer la
     * ventaja del reloj. Cero inversiones significa que el orden de la fila es
     * exactamente el orden de los relojes: el instante decide, sin remedio.
     */
    const inversiones = (): { pares: number; invertidos: number } => {
      let pares = 0;
      let invertidos = 0;
      for (const lote of lotes) {
        const conTurno = deLote(lote.loteId).filter(
          (m) => m.turno !== undefined && m.desfaseDisparoMs !== undefined,
        );
        for (const a of conTurno) {
          for (const b of conTurno) {
            if (a.desfaseDisparoMs! >= b.desfaseDisparoMs!) continue;
            pares += 1;
            if (a.turno! > b.turno!) invertidos += 1;
          }
        }
      }
      return { pares, invertidos };
    };

    const informe = (): void => {
      const conTurno = mediciones.filter((m) => m.turno !== undefined);
      const latencias = mediciones
        .map((m) => m.ms)
        .filter((ms): ms is number => ms !== undefined);
      const bucles = dePerfil("BUCLE");

      const porPerfil = Object.fromEntries(
        PERFILES.map((perfil) => [
          perfil,
          {
            turno: resumenDe(
              dePerfil(perfil)
                .map((m) => m.turno)
                .filter((t): t is number => t !== undefined),
            ),
            desfaseDisparoMs: resumenDe(
              dePerfil(perfil)
                .map((m) => m.desfaseDisparoMs)
                .filter((d): d is number => d !== undefined),
            ),
            desfasePersistidoMs: resumenDe(
              dePerfil(perfil)
                .map((m) => m.desfasePersistidoMs)
                .filter((d): d is number => d !== undefined),
            ),
          },
        ]),
      );

      // Por lote: ¿algun humano quedo delante de algun automatizado?
      const humanosPorDelante = lotes.filter((lote) => {
        const delLote = deLote(lote.loteId);
        const automatizados = delLote
          .filter((m) => m.perfil !== "HUMANO" && m.turno !== undefined)
          .map((m) => m.turno!);
        const humanos = delLote
          .filter((m) => m.perfil === "HUMANO" && m.turno !== undefined)
          .map((m) => m.turno!);
        if (!automatizados.length || !humanos.length) return false;
        return Math.min(...humanos) < Math.max(...automatizados);
      }).length;

      const encabezan = Object.fromEntries(
        [...PERFILES, "ninguno"].map((perfil) => [
          perfil,
          lotes.filter((lote) => perfilQueEncabeza(lote.loteId) === perfil)
            .length,
        ]),
      );

      const rechazadosAntes = bucles.reduce(
        (suma, m) => suma + m.rechazadosAntesDeApertura,
        0,
      );
      const rafagas = dePerfil("RAFAGA");
      const intentosDeRafaga = rafagas.reduce(
        (suma, m) => suma + m.intentos,
        0,
      );
      const antesDeAbrirEnRafaga = rafagas.reduce(
        (suma, m) => suma + m.rechazadosAntesDeApertura,
        0,
      );
      const turnosConsumidos = [...contadores.values()].reduce(
        (suma, n) => suma + n,
        0,
      );
      const huecos = Math.max(0, turnosConsumidos - conTurno.length);

      const resumen = {
        escenario: {
          lotes: LOTES,
          porLote: {
            reloj: RELOJ,
            bucle: BUCLE,
            rafaga: RAFAGA,
            humano: HUMANOS,
          },
          reaccionHumanaMs: [REACCION_MIN_MS, REACCION_MAX_MS],
          anticipacionDelBucleMs: ANTICIPACION_MS,
          intervaloDeReintentoMs: INTERVALO_REINTENTO_MS,
          solicitudes: mediciones.length,
          aceptadas: conTurno.length,
        },
        ventaja: {
          porPerfil,
          lotesEncabezadosPor: encabezan,
          lotesConAlgunHumanoPorDelante: humanosPorDelante,
          ...inversiones(),
          // Cuantos lotes se adjudicaron en el acto. Lo que falte quedo para el
          // barrido porque habia turnos en vuelo (R18) — se lo llevara el mismo
          // turno menor, solo que mas tarde.
          adjudicadosEnElActo: mediciones.filter(
            (m) => m.turnoAdjudicado !== undefined,
          ).length,
        },
        // Las dos formas del bucle, juntas, porque la comparacion **entre
        // ellas** es lo que dice a que tasa acotar: la secuencial es lo que la
        // red permite sin esfuerzo, la rafaga lo que un cliente decidido
        // alcanza.
        bucleDeReintentos: {
          limitacionDeTasaActiva: !SIN_LIMITE,
          secuencial: {
            intentos: resumenDe(bucles.map((m) => m.intentos)),
            rechazadosAntesDeLaApertura: rechazadosAntes,
            intentosPorSegundo: porSegundo(rechazadosAntes, bucles.length),
            estrangulados: bucles.reduce((s, m) => s + m.estrangulados, 0),
          },
          rafaga: {
            intentos: resumenDe(rafagas.map((m) => m.intentos)),
            rechazadosAntesDeLaApertura: antesDeAbrirEnRafaga,
            intentosPorSegundo: porSegundo(
              antesDeAbrirEnRafaga,
              rafagas.length,
            ),
            intentosTotales: intentosDeRafaga,
            estrangulados: rafagas.reduce((s, m) => s + m.estrangulados, 0),
          },
          // Lo que de verdad llego al motor de fila. Es la cifra que hay que
          // comparar entre las dos mediciones: la limitacion sirve si baja
          // esto sin tocar nada mas.
          intentosQueTocaronElMotor: [...intentosPorLote.values()].reduce(
            (suma, cuenta) => suma + cuenta.alcanzaronElMotor,
            0,
          ),
          rechazadosPorLaVentana: [...intentosPorLote.values()].reduce(
            (suma, cuenta) => suma + cuenta.rechazadosPorLaVentana,
            0,
          ),
          // Turnos que se consumieron sin producir solicitud: la huella que
          // deja cubrir el instante a base de intentos en paralelo.
          turnosConsumidos,
          huecosEnLasFilas: huecos,
        },
        // Linea base de R26: con esto se compara la corrida posterior a la
        // limitacion de tasa. Si empeora, la limitacion se pago de mas.
        latenciaMs: {
          p50: percentil(latencias, 50),
          p95: percentil(latencias, 95),
          maxima: latencias.length ? Math.max(...latencias) : 0,
        },
        rechazos: Object.fromEntries(
          mediciones
            .filter((m) => m.turno === undefined && m.error)
            .reduce((cuenta, m) => {
              cuenta.set(m.error!, (cuenta.get(m.error!) ?? 0) + 1);
              return cuenta;
            }, new Map<string, number>()),
        ),
      };

      // Salida deliberada: sin ella la prueba no entrega nada al operador.
      console.info(
        `\n=== Equidad del instante de apertura ===\n${JSON.stringify(resumen, null, 2)}\n`,
      );
    };

    // --- El escenario se monto de verdad ------------------------------------

    it("quien dispara una sola vez entra a la fila y nunca se estrangula", () => {
      // **Es la garantia de R26 en forma de prueba.** `RELOJ` y `HUMANO` hacen
      // un intento cada uno, que es lo que hace una persona por la pantalla: la
      // interfaz deshabilita el boton antes de la apertura y mientras hay una
      // peticion en vuelo. Si la limitacion llegara a tocarlos, estaria
      // degradando a todos para frenar a unos pocos, que es exactamente lo que
      // R26 advierte.
      //
      // `BUCLE` y `RAFAGA` si pueden quedarse fuera, y es el mecanismo
      // funcionando: gastan su cupo contra la ventana cerrada y llegan sin
      // intentos a la apertura.
      const deUnDisparo = [...dePerfil("RELOJ"), ...dePerfil("HUMANO")];

      expect(deUnDisparo.map((m) => m.estrangulados)).toEqual(
        deUnDisparo.map(() => 0),
      );
      expect(
        deUnDisparo
          .filter((m) => m.turno === undefined)
          .map((m) => `${m.perfil}/${m.loteId}: ${String(m.error)}`),
      ).toEqual([]);
    });

    it.skipIf(SIN_LIMITE)(
      "la limitacion acota los intentos que llegan al motor",
      () => {
        // Una ventana entera de margen: el escenario cruza el borde de la
        // ventana fija, asi que un cliente puede legitimamente juntar dos — la
        // holgura conocida de `ventanaDe`. Lo que no puede es seguir sin tope.
        for (const m of [...dePerfil("BUCLE"), ...dePerfil("RAFAGA")]) {
          expect(
            m.intentos - m.estrangulados,
            `${m.perfil}/${m.participanteId} colo ${String(m.intentos - m.estrangulados)} intentos`,
          ).toBeLessThanOrEqual(INTENTOS_POR_VENTANA * 2);
        }
      },
    );

    it("un intento anterior a la apertura no consume turno", () => {
      // Es la linea base de la verificacion de la Etapa 16: hoy un intento
      // antes de tiempo ya no gasta turno, y la limitacion de tasa no puede
      // empeorar eso. Si esto fallara, el bucle no habria empezado a tiempo y
      // la medicion no diria nada.
      expect(
        [...dePerfil("BUCLE"), ...dePerfil("RAFAGA")].every(
          (m) => m.rechazadosAntesDeApertura > 0,
        ),
      ).toBe(true);

      // Se contrasta contra `contadorTurnos` y **no** contra la ausencia de
      // huecos en la fila: la rafaga produce huecos legitimos (regla 16) al
      // quemar turnos que despues choca con R-07. Lo que si tiene que cuadrar
      // es que se hayan repartido tantos turnos como intentos pasaron la
      // condicion, ni uno mas.
      for (const lote of lotes) {
        const cuenta = intentosPorLote.get(lote.loteId);
        // Una carrera perdida haria ambigua la cuenta —`conflicto_concurrencia`
        // puede ocurrir antes o despues del `ADD`—, asi que se comprueba
        // primero que no hubo ninguna.
        expect(cuenta?.conflictos, `${lote.loteId} tuvo conflictos`).toBe(0);
        expect(
          contadores.get(lote.loteId),
          `${lote.loteId}: ${String(cuenta?.rechazadosPorLaVentana)} de ${String(cuenta?.alcanzaronElMotor)} rechazados por la ventana`,
        ).toBe(
          (cuenta?.alcanzaronElMotor ?? 0) -
            (cuenta?.rechazadosPorLaVentana ?? 0),
        );
      }
    });

    it("ningun lote se adjudica dos veces, y el que se adjudica va al turno menor", () => {
      // **No se exige que todos se adjudiquen en el acto.** Con una rafaga en
      // vuelo la adjudicacion se abstiene por R18 y el lote queda para el
      // barrido, que se lo dara al mismo turno menor. Exigirlo aqui convertiria
      // una abstencion correcta en una prueba intermitente.
      for (const lote of lotes) {
        const adjudicados = deLote(lote.loteId).filter(
          (m) => m.turnoAdjudicado !== undefined,
        );
        expect(adjudicados.length).toBeLessThanOrEqual(1);
        if (adjudicados.length === 1) {
          expect(adjudicados[0]!.turnoAdjudicado).toBe(
            turnoMenorDe(lote.loteId),
          );
        }
      }
    });

    it("la evidencia del desfase es derivable de lo ya persistido", () => {
      // `solicitadoEn - inicioVenta` reproduce el disparo medido. Es lo que el
      // plan afirma y lo que permite mostrar la evidencia sin escribir nada.
      const conAmbos = mediciones.filter(
        (m) =>
          m.desfasePersistidoMs !== undefined &&
          m.desfaseDisparoMs !== undefined,
      );
      expect(conAmbos.length).toBeGreaterThan(0);
      for (const m of conAmbos) {
        expect(
          Math.abs(m.desfasePersistidoMs! - m.desfaseDisparoMs!),
          `${m.perfil}/${m.participanteId}: persistido ${String(m.desfasePersistidoMs)} vs disparo ${String(m.desfaseDisparoMs)}`,
        ).toBeLessThan(1_000);
      }
    });
  },
);
