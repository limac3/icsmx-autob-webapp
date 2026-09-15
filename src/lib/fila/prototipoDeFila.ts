import "server-only";

// Prototipo del riesgo R18 — la carrera entre el paso 1 y el paso 2 de T1.
//
// `modelo-datos-dynamodb.md` seccion 6 declara que el diseno de T1 **todavia no
// es correcto y no debe implementarse tal cual**: entre el `ADD` que entrega el
// turno y el `Put` que hace visible la solicitud hay una ventana en la que el
// turno existe pero la fila no lo ve, asi que un turno mayor puede ganar la
// adjudicacion. Este archivo existe para decidir esa cuestion con evidencia y
// no con argumentos, antes de escribir la Etapa 8.
//
// Por eso implementa **tres variantes de la misma operacion**, para poder
// contrastarlas contra DynamoDB real:
//
//   - `ingenuo`            — T1 tal como esta escrito hoy en el documento.
//   - `reservas_en_lote`   — el mecanismo candidato que el documento propone:
//                            la reserva es un atributo mapa del item del lote.
//   - `reservas_por_item`  — la reserva es un item propio en la particion del
//                            lote.
//
// La comparacion es el prototipo. Sin la variante ingenua no habria con que
// comprobar que el arnes de prueba de verdad ejerce la carrera, y sin la
// candidata no quedaria registrado **por que** se descarto: cierra la carrera,
// pero mete el item del lote dentro de una `TransactWriteItems` que N
// solicitudes ejecutan a la vez, y ahi DynamoDB no serializa sino que cancela
// con `TransactionConflict`. Es la misma disciplina de falsificacion de la
// Etapa 4: una invariante que no se sabe romper no esta probada.
//
// **No es codigo de produccion.** La Etapa 8 escribira `solicitarCompra.ts` y
// `adjudicarLote.ts` con validacion de permisos, DTOs sin identidades (R-12),
// correo por outbox y el estado `CONGELADA`. Aqui solo esta el nucleo de
// concurrencia, que es lo unico que una prueba de integracion puede decidir.

import { randomUUID } from "node:crypto";

import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

import { clave, PREFIJO, turnoDesdeClave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import {
  CONDICION_CENTINELA_NUEVO,
  CONDICION_LOTE_LIBRE,
  ejecutarTransaccion,
  esFalloDeCondicion,
  putDeEvento,
  type ItemDeTransaccion,
} from "@/lib/data/transacciones";
import { calcularVenceEn } from "@/lib/domain/plazos";
import type { CodigoError } from "@/types/resultado";

export const VARIANTES = [
  "ingenuo",
  "reservas_en_lote",
  "reservas_por_item",
] as const;
export type Variante = (typeof VARIANTES)[number];

/** Atributo mapa del lote que usa la variante `reservas_en_lote`. */
export const ATRIBUTO_RESERVAS = "reservas";

/**
 * El centinela de adjudicacion activa, **congelado aqui como registro
 * historico**.
 *
 * Este prototipo reproduce T1 y T2 **tal como eran cuando se decidio R18**, y
 * entonces R-09 era "una sola adjudicacion activa en todo el sistema",
 * garantizada por un `PART#<id> / ADJUDICACION_ACTIVA`. La Etapa 14 sustituyo
 * esa regla por el cupo por convocatoria y retiro el constructor de
 * `claves.ts`.
 *
 * Se copia la forma de la clave en vez de migrar el prototipo al cupo, y es
 * deliberado: **este archivo no es codigo de produccion, es la evidencia de una
 * decision ya tomada.** Actualizarlo para seguir al motor lo convertiria en una
 * segunda implementacion que mantener, y peor, invalidaria lo que demuestra —
 * la comparacion entre las tres variantes solo significa algo si las tres son
 * las que se midieron. La prueba que lo ejerce vive en el sandbox y limpia sus
 * propias particiones.
 */
const centinelaAdjudicacionDelPrototipo = (
  participanteId: string,
): { PK: string; SK: string } => ({
  PK: `PART#${participanteId}`,
  SK: "ADJUDICACION_ACTIVA",
});

/**
 * La reserva sigue viva en el momento de retirarla.
 *
 * Es la condicion que convierte el umbral en un compromiso de **espera** y no
 * de correccion: si la adjudicacion ya dio la reserva por muerta, el paso 2 no
 * se aplica y el turno se pierde.
 */
const CONDICION_RESERVA_VIVA = "attribute_exists(SK)";

/**
 * Cuanto se espera a una reserva antes de darla por muerta.
 *
 * Acota la **espera**, no la correccion: el paso 2 exige que su reserva siga
 * viva, asi que un proceso al que se le dio por muerto no puede escribir su
 * solicitud tarde. Pasado el umbral, el unico efecto es que ese turno se pierde
 * y queda un hueco, que el diseno ya acepta.
 *
 * 15 s es dos ordenes de magnitud mas que el viaje de red que separa los dos
 * pasos, y mucho menos que la paciencia de quien espera el resultado.
 */
export const UMBRAL_DE_RESERVA_MS = 15_000;

/**
 * Reintentos de la adjudicacion ante `TransactionConflict`.
 *
 * El item del lote es el mutex de la adjudicacion: dos procesos que intentan
 * adjudicar a la vez **tienen** que tocarlo. Cuando DynamoDB cancela por
 * conflicto no dice quien gano, asi que releer y reintentar es la unica
 * respuesta correcta. Es distinto del conflicto que hunde a `reservas_en_lote`:
 * alli el item caliente esta en el camino de **toda solicitud**, aqui solo en
 * el de la adjudicacion, que ocurre una vez.
 */
export const INTENTOS_DE_ADJUDICACION = 4;

export type DepsDeFila = { cliente: DynamoDBDocumentClient };

const dormir = (ms: number): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));

