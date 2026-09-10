import "server-only";

// PA-13 — la bitacora de un rango, **por condicion de clave**.
//
// Antes: una `Query` por dia sobre `AUDIT#<dia>` en GSI2, con todo lo demas
// —tipo de evento, persona, tipo de registro— en `FilterExpression` sobre un
// tope de 2 000 eventos acumulados en memoria. Ese tope produjo tres defectos
// seguidos, los tres la misma clase de error: una cota que cambia la respuesta
// en silencio (`desafios-implementacion.md` 44 y 46).
//
// Ahora cada criterio tiene su propia particion, y el rango es una condicion de
// **clave de ordenamiento**, no un filtro:
//
//   sin criterio     -> GSI5, `MES#<mes>`               1-4 Query por rango
//   tipo de evento   -> GSI6, `TIPO#<tipo>#<mes>`       1-4
//   persona que firmo-> GSI9, `ACTOR#<id>#<mes>`        1-4
//   tipo de registro -> GSI7, `DIA#<dia>` + begins_with 1 por dia
//
// Las tres primeras particionan por **mes** porque el rango se acota dentro de
// la particion: con 90 dias, por dia costarian 90 consultas y por mes cuestan
// entre una y cuatro. La cuarta se queda por dia a proposito — no es
// rendimiento sino correccion, y se explica en `bitacora.porAgregadoDelDia`.

