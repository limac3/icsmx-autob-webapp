import "server-only";

// T2 — adjudicacion. `modelo-datos-dynamodb.md` seccion 6.
//
// **Aqui vive la equidad del sistema.** Tres reglas gobiernan este archivo y
// ninguna es negociable:
//
//  1. **La adjudicacion se gana con escritura condicional, jamas con una
//     lectura previa** (regla 6). Ante N intentos simultaneos, DynamoDB deja
//     pasar exactamente uno. Cualquier "leer el lote y decidir" es una carrera.
//  2. **El orden manda sobre el tiempo** (R-08). Se recorre PA-07, que devuelve
//     la fila ordenada por turno **por construccion** —el relleno de ceros de la
//     `SK`—, y no se ordena nada en memoria.
//  3. **Toda desviacion aparente del orden lleva su propio evento.** Saltarse un
//     turno vivo sin registrarlo es indistinguible de un fraude
//     (`trazabilidad-auditoria.md` 3).
//
// La abstencion por reservas (R18) es lo unico que se decide leyendo, y solo
// puede **detener**: una lectura que nunca concede no puede autorizar de mas.

import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import {
  clave,
  gsi4,
  identificadorDeSolicitud,
  PREFIJO,
  turnoDesdeClave,
} from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  CONDICION_CENTINELA_NUEVO,
  CONDICION_LOTE_LIBRE,
  ejecutarTransaccion,
  type ItemDeTransaccion,
} from "@/lib/data/transacciones";
import { diaDeNegocio } from "@/lib/domain/fechas";
import { calcularVenceEn } from "@/lib/domain/plazos";
import type { MotivoDeAdjudicacion } from "@/types/fila";
import type { Lote } from "@/types/lote";
import type { CodigoError } from "@/types/resultado";
import { depurarYContarReservas } from "./reservas";

/**
 * Reintentos ante `TransactionConflict` sobre el item del lote.
 *
 * El item del lote es el mutex de la adjudicacion: dos procesos que intentan
 * adjudicar a la vez **tienen** que tocarlo. Cuando DynamoDB cancela por
 * conflicto no dice quien gano, asi que releer y reintentar es la unica
 * respuesta correcta — decidir aqui seria adivinar.
 *
 * Es distinto del conflicto que hundio a la variante descartada de R18: alli el
 * item caliente estaba en el camino de **toda solicitud**; aqui solo en el de la
 * adjudicacion, que ocurre una vez por lote.
 */
export const INTENTOS_DE_ADJUDICACION = 4;

export type ResultadoDeAdjudicacion =
  | {
      estado: "adjudicado";
      turno: number;
      solicitudId: string;
      participanteId: string;
      venceEn: string;
    }
  /** Hay turnos en vuelo que la fila todavia no muestra (R18). */
  | { estado: "abstenido"; reservasVigentes: number }
  /**
   * El lote no esta en juego. Casi siempre porque otro proceso acaba de
   * ganarlo; tambien si su vehiculo no esta `EN_CONVOCATORIA`, que seria una
   * inconsistencia de datos. En los dos casos la respuesta es la misma —
   * abortar el bucle— porque ninguno depende del candidato: reintentar con el
   * turno siguiente solo produciria N fracasos identicos.
   */
  | { estado: "no_adjudicable" }
  /** Ningun candidato vivo pudo tomarlo (R-17). */
  | { estado: "fila_agotada"; turnosRevisados: number }
  /** Contencion sostenida sobre el item del lote. Reintentable. */
  | { estado: "en_conflicto" };

export type EntradaDeAdjudicacion = {
  /** Ya leido por quien invoca: releerlo abriria una ventana innecesaria. */
  lote: Lote;
  motivo: MotivoDeAdjudicacion;
  umbralDeReservaMs?: number;
  intentos?: number;
};

type Candidato = { turno: number; participanteId: string };

const dormir = (ms: number): Promise<void> =>
  new Promise((continuar) => setTimeout(continuar, ms));

