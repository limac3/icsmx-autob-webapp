// Camino 2 del barrido — `arquitectura-tecnica-aws.md` 2.6 y 4.5:
//
//   Barrido -> Query GSI4 OUTBOX_PENDIENTE
//       -> PENDIENTE -> ENVIANDO (condicional, con plazo)
//       -> CES -> exito: ENVIADO, CORREO_ENVIADO y se retiran las claves GSI4
//              -> fallo reintentable: vuelve a PENDIENTE con un intento mas
//              -> agotados o no reintentable: FALLIDO y CORREO_FALLIDO
//
// **El envio va despues de la adquisicion, y ese orden es el mecanismo.** El
// barrido corre cada 5 minutos y puede tardar hasta 300 s, asi que dos corridas
// se solapan y leen la misma lista. Antes las dos llamaban a CES y solo una
// lograba el `Update` a `ENVIADO`: la bitacora quedaba correcta —la condicion
// impedia el segundo evento— y el participante recibia dos correos.
// Adquiriendo primero, la unica corrida que llega a CES es la que gano la
// escritura condicional.
//
// **Lo que no se puede cerrar desde aqui**: si el proceso muere entre que CES
// acepta y que se escribe `ENVIADO`, el plazo vence y el mensaje se reenvia.
// CES no ofrece clave de idempotencia —responde una confirmacion de envio, o la
// causa del error— asi que no hay forma de que el reintento se reconozca como
// duplicado. El `id` que CES devuelve se guarda como `idExterno`, pero sirve
// para rastrear, no para deduplicar. Ver `desafios-implementacion.md`.
//
// **El retroceso es el propio horario del barrido, no una espera dentro de la
// funcion.** Un mensaje que falla no se reintenta en la misma corrida —eso
// solo martillaria a un CES caido sin ganar nada— sino que se devuelve a
// `PENDIENTE` para la siguiente pasada (D-6). `MAXIMO_INTENTOS_CORREO` acota
// cuantas pasadas se le dan antes de declarar el fallo permanente y escribir
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

/**
 * Cuanto vale una adquisicion antes de que otra corrida pueda retomar el
 * mensaje.
 *
 * **Tiene que ser mayor que el limite de ejecucion de la funcion** (300 s,
 * `amplify/barrido/resource.ts`). Si fuera menor, una corrida lenta podria ver
 * vencer su propia adquisicion mientras todavia esta enviando, y la corrida
 * siguiente reenviaria el mismo correo — el defecto que este mecanismo viene a
 * cerrar. Quince minutos son tres horarios de holgura sobre ese limite, y a la
 * vez el peor caso de espera para un mensaje cuya corrida murio a mitad del
 * envio.
 */
export const LEASE_MS = 15 * 60 * 1000;

/**
 * Cuanto tiempo de la corrida se dedica a enviar antes de dejar el resto para
 * la siguiente.
 *
 * **Acota tiempo y no cantidad de mensajes, y la diferencia importa.** El
 * limite que hay que respetar es el de ejecucion de la funcion (300 s), y un
 * tope de mensajes no lo garantiza: con CES lento, cien mensajes se pasan; con
 * CES rapido, mil no llegan ni a la mitad. Se mide con `performance.now()` por
 * lo mismo que `conTraza`: el `ahora` inyectable esta congelado por invocacion
 * a proposito y daria siempre cero.
 *
 * Importa sobre todo en el arranque: mientras CES siga sin aprobar (R17) el
 * outbox acumula pendientes **por diseno**, asi que la primera corrida real
 * empieza con toda la mora junta. Una corrida truncada aqui es un retraso, no
 * trabajo perdido — la misma doctrina que `modelo-datos-dynamodb.md` 8.2 —
 * mientras una corrida que se pasa del limite es justo lo que produce el
 * solapamiento.
 *
 * 120 s dejan mas de la mitad del presupuesto de la funcion al barrido de
 * vencimientos, que corre antes en el mismo `handler`.
 */
export const PRESUPUESTO_DE_ENVIO_MS = 120 * 1000;

