import "server-only";

// Toda la actividad de un participante en un rango — la consulta que la
// pantalla de auditoria no podia responder.
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

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { gsi3, NOMBRES_DE_INDICE } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import { aSolicitud } from "@/lib/fila/mapeo";
import type { EventoDTO, TipoDeEvento } from "@/types/auditoria";
import { exito, type Resultado } from "@/types/resultado";
import { consultarBitacoraCompleta } from "./consultarBitacora";
import {
  consultarBitacoraGlobal,
  type BitacoraGlobal,
} from "./consultarBitacoraGlobal";
import { eventoCoincideConFiltros } from "./filtrosDeBitacora";

/**
 * Solicitudes cuya historia se rastrea por participante.
 *
 * Cada una es una `Query` de particion. El tope no es de correccion: un
 * participante con mas de cien solicitudes en el sistema es un caso que hay
 * que mirar con la pantalla de fila, no con la de bitacora.
 */
export const MAXIMO_SOLICITUDES_A_RASTREAR = 100;

const solicitudesDelParticipante = async (
  participanteId: string,
  deps: DepsDeServicio,
): Promise<string[]> => {
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

  const ids: string[] = [];
  for (const item of salida.Items ?? []) {
    const solicitud = aSolicitud(item);
    if (solicitud) ids.push(solicitud.solicitudId);
  }
  return ids;
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
    ? a.eventoId.localeCompare(b.eventoId)
    : a.ocurridoEn.localeCompare(b.ocurridoEn);

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

  const solicitudes = await solicitudesDelParticipante(
    entrada.participanteId,
    deps,
  );

  const historias = await Promise.all(
    solicitudes.map((solicitudId) =>
      consultarBitacoraCompleta(
        { agregado: "SOLICITUD", agregadoId: solicitudId },
        deps,
      ),
    ),
  );

  // Indexado por `eventoId` y no concatenado: la historia de una solicitud
  // incluye su `SOLICITUD_CREADA`, que la persona firmo y que por tanto ya
  // vino en la lectura global. Sin desduplicar, el auditor veria dos veces el
  // mismo hecho y podria leerlo como dos.
  const porId = new Map<string, EventoDTO>();
  for (const evento of firmados.data.eventos)
    porId.set(evento.eventoId, evento);

  for (const historia of historias) {
    if (!historia.ok) return historia;
    for (const evento of historia.data) {
      // La historia de una solicitud no conoce el rango: se lee entera y se
      // acota aqui, con el mismo filtro que usa el resto de la pantalla.
      if (
        eventoCoincideConFiltros(evento, {
          desde: entrada.desde,
          hasta: entrada.hasta,
          ...(entrada.tipo ? { tipo: entrada.tipo } : {}),
        })
      ) {
        porId.set(evento.eventoId, evento);
      }
    }
  }

  return exito({
    eventos: [...porId.values()].sort(cronologico),
    truncada: firmados.data.truncada,
  });
};
