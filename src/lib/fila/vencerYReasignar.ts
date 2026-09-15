// T5 — vencer y reasignar (R-15). `modelo-datos-dynamodb.md` seccion 6.
//
// **Un solo acto atomico**, a diferencia de T5b/T6 (cancelacion y rechazo):
// cierra al vencido y adjudica al siguiente turno vivo en la **misma**
// transaccion. La razon de la asimetria esta documentada en T5b: esto lo
// dispara un barrido desatendido o una lectura cualquiera, y **no puede** dejar
// el lote libre sin dueno si el proceso muere a la mitad — a diferencia de una
// cancelacion, que dispara una persona mirando la pantalla y puede reintentar.
//
// Estructuralmente es T2 (`adjudicarLote.ts`) con dos escrituras del lado del
// vencido intercaladas delante: misma abstencion por reservas (R18), misma
// lectura de PA-07 en orden de turno, mismo bucle de candidatos con omision
// por cupo agotado (R-09). Reusa `leerFila` y `omitirPorLimite` de
// `adjudicarLote.ts` en vez de duplicarlos.
//
// **Correccion sobre el documento: la variante reducida tambien libera el
// vehiculo.** `modelo-datos-dynamodb.md` describia la variante de fila agotada
// como "items 1, 2, 6 mas REMOVE adjudicacionActual y estatus = EN_OFERTA",
// sin tocar el vehiculo. Dejarlo `RESERVADO` mientras el lote vuelve a
// `EN_OFERTA` reproduce exactamente el defecto que la Etapa 10 pide corregir en
// otro frente ("lotes libres con fila viva"): el siguiente que solicite
// entraria a la fila, pero el item 4 de T2 exige `vehiculo.estatus =
// EN_CONVOCATORIA` y fallaria siempre, dejando el lote huerfano para
// **siempre**, no solo hasta el proximo barrido. Se agrega aqui el mismo
// `Update` que usan T4, T5b y T6 para liberar el vehiculo.

import { clave, gsi4, identificadorDeSolicitud } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  ejecutarTransaccion,
  type ItemDeTransaccion,
} from "@/lib/data/transacciones";
import { diaDeNegocio } from "@/lib/domain/fechas";
import { calcularVenceEn, estaVencido } from "@/lib/domain/plazos";
import { transicion } from "@/lib/domain/transiciones";
import { conTraza } from "@/lib/observabilidad/traza";
import { itemsDeEncoladoAdjudicacion } from "@/lib/correo/outbox";
import type { Solicitud } from "@/types/fila";
import type { Lote } from "@/types/lote";
import type { CodigoError } from "@/types/resultado";
import { leerFila, omitirPorLimite, type Candidato } from "./adjudicarLote";
import { itemDeConsumoDeCupo, itemDeLiberacionDeCupo } from "./cupo";
import { depurarYContarReservas } from "./reservas";

/** Mismo criterio de reintentos que T2 (`INTENTOS_DE_ADJUDICACION`): un
 * `TransactionConflict` sobre el item del lote no dice quien gano. */
export const INTENTOS_DE_VENCIMIENTO = 4;

export type DetectadoPor = "BARRIDO" | "VERIFICACION_PEREZOSA";

export type ResultadoDeVencimiento =
  | {
      estado: "reasignado";
      turno: number;
      solicitudId: string;
      participanteId: string;
      venceEn: string;
    }
  /** Fila sin candidato vivo (R-17): el lote y el vehiculo vuelven a la oferta. */
  | { estado: "fila_agotada" }
  /**
   * La solicitud ya no esta `ADJUDICADA` y vencida cuando se intento — alguien
   * mas la resolvio primero (avalado, rechazo, otra reasignacion). No es un
   * error: es la carrera inofensiva que describe D-7.
   */
  | { estado: "no_vigente" }
  /** Hay turnos en vuelo que la fila todavia no muestra (R18). */
  | { estado: "abstenido"; reservasVigentes: number }
  /** Contencion sostenida. Reintentable. */
  | { estado: "en_conflicto" };

export type EntradaDeVencimiento = {
  /** El lote ya leido por quien invoca. */
  lote: Lote;
  /** La solicitud `ADJUDICADA` con `venceEn` pasado. */
  solicitudVencida: Solicitud;
  /** Para el evento y el runbook R-1: distingue el barrido de la lectura. */
  detectadoPor: DetectadoPor;
  umbralDeReservaMs?: number;
  intentos?: number;
};

