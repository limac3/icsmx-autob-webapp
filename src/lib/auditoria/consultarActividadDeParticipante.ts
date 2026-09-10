import "server-only";

// Toda la actividad de un participante en un rango.
//
// Son **dos preguntas distintas** y hacen falta las dos, porque la bitacora no
// guarda "de quien es este evento" sino solo quien lo firmo (`actorId`):
//
//   1. Lo que la persona **hizo**: sus eventos firmados. Para un administrador
//      o un operador de tesoreria es casi todo lo que hay, y cuelga de
//      agregados que no son suyos (un vehiculo, una convocatoria).
//   2. Lo que **le ocurrio**: los eventos de sus solicitudes. Un vencimiento,
//      una omision o un descongelamiento los firma `SISTEMA`, asi que buscar
//      por `actorId` no los encuentra — y son justo los que explican por que
//      alguien perdio una adjudicacion.
//
// Buscar solo por `actorId` daria una respuesta que parece completa y no lo es,
// que es la peor clase de respuesta para un auditor.
//
// **La segunda mitad estaba muerta hasta la Etapa 11.2.** Leia particiones
// `AUDIT#SOLICITUD#<id>` que ningun escritor escribe: los 19 eventos de fila
// anclan a `LOTE`, porque la fila **es** del lote y la solicitud es un lugar
// dentro de ella. La consulta devolvia siempre cero y nadie lo notaba, porque
// cero es una respuesta plausible. Ahora se leen las particiones de **lote**
// filtrando por `solicitudId`, que es donde esos eventos de verdad estan.
//
// Se descarto agregar un `sujetoId` al evento para poder preguntarlo por clave:
// solo respondería sobre los eventos futuros, y esta consulta es retrospectiva
// por definicion — la escribe un auditor que pregunta por algo que ya paso.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import {
  clave,
  comparandoClaves,
  gsi3,
  NOMBRES_DE_INDICE,
} from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import { aSolicitud } from "@/lib/fila/mapeo";
import type { EventoDTO, TipoDeEvento } from "@/types/auditoria";
import { exito, type Resultado } from "@/types/resultado";
import {
  consultarBitacoraGlobal,
  type BitacoraGlobal,
} from "./consultarBitacoraGlobal";
import { aEventoDTO } from "./mapeo";
import { condicionDeRangoEnSK, cotaDeRango } from "./rangoDeBitacora";

/**
 * Solicitudes cuya historia se rastrea por participante.
 *
 * El tope no es de correccion: un participante con mas de cien solicitudes en
 * el sistema es un caso que hay que mirar con la pantalla de fila, no con la de
 * bitacora.
 */
export const MAXIMO_SOLICITUDES_A_RASTREAR = 100;

/** Sus solicitudes, con el lote de cada una: GSI3, una `Query`. */
const solicitudesDelParticipante = async (
  participanteId: string,
  deps: DepsDeServicio,
): Promise<{ solicitudId: string; loteId: string }[]> => {
  const salida = await clienteDe(deps).send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      IndexName: NOMBRES_DE_INDICE.porParticipante,
      KeyConditionExpression: "GSI3PK = :pk",
      ExpressionAttributeValues: {
        ":pk": gsi3.solicitudDeParticipante(
          participanteId,
          "relleno",
          "relleno",
        ).GSI3PK,
      },
      Limit: MAXIMO_SOLICITUDES_A_RASTREAR,
    }),
  );

  const solicitudes: { solicitudId: string; loteId: string }[] = [];
  for (const item of salida.Items ?? []) {
    const solicitud = aSolicitud(item);
    if (solicitud) {
      solicitudes.push({
        solicitudId: solicitud.solicitudId,
        loteId: solicitud.loteId,
      });
    }
  }
  return solicitudes;
};

/**
 * Los eventos de un lote que hablan de **estas** solicitudes, dentro del rango.
 *
 * El rango va como condicion de clave (`SK`, que es `<ocurridoEn>#<eventoId>`) y
 * las solicitudes como filtro. Es el reparto correcto: el rango recorta la
 * particion antes de leerla, y el filtro descarta los eventos del lote que son
 * de otros participantes — que en un lote con fila son la mayoria.
 */