export type ResultadoDeProcesarOutbox = {
  enviados: number;
  fallidosPermanentes: number;
  reintentaraDespues: number;
  /**
   * Mensajes que otra corrida tenia adquiridos. No es un fallo: es el
   * mecanismo funcionando, y la corrida que los tiene los esta enviando.
   */
  enVuelo: number;
  /**
   * Mensajes que quedaron sin mirar al agotarse el presupuesto de la corrida.
   * La siguiente empieza por ellos, porque PA-14 lee de lo mas viejo a lo mas
   * nuevo.
   */
  sinPresupuesto: number;
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
    enVuelo: 0,
    sinPresupuesto: 0,
    antiguedadMaximaMin: antiguedadEnMinutos(pendientes[0]?.creadoEn, ahora),
  };

  const inicio = performance.now();

  for (const [indice, mensaje] of pendientes.entries()) {
    if (performance.now() - inicio > PRESUPUESTO_DE_ENVIO_MS) {
      resultado.sinPresupuesto = pendientes.length - indice;
      break;
    }

    // Otra corrida lo tiene y su plazo sigue vivo: no se toca. La escritura
    // condicional de `adquirir` lo impediria igual, pero preguntar primero
    // ahorra un `Update` por mensaje en el caso que el solapamiento hace
    // frecuente.
    if (adquiridoPorOtra(mensaje, ahora)) {
      resultado.enVuelo += 1;
      continue;
    }

    await procesarUno(mensaje, resultado, deps);
  }

  return resultado;
};

/**
 * Si el mensaje esta `ENVIANDO` con su plazo todavia vigente.
 *
 * Un `ENVIANDO` con plazo vencido **si** se retoma: significa que la corrida
 * que lo adquirio murio sin resolverlo.
 */
const adquiridoPorOtra = (mensaje: MensajeDeCorreo, ahora: Date): boolean =>
  mensaje.estatus === "ENVIANDO" &&
  mensaje.leaseHasta !== undefined &&
  new Date(mensaje.leaseHasta).getTime() > ahora.getTime();

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
    // **Se lee del item y no se fija como literal.** Antes era `"PENDIENTE"`
    // constante, y tenia su logica: estar en la particion `OUTBOX_PENDIENTE`
    // *era* la definicion de pendiente, porque el indice es disperso. Con
    // `ENVIANDO` en el mismo indice, esa equivalencia dejo de valer y el
    // estatus real es lo que decide si el mensaje se puede retomar.
    estatus: item.estatus === "ENVIANDO" ? "ENVIANDO" : "PENDIENTE",
    intentos: typeof item.intentos === "number" ? item.intentos : 0,
    ...(typeof item.leaseHasta === "string"
      ? { leaseHasta: item.leaseHasta }
      : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    datos: datos as any,
  };
};

/**
 * Adquiere, envia y resuelve — en ese orden, que es el arreglo.
 *
 * Antes llamaba a CES **primero** y despues intentaba el `Update` condicional a
 * `ENVIADO`: la condicion garantizaba una sola escritura de estado y un solo
 * evento `CORREO_ENVIADO` —la bitacora nunca se duplico— pero se evaluaba
 * cuando CES ya habia aceptado, asi que dos corridas solapadas mandaban dos
 * correos y solo una lo anotaba. Adquirir antes invierte eso: la unica corrida
 * que llega a CES es la que gano la escritura condicional.
 */
const procesarUno = async (
  mensaje: MensajeDeCorreo,
  resultado: ResultadoDeProcesarOutbox,
  deps: DepsDeServicio,
): Promise<void> => {
  if (!(await adquirir(mensaje, deps))) {
    // La perdio contra otra corrida entre la lectura y este intento. Es el
    // mecanismo funcionando, no un fallo.
    resultado.enVuelo += 1;
    return;
  }

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

  await devolverAPendiente(mensaje, envio.error, intentos, deps);
  resultado.reintentaraDespues += 1;
};

/**
 * `PENDIENTE -> ENVIANDO` con plazo, o `false` si otra corrida lo tiene.
 *
 * La condicion admite los dos casos legitimos: el mensaje esta `PENDIENTE`, o
 * esta `ENVIANDO` con el plazo ya vencido —una corrida que murio despues de
 * adquirirlo—. Un `ENVIANDO` con plazo vivo pierde la condicion, y eso es
 * exactamente lo que se busca.
 *
 * **No lleva evento de auditoria.** Adquirir no es un acto de negocio: es
 * coordinacion entre dos corridas del mismo proceso, y el catalogo de
 * `trazabilidad-auditoria.md` deja los errores y detalles tecnicos fuera de la
 * bitacora a proposito. Lo que si queda registrado es el envio (`CORREO_ENVIADO`)
 * y el fallo permanente (`CORREO_FALLIDO`).
 */