const dormir = (ms: number): Promise<void> =>
  new Promise((continuar) => setTimeout(continuar, ms));

/**
 * Cierra la adjudicacion vencida y reasigna al siguiente turno vivo, en una
 * sola transaccion. **No devuelve `Resultado`**: igual que `adjudicarLote`,
 * ninguno de sus desenlaces es un error que quien invoca deba propagar.
 */
export const vencerYReasignar = async (
  entrada: EntradaDeVencimiento,
  deps: DepsDeServicio = {},
): Promise<ResultadoDeVencimiento> =>
  conTraza(
    "vencerYReasignar",
    {
      loteId: entrada.lote.loteId,
      turnoVencido: entrada.solicitudVencida.turno,
      // Cual de los dos caminos de D-7 detecto el vencimiento. Es el dato que
      // el runbook R-1 usa para decidir si el barrido esta cumpliendo su
      // funcion o si todo lo esta resolviendo la verificacion perezosa.
      detectadoPor: entrada.detectadoPor,
    },
    async () => ejecutarVencimiento(entrada, deps),
    (resultado) => ({
      desenlace:
        resultado.estado === "reasignado" || resultado.estado === "no_vigente"
          ? "ok"
          : "rechazado",
      estado: resultado.estado,
      ...(resultado.estado === "reasignado"
        ? { turno: resultado.turno, participanteId: resultado.participanteId }
        : {}),
      ...(resultado.estado === "abstenido"
        ? { reservasVigentes: resultado.reservasVigentes }
        : {}),
    }),
  );

const ejecutarVencimiento = async (
  entrada: EntradaDeVencimiento,
  deps: DepsDeServicio,
): Promise<ResultadoDeVencimiento> => {
  const { ahora } = resolver(deps);
  const { solicitudVencida } = entrada;

  // Comprobacion local antes de tocar DynamoDB: en la carrera entre el barrido
  // y la verificacion perezosa, quien llega segundo se ahorra la transaccion
  // entera con lo que ya sabe.
  if (
    solicitudVencida.estatus !== "ADJUDICADA" ||
    !solicitudVencida.venceEn ||
    !estaVencido(new Date(solicitudVencida.venceEn), ahora)
  ) {
    return { estado: "no_vigente" };
  }

  const intentos = entrada.intentos ?? INTENTOS_DE_VENCIMIENTO;

  for (let intento = 0; intento < intentos; intento += 1) {
    const resultado = await intentarRonda(entrada, deps);
    if (resultado.estado !== "en_conflicto") return resultado;

    await dormir(25 * (intento + 1) + Math.floor(Math.random() * 25));
  }

  return { estado: "en_conflicto" };
};