// --- Paso 1: el contador atomico --------------------------------------------

export type TurnoReservado = {
  turno: number;
  /**
   * Identificador de **este intento**, no del participante. Se genera nuevo
   * cada vez para que retirar una reserva no pueda retirar la de otro intento.
   */
  reservaId: string;
};

export type ResultadoPaso1 =
  { ok: true; datos: TurnoReservado } | { ok: false; error: CodigoError };

export type EntradaDePaso1 = {
  convocatoriaId: string;
  loteId: string;
  ahora: Date;
};

/**
 * Condicion del paso 1: la venta esta abierta y el lote todavia admite fila.
 *
 * **No exige `estatus = EN_OFERTA`**, y esa diferencia con el texto de T1 es
 * deliberada. Con adjudicacion inmediata el primer turno pasa el lote a
 * `ADJUDICADO` a los pocos segundos de `inicioVenta`; exigir `EN_OFERTA`
 * cerraria la fila justo ahi y dejaria sin sentido `miPosicion`, `tamanoFila`,
 * la reasignacion de R-15 y el propio R-17, que dice que el lote "sigue
 * disponible para quien solicite despues, mientras la venta siga abierta".
 * Lo que si debe cerrar la fila es un lote vendido, no vendido o retirado.
 */
const CONDICION_LOTE_ADMITE_FILA =
  "(estatus = :enOferta OR estatus = :adjudicado)" +
  " AND estatusConvocatoria = :publicada" +
  " AND inicioVenta <= :ahora AND finVenta > :ahora";

/**
 * Paso 1 de T1: el `UpdateItem` atomico sobre el lote que entrega el turno.
 *
 * La condicion mira los atributos desnormalizados del lote, como manda el
 * documento: leer la convocatoria y decidir despues seria justo la carrera que
 * el diseno evita. Que esos atributos sean fiables depende de que la
 * propagacion de T8 deje siempre el estado intermedio mas restrictivo; el
 * `ConditionCheck` del paso 2 que buscaba lo mismo resulto inviable bajo rafaga
 * y esta ahi solo para poder medirlo.
 *
 * Cada variante marca la ventana a su manera:
 *
 *  - `reservas_en_lote` anota la reserva en la **misma** escritura del contador.
 *  - `reservas_por_item` escribe la reserva **antes** de pedir el turno. El
 *    orden es lo que la hace correcta: si se escribiera despues, entre el
 *    contador y la reserva quedaria abierta exactamente la ventana que se
 *    quiere cerrar. Al reves, lo peor que pasa es una reserva huerfana que
 *    nadie reclama y que el umbral depura.
 */
