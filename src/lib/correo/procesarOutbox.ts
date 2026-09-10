// Camino 2 del barrido — `arquitectura-tecnica-aws.md` 2.6 y 4.5:
//
//   Barrido -> Query GSI4 OUTBOX_PENDIENTE
//       -> CES -> exito: CORREO_ENVIADO y se retiran las claves GSI4
//              -> fallo: reintento con retroceso; agotados, CORREO_FALLIDO
//
// **El retroceso es el propio horario del barrido, no una espera dentro de la
// funcion.** Un mensaje que falla no se reintenta en la misma corrida —eso
// solo martillaria a un CES caido sin ganar nada— sino que se deja `PENDIENTE`
// para la siguiente pasada (D-6). `MAXIMO_INTENTOS_CORREO` acota cuantas
// pasadas se le dan antes de declarar el fallo permanente y escribir
// `CORREO_FALLIDO`.
//
// **Un fallo no reintentable (401, 4xx) no espera esos intentos.**
// `clienteCes.ts` ya distingue "credenciales o mensaje mal formado" de
// "CES caido" (`runbooks.md` R-2); reintentar un 401 cinco veces solo demora
// el diagnostico cinco corridas.

import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { clave, gsi4, NOMBRES_DE_INDICE } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  ejecutarTransaccion,
  esConflictoDeTransaccion,
  esFalloDeCondicion,
} from "@/lib/data/transacciones";
import { conTraza } from "@/lib/observabilidad/traza";
import type { MensajeDeCorreo } from "@/types/correo";
import { enviarCorreo } from "./clienteCes";
import { correoDeAdjudicacion } from "./plantillas";

/**
 * Corridas del barrido (cada una ~5 minutos, `amplify/barrido/resource.ts`)
 * antes de declarar el fallo permanente. Cinco corridas son unos 25 minutos
 * de holgura contra una caida transitoria de CES, sin dejar un mensaje
 * fallido acumulandose indefinidamente.
 */
export const MAXIMO_INTENTOS_CORREO = 5;

export type ResultadoDeProcesarOutbox = {
  enviados: number;
  fallidosPermanentes: number;
  reintentaraDespues: number;
  /**
   * Antiguedad, en minutos, del pendiente mas viejo **al empezar** la corrida.
   * `0` si no habia ninguno.
   *
   * Es el numero que pide la alarma "correos en el outbox mas antiguos que un
   * umbral" (`arquitectura-tecnica-aws.md` 7). Se calcula aqui y no en la
   * alarma porque los contadores no bastan: un CES caido deja
   * `reintentaraDespues` en un valor pequeno y constante —los mismos mensajes,
   * corrida tras corrida— que no distingue "cinco mensajes esperando dos
   * minutos" de "cinco mensajes esperando dos dias". La antiguedad si.
   */
  antiguedadMaximaMin: number;
};

const MILISEGUNDOS_POR_MINUTO = 60_000;

export const procesarOutbox = async (
  deps: DepsDeServicio = {},
): Promise<ResultadoDeProcesarOutbox> =>
  conTraza(
    "procesarOutbox",
    {},
    async () => ejecutarOutbox(deps),
    (resultado) => ({
      // Un fallo permanente es un correo que **nadie** va a recibir: el
      // adjudicado no se entera de que gano y su plazo corre igual (R-13). Es
      // lo unico de esta corrida que exige que alguien mire.
      desenlace: resultado.fallidosPermanentes > 0 ? "rechazado" : "ok",
      ...resultado,
    }),
  );

const ejecutarOutbox = async (
  deps: DepsDeServicio,
): Promise<ResultadoDeProcesarOutbox> => {
  const { ahora } = resolver(deps);
  const pendientes = await leerPendientes(deps);
  const resultado: ResultadoDeProcesarOutbox = {
    enviados: 0,
    fallidosPermanentes: 0,
    reintentaraDespues: 0,
    antiguedadMaximaMin: antiguedadEnMinutos(pendientes[0]?.creadoEn, ahora),
  };

  for (const mensaje of pendientes) {
    await procesarUno(mensaje, resultado, deps);
  }

  return resultado;
};

/**
 * El primero de la lista es el mas viejo: `GSI4SK` es `creadoEn` y PA-14
 * consulta con `ScanIndexForward: true`.
 *
 * Se acota por abajo a cero: un `creadoEn` en el futuro —reloj torcido, dato
 * sembrado a mano— daria un negativo y una alarma de umbral nunca se
 * dispararia con el.
 */
