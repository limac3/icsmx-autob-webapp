import "server-only";

// PA-13 — bitacora cronologica global de un rango de dias.
//
// `modelo-datos-dynamodb.md` seccion 5 declaraba este patron desde la Etapa 0 y
// `eventos.ts` escribe su clave (`AUDIT#<dia>` en GSI2) en cada evento desde la
// Etapa 5, pero **nadie lo leia**: la pantalla de auditoria solo sabia consultar
// la particion de un agregado (PA-12), asi que exigia conocer de antemano el
// identificador de lo que se buscaba. Es lo que hacia imposible responder "toda
// la actividad de esta persona" o "todos los rechazos de pago del mes".
//
// Una `Query` por dia y no una sola: la particion es el dia, precisamente para
// que el trabajo del sistema no caiga todo en una clave (riesgo R12). El rango
// de la pantalla es lo que decide cuantas.

import {
  QueryCommand,
  type QueryCommandInput,
  type QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";

import {
  clave,
  gsi2,
  NOMBRES_DE_INDICE,
  type TipoDeAgregado,
} from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import { diasDeNegocioEntre } from "@/lib/domain/fechas";
import type { EventoDTO, TipoDeEvento } from "@/types/auditoria";
import { exito, fallo, type Resultado } from "@/types/resultado";
import { MAXIMO_DIAS_DE_RANGO } from "./filtrosDeBitacora";
import { aEventoDTO } from "./mapeo";

/**
 * Tope de eventos que una busqueda global acumula en memoria.
 *
 * No es una cota de correccion sino de supervivencia: un dia de apertura de
 * convocatoria escribe un evento por solicitud, y treinta y un dias de eso no
 * caben en una pantalla ni deben caber en un render. Cuando se alcanza, la
 * respuesta lo dice (`truncada`) para que la pantalla pida acotar el rango, en
 * vez de mostrar una lista incompleta que parece completa.
 */
export const LIMITE_DE_EVENTOS_GLOBAL = 2_000;

/** Tamano de pagina de cada `Query` de dia. */
const TAMANO_DE_PAGINA = 200;

export type BusquedaGlobal = {
  /** Dia de negocio `yyyy-mm-dd`, inclusivo. */
  desde: string;
  /** Dia de negocio `yyyy-mm-dd`, inclusivo. */
  hasta: string;
  /** Se aplica en DynamoDB, no en memoria: ver `filtroDeEvento`. */
  tipo?: TipoDeEvento;
  /** Compara contra `actorId`: quien firmo el evento. */
  actorId?: string;
  /**
   * Acota a un tipo de registro, por el prefijo de la `PK`.
   *
   * **Sin esto, el cupo lo puede consumir un solo tipo.** Medido en el
   * sandbox: 3 288 eventos de lote en un dia agotaban los 2 000 del tope, y
   * los 9 de vehiculo y 7 de convocatoria del dia anterior quedaban fuera —
   * asi que la pantalla ofrecia cero identificadores de vehiculo y afirmaba
   * "sin actividad en este rango", que era falso.
   */
  agregado?: TipoDeAgregado;
};

export type BitacoraGlobal = {
  eventos: readonly EventoDTO[];
  /** `true` si se alcanzo `LIMITE_DE_EVENTOS_GLOBAL` y falta historia. */
  truncada: boolean;
};

/**
 * `FilterExpression` dinamica, contra el criterio general del modulo de
 * filtros.
 *
 * Ahi se argumenta que filtrar en memoria no pierde nada, y es cierto **para
 * la particion de un agregado**: unos cientos de eventos en toda su vida. Una
 * particion de dia es de otra naturaleza — puede traer todos los eventos del
 * sistema de ese dia—, y traerla entera por la red para descartar el 99% en el
 * proceso es un costo real. El filtro no ahorra RCU (DynamoDB cobra lo leido,
 * no lo devuelto), pero si transferencia y memoria, que es lo que aqui se
 * agota primero.
 */
const filtroDeEvento = (
  busqueda: BusquedaGlobal,
): Pick<QueryCommandInput, "FilterExpression" | "ExpressionAttributeNames"> & {
  valores: Record<string, unknown>;
} => {
  const condiciones: string[] = [];
  const nombres: Record<string, string> = {};
  const valores: Record<string, unknown> = {};

  if (busqueda.tipo) {
    // `tipo` no es palabra reservada de DynamoDB, pero `#tipo` cuesta lo mismo
    // y no hay que volver a comprobarlo cada vez que se lea esta expresion.
    nombres["#tipo"] = "tipo";
    valores[":tipo"] = busqueda.tipo;
    condiciones.push("#tipo = :tipo");
  }
  if (busqueda.actorId) {
    nombres["#actorId"] = "actorId";
    valores[":actorId"] = busqueda.actorId;
    condiciones.push("#actorId = :actorId");
  }
  if (busqueda.agregado) {
    // `PK` es la clave de la tabla base, no del indice, asi que **si** se
    // puede filtrar por ella en una `Query` de GSI2 (comprobado contra
    // DynamoDB real, no supuesto).
    nombres["#PK"] = "PK";
    valores[":prefijoDeAgregado"] = clave.prefijoDeParticionDeEvento(
      busqueda.agregado,
    );
    condiciones.push("begins_with(#PK, :prefijoDeAgregado)");
  }

  return {
    ...(condiciones.length > 0
      ? {
          FilterExpression: condiciones.join(" AND "),
          ExpressionAttributeNames: nombres,
        }
      : {}),
    valores,
  };
};

/**
 * Un dia, **del evento mas nuevo al mas viejo** y sin pasar de `cupo`.
 *
 * `ScanIndexForward: false` no es un detalle: es lo que hace que el
 * truncamiento se lleve lo mas viejo. Ver el comentario de
 * `consultarBitacoraGlobal`.
 */
const leerDia = async (
  dia: string,
  busqueda: BusquedaGlobal,
  cupo: number,
  deps: DepsDeServicio,
): Promise<EventoDTO[]> => {
  const { FilterExpression, ExpressionAttributeNames, valores } =
    filtroDeEvento(busqueda);
  const eventos: EventoDTO[] = [];
  let cursor: QueryCommandOutput["LastEvaluatedKey"];

  do {
    const salida = await clienteDe(deps).send(
      new QueryCommand({
        TableName: nombreDeTabla(),
        IndexName: NOMBRES_DE_INDICE.porEstatus,
        KeyConditionExpression: "GSI2PK = :pk",
        ...(FilterExpression ? { FilterExpression } : {}),
        ...(ExpressionAttributeNames ? { ExpressionAttributeNames } : {}),
        ExpressionAttributeValues: {
          // Los rellenos solo construyen la particion; las claves se siguen
          // armando en un unico lugar (`claves.ts`).
          ":pk": gsi2.bitacoraDelDia(dia, "relleno", "relleno").GSI2PK,
          ...valores,
        },
        ScanIndexForward: false,
        Limit: TAMANO_DE_PAGINA,
        ExclusiveStartKey: cursor,
      }),
    );

    for (const item of salida.Items ?? []) {
      const evento = aEventoDTO(item);
      if (evento) eventos.push(evento);
    }

    cursor = salida.LastEvaluatedKey;
    // Se corta por dia y no solo al final: un solo dia de apertura puede
    // agotar el cupo por si mismo, y seguir paginandolo seria traer eventos
    // que se van a descartar.
  } while (cursor && eventos.length < cupo);

  return eventos;
};

/**
 * Eventos del rango en orden cronologico ascendente.
 *
 * **Se lee del dia mas nuevo al mas viejo, y se voltea al final.** Es la
 * decision que hace correcto el truncamiento: cuando el rango tiene mas
 * eventos de los que caben, lo que sobra tiene que ser **lo mas viejo**. La
 * primera version leia al reves —ascendente, cortando al llegar al tope— y con
 * datos reales eso escondia justamente lo de hoy: en el sandbox, un dia de
 * prueba de carga con 3 069 eventos consumia el cupo entero y las opciones de
 * los selects, que se ordenan por actividad mas reciente, se armaban del dia
 * anterior.
 *
 * **Y por eso los dias se leen en secuencia y no en paralelo.** Leerlos a la
 * vez obligaria a traer hasta el cupo de cada uno para quedarse con el cupo
 * total. En secuencia y de nuevo a viejo se deja de leer en cuanto se llena, y
 * el caso lento —recorrer los 31 dias— es exactamente el caso en que casi no
 * hay datos y cada `Query` es barata.
 *
 * No se ordena en memoria: cada `Query` devuelve su dia ya ordenado (la
 * `GSI2SK` es `<ocurridoEn>#<eventoId>`), las particiones de dia son disjuntas
 * y se recorren en orden, asi que basta un `reverse` al final.
 */
export const consultarBitacoraGlobal = async (
  busqueda: BusquedaGlobal,
  deps: DepsDeServicio = {},
): Promise<Resultado<BitacoraGlobal>> => {
  const dias = diasDeNegocioEntre(busqueda.desde, busqueda.hasta);
  if (!dias) return fallo("validation_failed", { campo: "rango" });

  // Segunda linea de defensa, y no una duplicacion de `validarBusqueda`: quien
  // llama puede ser una action nueva que olvide validar, y treinta y una
  // `Query` es el techo que este servicio esta dispuesto a ejecutar.
  if (dias.length > MAXIMO_DIAS_DE_RANGO) {
    return fallo("validation_failed", {
      campo: "rango",
      maximo: String(MAXIMO_DIAS_DE_RANGO),
    });
  }

  // Del mas nuevo al mas viejo. `diasDeNegocioEntre` los entrega ascendentes.
  const descendentes = [...dias].reverse();
  const recientesPrimero: EventoDTO[] = [];
  let truncada = false;

  for (const dia of descendentes) {
    const restante = LIMITE_DE_EVENTOS_GLOBAL - recientesPrimero.length;
    if (restante <= 0) {
      // Queda rango sin leer: hay mas historia de la que cabe.
      truncada = true;
      break;
    }

    // Se pide uno mas que el cupo para poder distinguir "cabe justo" de "no
    // cabe": sin ese evento extra, un rango que llena el tope exacto se
    // reportaria como truncado sin serlo.
    const delDia = await leerDia(dia, busqueda, restante + 1, deps);
    if (delDia.length > restante) truncada = true;
    recientesPrimero.push(...delDia.slice(0, restante));
  }

  return exito({
    eventos: recientesPrimero.reverse(),
    truncada,
  });
};

/**
 * Los eventos de un tipo en el rango, reusando una lectura previa **solo si
 * fue completa**.
 *
 * La pantalla ya lee el rango sin filtrar para armar las opciones de sus
 * selects. Si esa lectura no trunco, contiene todo el rango y filtrarla en
 * memoria da exactamente el mismo conjunto que preguntarle a DynamoDB: la
 * segunda consulta seria gasto puro.
 *
 * **Si trunco, no se puede reusar**, y esta es la razon de que exista esta
 * funcion en vez de un `filter` en la pagina: el corte se lleva los eventos
 * mas viejos del rango, y entre ellos puede haber muchos del tipo buscado.
 * Medido en el sandbox: `LOTE_ADJUDICADO` devolvia 483 filas reusando la
 * lectura truncada y devuelve **841** preguntando con el filtro — 358 eventos
 * que se presentaban como "todos los del rango" sin serlo. Y peor que el
 * numero: la respuesta reusada venia marcada como truncada, que le dice al
 * auditor "acota el rango" cuando lo que hacia falta era justo lo contrario.
 *
 * Repetir la lectura cuesta el mismo RCU que la primera —DynamoDB cobra lo
 * leido, no lo devuelto— y se paga: una bitacora que responde de menos sin
 * decirlo no sirve para auditar.
 */
export const consultarPorTipoDeEvento = async (
  entrada: {
    desde: string;
    hasta: string;
    tipo: TipoDeEvento;
    /** Lo que la pantalla ya leyo del rango, sin filtrar. */
    yaLeido?: BitacoraGlobal;
  },
  deps: DepsDeServicio = {},
): Promise<Resultado<BitacoraGlobal>> => {
  if (entrada.yaLeido && !entrada.yaLeido.truncada) {
    return exito({
      eventos: entrada.yaLeido.eventos.filter(
        (evento) => evento.tipo === entrada.tipo,
      ),
      truncada: false,
    });
  }

  return consultarBitacoraGlobal(
    { desde: entrada.desde, hasta: entrada.hasta, tipo: entrada.tipo },
    deps,
  );
};