const eventosDeSolicitudesEnLote = async (
  entrada: {
    loteId: string;
    solicitudIds: readonly string[];
    cota: { desde: string; hasta: string };
  },
  deps: DepsDeServicio,
): Promise<EventoDTO[]> => {
  const rango = condicionDeRangoEnSK(entrada.cota);
  const marcadores = entrada.solicitudIds.map(
    (_, indice) => `:solicitud${indice}`,
  );
  const valoresDeSolicitud = Object.fromEntries(
    entrada.solicitudIds.map((id, indice) => [`:solicitud${indice}`, id]),
  );

  const eventos: EventoDTO[] = [];
  let cursor: Record<string, unknown> | undefined;

  do {
    const salida = await clienteDe(deps).send(
      new QueryCommand({
        TableName: nombreDeTabla(),
        KeyConditionExpression: `PK = :pk AND ${rango.condicion}`,
        FilterExpression: `#solicitudId IN (${marcadores.join(", ")})`,
        ExpressionAttributeNames: { "#solicitudId": "solicitudId" },
        ExpressionAttributeValues: {
          ":pk": clave.particionDeEvento("LOTE", entrada.loteId).PK,
          ...rango.valores,
          ...valoresDeSolicitud,
        },
        ExclusiveStartKey: cursor,
      }),
    );

    for (const item of salida.Items ?? []) {
      const evento = aEventoDTO(item);
      if (evento) eventos.push(evento);
    }
    // `Limit` con `FilterExpression` no es el tamano de pagina: DynamoDB acota
    // antes de filtrar. Se pagina hasta agotar la particion acotada, que ya es
    // pequena porque el rango es condicion de clave.
    cursor = salida.LastEvaluatedKey;
  } while (cursor);

  return eventos;
};

/**
 * Ordena por `ocurridoEn` y desempata por `eventoId`.
 *
 * Es el unico lugar de la auditoria donde hay que ordenar en memoria, y es
 * inevitable: aqui se unen dos lecturas distintas. El criterio reproduce
 * literalmente la `SK` de la bitacora (`<ocurridoEn>#<eventoId>`), asi que dos
 * eventos del mismo milisegundo quedan en el mismo orden en que la tabla los
 * tiene — que es el orden que el auditor vera si consulta la particion.
 */
const cronologico = (a: EventoDTO, b: EventoDTO): number =>
  a.ocurridoEn === b.ocurridoEn
    ? comparandoClaves(a.eventoId, b.eventoId)
    : comparandoClaves(a.ocurridoEn, b.ocurridoEn);

export const consultarActividadDeParticipante = async (
  entrada: {
    participanteId: string;
    /** Dia de negocio `yyyy-mm-dd`, inclusivo. */
    desde: string;
    hasta: string;
    tipo?: TipoDeEvento;
  },
  deps: DepsDeServicio = {},
): Promise<Resultado<BitacoraGlobal>> => {
  // Lo que firmo: GSI9, una particion por mes del rango.
  const firmados = await consultarBitacoraGlobal(
    {
      desde: entrada.desde,
      hasta: entrada.hasta,
      actorId: entrada.participanteId,
      ...(entrada.tipo ? { tipo: entrada.tipo } : {}),
    },
    deps,
  );
  if (!firmados.ok) return firmados;

  const cota = cotaDeRango(entrada.desde, entrada.hasta);
  if (!cota) return firmados;

  const solicitudes = await solicitudesDelParticipante(
    entrada.participanteId,
    deps,
  );

  // Agrupadas por lote: un participante con varias solicitudes en el mismo lote
  // —turnos distintos de la misma fila— se resuelve con **una** consulta.
  const solicitudesPorLote = new Map<string, string[]>();
  for (const { solicitudId, loteId } of solicitudes) {
    solicitudesPorLote.set(loteId, [
      ...(solicitudesPorLote.get(loteId) ?? []),
      solicitudId,
    ]);
  }

  const historias = await Promise.all(
    [...solicitudesPorLote.entries()].map(([loteId, solicitudIds]) =>
      eventosDeSolicitudesEnLote({ loteId, solicitudIds, cota }, deps),
    ),
  );

  // Indexado por `eventoId` y no concatenado: la historia de una solicitud
  // incluye su `SOLICITUD_CREADA`, que la persona firmo y que por tanto ya
  // vino en la lectura por actor. Sin desduplicar, el auditor veria dos veces
  // el mismo hecho y podria leerlo como dos.
  const porId = new Map<string, EventoDTO>();
  for (const evento of firmados.data.eventos)
    porId.set(evento.eventoId, evento);

  for (const historia of historias) {
    for (const evento of historia) {
      // El rango ya lo acoto la condicion de clave; el tipo, cuando se pidio,
      // no cabe en esa clave y se filtra aqui.
      if (entrada.tipo && evento.tipo !== entrada.tipo) continue;
      porId.set(evento.eventoId, evento);
    }
  }

  return exito({
    eventos: [...porId.values()].sort(cronologico),
    truncada: firmados.data.truncada,
  });
};