export const reservarTurno = async (
  variante: Variante,
  entrada: EntradaDePaso1,
  deps: DepsDeFila,
): Promise<ResultadoPaso1> => {
  const tabla = nombreDeTabla();
  const reservaId = randomUUID();
  const ahora = entrada.ahora.toISOString();

  if (variante === "reservas_por_item") {
    await deps.cliente.send(
      new PutCommand({
        TableName: tabla,
        Item: {
          ...clave.reservaDeTurno(entrada.loteId, reservaId),
          anotadaEn: ahora,
        },
      }),
    );
  }

  const enLote = variante === "reservas_en_lote";

  try {
    const salida = await deps.cliente.send(
      new UpdateCommand({
        TableName: tabla,
        Key: clave.lote(entrada.convocatoriaId, entrada.loteId),
        UpdateExpression: enLote
          ? `SET ${ATRIBUTO_RESERVAS}.#reserva = :ahora ADD contadorTurnos :uno`
          : "ADD contadorTurnos :uno",
        ConditionExpression: CONDICION_LOTE_ADMITE_FILA,
        ...(enLote
          ? { ExpressionAttributeNames: { "#reserva": reservaId } }
          : {}),
        ExpressionAttributeValues: {
          ":uno": 1,
          ":ahora": ahora,
          ":enOferta": "EN_OFERTA",
          ":adjudicado": "ADJUDICADO",
          ":publicada": "PUBLICADA",
        },
        ReturnValues: "UPDATED_NEW",
      }),
    );

    const turno = salida.Attributes?.contadorTurnos;
    if (typeof turno !== "number") {
      // `UPDATED_NEW` sobre un `ADD` siempre devuelve el contador. Si no lo
      // hace, el turno se perdio y no hay forma segura de continuar.
      throw new Error(
        `El paso 1 no devolvio el turno del lote ${entrada.loteId}`,
      );
    }
    return { ok: true, datos: { turno, reservaId } };
  } catch (error) {
    if (!esFalloDeCondicion(error)) throw error;
    // La reserva ya escrita no corresponde a ningun turno: se retira para no
    // detener adjudicaciones ajenas hasta que venza el umbral.
    await liberarReserva(variante, { ...entrada, reservaId }, deps);
    return { ok: false, error: "lote_no_disponible" };
  }
};

// --- Paso 2: la solicitud se hace visible ------------------------------------

export type EntradaDePaso2 = EntradaDePaso1 & {
  participanteId: string;
  turno: number;
  reservaId: string;
  /** Informativo (R-08). Las pruebas lo escriben desordenado a proposito. */
  solicitadoEn: Date;
  /**
   * Incluir el `ConditionCheck` sobre la convocatoria que T1 trae escrito
   * contra la publicacion parcial.
   *
   * Es una opcion y no una constante porque el prototipo tiene que **medirla**:
   * ese item apunta a un unico registro que comparten todas las solicitudes de
   * la convocatoria, y dentro de una transaccion un `ConditionCheck` retiene el
   * item igual que una escritura. Ver la prueba de rafaga correspondiente.
   */
  verificarConvocatoriaEnTransaccion?: boolean;
};

export type ResultadoPaso2 =
  { ok: true } | { ok: false; error: CodigoError; detalle?: string };

/**
 * Paso 2 de T1: la `TransactWriteItems` que hace visible la solicitud.
 *
 * El orden de los items no es decorativo. `traducirCancelacion` se queda con el
 * **primer** motivo distinto de `None`, asi que la posicion fija la prioridad
 * del diagnostico cuando fallan varias condiciones a la vez: "ya estabas en la
 * fila" antes que "la convocatoria dejo de estar publicada", y esa antes que
 * "tu reserva ya se dio por muerta".
 */
