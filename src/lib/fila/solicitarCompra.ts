import "server-only";

// T1 — solicitar compra. `modelo-datos-dynamodb.md` seccion 6, ya corregido por
// el prototipo de R18 (Etapa 4.1) y validado contra DynamoDB real.
//
// **Tres escrituras, en este orden y no en otro:**
//
//   0. `Put` de la reserva del turno       -> marca la ventana de R18
//   1. `ADD contadorTurnos` sobre el lote  -> entrega el turno (regla 3)
//   2. `TransactWriteItems`                -> hace visible la solicitud
//
// El paso 1 no puede vivir dentro de la transaccion: `TransactWriteItems` **no
// devuelve valores**, asi que el turno que produce un `ADD` no se podria usar
// como clave del `Put` de la misma transaccion. De ahi que hagan falta tres
// escrituras y de ahi, a su vez, que exista la reserva del paso 0.
//
// **El orden de la reserva es la garantia.** Escribirla despues del contador
// dejaria abierta exactamente la ventana que existe para cerrar. Escrita antes,
// lo peor que puede pasar es una reserva huerfana que el umbral depura.

import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { clave, gsi3, identificadorDeSolicitud } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  CONDICION_CENTINELA_NUEVO,
  ejecutarTransaccion,
  esConflictoDeTransaccion,
  esFalloDeCondicion,
} from "@/lib/data/transacciones";
import { ventaAbierta } from "@/lib/domain/ventanas";
import { desdeIso } from "@/lib/domain/fechas";
import { conTraza } from "@/lib/observabilidad/traza";
import type { ActorUsuario } from "@/types/auditoria";
import type { Lote } from "@/types/lote";
import {
  exito,
  fallo,
  type CodigoError,
  type Resultado,
} from "@/types/resultado";
import { adjudicarLote, type ResultadoDeAdjudicacion } from "./adjudicarLote";
import {
  anotarReserva,
  CONDICION_RESERVA_VIVA,
  liberarReserva,
} from "./reservas";

/**
 * Condicion del paso 1: la venta esta abierta y el lote todavia admite fila.
 *
 * **No exige `estatus = EN_OFERTA`**, y la diferencia con el texto original de
 * T1 es una correccion, no un descuido. Con adjudicacion inmediata el primer
 * turno pasa el lote a `ADJUDICADO` a los segundos de `inicioVenta`; exigir
 * `EN_OFERTA` cerraria la fila justo ahi y dejaria sin sentido `miPosicion`,
 * `tamanoFila`, la reasignacion de R-15 y el propio R-17 —"sigue disponible
 * para quien solicite despues, mientras la venta siga abierta"—. Lo que si
 * cierra la fila es un lote `VENDIDO`, `NO_VENDIDO` o `RETIRADO`.
 *
 * Mira los atributos **desnormalizados** del lote (modelo-datos 1). Leer la
 * convocatoria y decidir despues seria justo la carrera que el diseno evita;
 * que la copia sea fiable depende de que T8 propague siempre dejando el estado
 * intermedio mas restrictivo.
 */
const CONDICION_LOTE_ADMITE_FILA =
  "(#estatus = :enOferta OR #estatus = :adjudicado)" +
  " AND estatusConvocatoria = :publicada" +
  " AND inicioVenta <= :ahora AND finVenta > :ahora";

export type EntradaSolicitarCompra = {
  /** El lote ya leido por quien invoca, el mismo que evaluo el permiso. */
  lote: Lote;
  participanteId: string;
  actor: ActorUsuario;
  /**
   * Correo de la sesion, para que tesoreria sepa a quien pertenece un
   * comprobante (`PendienteDTO`) sin que exista todavia un perfil de
   * participante persistido (`desafios-implementacion.md` 8).
   */
  correoTitular?: string;
  /** Solicitudes vivas al momento, para el evento. Informativo. */
  tamanoFilaAlMomento?: number;
  umbralDeReservaMs?: number;
};