const adquirir = async (
  mensaje: MensajeDeCorreo,
  deps: DepsDeServicio,
): Promise<boolean> => {
  const { ahora } = resolver(deps);
  const momento = ahora.toISOString();

  try {
    await clienteDe(deps).send(
      new UpdateCommand({
        TableName: nombreDeTabla(),
        Key: clave.mensaje(mensaje.mensajeId),
        UpdateExpression:
          "SET #estatus = :enviando, leaseHasta = :leaseHasta," +
          " ultimoIntentoEn = :ahora",
        ConditionExpression:
          "#estatus = :pendiente" +
          " OR (#estatus = :enviando AND leaseHasta <= :ahora)",
        ExpressionAttributeNames: { "#estatus": "estatus" },
        ExpressionAttributeValues: {
          ":enviando": "ENVIANDO",
          ":pendiente": "PENDIENTE",
          ":leaseHasta": new Date(ahora.getTime() + LEASE_MS).toISOString(),
          ":ahora": momento,
        },
      }),
    );
    return true;
  } catch (error) {
    if (esFalloDeCondicion(error)) return false;
    // Un conflicto de transaccion tambien significa que alguien mas lo esta
    // tocando: mismo tratamiento que la condicion perdida, por la misma razon
    // que en `devolverAPendiente`.
    if (esConflictoDeTransaccion(error)) return false;
    throw error;
  }
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
              " REMOVE GSI4PK, GSI4SK, leaseHasta",
            // Condiciona a `ENVIANDO` porque esta corrida acaba de adquirirlo:
            // si el estatus ya no es ese, alguien retomo el mensaje —lease
            // vencido— y quien escriba primero gana. La condicion sigue siendo
            // lo que garantiza **un solo** evento `CORREO_ENVIADO`.
            ConditionExpression: "estatus = :enviando",
            ExpressionAttributeValues: {
              ":enviado": "ENVIADO",
              ":enviando": "ENVIANDO",
              ":ahora": ahora.toISOString(),
              ...(idExterno ? { ":idExterno": idExterno } : {}),
            },
          },
        },
        siFalla: "conflicto_concurrencia",
        descripcion: `mensaje ${mensaje.mensajeId} sigue adquirido por esta corrida`,
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
              " REMOVE GSI4PK, GSI4SK, leaseHasta",
            ConditionExpression: "estatus = :enviando",
            ExpressionAttributeValues: {
              ":fallido": "FALLIDO",
              ":enviando": "ENVIANDO",
              ":ahora": ahora.toISOString(),
              ":intentos": intentos,
              ":error": error,
            },
          },
        },
        siFalla: "conflicto_concurrencia",
        descripcion: `mensaje ${mensaje.mensajeId} sigue adquirido por esta corrida`,
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
 * Fallo transitorio: **suelta la adquisicion** y anota el intento, sin evento —
 * es dato operativo, no de auditoria (`trazabilidad-auditoria.md` seccion 6).
 * Un `UpdateItem` suelto y no una transaccion: no hay evento que acompanarlo.
 *
 * Devolverlo a `PENDIENTE` en vez de dejarlo `ENVIANDO` hasta que venza el
 * plazo es lo que conserva el retroceso de D-6: el mensaje vuelve a estar
 * disponible para la corrida siguiente, dentro de 5 minutos y no dentro de 15.
 * El plazo queda como red para la corrida que muere **antes** de llegar aqui.
 *
 * Si la condicion falla es porque otra corrida ya lo resolvio: de mejor
 * esfuerzo, se ignora.
 */
const devolverAPendiente = async (
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
          "SET estatus = :pendiente, intentos = :intentos," +
          " ultimoIntentoEn = :ahora, ultimoError = :error" +
          " REMOVE leaseHasta",
        ConditionExpression: "estatus = :enviando",
        ExpressionAttributeValues: {
          ":intentos": intentos,
          ":ahora": ahora.toISOString(),
          ":error": error,
          ":pendiente": "PENDIENTE",
          ":enviando": "ENVIANDO",
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