export const registrarSolicitud = async (
  variante: Variante,
  entrada: EntradaDePaso2,
  deps: DepsDeFila,
): Promise<ResultadoPaso2> => {
  const tabla = nombreDeTabla();
  const solicitudId = `${entrada.loteId}-${entrada.turno}`;

  const items: ItemDeTransaccion[] = [
    {
      item: {
        Put: {
          TableName: tabla,
          Item: {
            ...clave.solicitud(entrada.loteId, entrada.turno),
            turno: entrada.turno,
            participanteId: entrada.participanteId,
            estatus: "EN_FILA",
            solicitadoEn: entrada.solicitadoEn.toISOString(),
          },
        },
      },
      siFalla: "conflicto_concurrencia",
      descripcion: `solicitud turno ${entrada.turno}`,
    },
    {
      item: {
        Put: {
          TableName: tabla,
          Item: {
            ...clave.centinelaFila(entrada.loteId, entrada.participanteId),
            turno: entrada.turno,
          },
          ConditionExpression: CONDICION_CENTINELA_NUEVO,
        },
      },
      siFalla: "already_in_queue",
      descripcion: "centinela de fila (R-07)",
    },
    putDeEvento(
      clave.evento(
        "SOLICITUD",
        solicitudId,
        entrada.ahora.toISOString(),
        randomUUID(),
      ),
      {
        tipo: "SOLICITUD_CREADA",
        actor: entrada.participanteId,
        turno: entrada.turno,
      },
    ),
  ];

  if (entrada.verificarConvocatoriaEnTransaccion === true) {
    items.push({
      item: {
        ConditionCheck: {
          TableName: tabla,
          Key: clave.convocatoria(entrada.convocatoriaId),
          ConditionExpression: "estatus = :publicada",
          ExpressionAttributeValues: { ":publicada": "PUBLICADA" },
        },
      },
      siFalla: "lote_no_disponible",
      descripcion: "convocatoria publicada (publicacion parcial)",
    });
  }

  // El retiro de la reserva viaja **dentro** de la transaccion: si viajara
  // fuera, entre hacer visible la solicitud y retirar la reserva habria otra
  // ventana, mas pequena pero de la misma naturaleza.
  //
  // La condicion de existencia es lo que hace seguro el umbral. Sin ella el
  // mecanismo seria solo una espera cortes: un proceso al que ya se le dio por
  // muerto escribiria su solicitud con un turno menor que el del ganador y
  // reabriria la carrera, mas dificil de reproducir. Con ella, quien pierde su
  // reserva pierde su turno y queda un hueco.
  if (variante === "reservas_en_lote") {
    items.push({
      item: {
        Update: {
          TableName: tabla,
          Key: clave.lote(entrada.convocatoriaId, entrada.loteId),
          UpdateExpression: `REMOVE ${ATRIBUTO_RESERVAS}.#reserva`,
          ConditionExpression: `attribute_exists(${ATRIBUTO_RESERVAS}.#reserva)`,
          ExpressionAttributeNames: { "#reserva": entrada.reservaId },
        },
      },
      siFalla: "conflicto_concurrencia",
      descripcion: "retiro de la reserva del turno (en el lote)",
    });
  }

  if (variante === "reservas_por_item") {
    items.push({
      item: {
        Delete: {
          TableName: tabla,
          Key: clave.reservaDeTurno(entrada.loteId, entrada.reservaId),
          ConditionExpression: CONDICION_RESERVA_VIVA,
        },
      },
      siFalla: "conflicto_concurrencia",
      descripcion: "retiro de la reserva del turno (item propio)",
    });
  }

  const resultado = await ejecutarTransaccion(items, { cliente: deps.cliente });
  if (resultado.ok) return { ok: true };

  // La transaccion no ocurrio, pero el turno ya se consumio: sin esta
  // compensacion la reserva bloquearia la adjudicacion hasta el umbral. Es una
  // optimizacion de espera —la correccion no depende de ella— y por eso puede
  // ser de mejor esfuerzo.
  await liberarReserva(variante, entrada, deps);

  return {
    ok: false,
    error: resultado.error,
    detalle: resultado.descripcion,
  };
};