export type SolicitudRegistrada = {
  solicitudId: string;
  turno: number;
  /** Que paso al intentar adjudicar despues de entrar a la fila. */
  adjudicacion: ResultadoDeAdjudicacion;
};

/**
 * Registra la solicitud y **siempre** intenta adjudicar despues.
 *
 * "Siempre", y no "solo si la fila estaba vacia": con la abstencion por
 * reservas, esa optimizacion produce un bloqueo. Si A (turno 1) y B (turno 2)
 * llegan juntos, A ve la fila vacia e intenta adjudicar pero se abstiene porque
 * B esta en vuelo, y B ya no intenta porque la fila no estaba vacia — nadie
 * adjudica hasta el barrido. Intentar siempre es barato y garantiza que **el
 * ultimo en aterrizar cierra la ronda** (`arquitectura-tecnica-aws.md` 4.2).
 */
export const solicitarCompra = async (
  entrada: EntradaSolicitarCompra,
  deps: DepsDeServicio = {},
): Promise<Resultado<SolicitudRegistrada>> =>
  conTraza(
    "solicitarCompra",
    { loteId: entrada.lote.loteId, participanteId: entrada.participanteId },
    async () => ejecutarSolicitud(entrada, deps),
    (resultado) =>
      resultado.ok
        ? {
            desenlace: "ok",
            turno: resultado.data.turno,
            // El desenlace de la adjudicacion que dispara toda solicitud. Es
            // lo que responde "entro a la fila, ¿y gano?" sin cruzar dos
            // lineas de registro.
            adjudicacion: resultado.data.adjudicacion.estado,
          }
        : { desenlace: "rechazado", error: resultado.error },
  );

const ejecutarSolicitud = async (
  entrada: EntradaSolicitarCompra,
  deps: DepsDeServicio,
): Promise<Resultado<SolicitudRegistrada>> => {
  const { ahora, nuevoId } = resolver(deps);
  const { lote } = entrada;
  const reservaId = nuevoId();

  // Paso 0 — la reserva, antes del contador.
  await anotarReserva({ loteId: lote.loteId, reservaId, ahora }, deps);

  // Paso 1 — el contador atomico entrega el turno.
  const paso1 = await pedirTurno(lote, ahora, deps);
  if ("rechazo" in paso1) {
    await liberarReserva({ loteId: lote.loteId, reservaId }, deps);
    return fallo(paso1.rechazo);
  }
  const { turno } = paso1;

  // Paso 2 — la solicitud se hace visible, y la reserva se retira con ella.
  const registro = await registrarEnLaFila(
    { ...entrada, turno, reservaId, ahora },
    deps,
  );
  if (!registro.ok) {
    // El turno ya se consumio y no se recicla: queda un hueco, que el diseno
    // acepta (modelo-datos 6). Liberar la reserva es solo para no detener
    // adjudicaciones ajenas hasta el umbral.
    await liberarReserva({ loteId: lote.loteId, reservaId }, deps);
    return registro;
  }

  const adjudicacion = await adjudicarLote(
    {
      lote,
      motivo: "PRIMERA_ADJUDICACION",
      ...(entrada.umbralDeReservaMs === undefined
        ? {}
        : { umbralDeReservaMs: entrada.umbralDeReservaMs }),
    },
    deps,
  );

  return exito({
    solicitudId: identificadorDeSolicitud(lote.loteId, turno),
    turno,
    adjudicacion,
  });
};

/**
 * Paso 1: `ADD contadorTurnos :uno` con `ReturnValues: UPDATED_NEW`.
 *
 * El turno **es** el valor nuevo del contador: atomico, sin lectura previa y
 * sin forma de que dos solicitudes reciban el mismo (regla 3).
 *
 * Devuelve `{ rechazo }` en dos casos que **no** se pueden confundir, y por eso
 * devuelve el codigo en lugar de un `undefined` que quien invoca tendria que
 * interpretar:
 *
 *   - La condicion no se cumple: la venta cerro, el lote se retiro. Es un
 *     rechazo de negocio y `motivoDelRechazo` dice cual.
 *   - `TransactionConflictException`: el `ADD` choco con la transaccion de T2
 *     sobre el mismo item del lote. Es `conflicto_concurrencia` — relee y
 *     reintenta —, y decirle al participante "el lote no esta disponible"
 *     seria falso.
 */