const intentarRonda = async (
  entrada: EntradaDeVencimiento,
  deps: DepsDeServicio,
): Promise<ResultadoDeVencimiento> => {
  const { lote } = entrada;
  const { ahora } = resolver(deps);
  const correlacionId = nuevaCorrelacion(ahora);

  const vigentes = await depurarYContarReservas(
    {
      loteId: lote.loteId,
      ahora,
      ...(entrada.umbralDeReservaMs === undefined
        ? {}
        : { umbralMs: entrada.umbralDeReservaMs }),
    },
    deps,
  );
  if (vigentes > 0) return { estado: "abstenido", reservasVigentes: vigentes };

  // **En modalidad manual se vence SIN reasignar** (R-23): la variante reducida
  // cierra al vencido, devuelve el lote a `EN_OFERTA` y libera el vehiculo, y
  // ahi se detiene. El lote vuelve a la bandeja del adjudicador, que es lo que
  // se decidio para el caso "el ganador elegido no paga".
  //
  // Este es el unico de los cinco disparadores que no pasa por `adjudicarLote`
  // —hace su propia transaccion— asi que su compuerta tiene que estar aqui.
  if (lote.modalidadAdjudicacion === "MANUAL") {
    return await intentarVarianteReducida(entrada, deps, correlacionId);
  }

  const candidatos = await leerFila(lote.loteId, deps);

  for (const candidato of candidatos) {
    const intento = await intentarVencer(
      candidato,
      entrada,
      deps,
      correlacionId,
    );

    if (intento.ok) {
      return {
        estado: "reasignado",
        turno: candidato.turno,
        solicitudId: identificadorDeSolicitud(lote.loteId, candidato.turno),
        participanteId: candidato.participanteId,
        venceEn: intento.venceEn,
      };
    }

    // `TransactionConflict` en cualquier item: no dice quien gano. Releer y
    // reintentar la ronda completa, igual que T2.
    if (intento.error === "conflicto_concurrencia") {
      return { estado: "en_conflicto" };
    }

    // **Este bloque rutea por POSICION, no por codigo de error.** Insertar,
    // quitar o mover un item de `intentarVencer` desplaza estos numeros **en
    // silencio**: no hay error de compilacion y ninguna prueba unitaria lo
    // nota, porque los indices son datos que devuelve DynamoDB. La Etapa 14
    // sustituyo dos items de esta transaccion conservando su cantidad y su
    // orden justamente para no tocarlos.
    //
    // Item 0 (la vencida ya no aplica) o item 2 (el lote ya no es suyo): el
    // problema no es de este candidato, es de la operacion entera. Abortar.
    if (intento.indice === 0 || intento.indice === 2) {
      return { estado: "no_vigente" };
    }

    // Item 4: el candidato agoto su cupo en esta convocatoria (R-09). Se omite
    // con su evento, igual que T2, y se sigue con el turno siguiente. Su
    // solicitud se queda `EN_FILA` con el turno intacto.
    if (intento.indice === 4) {
      await omitirPorLimite(candidato, lote, deps);
      continue;
    }

    // Item 3: la solicitud dejo de estar EN_FILA bajo nosotros. Sin evento —
    // quien provoco el cambio escribio el suyo.
  }

  return await intentarVarianteReducida(entrada, deps, correlacionId);
};

type ResultadoDeIntento =
  | { ok: true; venceEn: string }
  | { ok: false; error: CodigoError; indice?: number };

/**
 * Un candidato, un intento: la transaccion T5 completa (items 0-6, mas el
 * outbox si el candidato tiene correo).
 */
