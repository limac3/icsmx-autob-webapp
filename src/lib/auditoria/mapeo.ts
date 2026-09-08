import "server-only";

// Traduccion entre el item crudo de DynamoDB y el evento tipado — mismo
// criterio que `fila/mapeo.ts` y `convocatorias/mapeo.ts`: todo lo que sale de
// DynamoDB es `Record<string, unknown>`, y afirmarle un tipo con `as` seria
// mentirle al compilador sobre datos que pudo escribir una version anterior
// del codigo.

import { loteYTurnoDesdeIdentificador } from "@/lib/data/claves";
import {
  TIPOS_DE_ACTOR,
  TIPOS_DE_EVENTO,
  type EventoDTO,
} from "@/types/auditoria";

const texto = (valor: unknown): string | undefined =>
  typeof valor === "string" && valor.length > 0 ? valor : undefined;

const esTipoDeEvento = (valor: unknown): valor is EventoDTO["tipo"] =>
  typeof valor === "string" &&
  (TIPOS_DE_EVENTO as readonly string[]).includes(valor);

const esTipoDeActor = (valor: unknown): valor is EventoDTO["actorTipo"] =>
  typeof valor === "string" &&
  (TIPOS_DE_ACTOR as readonly string[]).includes(valor);

const permisos = (valor: unknown): readonly string[] | undefined =>
  Array.isArray(valor) && valor.every((v) => typeof v === "string")
    ? (valor as string[])
    : undefined;

/**
 * Completa `datos.turno` cuando el evento no lo trae — `COMPROBANTE_CARGADO`,
 * `PAGO_AVALADO` y `PAGO_RECHAZADO` no lo llevan porque tesoreria conoce el
 * `solicitudId`, no el turno. Se deriva aqui, y no en `src/lib/domain`, porque
 * `identificadorDeSolicitud` (`<loteId>-<turno>`) es un detalle de
 * codificacion de `src/lib/data/claves.ts`: el dominio no importa nada de la
 * capa de datos (`estrategia-aplicacion.md` seccion 2, principio P-2), ni
 * siquiera un parser sin I/O.
 */
const conTurnoCompletado = (
  solicitudId: string | undefined,
  datos: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (typeof datos?.turno === "number") return datos;
  const turno = solicitudId
    ? loteYTurnoDesdeIdentificador(solicitudId)?.turno
    : undefined;
  return turno === undefined ? datos : { ...datos, turno };
};

/**
 * Convierte un item en un `EventoDTO`, o `undefined` si le falta algo
 * indispensable. Un evento que no se puede leer se omite en vez de fabricarse
 * a medias — mismo criterio que `aSolicitud`.
 */
export const aEventoDTO = (
  item: Record<string, unknown>,
): EventoDTO | undefined => {
  const eventoId = texto(item.eventoId);
  const ocurridoEn = texto(item.ocurridoEn);
  const actorId = texto(item.actorId);
  const correlacionId = texto(item.correlacionId);
  const solicitudId = texto(item.solicitudId);
  const datos = conTurnoCompletado(
    solicitudId,
    item.datos && typeof item.datos === "object"
      ? (item.datos as Record<string, unknown>)
      : undefined,
  );

  if (
    !eventoId ||
    !esTipoDeEvento(item.tipo) ||
    !ocurridoEn ||
    !esTipoDeActor(item.actorTipo) ||
    !actorId ||
    !correlacionId
  ) {
    return undefined;
  }

  return {
    eventoId,
    tipo: item.tipo,
    ocurridoEn,
    actorTipo: item.actorTipo,
    actorId,
    ...(permisos(item.actorPermisos)
      ? {
          actorPermisos: permisos(
            item.actorPermisos,
          ) as EventoDTO["actorPermisos"],
        }
      : {}),
    correlacionId,
    ...(texto(item.vehiculoId) ? { vehiculoId: texto(item.vehiculoId) } : {}),
    ...(texto(item.convocatoriaId)
      ? { convocatoriaId: texto(item.convocatoriaId) }
      : {}),
    ...(texto(item.loteId) ? { loteId: texto(item.loteId) } : {}),
    ...(solicitudId ? { solicitudId } : {}),
    ...(texto(item.estadoAnterior)
      ? { estadoAnterior: texto(item.estadoAnterior) }
      : {}),
    ...(texto(item.estadoNuevo)
      ? { estadoNuevo: texto(item.estadoNuevo) }
      : {}),
    ...(texto(item.motivo) ? { motivo: texto(item.motivo) } : {}),
    ...(datos ? { datos } : {}),
  };
};
