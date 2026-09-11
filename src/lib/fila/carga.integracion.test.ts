// @vitest-environment node
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { clave, PREFIJO, turnoDesdeClave } from "@/lib/data/claves";
import type { DepsDeServicio } from "@/lib/data/deps";
import type { ActorUsuario } from "@/types/auditoria";
import type { Lote } from "@/types/lote";
import { solicitarCompra } from "./solicitarCompra";
import { puedeUsarBackendReal } from "@/utils/backendUtilizable";

vi.mock("server-only", () => ({}));

/**
 * Prueba de carga de la apertura de una convocatoria — Etapa 12.
 *
 * **En que se distingue de `fila.integracion.test.ts`**, que ya lanza N
 * solicitudes en paralelo. Aquella prueba responde una pregunta de correccion
 * sobre **un** lote: ¿entran las N, los turnos son unicos, gana uno solo? Vive
 * en la compuerta y tiene que seguir ahi.
 *
 * Esta responde una pregunta de capacidad sobre **la convocatoria entera**:
 * cuando `inicioVenta` llega, no se abre un lote sino todos a la vez, y cada
 * uno arrastra su propia fila. Lo que se mide es lo que solo aparece a esa
 * escala:
 *
 *   - **Latencia.** Cuanto tarda una solicitud cuando compiten L x P a la vez.
 *     El p95 es lo que decide si la pantalla es usable en el unico momento en
 *     que todo el mundo la usa.
 *   - **Contencion.** Cuantos conflictos de transaccion produce el pico. Es el
 *     numero que calibra `UMBRAL_CONFLICTOS_POR_PERIODO` de
 *     `amplify/alarmas.ts`, que hoy es una estimacion y no una medida.
 *   - **Que la correccion aguante la escala.** Un lote se comporta bien con
 *     seis participantes; lo que no se sabe sin medirlo es si sigue
 *     comportandose bien con cien solicitudes concurrentes repartidas en diez
 *     particiones distintas. Las invariantes se vuelven a afirmar aqui: una
 *     prueba de carga que solo cronometra es un banco de pruebas, no una
 *     prueba.
 *
 * **Se omite salvo que se pida con `CARGA_APERTURA=1`.** Por las dos razones
 * de siempre, que son distintas entre si: sin AWS la compuerta tiene que poder
 * correr igual —una prueba que falla por falta de infraestructura deja de
 * distinguir "roto" de "no desplegado"—, y con AWS esto escribe cientos de
 * items y tarda, que es exactamente lo que `verify:rapido` existe para evitar.
 *
 *   npx ampx sandbox        # en otra terminal
 *   npm run carga:apertura
 *
 * Tamano del pico: `CARGA_LOTES` (10) y `CARGA_PARTICIPANTES` (10).
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
const seSolicito = process.env.CARGA_APERTURA === "1";

const LOTES = Number(process.env.CARGA_LOTES ?? "10");
const PARTICIPANTES = Number(process.env.CARGA_PARTICIPANTES ?? "10");
const HORAS_LIQUIDACION = 48;

/**
 * Techo del p95. **No es un objetivo de rendimiento.**
 *
 * Y la razon de que no pueda serlo la dieron dos corridas seguidas del mismo
 * escenario —10 lotes x 10 participantes contra el mismo sandbox— con diez
 * veces de diferencia entre ellas:
 *
 *   corrida en frio:  p50 1 709 ms · p95 15 525 ms ·  6,4 solicitudes/s
 *   corrida en caliente: p50 965 ms · p95  1 296 ms · 62,3 solicitudes/s
 *
 * Lo que cambio no fue DynamoDB: fueron los apretones de manos TLS. Con la
 * inspeccion corporativa de por medio (riesgo R11), abrir trescientas
 * conexiones nuevas domina por completo la primera corrida — antes de subir el
 * cupo de sockets ni siquiera completaba, fallaba con `ETIMEDOUT` al conectar.
 * La segunda reusa el agente HTTPS del proceso y mide algo mucho mas cercano a
 * la aplicacion.
 *
 * Asi que treinta segundos: holgado para que la corrida en frio pase, suficiente
 * para detectar una degradacion catastrofica. El p95 que se lleva a la revision
 * de capacidad se mide desde el entorno desplegado, y es lo que el informe
 * imprime.
 *
 * Ajustable con `CARGA_TECHO_P95_MS` para apretarlo donde la red no sea el
 * limite.
 */
