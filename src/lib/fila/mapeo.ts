// Traduccion entre el item crudo de DynamoDB y la solicitud tipada.
//
// Mismo criterio que `convocatorias/mapeo.ts`: todo lo que sale de DynamoDB es
// `Record<string, unknown>`, y afirmarle un tipo con `as` seria mentirle al
// compilador sobre datos que pudo escribir una version anterior del codigo.
//
// **El turno se lee de la clave, no del atributo.** La `SK` es la que define el
// orden de la fila (D-5); el atributo `turno` es una copia por comodidad. Si
// discrepan manda la clave, porque es la que ordena la `Query`.

import { turnoDesdeClave } from "@/lib/data/claves";
import type { Solicitud } from "@/types/fila";
import { ESTATUS_SOLICITUD, type EstatusSolicitud } from "@/types/solicitud";

const texto = (valor: unknown): string | undefined =>
  typeof valor === "string" && valor.length > 0 ? valor : undefined;

const esEstatus = (valor: unknown): valor is EstatusSolicitud =>
  typeof valor === "string" &&
  (ESTATUS_SOLICITUD as readonly string[]).includes(valor);

/**
 * Convierte un item en una solicitud, o `undefined` si le falta algo
 * indispensable o su clave no es la de una solicitud.
 */
export const aSolicitud = (
  item: Record<string, unknown>,
): Solicitud | undefined => {
  const turno = turnoDesdeClave(String(item.SK));
  const solicitudId = texto(item.solicitudId);
  const loteId = texto(item.loteId);
  const participanteId = texto(item.participanteId);
  const solicitadoEn = texto(item.solicitadoEn);

  if (
    turno === undefined ||
    !solicitudId ||
    !loteId ||
    !participanteId ||
    !solicitadoEn ||
    !esEstatus(item.estatus)
  ) {
    return undefined;
  }

  return {
    solicitudId,
    loteId,
    ...(texto(item.convocatoriaId)
      ? { convocatoriaId: texto(item.convocatoriaId) }
      : {}),
    participanteId,
    turno,
    estatus: item.estatus,
    solicitadoEn,
    // Ausente en las solicitudes anteriores a la Etapa 14 (R-22). Es lo unico
    // que permite comparar el orden de llegada de un participante **entre
    // lotes** de la misma convocatoria, y lo que consume la pantalla del
    // adjudicador.
    ...(typeof item.ordenEnConvocatoria === "number"
      ? { ordenEnConvocatoria: item.ordenEnConvocatoria }
      : {}),
    ...(texto(item.adjudicadoEn)
      ? { adjudicadoEn: texto(item.adjudicadoEn) }
      : {}),
    ...(texto(item.venceEn) ? { venceEn: texto(item.venceEn) } : {}),
    ...(texto(item.comprobanteClaveS3)
      ? { comprobanteClaveS3: texto(item.comprobanteClaveS3) }
      : {}),
    ...(texto(item.comprobanteSubidoEn)
      ? { comprobanteSubidoEn: texto(item.comprobanteSubidoEn) }
      : {}),
    ...(texto(item.motivoRechazo)
      ? { motivoRechazo: texto(item.motivoRechazo) }
      : {}),
    ...(texto(item.correoTitular)
      ? { correoTitular: texto(item.correoTitular) }
      : {}),
  };
};