/**
 * Intenta adjudicar el lote al turno vivo menor.
 *
 * **No devuelve `Resultado`** y no es un descuido: ninguno de sus desenlaces es
 * un error que quien invoca deba propagar. Abstenerse, encontrar el lote ya
 * adjudicado o agotar la fila son resultados normales de una operacion que se
 * dispara sola despues de cada solicitud y de cada liberacion.
 */
export const adjudicarLote = async (
  entrada: EntradaDeAdjudicacion,
  deps: DepsDeServicio = {},
): Promise<ResultadoDeAdjudicacion> => {
  const intentos = entrada.intentos ?? INTENTOS_DE_ADJUDICACION;

  for (let intento = 0; intento < intentos; intento += 1) {
    const resultado = await intentarRonda(entrada, deps);
    if (resultado.estado !== "en_conflicto") return resultado;

    // Espera con jitter: sin el, dos procesos en conflicto reintentan en fase y
    // vuelven a chocar.
    await dormir(25 * (intento + 1) + Math.floor(Math.random() * 25));
  }

  return { estado: "en_conflicto" };
};

/**
 * Una pasada completa: abstencion, lectura de la fila y bucle de candidatos.
 *
 * **Las reservas se leen antes que la fila, y ese orden es parte del
 * mecanismo.** Al reves no sirve: una solicitud cuyo paso 2 se confirmara entre
 * la lectura de la fila y la de las reservas no apareceria en la primera y ya
 * no tendria reserva en la segunda — quedaria invisible por ambos lados.
 * Leyendo las reservas primero, toda reserva ausente pertenece a una solicitud
 * que o bien ya esta escrita —y la `Query` consistente posterior la vera— o
 * bien nunca se escribira.
 */
const intentarRonda = async (
  entrada: EntradaDeAdjudicacion,
  deps: DepsDeServicio,
): Promise<ResultadoDeAdjudicacion> => {
  const { lote } = entrada;
  const { ahora } = resolver(deps);

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

  const candidatos = await leerFila(lote.loteId, deps);
  let turnosRevisados = 0;

  for (const candidato of candidatos) {
    turnosRevisados += 1;
    const intento = await intentarAdjudicar(candidato, entrada, deps);

    if (intento.ok) {
      return {
        estado: "adjudicado",
        turno: candidato.turno,
        solicitudId: identificadorDeSolicitud(lote.loteId, candidato.turno),
        participanteId: candidato.participanteId,
        venceEn: intento.venceEn,
      };
    }

    // Fallo el item 1 o el item 4: el problema es del lote, no del candidato.
    // Se aborta el bucle entero — seguir con el turno siguiente solo
    // produciria N fracasos identicos.
    if (intento.error === "lote_no_disponible") {
      return { estado: "no_adjudicable" };
    }

    // Cancelacion por conflicto: no dice quien gano. Releer y reintentar.
    if (intento.error === "conflicto_concurrencia")
      return { estado: "en_conflicto" };

    // Fallo el item 3: el candidato ya sostiene otra adjudicacion (R-09). Se
    // congela **con su evento** y se sigue con el turno siguiente.
    if (intento.error === "adjudicacion_activa") {
      await congelar(candidato, lote, deps);
      continue;
    }

    // Fallo el item 2: la solicitud dejo de estar `EN_FILA` bajo nosotros. No
    // hace falta evento — quien provoco ese cambio escribio el suyo, y una
    // solicitud que ya no esta viva no es un turno saltado.
  }

  await registrarFilaAgotada(lote, turnosRevisados, deps);
  return { estado: "fila_agotada", turnosRevisados };
};

