import "server-only";

// Los valores distintos con actividad en un rango: identificadores para un
// select, personas para el otro.
//
// **El salto es todo el diseno.** La pregunta es "que identificadores distintos
// tuvieron actividad", y la respuesta natural —leer los eventos del rango y
// quedarse con los distintos— cuesta miles de items para devolver docenas. Un
// dia de apertura de convocatoria en el sandbox escribe 3 288 eventos de lote
// sobre 10 lotes.
//
// GSI7 y GSI8 agrupan **por valor antes que por tiempo**, asi que se puede
// sondear el ultimo del grupo (`Limit: 1`, descendente) y saltar el grupo
// entero con `ExclusiveStartKey`. La cota del salto es el prefijo sin sufijo
// —`"LOTE#<id>"` ordena estrictamente antes que `"LOTE#<id>#<crono>"`—, y
// DynamoDB acepta esa clave sintetizada aunque no corresponda a ningun item.
// Verificado contra la tabla real: 10 lotes distintos en 11 consultas, contra
// 110 eventos que habria que leer sin el salto.
//
// **Lo que se pierde, dicho aqui para que nadie lo descubra despues:** el orden
// deja de ser "ultima actividad exacta" y pasa a ser "ultimo dia con actividad,
// y dentro del dia el orden del indice". Para poblar un `<select>` es
// aceptable; para una tabla de resultados no lo seria.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import {
  bitacora,
  NOMBRES_DE_INDICE,
  type TipoDeAgregado,
} from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import { diasDeNegocioEntre } from "@/lib/domain/fechas";
import { ACTOR_SISTEMA, type EventoDTO } from "@/types/auditoria";
import { exito, fallo, type Resultado } from "@/types/resultado";
import { MAXIMO_DIAS_DE_RANGO } from "./filtrosDeBitacora";
import { aEventoDTO } from "./mapeo";

/**
 * Tope de valores distintos por select.
 *
 * Un `<select>` con miles de opciones no se puede usar ni con raton ni con
 * teclado. Se recorren los dias de nuevo a viejo, asi que el corte se lleva lo
 * mas viejo del rango — que es lo que menos se busca.
 */
export const MAXIMO_DE_VALORES = 200;

/**
 * Tope de lecturas por dia.
 *
 * Sin tope, un dia con miles de grupos grandes convertiria una pantalla de
 * filtros en miles de consultas. Con el, un dia asi aporta lo que alcance y el
 * rango sigue avanzando.
 */
const MAXIMO_DE_LECTURAS_POR_DIA = 40;

/**
 * Un valor distinto y el evento que lo delato.
 *
 * Se devuelve el **evento entero** y no solo el identificador porque los cinco
 * indices proyectan `ALL`: el sondeo ya trajo el item completo, y de ahi salen
 * los datos que hacen falta para etiquetarlo (el `convocatoriaId` de un lote,
 * por ejemplo, sin el cual no se puede ni armar su clave). Pedirlo despues
 * seria una segunda lectura de algo que ya se tiene.
 */
export type ValorConActividad = {
  valor: string;
  /** El evento mas reciente del grupo dentro del dia en que se le encontro. */
  evento: EventoDTO;
};

type Sondeo = {
  indice: string;
  /** GSI7 y GSI8 comparten particion: el dia. */
  diaPK: string;
  /** Nombre de la clave de ordenamiento sobre la que se salta. */
  atributoDeOrden: "agregadoSK" | "actorSK";
  prefijo: string;
  /** Del item sondeado al valor distinto, o `undefined` si no se puede leer. */
  valorDe: (evento: EventoDTO) => string | undefined;
  /** Del valor a la cota que salta su grupo entero. */
  cotaDeGrupo: (valor: string) => string;
};