const antiguedadEnMinutos = (
  creadoEn: string | undefined,
  ahora: Date,
): number => {
  if (!creadoEn) return 0;
  const creado = new Date(creadoEn).getTime();
  if (Number.isNaN(creado)) return 0;
  return Math.max(
    0,
    Math.round((ahora.getTime() - creado) / MILISEGUNDOS_POR_MINUTO),
  );
};

/** PA-14: `Query` GSI4 `OUTBOX_PENDIENTE`, mas antiguos primero. */
const leerPendientes = async (
  deps: DepsDeServicio,
): Promise<MensajeDeCorreo[]> => {
  const salida = await clienteDe(deps).send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      IndexName: NOMBRES_DE_INDICE.trabajoPendiente,
      KeyConditionExpression: "GSI4PK = :pk",
      ExpressionAttributeValues: {
        ":pk": gsi4.outboxPendiente("relleno").GSI4PK,
      },
      ScanIndexForward: true,
    }),
  );

  const mensajes: MensajeDeCorreo[] = [];
  for (const item of salida.Items ?? []) {
    const mensaje = aMensaje(item);
    if (mensaje) mensajes.push(mensaje);
  }
  return mensajes;
};

const aMensaje = (
  item: Record<string, unknown>,
): MensajeDeCorreo | undefined => {
  const mensajeId = item.mensajeId;
  const destinatario = item.destinatario;
  const creadoEn = item.creadoEn;
  const datos = item.datos;
  if (
    typeof mensajeId !== "string" ||
    typeof destinatario !== "string" ||
    typeof creadoEn !== "string" ||
    item.tipo !== "ADJUDICACION" ||
    typeof datos !== "object" ||
    datos === null
  ) {
    return undefined;
  }

  return {
    mensajeId,
    tipo: "ADJUDICACION",
    destinatario,
    creadoEn,
    estatus: "PENDIENTE",
    intentos: typeof item.intentos === "number" ? item.intentos : 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    datos: datos as any,
  };
};

const procesarUno = async (
  mensaje: MensajeDeCorreo,
  resultado: ResultadoDeProcesarOutbox,
  deps: DepsDeServicio,
): Promise<void> => {
  const { asunto, cuerpoHtml } = correoDeAdjudicacion(mensaje.datos);
  const envio = await enviarCorreo({
    destinatario: mensaje.destinatario,
    asunto,
    cuerpoHtml,
  });

  if (envio.ok) {
    await marcarEnviado(mensaje, envio.idExterno, deps);
    resultado.enviados += 1;
    return;
  }

  const intentos = mensaje.intentos + 1;
  if (!envio.reintentable || intentos >= MAXIMO_INTENTOS_CORREO) {
    await marcarFallido(mensaje, envio.error, intentos, deps);
    resultado.fallidosPermanentes += 1;
    return;
  }

  await incrementarIntento(mensaje, envio.error, intentos, deps);
  resultado.reintentaraDespues += 1;
};

/** Exito: CORREO_ENVIADO, y se retiran las claves de GSI4 (seccion 3, dispersion). */
const marcarEnviado = async (
  mensaje: MensajeDeCorreo,
  idExterno: string | undefined,
  deps: DepsDeServicio,
): Promise<void> => {
  const { ahora } = resolver(deps);
  const tabla = nombreDeTabla();

  await ejecutarTransaccion(
    [
      {
        item: {
          Update: {
            TableName: tabla,
            Key: clave.mensaje(mensaje.mensajeId),
            UpdateExpression:
              "SET estatus = :enviado, ultimoIntentoEn = :ahora" +
              (idExterno ? ", idExterno = :idExterno" : "") +
              " REMOVE GSI4PK, GSI4SK",
            ConditionExpression: "estatus = :pendiente",
            ExpressionAttributeValues: {
              ":enviado": "ENVIADO",
              ":pendiente": "PENDIENTE",
              ":ahora": ahora.toISOString(),
              ...(idExterno ? { ":idExterno": idExterno } : {}),
            },
          },
        },
        siFalla: "conflicto_concurrencia",
        descripcion: `mensaje ${mensaje.mensajeId} sigue PENDIENTE`,
      },
      eventoParaTransaccion({
        tipo: "CORREO_ENVIADO",
        agregado: "LOTE",
        agregadoId: mensaje.datos.loteId,
        actor: { tipo: "SISTEMA" },
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        convocatoriaId: mensaje.datos.convocatoriaId,
        loteId: mensaje.datos.loteId,
        solicitudId: mensaje.datos.solicitudId,
        vehiculoId: mensaje.datos.vehiculoId,
        datos: { mensajeId: mensaje.mensajeId, idExterno },
      }),
    ],
    deps,
  );
};