const intentarVencer = async (
  candidato: Candidato,
  entrada: EntradaDeVencimiento,
  deps: DepsDeServicio,
  correlacionId: string,
): Promise<ResultadoDeIntento> => {
  const { lote, solicitudVencida, detectadoPor } = entrada;
  const { ahora, nuevoId } = resolver(deps);
  const tabla = nombreDeTabla();

  const vence = calcularVenceEn(ahora, lote.horasLiquidacion);
  if (!vence) {
    // Mismo criterio que T2: un lote sin `horasLiquidacion` valida es un item
    // corrupto, no un estado del negocio.
    throw new RangeError(
      `El lote ${lote.loteId} tiene horasLiquidacion invalida: ${String(lote.horasLiquidacion)}`,
    );
  }

  const adjudicadoEn = ahora.toISOString();
  const venceEn = vence.toISOString();
  const solicitudNuevaId = identificadorDeSolicitud(
    lote.loteId,
    candidato.turno,
  );
  const clavesGsi4 = gsi4.vencimiento(diaDeNegocio(vence), venceEn);

  const resultado = await ejecutarTransaccion(
    [
      itemCancelarVencida({ lote, solicitudVencida, ahora }),
      itemDeLiberacionDeCupo({
        participanteId: solicitudVencida.participanteId,
        convocatoriaId: lote.convocatoriaId,
      }),
      {
        item: {
          Update: {
            TableName: tabla,
            Key: clave.lote(lote.convocatoriaId, lote.loteId),
            UpdateExpression:
              "SET adjudicacionActual = :nueva, turnoAdjudicado = :turno," +
              " adjudicadoEn = :adjudicadoEn, venceEn = :venceEn",
            ConditionExpression: "adjudicacionActual = :vencida",
            ExpressionAttributeValues: {
              ":nueva": solicitudNuevaId,
              ":turno": candidato.turno,
              ":adjudicadoEn": adjudicadoEn,
              ":venceEn": venceEn,
              ":vencida": solicitudVencida.solicitudId,
            },
          },
        },
        siFalla: "lote_no_disponible",
        descripcion: "el lote sigue adjudicado a la solicitud vencida",
      },
      {
        item: {
          Update: {
            TableName: tabla,
            Key: clave.solicitud(lote.loteId, candidato.turno),
            UpdateExpression:
              "SET #estatus = :adjudicada, adjudicadoEn = :adjudicadoEn," +
              " venceEn = :venceEn, GSI4PK = :gsi4pk, GSI4SK = :gsi4sk",
            ConditionExpression: "#estatus = :enFila",
            ExpressionAttributeNames: { "#estatus": "estatus" },
            ExpressionAttributeValues: {
              ":adjudicada": "ADJUDICADA",
              ":enFila": "EN_FILA",
              ":adjudicadoEn": adjudicadoEn,
              ":venceEn": venceEn,
              ":gsi4pk": clavesGsi4.GSI4PK,
              ":gsi4sk": clavesGsi4.GSI4SK,
            },
          },
        },
        siFalla: "invalid_state",
        descripcion: `solicitud turno ${String(candidato.turno)} sigue EN_FILA`,
      },
      // El item 5 y el item 1 tocan el **mismo tipo** de item, y coincidir
      // seria fatal: `TransactWriteItems` rechaza dos operaciones sobre el
      // mismo item con `ValidationException`, no con un fallo de condicion que
      // se pueda diagnosticar. No pueden coincidir, y la garantia es de R-07,
      // no de aqui: T5 **no** retira el centinela de fila del vencido —lo deja
      // para que `consultarMiLugar` le siga mostrando su
      // `CANCELADA_POR_VENCIMIENTO`—, asi que mientras esa solicitud existio su
      // titular nunca pudo tener otra viva en este lote. Quien toque ese
      // centinela tiene que volver aqui.
      itemDeConsumoDeCupo({
        participanteId: candidato.participanteId,
        convocatoriaId: lote.convocatoriaId,
        limite: lote.limiteAdjudicaciones,
      }),
      eventoParaTransaccion({
        tipo: "SOLICITUD_VENCIDA",
        agregado: "LOTE",
        agregadoId: lote.loteId,
        actor: { tipo: "SISTEMA" },
        ocurridoEn: ahora,
        correlacionId,
        convocatoriaId: lote.convocatoriaId,
        loteId: lote.loteId,
        solicitudId: solicitudVencida.solicitudId,
        estadoAnterior: "ADJUDICADA",
        estadoNuevo: "CANCELADA_POR_VENCIMIENTO",
        datos: {
          turno: solicitudVencida.turno,
          venceEn: solicitudVencida.venceEn,
          detectadoEn: ahora.toISOString(),
          detectadoPor,
        },
      }),
      eventoParaTransaccion({
        tipo: "LOTE_ADJUDICADO",
        agregado: "LOTE",
        agregadoId: lote.loteId,
        actor: { tipo: "SISTEMA" },
        ocurridoEn: ahora,
        correlacionId,
        convocatoriaId: lote.convocatoriaId,
        loteId: lote.loteId,
        solicitudId: solicitudNuevaId,
        vehiculoId: lote.vehiculoId,
        estadoAnterior: "EN_FILA",
        estadoNuevo: "ADJUDICADA",
        datos: {
          turno: candidato.turno,
          adjudicadoEn,
          venceEn,
          motivoAdjudicacion: "REASIGNACION_POR_VENCIMIENTO",
        },
      }),
      ...itemsDeEncoladoAdjudicacion({
        mensajeId: nuevoId(),
        destinatario: candidato.correoTitular,
        datos: {
          solicitudId: solicitudNuevaId,
          loteId: lote.loteId,
          convocatoriaId: lote.convocatoriaId,
          vehiculoId: lote.vehiculoId,
          precio: lote.precio,
          venceEn,
        },
        actor: { tipo: "SISTEMA" },
        ahora,
        correlacionId,
      }),
    ],
    deps,
  );

  if (!resultado.ok) {
    return { ok: false, error: resultado.error, indice: resultado.indice };
  }
  return { ok: true, venceEn };
};

/**
 * Fila agotada (R-17): nadie vivo pudo tomar el lote. Cierra al vencido igual
 * y libera el lote **y el vehiculo** — la correccion del encabezado.
 */