/**
 * Items por lectura.
 *
 * **No es 1, y esa fue una correccion medida.** La primera version sondeaba de a
 * un item, que es lo optimo cuando cada grupo es enorme —un lote con 300
 * eventos se salta con una consulta— y lo peor cuando hay muchos valores con
 * pocos eventos: 200 vehiculos distintos costaban 200 viajes de red en serie, y
 * la pantalla tardaba **20 segundos** en el sandbox.
 *
 * Con una pagina, cada lectura aporta todos los valores distintos que quepan en
 * ella y el salto se aplica **desde el ultimo grupo visto**. El costo pasa a ser
 * el mejor de los dos mundos: nunca mas de una consulta por grupo grande, y
 * hasta cien valores por consulta cuando los grupos son chicos.
 */
const ITEMS_POR_LECTURA = 100;

/**
 * Recorre un dia extrayendo valores distintos y saltando los grupos ya vistos.
 *
 * Devuelve los valores en el orden del indice descendente, que dentro del dia
 * es el orden **inverso del identificador**, no el del tiempo. Da igual: lo que
 * ordena las opciones es el dia, y los dias se recorren de nuevo a viejo.
 */
const valoresDelDia = async (
  sondeo: Sondeo,
  deps: DepsDeServicio,
): Promise<ValorConActividad[]> => {
  const porValor = new Map<string, ValorConActividad>();
  let cursor: Record<string, unknown> | undefined;

  for (let i = 0; i < MAXIMO_DE_LECTURAS_POR_DIA; i += 1) {
    const salida = await clienteDe(deps).send(
      new QueryCommand({
        TableName: nombreDeTabla(),
        IndexName: sondeo.indice,
        KeyConditionExpression: `diaPK = :particion AND begins_with(${sondeo.atributoDeOrden}, :prefijo)`,
        ExpressionAttributeValues: {
          ":particion": sondeo.diaPK,
          ":prefijo": sondeo.prefijo,
        },
        ScanIndexForward: false,
        Limit: ITEMS_POR_LECTURA,
        ExclusiveStartKey: cursor,
      }),
    );

    const items = salida.Items ?? [];
    if (items.length === 0) break;

    // El **ultimo** item legible de la pagina es el que define el salto: todo
    // lo anterior ya se leyo, y su grupo puede seguir mas alla de la pagina.
    let ultimo: { valor: string; item: Record<string, unknown> } | undefined;
    for (const item of items) {
      const evento = aEventoDTO(item);
      const valor = evento ? sondeo.valorDe(evento) : undefined;
      if (!evento || !valor) continue;
      // Se conserva el primero de cada grupo, que en orden descendente es el
      // mas reciente.
      if (!porValor.has(valor)) porValor.set(valor, { valor, evento });
      ultimo = { valor, item };
    }

    // Ningun item de la pagina se pudo interpretar: no hay de donde sacar el
    // salto, y repetir la misma lectura giraria en falso.
    if (!ultimo) break;
    if (porValor.size >= MAXIMO_DE_VALORES) break;

    // La cota del grupo: el prefijo **sin** el sufijo de tiempo. En orden
    // descendente deja atras todas las entradas de ese valor de una vez.
    cursor = {
      diaPK: sondeo.diaPK,
      [sondeo.atributoDeOrden]: sondeo.cotaDeGrupo(ultimo.valor),
      PK: ultimo.item.PK,
      SK: ultimo.item.SK,
    };
  }

  return [...porValor.values()];
};

/**
 * Dias que se consultan a la vez.
 *
 * En serie, un rango de 90 dias con casi nada dentro cuesta 90 viajes de red
 * encadenados —siete segundos de espera para devolver una lista corta—, porque
 * la latencia se suma aunque el trabajo sea minimo. En tandas se divide por
 * ocho y el tope sigue acotado: nunca hay mas de ocho dias en vuelo.
 *
 * No son los 90 a la vez porque cada dia puede pedir hasta
 * `MAXIMO_DE_LECTURAS_POR_DIA`, y lanzarlos todos convertiria un rango largo en
 * una rafaga de miles de consultas simultaneas contra la tabla.
 */
const DIAS_POR_TANDA = 8;