/**
 * PA-07: la fila de un lote, en orden de turno.
 *
 * **No se ordena en memoria.** El turno va con ceros a la izquierda en la `SK`
 * (D-5), asi que la `Query` la devuelve ya ordenada; ordenar aqui ocultaria un
 * error de construccion de claves en vez de exponerlo.
 *
 * `ConsistentRead` porque alimenta un bucle de escrituras condicionales
 * (modelo-datos 8): una lectura eventual podria no ver al turno menor y coronar
 * al siguiente.
 */
const leerFila = async (
  loteId: string,
  deps: DepsDeServicio,
): Promise<Candidato[]> => {
  const salida = await clienteDe(deps).send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefijo)",
      ExpressionAttributeValues: {
        ":pk": clave.solicitud(loteId, 0).PK,
        ":prefijo": PREFIJO.solicitud,
      },
      ScanIndexForward: true,
      ConsistentRead: true,
    }),
  );

  const candidatos: Candidato[] = [];
  for (const item of salida.Items ?? []) {
    const turno = turnoDesdeClave(String(item.SK));
    if (turno === undefined || item.estatus !== "EN_FILA") continue;
    candidatos.push({ turno, participanteId: String(item.participanteId) });
  }
  return candidatos;
};

/**
 * La transaccion de T2, con dos correcciones respecto del documento.
 *
 * **1. La condicion del item 1 incluye `estatus = EN_OFERTA`.** El documento
 * pedia solo `attribute_not_exists(adjudicacionActual)`, y eso deja pasar un
 * lote `NO_VENDIDO`: al concluir la convocatoria el lote cierra **sin**
 * `adjudicacionActual`, asi que una adjudicacion en vuelo podria entregarlo
 * despues del cierre. Un lote `VENDIDO` ya queda excluido por conservar su
 * adjudicacion, pero `NO_VENDIDO` y `RETIRADO` no.
 *
 * **2. Lleva el vehiculo a `RESERVADO` (item 4).** T2 no lo mencionaba, pero la
 * maquina de estados del vehiculo (`proyecto.md` 5.2) solo admite
 * `AVALAR_PAGO` desde `RESERVADO`: sin este item, `RESERVADO` seria inalcanzable
 * y T4 no tendria transicion valida al vender. El item no reintroduce la
 * contencion de R18 —el vehiculo se toca una vez por adjudicacion, no una vez
 * por solicitud— y R-10 garantiza que ningun otro lote activo lo comparte.
 */
const intentarAdjudicar = async (
  candidato: Candidato,
  entrada: EntradaDeAdjudicacion,
  deps: DepsDeServicio,
): Promise<
  { ok: true; venceEn: string } | { ok: false; error: CodigoError }