const intentarVarianteReducida = async (
  entrada: EntradaDeVencimiento,
  deps: DepsDeServicio,
  correlacionId: string,
): Promise<ResultadoDeVencimiento> => {
  const { lote, solicitudVencida, detectadoPor } = entrada;
  const { ahora } = resolver(deps);
  const tabla = nombreDeTabla();
  const momento = ahora.toISOString();

  const destinoLote = transicion("lote", "ADJUDICADO", "LIBERAR");
  const destinoVehiculo = transicion("vehiculo", "RESERVADO", "LIBERAR");
  if (!destinoLote || !destinoVehiculo) {
    throw new Error("La maquina de estados ya no admite LIBERAR");
  }

  const items: ItemDeTransaccion[] = [
    itemCancelarVencida({ lote, solicitudVencida, ahora }),
    itemDeLiberacionDeCupo({
      participanteId: solicitudVencida.participanteId,
      convocatoriaId: lote.convocatoriaId,
    }),
    {
      item: {
        Update: {
          TableName: tabla,
          Key: clave.lote(lote.convocatoriaId, lote.loteId),
          UpdateExpression:
            "SET #estatus = :enOferta, actualizadoEn = :momento" +
            " REMOVE adjudicacionActual, adjudicadoEn, venceEn, turnoAdjudicado",
          ConditionExpression: "adjudicacionActual = :vencida",
          ExpressionAttributeNames: { "#estatus": "estatus" },
          ExpressionAttributeValues: {
            ":enOferta": destinoLote,
            ":vencida": solicitudVencida.solicitudId,
            ":momento": momento,
          },
        },
      },
      siFalla: "lote_no_disponible",
      descripcion: "el lote sigue adjudicado a la solicitud vencida",
    },
    {
      item: {
        Update: {
          TableName: tabla,
          Key: clave.vehiculo(lote.vehiculoId),
          UpdateExpression:
            "SET #estatus = :enConvocatoria, actualizadoEn = :momento",
          ConditionExpression: "#estatus = :reservado",
          ExpressionAttributeNames: { "#estatus": "estatus" },
          ExpressionAttributeValues: {
            ":enConvocatoria": destinoVehiculo,
            ":reservado": "RESERVADO",
            ":momento": momento,
          },
        },
      },
      siFalla: "invalid_state",
      descripcion: "vehiculo RESERVADO vuelve a EN_CONVOCATORIA",
    },
    eventoParaTransaccion({
      tipo: "SOLICITUD_VENCIDA",
      agregado: "LOTE",
      agregadoId: lote.loteId,
      actor: { tipo: "SISTEMA" },
      ocurridoEn: ahora,
      correlacionId,
      convocatoriaId: lote.convocatoriaId,
      loteId: lote.loteId,
      solicitudId: solicitudVencida.solicitudId,
      estadoAnterior: "ADJUDICADA",
      estadoNuevo: "CANCELADA_POR_VENCIMIENTO",
      datos: {
        turno: solicitudVencida.turno,
        venceEn: solicitudVencida.venceEn,
        detectadoEn: ahora.toISOString(),
        detectadoPor,
      },
    }),
  ];

  const resultado = await ejecutarTransaccion(items, deps);
  if (!resultado.ok) {
    return resultado.error === "conflicto_concurrencia"
      ? { estado: "en_conflicto" }
      : { estado: "no_vigente" };
  }
  return { estado: "fila_agotada" };
};

const itemCancelarVencida = (entrada: {
  lote: Lote;
  solicitudVencida: Solicitud;
  ahora: Date;
}): ItemDeTransaccion => {
  const { lote, solicitudVencida, ahora } = entrada;
  return {
    item: {
      Update: {
        TableName: nombreDeTabla(),
        Key: clave.solicitud(lote.loteId, solicitudVencida.turno),
        UpdateExpression: "SET #estatus = :cancelada REMOVE GSI4PK, GSI4SK",
        ConditionExpression: "#estatus = :adjudicada AND venceEn <= :ahora",
        ExpressionAttributeNames: { "#estatus": "estatus" },
        ExpressionAttributeValues: {
          ":cancelada": "CANCELADA_POR_VENCIMIENTO",
          ":adjudicada": "ADJUDICADA",
          ":ahora": ahora.toISOString(),
        },
      },
    },
    siFalla: "invalid_state",
    descripcion: `solicitud ${solicitudVencida.solicitudId} sigue ADJUDICADA y vencida`,
  };
};

export const __test__ = { itemCancelarVencida };