/**
 * Retira una reserva. Idempotente: que ya no exista es exito, no error.
 *
 * Sirve para compensar un paso 1 o un paso 2 fallidos y para depurar reservas
 * muertas desde la adjudicacion.
 */
export const liberarReserva = async (
  variante: Variante,
  entrada: { convocatoriaId: string; loteId: string; reservaId: string },
  deps: DepsDeFila,
): Promise<void> => {
  if (variante === "ingenuo") return;

  try {
    if (variante === "reservas_por_item") {
      await deps.cliente.send(
        new DeleteCommand({
          TableName: nombreDeTabla(),
          Key: clave.reservaDeTurno(entrada.loteId, entrada.reservaId),
        }),
      );
      return;
    }

    await deps.cliente.send(
      new UpdateCommand({
        TableName: nombreDeTabla(),
        Key: clave.lote(entrada.convocatoriaId, entrada.loteId),
        UpdateExpression: `REMOVE ${ATRIBUTO_RESERVAS}.#reserva`,
        ConditionExpression: `attribute_exists(${ATRIBUTO_RESERVAS}.#reserva)`,
        ExpressionAttributeNames: { "#reserva": entrada.reservaId },
      }),
    );
  } catch (error) {
    if (esFalloDeCondicion(error)) return;
    throw error;
  }
};

// --- Adjudicacion (T2) -------------------------------------------------------

export type ResultadoDeAdjudicacion =
  | { estado: "adjudicado"; turno: number; participanteId: string }
  | { estado: "abstenido"; reservasVigentes: number }
  | { estado: "ya_adjudicado" }
  | { estado: "fila_agotada" }
  | { estado: "en_conflicto" };

export type EntradaDeAdjudicacion = {
  convocatoriaId: string;
  loteId: string;
  ahora: Date;
  horasLiquidacion: number;
  umbralDeReservaMs?: number;
  intentos?: number;
};

type Candidato = { turno: number; participanteId: string };

/**
 * T2 con el bucle de candidatos por fuera, mas la abstencion que resuelve R18.
 *
 * Si el lote tiene alguna reserva vigente hay un turno en vuelo que la fila
 * todavia no muestra, y adjudicar ahora podria coronar a un turno mayor.
 *
 * **Las reservas se leen antes que la fila, y ese orden es parte del
 * mecanismo.** Al reves no sirve: una solicitud cuyo paso 2 se confirmara entre
 * la lectura de la fila y la de las reservas no apareceria en la primera y ya
 * no tendria reserva en la segunda, de modo que quedaria invisible por ambos
 * lados. Leyendo las reservas primero, toda reserva ausente pertenece a una
 * solicitud que o bien ya esta escrita —y la `Query` consistente posterior la
 * vera— o bien nunca se escribira.
 */
export const adjudicar = async (
  variante: Variante,
  entrada: EntradaDeAdjudicacion,
  deps: DepsDeFila,
): Promise<ResultadoDeAdjudicacion> => {
  const intentos = entrada.intentos ?? INTENTOS_DE_ADJUDICACION;

  for (let intento = 0; intento < intentos; intento += 1) {
    const resultado = await intentarRonda(variante, entrada, deps);
    if (resultado.estado !== "en_conflicto") return resultado;
    // Espera con jitter: sin el, dos procesos en conflicto reintentan en fase y
    // vuelven a chocar.
    await dormir(25 * (intento + 1) + Math.floor(Math.random() * 25));
  }
  return { estado: "en_conflicto" };
};