/**
 * Recorre los dias de nuevo a viejo acumulando valores distintos.
 *
 * El primer dia en que aparece un valor es el mas reciente en que tuvo
 * actividad, asi que el `Map` conserva ese evento y no lo pisa despues: el
 * orden de insercion **es** el orden de ultima actividad por dia. Por eso las
 * tandas se procesan **en orden** aunque sus dias vayan en paralelo — si se
 * mezclaran, el orden de las opciones dejaria de significar nada.
 */
const recorrerRango = async (
  dias: readonly string[],
  sondeoDelDia: (dia: string) => Sondeo,
  deps: DepsDeServicio,
): Promise<ValorConActividad[]> => {
  const porValor = new Map<string, ValorConActividad>();
  const descendentes = [...dias].reverse();

  for (let i = 0; i < descendentes.length; i += DIAS_POR_TANDA) {
    if (porValor.size >= MAXIMO_DE_VALORES) break;

    const tanda = await Promise.all(
      descendentes
        .slice(i, i + DIAS_POR_TANDA)
        .map((dia) => valoresDelDia(sondeoDelDia(dia), deps)),
    );

    for (const delDia of tanda) {
      for (const encontrado of delDia) {
        if (!porValor.has(encontrado.valor)) {
          porValor.set(encontrado.valor, encontrado);
        }
      }
    }
  }

  return [...porValor.values()].slice(0, MAXIMO_DE_VALORES);
};

const diasDelRango = (
  desde: string,
  hasta: string,
): readonly string[] | undefined => {
  const dias = diasDeNegocioEntre(desde, hasta);
  if (!dias || dias.length > MAXIMO_DIAS_DE_RANGO) return undefined;
  return dias;
};

/**
 * Los identificadores de un tipo de registro con actividad en el rango — GSI7.
 */
export const identificadoresConActividad = async (
  entrada: { desde: string; hasta: string; agregado: TipoDeAgregado },
  deps: DepsDeServicio = {},
): Promise<Resultado<readonly ValorConActividad[]>> => {
  const dias = diasDelRango(entrada.desde, entrada.hasta);
  if (!dias) return fallo("validation_failed", { campo: "rango" });

  const prefijo = bitacora.prefijoDeAgregado(entrada.agregado);
  return exito(
    await recorrerRango(
      dias,
      (dia) => ({
        indice: NOMBRES_DE_INDICE.porAgregadoDelDia,
        diaPK: bitacora.particionDelDia(dia).diaPK,
        atributoDeOrden: "agregadoSK",
        prefijo,
        // Del propio evento y no de la clave: `aEventoDTO` ya extrajo el
        // agregado de la `PK`, que es la fuente que la bitacora considera
        // autoritativa para "de quien es este evento".
        valorDe: (evento) =>
          evento.agregado === entrada.agregado ? evento.agregadoId : undefined,
        cotaDeGrupo: (valor) =>
          bitacora.cotaDeGrupoDeAgregado(entrada.agregado, valor),
      }),
      deps,
    ),
  );
};

/**
 * Las personas con actividad en el rango — GSI8.
 *
 * `SISTEMA` queda fuera: no es una persona a la que rastrear, y ademas firma
 * los eventos de vencimiento de todos, asi que como opcion de un select de
 * participantes no distingue nada.
 */
export const participantesConActividad = async (
  entrada: { desde: string; hasta: string },
  deps: DepsDeServicio = {},
): Promise<Resultado<readonly ValorConActividad[]>> => {
  const dias = diasDelRango(entrada.desde, entrada.hasta);
  if (!dias) return fallo("validation_failed", { campo: "rango" });

  const encontrados = await recorrerRango(
    dias,
    (dia) => ({
      indice: NOMBRES_DE_INDICE.porActorDelDia,
      diaPK: bitacora.particionDelDia(dia).diaPK,
      atributoDeOrden: "actorSK",
      prefijo: "ACTOR#",
      valorDe: (evento) => evento.actorId,
      cotaDeGrupo: (valor) => bitacora.cotaDeGrupoDeActor(valor),
    }),
    deps,
  );

  return exito(
    encontrados.filter(
      ({ valor, evento }) =>
        valor !== ACTOR_SISTEMA && evento.actorTipo === "USUARIO",
    ),
  );
};