const TECHO_P95_MS = Number(process.env.CARGA_TECHO_P95_MS ?? "30000");

const CORRIDA = randomUUID().slice(0, 8);

const actorDe = (participanteId: string): ActorUsuario => ({
  tipo: "USUARIO",
  id: participanteId,
  permisos: ["Autob_Venta_a_empleados"],
});

const percentil = (valores: readonly number[], p: number): number => {
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.min(
    ordenados.length - 1,
    Math.ceil((p / 100) * ordenados.length) - 1,
  );
  return ordenados[Math.max(0, indice)] ?? 0;
};

type Medicion = {
  loteId: string;
  ok: boolean;
  error?: string;
  adjudicacion?: string;
  /** Turno propio de quien solicito. */
  turno?: number;
  /**
   * Turno **al que se adjudico el lote**, presente solo en la medicion de quien
   * disparo la adjudicacion ganadora. No coincide con `turno`: toda solicitud
   * llama a `adjudicarLote`, y esa funcion premia al turno vivo menor de la
   * fila, no a quien la invoco.
   */
  turnoAdjudicado?: number;
  ms: number;
};

describe.skipIf(!hayBackend || !seSolicito)(
  "carga: apertura de una convocatoria con fila concurrente",
  () => {
    let dynamo: DynamoDBClient;
    let cliente: DynamoDBDocumentClient;
    let deps: DepsDeServicio;
    const particionesCreadas = new Set<string>();

    let lotes: Lote[];
    let mediciones: Medicion[];
    let duracionTotalMs: number;

    beforeAll(async () => {
      vi.stubEnv("AUTOB_TABLE_NAME", salidas!.tabla!);

      // El rol real de computo SSR, no las credenciales del desarrollador: la
      // carga tiene que atravesar la misma politica de IAM que produccion,
      // incluidos sus `Deny`.
      const sesion = await new STSClient({}).send(
        new AssumeRoleCommand({
          RoleArn: salidas!.rolComputoSsr!,
          RoleSessionName: "carga-apertura-etapa12",
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
        // **Con los reintentos del SDK, como en produccion.**
        //
        // El primer intento de esta prueba los desactivo (`maxAttempts: 1`)
        // razonando que un reintento "esconde la contencion". El razonamiento
        // estaba mal: `maxAttempts` vale 3 por omision y **eso es lo que corre
        // en produccion**, asi que medir sin reintentos mide una configuracion
        // que el sistema no tiene. La latencia que interesa es la que percibe
        // el participante, reintentos incluidos.
        //
        // Aquella corrida si sirvio para algo, y quedo registrado: sin la red
        // del SDK, `TransactionConflictException` escapaba de `solicitarCompra`
        // como excepcion sin atrapar en vez de responder
        // `conflicto_concurrencia` (`desafios-implementacion.md` 41). Se
        // reproduce con `CARGA_SIN_REINTENTOS=1`.
        ...(process.env.CARGA_SIN_REINTENTOS === "1" ? { maxAttempts: 1 } : {}),
        // El agente HTTPS de Node trae 50 sockets por omision, y
        // `LOTES x PARTICIPANTES` solicitudes son el triple de peticiones en
        // vuelo: cada `solicitarCompra` hace tres escrituras. Sin subir el
        // cupo, lo que se mide es la cola de sockets de este proceso y no
        // DynamoDB.
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

      lotes = await crearConvocatoria();
      const inicio = performance.now();
      mediciones = await pico();
      duracionTotalMs = performance.now() - inicio;

      informe();
    });

    afterAll(async () => {
      // Los items `AUDIT#` no se purgan: el rol tiene `DeleteItem` denegado
      // sobre ellos, que es la garantia de la Etapa 3. Quedan como rastro.
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

    /** Una convocatoria publicada con `LOTES` lotes abiertos a la vez. */
    const crearConvocatoria = async (): Promise<Lote[]> => {
      const tabla = process.env.AUTOB_TABLE_NAME;
      const convocatoriaId = `carga-conv-${CORRIDA}`;
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
      particionesCreadas.add(clave.convocatoria(convocatoriaId).PK);

      const creados: Lote[] = [];
      for (let i = 0; i < LOTES; i += 1) {
        const sufijo = `${CORRIDA}-${String(i)}`;
        const loteId = `carga-lote-${sufijo}`;
        const vehiculoId = `carga-veh-${sufijo}`;

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

        particionesCreadas.add(clave.vehiculo(vehiculoId).PK);
        particionesCreadas.add(clave.solicitud(loteId, 0).PK);
        creados.push(lote);
      }

      return creados;
    };

    /**
     * `LOTES x PARTICIPANTES` solicitudes disparadas de una vez.
     *
     * **Un participante distinto por lote y por posicion.** Reutilizar uno
     * entre lotes seria medir otra cosa: el centinela
     * `PART#<id> / ADJUDICACION_ACTIVA` sobrevive al lote —tiene que hacerlo,
     * es lo que garantiza R-09—, asi que quien ya gano un lote llega al
     * siguiente con adjudicacion activa y R-09 lo congela. Correcto, y no lo
     * que esta prueba mide.
     */
    const pico = async (): Promise<Medicion[]> =>
      Promise.all(
        lotes.flatMap((lote, l) =>
          Array.from({ length: PARTICIPANTES }, async (_, p) => {
            const participanteId = `carga-p-${CORRIDA}-${String(l)}-${String(p)}`;
            particionesCreadas.add(
              clave.centinelaAdjudicacion(participanteId).PK,
            );

            const inicio = performance.now();
            const resultado = await solicitarCompra(
              { lote, participanteId, actor: actorDe(participanteId) },
              deps,
            );
            const ms = Math.round(performance.now() - inicio);

            if (!resultado.ok) {
              return {
                loteId: lote.loteId,
                ok: false,
                error: resultado.error,
                ms,
              };
            }

            const adjudicacion = resultado.data.adjudicacion;
            return {
              loteId: lote.loteId,
              ok: true,
              // El turno **propio** de quien solicito.
              turno: resultado.data.turno,
              adjudicacion: adjudicacion.estado,
              // El turno **al que se adjudico el lote**, que no tiene por que
              // ser el propio: toda solicitud dispara `adjudicarLote`, y esa
              // funcion premia al turno vivo menor de la fila, no a quien la
              // invoco. Confundir los dos era un defecto de esta prueba —
              // afirmaba que "gana el turno menor" comparando contra el turno
              // del **llamador** y fallaba con el sistema comportandose bien.
              ...(adjudicacion.estado === "adjudicado"
                ? { turnoAdjudicado: adjudicacion.turno }
                : {}),
              ms,
            };
          }),
        ),
      );

    /**
     * Turnos de la fila, tal como los devuelve la clave.
     *
     * Se conserva el `undefined` que `turnoDesdeClave` puede devolver en vez
     * de sustituirlo por cero: un `SK` mal formado es un defecto de
     * construccion de claves, y colapsarlo a cero lo disfrazaria de turno
     * legitimo justo en la prueba que existe para ver si la escala rompe algo.
     */
    const leerFila = async (
      loteId: string,
    ): Promise<(number | undefined)[]> => {
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
      return (salida.Items ?? []).map((item) =>
        turnoDesdeClave(String(item.SK)),
      );
    };

    /**
     * El informe **es** el entregable de esta prueba.
     *
     * Las afirmaciones de abajo solo detectan una degradacion catastrofica; el
     * valor esta en los numeros, que es lo que el operador lleva a
     * `UMBRAL_CONFLICTOS_POR_PERIODO` y a la revision de capacidad de
     * `modelo-datos-dynamodb.md`. Por eso se imprime siempre, tambien cuando
     * todo pasa.
     */
    const informe = (): void => {
      const latencias = mediciones.map((m) => m.ms);
      const porError = new Map<string, number>();
      for (const medicion of mediciones) {
        if (!medicion.ok && medicion.error) {
          porError.set(medicion.error, (porError.get(medicion.error) ?? 0) + 1);
        }
      }

      const resumen = {
        lotes: LOTES,
        participantesPorLote: PARTICIPANTES,
        solicitudes: mediciones.length,
        aceptadas: mediciones.filter((m) => m.ok).length,
        rechazadas: mediciones.filter((m) => !m.ok).length,
        porError: Object.fromEntries(porError),
        adjudicadas: mediciones.filter((m) => m.adjudicacion === "adjudicado")
          .length,
        abstenidas: mediciones.filter((m) => m.adjudicacion === "abstenido")
          .length,
        duracionTotalMs: Math.round(duracionTotalMs),
        solicitudesPorSegundo:
          Math.round((mediciones.length / duracionTotalMs) * 100_000) / 100,
        latenciaMs: {
          p50: percentil(latencias, 50),
          p95: percentil(latencias, 95),
          maxima: Math.max(...latencias),
        },
      };

      // Salida deliberada, no depuracion olvidada: sin ella la prueba no
      // entrega nada al operador.
      console.info(
        `\n=== Carga de apertura ===\n${JSON.stringify(resumen, null, 2)}\n`,
      );
    };

    // --- Correccion, a escala -------------------------------------------------

    it("ninguna solicitud se pierde por contencion", () => {
      // Un rechazo por `conflicto_concurrencia` en el pico no es una carrera
      // aceptable: es el defecto que hundio a la variante descartada de R18,
      // que perdia entre 5 y 9 de cada 10. Que no reaparezca al multiplicar
      // por diez las particiones simultaneas es la razon de esta prueba.
      const rechazadas = mediciones.filter((m) => !m.ok);
      expect(rechazadas.map((m) => `${m.loteId}: ${String(m.error)}`)).toEqual(
        [],
      );
    });

    it("cada lote adjudica exactamente una vez", () => {
      for (const lote of lotes) {
        const ganadores = mediciones.filter(
          (m) => m.loteId === lote.loteId && m.adjudicacion === "adjudicado",
        );
        expect(
          ganadores,
          `el lote ${lote.loteId} tuvo ${String(ganadores.length)} ganadores`,
        ).toHaveLength(1);
      }
    });

    it("el lote se adjudica al turno menor de su fila, tambien bajo carga", () => {
      // R-08: el orden manda sobre el tiempo. Es la invariante que la escala
      // podria romper si la abstencion por reservas se comportara distinto con
      // muchas particiones compitiendo por el mismo cupo de escritura.
      //
      // Se compara el turno **adjudicado** contra el menor de la fila. Comparar
      // el turno de quien disparo la adjudicacion ganadora seria otra cosa y
      // fallaria con el sistema funcionando bien: quien la dispara es el ultimo
      // en aterrizar, y el premiado es el turno vivo menor.
      for (const lote of lotes) {
        const delLote = mediciones.filter((m) => m.loteId === lote.loteId);
        const adjudicado = delLote.find(
          (m) => m.turnoAdjudicado !== undefined,
        )?.turnoAdjudicado;
        const turnoMenor = Math.min(
          ...delLote.map((m) => m.turno ?? Number.MAX_SAFE_INTEGER),
        );

        expect(
          adjudicado,
          `el lote ${lote.loteId} se adjudico al turno ${String(adjudicado)}` +
            ` y el menor de su fila era ${String(turnoMenor)}`,
        ).toBe(turnoMenor);
      }
    });

    it("los turnos de cada fila son unicos y ordenados", async () => {
      for (const lote of lotes) {
        const turnos = await leerFila(lote.loteId);
        expect(turnos).toHaveLength(PARTICIPANTES);
        expect(
          turnos.filter((turno) => turno === undefined),
          `el lote ${lote.loteId} tiene claves de solicitud mal formadas`,
        ).toEqual([]);

        const numeros = turnos as number[];
        expect(new Set(numeros).size).toBe(numeros.length);
        // La `Query` los devuelve ordenados por construccion (el relleno de
        // ceros de la `SK`), asi que esto comprueba que las claves se armaron
        // bien tambien con diez particiones compitiendo. Los huecos son
        // legitimos; el desorden y los repetidos no.
        expect([...numeros].sort((a, b) => a - b)).toEqual(numeros);
      }
    });

    // --- Capacidad -----------------------------------------------------------

    it("el p95 se mantiene por debajo del techo de degradacion", () => {
      // Detector de degradacion catastrofica, no objetivo de rendimiento: desde
      // una maquina con inspeccion TLS el limite es el establecimiento de
      // conexion y no DynamoDB. El numero medido lo imprime el informe, y es lo
      // que de verdad se lleva a la revision de capacidad.
      const p95 = percentil(
        mediciones.map((m) => m.ms),
        95,
      );
      expect(p95).toBeLessThan(TECHO_P95_MS);
    });
  },
);