const intentarRonda = async (
  variante: Variante,
  entrada: EntradaDeAdjudicacion,
  deps: DepsDeFila,
): Promise<ResultadoDeAdjudicacion> => {
  if (variante !== "ingenuo") {
    const vigentes = await depurarYContarReservas(variante, entrada, deps);
    if (vigentes > 0)
      return { estado: "abstenido", reservasVigentes: vigentes };
  }

  for (const candidato of await leerFila(entrada.loteId, deps)) {
    const resultado = await intentarAdjudicar(candidato, entrada, deps);

    if (resultado.ok) {
      return {
        estado: "adjudicado",
        turno: candidato.turno,
        participanteId: candidato.participanteId,
      };
    }
    // Fallo el item 1: otro proceso ya adjudico el lote. Se aborta, no se
    // reintenta con el siguiente — el lote ya no esta en juego.
    if (resultado.error === "lote_no_disponible") {
      return { estado: "ya_adjudicado" };
    }
    // Cancelacion por conflicto: no dice quien gano. Releer y reintentar es la
    // unica respuesta correcta; decidir aqui seria adivinar.
    if (resultado.error === "conflicto_concurrencia") {
      return { estado: "en_conflicto" };
    }
    // Fallo el item 2 (la solicitud cambio de estado) o el item 3 (el candidato
    // ya tiene una adjudicacion activa, R-09): se sigue con el turno siguiente.
  }

  return { estado: "fila_agotada" };
};

/**
 * Cuenta las reservas vigentes y retira las muertas.
 *
 * La lectura es **fuertemente consistente** y decide unicamente si abstenerse.
 * No concede nada: la adjudicacion la sigue ganando la escritura condicional
 * del item 1 de T2 (regla 6). Una lectura que solo puede detener nunca puede
 * autorizar de mas.
 */
const depurarYContarReservas = async (
  variante: Variante,
  entrada: EntradaDeAdjudicacion,
  deps: DepsDeFila,
): Promise<number> => {
  const umbral = entrada.umbralDeReservaMs ?? UMBRAL_DE_RESERVA_MS;
  const anotadas =
    variante === "reservas_por_item"
      ? await leerReservasPorItem(entrada.loteId, deps)
      : await leerReservasEnLote(entrada, deps);

  let vigentes = 0;
  for (const [reservaId, anotadaEn] of anotadas) {
    const edad = entrada.ahora.getTime() - Date.parse(anotadaEn);
    if (Number.isFinite(edad) && edad <= umbral) {
      vigentes += 1;
      continue;
    }
    // Muerta. Retirarla es lo que impide que un proceso caido bloquee el lote
    // para siempre; su paso 2, si algun dia llega, fallara por la condicion.
    await liberarReserva(variante, { ...entrada, reservaId }, deps);
  }
  return vigentes;
};

const leerReservasPorItem = async (
  loteId: string,
  deps: DepsDeFila,
): Promise<[string, string][]> => {
  const salida = await deps.cliente.send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefijo)",
      ExpressionAttributeValues: {
        ":pk": clave.reservaDeTurno(loteId, "x").PK,
        ":prefijo": PREFIJO.reservaDeTurno,
      },
      ConsistentRead: true,
    }),
  );
  return (salida.Items ?? []).map((item) => [
    String(item.SK).slice(PREFIJO.reservaDeTurno.length),
    String(item.anotadaEn),
  ]);
};

const leerReservasEnLote = async (
  entrada: EntradaDeAdjudicacion,
  deps: DepsDeFila,
): Promise<[string, string][]> => {
  const lote = await deps.cliente.send(
    new GetCommand({
      TableName: nombreDeTabla(),
      Key: clave.lote(entrada.convocatoriaId, entrada.loteId),
      ConsistentRead: true,
    }),
  );
  const reservas = lote.Item?.[ATRIBUTO_RESERVAS];
  if (typeof reservas !== "object" || reservas === null) return [];
  return Object.entries(reservas as Record<string, unknown>).map(
    ([reservaId, anotadaEn]) => [reservaId, String(anotadaEn)],
  );
};

/**
 * PA-07: la fila de un lote, en orden de turno.
 *
 * **No se ordena en memoria.** El turno va con ceros a la izquierda en la `SK`
 * (decision D-5), asi que la `Query` la devuelve ya ordenada. Ordenar aqui
 * ocultaria un error de construccion de claves en vez de exponerlo.
 */