/** Fallo permanente: CORREO_FALLIDO, con motivo obligatorio (R-16-like: el porque). */
const marcarFallido = async (
  mensaje: MensajeDeCorreo,
  error: string,
  intentos: number,
  deps: DepsDeServicio,
): Promise<void> => {
  const { ahora } = resolver(deps);
  const tabla = nombreDeTabla();

  await ejecutarTransaccion(
    [
      {
        item: {
          Update: {
            TableName: tabla,
            Key: clave.mensaje(mensaje.mensajeId),
            UpdateExpression:
              "SET estatus = :fallido, ultimoIntentoEn = :ahora," +
              " intentos = :intentos, ultimoError = :error" +
              " REMOVE GSI4PK, GSI4SK",
            ConditionExpression: "estatus = :pendiente",
            ExpressionAttributeValues: {
              ":fallido": "FALLIDO",
              ":pendiente": "PENDIENTE",
              ":ahora": ahora.toISOString(),
              ":intentos": intentos,
              ":error": error,
            },
          },
        },
        siFalla: "conflicto_concurrencia",
        descripcion: `mensaje ${mensaje.mensajeId} sigue PENDIENTE`,
      },
      eventoParaTransaccion({
        tipo: "CORREO_FALLIDO",
        agregado: "LOTE",
        agregadoId: mensaje.datos.loteId,
        actor: { tipo: "SISTEMA" },
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        convocatoriaId: mensaje.datos.convocatoriaId,
        loteId: mensaje.datos.loteId,
        solicitudId: mensaje.datos.solicitudId,
        vehiculoId: mensaje.datos.vehiculoId,
        motivo: error,
        datos: { mensajeId: mensaje.mensajeId, intentos },
      }),
    ],
    deps,
  );
};

/**
 * Fallo transitorio: solo se anota el intento, sin evento — es dato
 * operativo, no de auditoria (`trazabilidad-auditoria.md` seccion 6). Un
 * `UpdateItem` suelto y no una transaccion: no hay evento que acompanarlo.
 *
 * Si la condicion falla es porque otra corrida ya lo resolvio: de mejor
 * esfuerzo, se ignora.
 */
const incrementarIntento = async (
  mensaje: MensajeDeCorreo,
  error: string,
  intentos: number,
  deps: DepsDeServicio,
): Promise<void> => {
  const { ahora } = resolver(deps);
  try {
    await clienteDe(deps).send(
      new UpdateCommand({
        TableName: nombreDeTabla(),
        Key: clave.mensaje(mensaje.mensajeId),
        UpdateExpression:
          "SET intentos = :intentos, ultimoIntentoEn = :ahora, ultimoError = :error",
        ConditionExpression: "estatus = :pendiente",
        ExpressionAttributeValues: {
          ":intentos": intentos,
          ":ahora": ahora.toISOString(),
          ":error": error,
          ":pendiente": "PENDIENTE",
        },
      }),
    );
  } catch (error_) {
    if (esFalloDeCondicion(error_)) return;
    // El item del mensaje **si** participa en transacciones: `marcarEnviado` y
    // `marcarFallido` lo tocan dentro de una. Si dos corridas del barrido se
    // solapan —el horario es cada 5 min y el limite de ejecucion 300 s, asi que
    // puede pasar— una puede estar resolviendo el mensaje por transaccion
    // mientras la otra le anota el intento con este `UpdateItem` suelto, y
    // DynamoDB rechaza el suelto con `TransactionConflictException`.
    //
    // Se ignora por la misma razon que el fallo de condicion: significa que
    // otra corrida ya lo resolvio, que es justo lo que este helper declara
    // tolerar. Dejarla escapar abortaria el resto del outbox de la corrida por
    // no poder anotar un contador de reintentos
    // (`desafios-implementacion.md` 41).
    if (esConflictoDeTransaccion(error_)) return;
    throw error_;
  }
};

export const __test__ = { aMensaje };