import {
  QueryCommand,
  type QueryCommandInput,
  type QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";

import {
  bitacora,
  comparandoClaves,
  NOMBRES_DE_INDICE,
  type TipoDeAgregado,
} from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import { diasDeNegocioEntre, mesesDeNegocioEntre } from "@/lib/domain/fechas";
import type { EventoDTO, TipoDeEvento } from "@/types/auditoria";
import { exito, fallo, type Resultado } from "@/types/resultado";
import { MAXIMO_DIAS_DE_RANGO } from "./filtrosDeBitacora";
import { aEventoDTO } from "./mapeo";
import {
  condicionDeRango,
  cotaDeRango,
  type CotaDeRango,
} from "./rangoDeBitacora";

/**
 * Tope de eventos que una busqueda acumula en memoria.
 *
 * Sigue existiendo, pero ya no es lo mismo que antes. Antes acotaba una lectura
 * que traia el rango entero para descartarlo en memoria, y por eso su corte
 * cambiaba la respuesta de preguntas que nada tenian que ver. Ahora acota una
 * lectura **ya restringida al criterio**: lo que sobra del tope son eventos que
 * de verdad coinciden con lo que se pregunto, y la pantalla lo dice.
 *
 * Se conserva porque la tabla de resultados se pinta entera, sin paginar. El
 * dia que la pantalla pagine, esto se va con ella.
 */
export const LIMITE_DE_EVENTOS_GLOBAL = 2_000;

/** Tamano de pagina de cada `Query`. */
const TAMANO_DE_PAGINA = 200;

type RangoDeBusqueda = {
  /** Dia de negocio `yyyy-mm-dd`, inclusivo. */
  desde: string;
  /** Dia de negocio `yyyy-mm-dd`, inclusivo. */
  hasta: string;
};

/**
 * Una busqueda de rango, con **al menos un criterio**.
 *
 * La union de tres es deliberada y es la parte que el tipo aporta: cada rama
 * exige uno de los tres, asi que un rango sin criterio **no se puede
 * construir**. Antes se podia, y caia en un indice cronologico que ya no
 * existe: un `ValidationException` en runtime sobre codigo que compilaba.
 *
 * `validarBusqueda` ya rechazaba `sin_criterio` en la pantalla; esto lo vuelve
 * una propiedad del servicio, para que una action nueva no pueda pedirlo.
 */
export type BusquedaGlobal = RangoDeBusqueda &
  (
    | { tipo: TipoDeEvento; actorId?: string; agregado?: TipoDeAgregado }
    | { tipo?: TipoDeEvento; actorId: string; agregado?: TipoDeAgregado }
    | { tipo?: TipoDeEvento; actorId?: string; agregado: TipoDeAgregado }
  );

export type BitacoraGlobal = {
  eventos: readonly EventoDTO[];
  /** `true` si se alcanzo `LIMITE_DE_EVENTOS_GLOBAL` y falta historia. */
  truncada: boolean;
};

/**
 * Una consulta: la particion, su condicion de clave y sus valores.
 *
 * Las particiones se recorren **de la mas nueva a la mas vieja** y cada una se
 * lee descendente, para que el truncamiento se lleve lo mas viejo. Es la
 * correccion de la seccion 46: la version anterior leia ascendente y el corte
 * escondia justamente lo de hoy.
 */
type Consulta = Pick<
  QueryCommandInput,
  | "IndexName"
  | "KeyConditionExpression"
  | "ExpressionAttributeNames"
  | "ExpressionAttributeValues"
>;

/**
 * Traduce la busqueda en la lista de consultas que la responden, de la
 * particion mas nueva a la mas vieja.
 *
 * Un solo lugar decide que indice sirve a que criterio. Repartir esa decision
 * entre funciones por indice se leeria mas ordenado y escondería lo unico que
 * de verdad hay que poder revisar de un vistazo: **que ninguna combinacion cae
 * en un `Scan` ni en un filtro**.
 */
const consultasDe = (
  busqueda: BusquedaGlobal,
  cota: CotaDeRango,
  meses: readonly string[],
  dias: readonly string[],
): Consulta[] => {
  const rango = condicionDeRango(cota);
  const descendente = <T>(valores: readonly T[]): T[] => [...valores].reverse();

  // El tipo de registro va por dia y con `begins_with` sobre `agregadoSK`, que
  // es la clave de ordenamiento de GSI7: el rango ya lo acota la particion, asi
  // que no lleva condicion de tiempo.
  if (busqueda.agregado) {
    const agregado = busqueda.agregado;
    return descendente(dias).map((dia) => ({
      IndexName: NOMBRES_DE_INDICE.porAgregadoDelDia,
      KeyConditionExpression:
        "diaPK = :particion AND begins_with(agregadoSK, :prefijo)",
      ExpressionAttributeValues: {
        ":particion": bitacora.particionDelDia(dia).diaPK,
        ":prefijo": bitacora.prefijoDeAgregado(agregado),
      },
    }));
  }

  if (busqueda.tipo) {
    const tipo = busqueda.tipo;
    return descendente(meses).map((mes) => ({
      IndexName: NOMBRES_DE_INDICE.porTipoDeEvento,
      KeyConditionExpression: `tipoPK = :particion AND ${rango.condicion}`,
      ExpressionAttributeValues: {
        ":particion": bitacora.particionDeTipo(tipo, mes).tipoPK,
        ...rango.valores,
      },
    }));
  }

  if (busqueda.actorId) {
    const actorId = busqueda.actorId;
    return descendente(meses).map((mes) => ({
      IndexName: NOMBRES_DE_INDICE.porActor,
      KeyConditionExpression: `actorMesPK = :particion AND ${rango.condicion}`,
      ExpressionAttributeValues: {
        ":particion": bitacora.particionDeActor(actorId, mes).actorMesPK,
        ...rango.valores,
      },
    }));
  }

  // Inalcanzable: `BusquedaGlobal` exige uno de los tres criterios. Se lanza en
  // vez de devolver una consulta de respaldo porque no hay ninguna que sea
  // correcta — el indice cronologico se borro justamente por no tener lector, y
  // una consulta contra un indice inexistente fallaria en DynamoDB con un error
  // que no dice que el criterio venia vacio.
  throw new Error(
    "consultarBitacoraGlobal sin criterio: el tipo de BusquedaGlobal lo impide",
  );
};

/**
 * Lo que un indice no puede acotar por clave.
 *
 * Solo queda un caso, y es el unico legitimo: **el tipo de evento combinado con
 * el tipo de registro**. GSI7 particiona por dia y ordena por agregado, asi que
 * el tipo de evento no cabe en su clave. Es un filtro sobre una lectura ya
 * restringida a un dia y a un tipo de registro, no sobre la bitacora entera.
 *
 * Toda otra combinacion tiene indice. Si esta funcion crece, es la senal de que
 * alguien agrego un criterio sin darle clave.
 */
const filtroResidual = (
  busqueda: BusquedaGlobal,
): Pick<QueryCommandInput, "FilterExpression" | "ExpressionAttributeNames"> & {
  valores: Record<string, unknown>;
} => {
  if (!busqueda.agregado || !busqueda.tipo) return { valores: {} };
  return {
    FilterExpression: "#tipo = :tipoResidual",
    ExpressionAttributeNames: { "#tipo": "tipo" },
    valores: { ":tipoResidual": busqueda.tipo },
  };
};

/**
 * Una particion, descendente y sin pasar de `cupo`.
 *
 * `Limit` **no es el tamano de pagina cuando hay filtro**: DynamoDB aplica el
 * limite antes de filtrar, asi que una pagina puede volver corta o vacia con
 * mas datos detras. Por eso se itera `LastEvaluatedKey` hasta llenar el cupo y
 * no se confunde "pagina vacia" con "no hay mas".
 */
const leerParticion = async (
  consulta: Consulta,
  residual: ReturnType<typeof filtroResidual>,
  cupo: number,
  deps: DepsDeServicio,
): Promise<EventoDTO[]> => {
  const eventos: EventoDTO[] = [];
  let cursor: QueryCommandOutput["LastEvaluatedKey"];

  do {
    const salida = await clienteDe(deps).send(
      new QueryCommand({
        TableName: nombreDeTabla(),
        ...consulta,
        ...(residual.FilterExpression
          ? {
              FilterExpression: residual.FilterExpression,
              ExpressionAttributeNames: residual.ExpressionAttributeNames,
            }
          : {}),
        ExpressionAttributeValues: {
          ...consulta.ExpressionAttributeValues,
          ...residual.valores,
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
  } while (cursor && eventos.length < cupo);

  return eventos;
};

/**
 * Eventos del rango en orden cronologico ascendente.
 *
 * **Se lee de lo mas nuevo a lo mas viejo y se voltea al final**, por la razon
 * de la seccion 46: si el rango tiene mas eventos de los que caben, lo que
 * sobra tiene que ser lo mas viejo.
 *
 * Las particiones se recorren en **secuencia** y no en paralelo: en secuencia se
 * deja de leer en cuanto se llena el cupo, y el caso lento —recorrer las cuatro
 * particiones— es exactamente el caso en que hay pocos datos y cada `Query` es
 * barata.
 *
 * No se ordena en memoria. Las particiones son disjuntas, se recorren en orden
 * y cada una vuelve ordenada por su clave, asi que basta el `reverse` final.
 * La unica excepcion es GSI7, donde la particion del dia ordena por agregado y
 * no por tiempo: ahi si hay que ordenar, y se dice donde ocurre.
 */
export const consultarBitacoraGlobal = async (
  busqueda: BusquedaGlobal,
  deps: DepsDeServicio = {},
): Promise<Resultado<BitacoraGlobal>> => {
  const dias = diasDeNegocioEntre(busqueda.desde, busqueda.hasta);
  const meses = mesesDeNegocioEntre(busqueda.desde, busqueda.hasta);
  const cota = cotaDeRango(busqueda.desde, busqueda.hasta);
  if (!dias || !meses || !cota) {
    return fallo("validation_failed", { campo: "rango" });
  }

  // Segunda linea de defensa, y no una duplicacion de `validarBusqueda`: quien
  // llama puede ser una action nueva que olvide validar.
  if (dias.length > MAXIMO_DIAS_DE_RANGO) {
    return fallo("validation_failed", {
      campo: "rango",
      maximo: String(MAXIMO_DIAS_DE_RANGO),
    });
  }

  const residual = filtroResidual(busqueda);
  const consultas = consultasDe(busqueda, cota, meses, dias);
  const recientesPrimero: EventoDTO[] = [];
  let truncada = false;

  for (const consulta of consultas) {
    const restante = LIMITE_DE_EVENTOS_GLOBAL - recientesPrimero.length;
    if (restante <= 0) {
      truncada = true;
      break;
    }

    // Se pide uno mas que el cupo para distinguir "cabe justo" de "no cabe":
    // sin ese evento extra, un rango que llena el tope exacto se reportaria
    // como truncado sin serlo.
    const leidos = await leerParticion(consulta, residual, restante + 1, deps);
    if (leidos.length > restante) truncada = true;
    recientesPrimero.push(...leidos.slice(0, restante));
  }

  // GSI7 ordena su particion por `agregadoSK`, o sea por identificador y luego
  // por tiempo: dentro de un dia, los eventos no vienen cronologicos. Se ordena
  // aqui —es un dia de eventos ya acotado, no la bitacora entera— y se hace en
  // el mismo criterio que la clave: `ocurridoEn` y, a igualdad, `eventoId`.
  if (busqueda.agregado) {
    recientesPrimero.sort((a, b) =>
      a.ocurridoEn === b.ocurridoEn
        ? comparandoClaves(b.eventoId, a.eventoId)
        : comparandoClaves(b.ocurridoEn, a.ocurridoEn),
    );
  }

  return exito({ eventos: recientesPrimero.reverse(), truncada });
};

// `consultarPorTipoDeEvento` ya no existe. Era `consultarBitacoraGlobal` con
// una heuristica delante: reusar una lectura previa del rango **si no habia
// truncado**, para ahorrarse una consulta. Esa heuristica produjo el defecto de
// las 483 filas contra 841 (`desafios` 46), y ahora ademas no ahorra nada — el
// tipo de evento **es la particion** de GSI6, asi que preguntarlo directo
// cuesta entre una y cuatro consultas y no puede responder de menos.
