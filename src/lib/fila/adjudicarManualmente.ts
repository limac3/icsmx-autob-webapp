import "server-only";

// T2b — adjudicacion manual (R-23). `modelo-datos-dynamodb.md` seccion 6, T2.
//
// **Reusa la transaccion de T2 cambiando solo como se elige al candidato**: en
// vez de recorrer la fila de menor a mayor, toma el turno que indico el
// adjudicador. Las cinco condiciones se conservan intactas —lote libre y
// `EN_OFERTA`, solicitud `EN_FILA`, cupo disponible, vehiculo
// `EN_CONVOCATORIA`, evento append-only— y eso no es economia de codigo sino la
// afirmacion central de este archivo: **la regla 6 aplica igual cuando quien
// decide es una persona.** El servidor no lee para decidir; escribe
// condicionalmente y acepta perder la carrera.
//
// Dicho al reves: que la decision sea humana cambia *quien* elige, no *como se
// gana*. Si esto releyera el lote para comprobar que sigue libre y despues
// escribiera, la modalidad manual seria el unico camino del sistema con una
// carrera abierta — y seria el camino de la decision que mas caro cuesta
// deshacer.
//
// **Dos cosas que si son distintas de T2:**
//
//  1. **No prueba con otro candidato.** Si el elegido agota su cupo, la accion
//     falla con `limite_alcanzado` y la pantalla lo explica. Elegir a otro por
//     su cuenta seria volver a la modalidad automatica justo en el acto que
//     existe para no ser automatico.
//  2. **El evento lo firma una persona.** `actorTipo = USUARIO` con sus
//     permisos del momento y su motivo, y es lo unico que distingue una
//     decision legitima de un automatismo que actuo donde no debia
//     (`trazabilidad-auditoria.md` 5.1).

import { identificadorDeSolicitud } from "@/lib/data/claves";
import type { DepsDeServicio } from "@/lib/data/deps";
import { conTraza } from "@/lib/observabilidad/traza";
import type { ActorUsuario } from "@/types/auditoria";
import type { Lote } from "@/types/lote";
import { exito, fallo, type Resultado } from "@/types/resultado";
import { intentarAdjudicarA, leerFila } from "./adjudicarLote";

export type EntradaAdjudicarManualmente = {
  /** El lote ya leido por quien invoca, el mismo que evaluo el permiso. */
  lote: Lote;
  /** El turno que el adjudicador eligio. */
  turno: number;
  /** Su criterio. Obligatorio: una decision humana sin razon no es auditable. */
  motivo: string;
  actor: ActorUsuario;
  /** Si la venta seguia abierta al decidir. Va al evento. */
  ventaAbiertaAlDecidir?: boolean;
};

export type AdjudicacionManual = {
  turno: number;
  solicitudId: string;
  participanteId: string;
  venceEn: string;
};

export const adjudicarManualmente = async (
  entrada: EntradaAdjudicarManualmente,
  deps: DepsDeServicio = {},
): Promise<Resultado<AdjudicacionManual>> =>
  conTraza(
    "adjudicarManualmente",
    {
      loteId: entrada.lote.loteId,
      turno: entrada.turno,
      adjudicadorId: entrada.actor.id,
    },
    async () => ejecutar(entrada, deps),
    (resultado) =>
      resultado.ok
        ? {
            desenlace: "ok",
            turno: resultado.data.turno,
            participanteId: resultado.data.participanteId,
          }
        : { desenlace: "rechazado", error: resultado.error },
  );

const ejecutar = async (
  entrada: EntradaAdjudicarManualmente,
  deps: DepsDeServicio,
): Promise<Resultado<AdjudicacionManual>> => {
  const { lote, turno } = entrada;

  // La modalidad se comprueba aqui ademas de en la guarda del permiso, porque
  // este servicio es invocable directamente. Mismo criterio que `rechazarPago`
  // con su motivo obligatorio.
  if (lote.modalidadAdjudicacion !== "MANUAL") return fallo("invalid_state");
  if (!entrada.motivo.trim()) return fallo("validation_failed");

  // **Sin abstencion por reservas, a diferencia de T2.** R18 existe porque la
  // adjudicacion automatica decide **cual** es el turno menor, y un turno en
  // vuelo que todavia no se ve podria serlo. Aqui el turno ya lo eligio una
  // persona sobre la fila que tenia delante: una solicitud que aterrice ahora
  // no cambia esa eleccion. Esperarla solo retrasaria la decision.
  //
  // La fila se lee para resolver **quien** es ese turno —su `participanteId` y
  // su correo—, no para decidir. Si el turno no esta o dejo de estar `EN_FILA`,
  // no hay a quien adjudicar.
  const candidato = (await leerFila(lote.loteId, deps)).find(
    (c) => c.turno === turno,
  );
  if (!candidato) return fallo("not_found");

  const intento = await intentarAdjudicarA(
    candidato,
    {
      lote,
      motivo: "DECISION_MANUAL",
      actor: entrada.actor,
      motivoDelAdjudicador: entrada.motivo.trim(),
      ...(entrada.ventaAbiertaAlDecidir === undefined
        ? {}
        : { ventaAbiertaAlDecidir: entrada.ventaAbiertaAlDecidir }),
    },
    deps,
  );

  if (!intento.ok) return fallo(intento.error);

  return exito({
    turno: candidato.turno,
    solicitudId: identificadorDeSolicitud(lote.loteId, candidato.turno),
    participanteId: candidato.participanteId,
    venceEn: intento.venceEn,
  });
};
