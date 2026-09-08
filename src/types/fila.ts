// Fuente: api-contracts.md seccion 4.1, proyecto.md R-12 y
// modelo-datos-dynamodb.md 5.2.

import type { EstatusSolicitud } from "./solicitud";

/**
 * La solicitud tal como vive en `LOTE#<loteId> / SOL#<turno:010d>`.
 *
 * `turno` esta tambien en la clave, con relleno de ceros: la clave es la que
 * define el orden (D-5) y el atributo existe para poder leerlo sin volver a
 * interpretar la `SK`. Si alguna vez discrepan, manda la clave.
 */
export type Solicitud = {
  solicitudId: string;
  loteId: string;
  participanteId: string;
  turno: number;
  estatus: EstatusSolicitud;
  /** Informativo (R-08). **Jamas** se usa para ordenar la fila. */
  solicitadoEn: string;
  adjudicadoEn?: string;
  venceEn?: string;
  comprobanteClaveS3?: string;
  motivoRechazo?: string;
};

/**
 * Lo unico que un participante sabe de una fila — **la proyeccion mas delicada
 * del sistema** (api-contracts 4.1).
 *
 * **Este tipo es exhaustivo, no ilustrativo.** No contiene `participanteId` ni
 * ningun dato de terceros, y no debe crecer con ninguno (R-12). `tamanoFila` y
 * `miPosicion` se calculan con `Select: COUNT`, asi que los items de otros
 * participantes nunca salen de DynamoDB: la privacidad es **estructural**, no
 * una omision al serializar.
 *
 * Hay una prueba que falla si este tipo o su serializacion incorporan
 * `participanteId`, `correo` o `nombre`.
 */
export type MiLugarDTO = {
  solicitudId: string;
  loteId: string;
  /** Asignado por el contador atomico del servidor. Inmutable (R-08). */
  miTurno: number;
  /** Cuantas solicitudes vivas tienen turno menor que el mio, mas uno. */
  miPosicion: number;
  /** Solicitudes vivas del lote. Una cantidad, jamas identidades. */
  tamanoFila: number;
  estatus: EstatusSolicitud;
  /** Solo cuando esta `ADJUDICADA`: el plazo para pagar (R-13). */
  venceEn?: string;
};

/**
 * Por que se adjudico — `datos.motivoAdjudicacion` del evento `LOTE_ADJUDICADO`
 * (trazabilidad-auditoria.md 3).
 *
 * Distinguirlos es lo que permite al auditor leer la historia de un lote sin
 * inferir: una reasignacion no significa lo mismo que la primera entrega.
 */
export const MOTIVOS_DE_ADJUDICACION = [
  "PRIMERA_ADJUDICACION",
  "REASIGNACION_POR_VENCIMIENTO",
  "REASIGNACION_POR_RECHAZO",
  "REASIGNACION_POR_CANCELACION",
] as const;

export type MotivoDeAdjudicacion = (typeof MOTIVOS_DE_ADJUDICACION)[number];

/**
 * Por que la adjudicacion se salto un turno vivo — `datos.razonOmision` de
 * `SOLICITUD_OMITIDA`.
 *
 * Hoy solo hay una razon, y aun asi se nombra: **un salto sin registro es
 * indistinguible de un fraude** (trazabilidad-auditoria.md 3).
 */
export const RAZONES_DE_OMISION = ["ADJUDICACION_ACTIVA"] as const;

export type RazonDeOmision = (typeof RAZONES_DE_OMISION)[number];