type ResultadoDePaso1 = { turno: number } | { rechazo: CodigoError };

const pedirTurno = async (
  lote: Lote,
  ahora: Date,
  deps: DepsDeServicio,
): Promise<ResultadoDePaso1> => {
  try {
    const salida = await clienteDe(deps).send(
      new UpdateCommand({
        TableName: nombreDeTabla(),
        Key: clave.lote(lote.convocatoriaId, lote.loteId),
        UpdateExpression: "ADD contadorTurnos :uno",
        ConditionExpression: CONDICION_LOTE_ADMITE_FILA,
        ExpressionAttributeNames: { "#estatus": "estatus" },
        ExpressionAttributeValues: {
          ":uno": 1,
          ":ahora": ahora.toISOString(),
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
      // hace, el turno se perdio y no hay forma segura de continuar: escribir
      // una solicitud sin turno cierto romperia el orden de la fila.
      throw new Error(`El paso 1 no devolvio el turno del lote ${lote.loteId}`);
    }
    return { turno };
  } catch (error) {
    if (esFalloDeCondicion(error)) {
      return { rechazo: motivoDelRechazo(lote, ahora) };
    }
    // El `ADD` es la unica escritura del sistema que ocurre **fuera** de
    // transaccion sobre un item que si esta en otras: el de T2. En
    // `inicioVenta` los dos caminos se cruzan de forma rutinaria, y DynamoDB
    // rechaza la operacion suelta con `TransactionConflictException`.
    //
    // El SDK lo reintenta por su cuenta (`maxAttempts` 3 por omision), asi que
    // casi nunca llega hasta aqui. Cuando llega es porque la contencion agoto
    // los intentos, y entonces lo unico correcto es tratarlo como la carrera
    // perdida que es. Antes de la Etapa 12 escapaba como excepcion sin atrapar
    // y el participante veia un error del servidor en lugar de un "reintenta"
    // (`desafios-implementacion.md` 41).
    if (esConflictoDeTransaccion(error)) {
      return { rechazo: "conflicto_concurrencia" };
    }
    throw error;
  }
};

/**
 * Por que se rechazo el turno, con lo que ya se sabe del lote.
 *
 * Es un mensaje, no una decision: el rechazo ya ocurrio en DynamoDB. Se deduce
 * del lote que evaluo el permiso en vez de releerlo porque no cambia lo que se
 * hace, solo lo que se explica, y una lectura mas por cada rechazo no compra
 * nada. Si el lote sigue admitiendo fila y la venta sigue abierta, entonces el
 * estado cambio entre la lectura y la escritura: eso es una carrera.
 */
const motivoDelRechazo = (lote: Lote, ahora: Date): CodigoError => {
  if (lote.estatus !== "EN_OFERTA" && lote.estatus !== "ADJUDICADO") {
    return "lote_no_disponible";
  }
  const inicioVenta = desdeIso(lote.inicioVenta);
  const finVenta = desdeIso(lote.finVenta);
  if (
    !inicioVenta ||
    !finVenta ||
    !ventaAbierta({ inicioVenta, finVenta }, ahora)
  ) {
    return "invalid_state";
  }
  return "conflicto_concurrencia";
};

/**
 * Paso 2: la transaccion que hace visible la solicitud.
 *
 * **El orden de los items fija la prioridad del diagnostico.**
 * `traducirCancelacion` se queda con el primer motivo distinto de `None`, asi
 * que cuando fallan varias condiciones a la vez gana "ya estabas en la fila"
 * (item 2) sobre "tu reserva ya se dio por muerta" (item 4).
 *
 * **Sin `ConditionCheck` sobre la convocatoria.** Lo llevaba, y se quito con
 * medicion: apunta a un unico item que comparten todas las solicitudes de la
 * convocatoria, y dentro de una transaccion un `ConditionCheck` retiene el item
 * igual que una escritura. Con 10 solicitudes simultaneas cancelaba entre 5 y 7
 * por `TransactionConflict` — la garantia se pagaba rechazando a quien llega
 * puntual, en el unico instante en que todos llegan a la vez. La publicacion
 * parcial se cierra en T8, ordenando la propagacion.
 */
const registrarEnLaFila = async (
  entrada: EntradaSolicitarCompra & {
    turno: number;
    reservaId: string;
    ahora: Date;
  },
  deps: DepsDeServicio,
): Promise<Resultado<null>> => {
  const { lote, participanteId, turno, reservaId, ahora } = entrada;
  const tabla = nombreDeTabla();
  const solicitadoEn = ahora.toISOString();
  const solicitudId = identificadorDeSolicitud(lote.loteId, turno);

  const resultado = await ejecutarTransaccion(
    [
      {
        item: {
          Put: {
            TableName: tabla,
            Item: {
              ...clave.solicitud(lote.loteId, turno),
              solicitudId,
              loteId: lote.loteId,
              convocatoriaId: lote.convocatoriaId,
              participanteId,
              turno,
              estatus: "EN_FILA",
              // Informativo (R-08). No participa en ninguna clave: es
              // imposible ordenar la fila por tiempo aunque alguien lo intente.
              solicitadoEn,
              ...(entrada.correoTitular
                ? { correoTitular: entrada.correoTitular }
                : {}),
              // GSI3 — PA-09, "mis solicitudes". Aqui `solicitadoEn` si ordena,
              // y es correcto: esa lista es una vista personal por fecha, no la
              // fila.
              ...gsi3.solicitudDeParticipante(
                participanteId,
                solicitadoEn,
                lote.loteId,
              ),
            },
          },
        },
        siFalla: "conflicto_concurrencia",
        descripcion: `solicitud turno ${String(turno)}`,
      },
      {
        item: {
          Put: {
            TableName: tabla,
            Item: {
              ...clave.centinelaFila(lote.loteId, participanteId),
              solicitudId,
              turno,
            },
            ConditionExpression: CONDICION_CENTINELA_NUEVO,
          },
        },
        siFalla: "already_in_queue",
        descripcion: "centinela de fila (R-07)",
      },
      eventoParaTransaccion({
        tipo: "SOLICITUD_CREADA",
        // Anclado al **lote** y no a la solicitud: con eso la historia completa
        // de un lote —todas sus solicitudes, adjudicaciones y reasignaciones—
        // se reconstruye con una sola `Query` (trazabilidad-auditoria 2.1), que
        // es la consulta que el auditor hace mas veces.
        agregado: "LOTE",
        agregadoId: lote.loteId,
        actor: entrada.actor,
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        convocatoriaId: lote.convocatoriaId,
        loteId: lote.loteId,
        solicitudId,
        vehiculoId: lote.vehiculoId,
        estadoNuevo: "EN_FILA",
        datos: {
          turno,
          solicitadoEn,
          tamanoFilaAlMomento: entrada.tamanoFilaAlMomento,
        },
      }),
      {
        item: {
          Delete: {
            TableName: tabla,
            Key: clave.reservaDeTurno(lote.loteId, reservaId),
            // Sin esta condicion el umbral seria solo una espera cortes: un
            // proceso al que la adjudicacion ya dio por muerto escribiria su
            // solicitud con un turno menor que el del ganador y reabriria R18,
            // solo que mas dificil de reproducir.
            ConditionExpression: CONDICION_RESERVA_VIVA,
          },
        },
        siFalla: "conflicto_concurrencia",
        descripcion: "retiro de la reserva del turno",
      },
    ],
    deps,
  );

  return resultado.ok ? exito(null) : fallo(resultado.error);
};

export const __test__ = { motivoDelRechazo, CONDICION_LOTE_ADMITE_FILA };