> => {
  const { lote } = entrada;
  const { ahora } = resolver(deps);
  const tabla = nombreDeTabla();

  const vence = calcularVenceEn(ahora, lote.horasLiquidacion);
  if (!vence) {
    // Un lote sin `horasLiquidacion` valida es un item corrupto, no un estado
    // del negocio: R-14 lo exige mayor que cero desde que se captura.
    throw new RangeError(
      `El lote ${lote.loteId} tiene horasLiquidacion invalida: ${String(lote.horasLiquidacion)}`,
    );
  }

  const adjudicadoEn = ahora.toISOString();
  const venceEn = vence.toISOString();
  const solicitudId = identificadorDeSolicitud(lote.loteId, candidato.turno);
  const claves = gsi4.vencimiento(diaDeNegocio(vence), venceEn);

  const resultado = await ejecutarTransaccion(
    [
      {
        item: {
          Update: {
            TableName: tabla,
            Key: clave.lote(lote.convocatoriaId, lote.loteId),
            UpdateExpression:
              "SET adjudicacionActual = :solicitud, turnoAdjudicado = :turno," +
              " adjudicadoEn = :adjudicadoEn, venceEn = :venceEn," +
              " #estatus = :adjudicado",
            ConditionExpression: `${CONDICION_LOTE_LIBRE} AND #estatus = :enOferta`,
            ExpressionAttributeNames: { "#estatus": "estatus" },
            ExpressionAttributeValues: {
              ":solicitud": solicitudId,
              ":turno": candidato.turno,
              ":adjudicadoEn": adjudicadoEn,
              ":venceEn": venceEn,
              ":adjudicado": "ADJUDICADO",
              ":enOferta": "EN_OFERTA",
            },
          },
        },
        siFalla: "lote_no_disponible",
        descripcion: "lote libre y en oferta (regla 6)",
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
              // GSI4 es disperso a proposito: la solicitud entra al indice del
              // trabajo pendiente al adjudicarse y sale al subir el comprobante
              // (T3). El barrido de R-15 no filtra nada porque el indice
              // contiene exactamente lo que vence.
              ":gsi4pk": claves.GSI4PK,
              ":gsi4sk": claves.GSI4SK,
            },
          },
        },
        siFalla: "invalid_state",
        descripcion: `solicitud turno ${String(candidato.turno)} sigue EN_FILA`,
      },
      {
        item: {
          Put: {
            TableName: tabla,
            Item: {
              ...clave.centinelaAdjudicacion(candidato.participanteId),
              loteId: lote.loteId,
              convocatoriaId: lote.convocatoriaId,
              solicitudId,
              turno: candidato.turno,
              adjudicadoEn,
              venceEn,
            },
            ConditionExpression: CONDICION_CENTINELA_NUEVO,
          },
        },
        siFalla: "adjudicacion_activa",
        descripcion: "centinela de adjudicacion activa (R-09)",
      },
      {
        item: {
          Update: {
            TableName: tabla,
            Key: clave.vehiculo(lote.vehiculoId),
            UpdateExpression:
              "SET #estatus = :reservado, actualizadoEn = :adjudicadoEn",
            ConditionExpression: "#estatus = :enConvocatoria",
            ExpressionAttributeNames: { "#estatus": "estatus" },
            ExpressionAttributeValues: {
              ":reservado": "RESERVADO",
              ":enConvocatoria": "EN_CONVOCATORIA",
              ":adjudicadoEn": adjudicadoEn,
            },
          },
        },
        // `lote_no_disponible` y no `invalid_state`: si el vehiculo no esta
        // `EN_CONVOCATORIA` el problema no es de este candidato sino del lote,
        // y probar con el turno siguiente fallaria igual.
        siFalla: "lote_no_disponible",
        descripcion: "vehiculo EN_CONVOCATORIA pasa a RESERVADO",
      },
      eventoParaTransaccion({
        tipo: "LOTE_ADJUDICADO",
        agregado: "LOTE",
        agregadoId: lote.loteId,
        actor: { tipo: "SISTEMA" },
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        convocatoriaId: lote.convocatoriaId,
        loteId: lote.loteId,
        solicitudId,
        vehiculoId: lote.vehiculoId,
        estadoAnterior: "EN_FILA",
        estadoNuevo: "ADJUDICADA",
        datos: {
          turno: candidato.turno,
          adjudicadoEn,
          venceEn,
          motivoAdjudicacion: entrada.motivo,
        },
      }),
    ],
    deps,
  );

  return resultado.ok
    ? { ok: true, venceEn }
    : { ok: false, error: resultado.error };
};

/**
 * Congela al candidato que ya sostiene otra adjudicacion (R-09) y **deja
 * escrito por que se le salto**.
 *
 * Dos eventos y no uno, porque responden preguntas distintas y viven en sitios
 * distintos de la bitacora: `SOLICITUD_CONGELADA` explica el cambio de estado
 * de esa solicitud, y `SOLICITUD_OMITIDA` explica, en la historia del lote, por
 * que la adjudicacion siguio de largo con un turno mayor. Sin el segundo, el
 * auditor veria una adjudicacion al turno 5 con los turnos 3 y 4 vivos, que es
 * exactamente lo que la comprobacion 2 de integridad marca como sospechoso.
 *
 * De mejor esfuerzo: si falla, el candidato sigue `EN_FILA` y la proxima
 * adjudicacion volvera a intentarlo y a congelarlo. No adelanta a nadie.
 */