const leerFila = async (
  loteId: string,
  deps: DepsDeFila,
): Promise<Candidato[]> => {
  const fila = await deps.cliente.send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefijo)",
      ExpressionAttributeValues: {
        // El turno 0 solo sirve para construir la particion de la fila; las
        // claves se siguen armando en un unico lugar.
        ":pk": clave.solicitud(loteId, 0).PK,
        ":prefijo": PREFIJO.solicitud,
      },
      ConsistentRead: true,
    }),
  );

  const candidatos: Candidato[] = [];
  for (const item of fila.Items ?? []) {
    const turno = turnoDesdeClave(String(item.SK));
    if (turno === undefined || item.estatus !== "EN_FILA") continue;
    candidatos.push({ turno, participanteId: String(item.participanteId) });
  }
  return candidatos;
};

const intentarAdjudicar = async (
  candidato: Candidato,
  entrada: EntradaDeAdjudicacion,
  deps: DepsDeFila,
): Promise<{ ok: true } | { ok: false; error: CodigoError }> => {
  const tabla = nombreDeTabla();
  const adjudicadoEn = entrada.ahora;
  const venceEn = calcularVenceEn(adjudicadoEn, entrada.horasLiquidacion);
  if (!venceEn) {
    throw new RangeError(
      `horasLiquidacion invalida: ${entrada.horasLiquidacion}`,
    );
  }

  const solicitudId = `${entrada.loteId}-${candidato.turno}`;
  const valores = {
    ":adjudicadoEn": adjudicadoEn.toISOString(),
    ":venceEn": venceEn.toISOString(),
  };

  const resultado = await ejecutarTransaccion(
    [
      {
        item: {
          Update: {
            TableName: tabla,
            Key: clave.lote(entrada.convocatoriaId, entrada.loteId),
            UpdateExpression:
              "SET adjudicacionActual = :solicitud, turnoAdjudicado = :turno," +
              " adjudicadoEn = :adjudicadoEn, venceEn = :venceEn," +
              " estatus = :adjudicado",
            ConditionExpression: CONDICION_LOTE_LIBRE,
            ExpressionAttributeValues: {
              ...valores,
              ":solicitud": solicitudId,
              ":turno": candidato.turno,
              ":adjudicado": "ADJUDICADO",
            },
          },
        },
        siFalla: "lote_no_disponible",
        descripcion: "lote sin adjudicacion (regla 6)",
      },
      {
        item: {
          Update: {
            TableName: tabla,
            Key: clave.solicitud(entrada.loteId, candidato.turno),
            UpdateExpression:
              "SET estatus = :adjudicada, adjudicadoEn = :adjudicadoEn," +
              " venceEn = :venceEn",
            ConditionExpression: "estatus = :enFila",
            ExpressionAttributeValues: {
              ...valores,
              ":adjudicada": "ADJUDICADA",
              ":enFila": "EN_FILA",
            },
          },
        },
        siFalla: "invalid_state",
        descripcion: `solicitud turno ${candidato.turno} sigue EN_FILA`,
      },
      {
        item: {
          Put: {
            TableName: tabla,
            Item: {
              ...centinelaAdjudicacionDelPrototipo(candidato.participanteId),
              loteId: entrada.loteId,
              turno: candidato.turno,
            },
            ConditionExpression: CONDICION_CENTINELA_NUEVO,
          },
        },
        siFalla: "adjudicacion_activa",
        descripcion: "centinela de adjudicacion activa (R-09)",
      },
      putDeEvento(
        clave.evento(
          "LOTE",
          entrada.loteId,
          adjudicadoEn.toISOString(),
          randomUUID(),
        ),
        {
          tipo: "LOTE_ADJUDICADO",
          actor: "sistema",
          turno: candidato.turno,
          solicitudId,
        },
      ),
    ],
    { cliente: deps.cliente },
  );

  return resultado.ok ? { ok: true } : { ok: false, error: resultado.error };
};