const congelar = async (
  candidato: Candidato,
  lote: Lote,
  deps: DepsDeServicio,
): Promise<void> => {
  const { ahora } = resolver(deps);
  const correlacionId = nuevaCorrelacion(ahora);
  const solicitudId = identificadorDeSolicitud(lote.loteId, candidato.turno);
  const loteQueGano = await loteDeLaAdjudicacionActiva(
    candidato.participanteId,
    deps,
  );

  const items: ItemDeTransaccion[] = [
    {
      item: {
        Update: {
          TableName: nombreDeTabla(),
          Key: clave.solicitud(lote.loteId, candidato.turno),
          UpdateExpression: "SET #estatus = :congelada",
          ConditionExpression: "#estatus = :enFila",
          ExpressionAttributeNames: { "#estatus": "estatus" },
          ExpressionAttributeValues: {
            ":congelada": "CONGELADA",
            ":enFila": "EN_FILA",
          },
        },
      },
      siFalla: "invalid_state",
      descripcion: `congelar turno ${String(candidato.turno)}`,
    },
    eventoParaTransaccion({
      tipo: "SOLICITUD_CONGELADA",
      agregado: "LOTE",
      agregadoId: lote.loteId,
      actor: { tipo: "SISTEMA" },
      ocurridoEn: ahora,
      correlacionId,
      convocatoriaId: lote.convocatoriaId,
      loteId: lote.loteId,
      solicitudId,
      estadoAnterior: "EN_FILA",
      estadoNuevo: "CONGELADA",
      datos: { turno: candidato.turno, loteQueGano },
    }),
    eventoParaTransaccion({
      tipo: "SOLICITUD_OMITIDA",
      agregado: "LOTE",
      agregadoId: lote.loteId,
      actor: { tipo: "SISTEMA" },
      ocurridoEn: ahora,
      correlacionId,
      convocatoriaId: lote.convocatoriaId,
      loteId: lote.loteId,
      solicitudId,
      datos: { turno: candidato.turno, razonOmision: "ADJUDICACION_ACTIVA" },
    }),
  ];

  await ejecutarTransaccion(items, deps);
};

/** Que lote gano el participante, para que el evento lo diga. */
const loteDeLaAdjudicacionActiva = async (
  participanteId: string,
  deps: DepsDeServicio,
): Promise<string | undefined> => {
  const salida = await clienteDe(deps).send(
    new GetCommand({
      TableName: nombreDeTabla(),
      Key: clave.centinelaAdjudicacion(participanteId),
      ConsistentRead: true,
    }),
  );
  const loteId = salida.Item?.loteId;
  return typeof loteId === "string" ? loteId : undefined;
};

/**
 * `FILA_AGOTADA` — R-17: no quedo ningun candidato vivo y el lote sigue
 * `EN_OFERTA`, disponible para quien solicite despues.
 *
 * Es un evento sin mutacion, y es correcto que lo sea: la ausencia de
 * adjudicacion tambien es un hecho que el auditor tiene que poder ver. Sin el,
 * una fila con turnos vivos y un lote sin adjudicar pareceria un proceso que
 * dejo de correr.
 */
const registrarFilaAgotada = async (
  lote: Lote,
  turnosRevisados: number,
  deps: DepsDeServicio,
): Promise<void> => {
  const { ahora } = resolver(deps);

  await ejecutarTransaccion(
    [
      eventoParaTransaccion({
        tipo: "FILA_AGOTADA",
        agregado: "LOTE",
        agregadoId: lote.loteId,
        actor: { tipo: "SISTEMA" },
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        convocatoriaId: lote.convocatoriaId,
        loteId: lote.loteId,
        datos: { turnosRevisados },
      }),
    ],
    deps,
  );
};

export const __test__ = { leerFila, congelar, registrarFilaAgotada };
