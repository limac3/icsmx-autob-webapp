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
  /**
   * Desnormalizado desde el lote al crear la solicitud (T1). Tesoreria lo
   * necesita para resolver el vehiculo y la convocatoria de `PendienteDTO`
   * sin un patron de acceso nuevo (`listarPendientesVerificacion`).
   */
  convocatoriaId?: string;
  participanteId: string;
  turno: number;
  estatus: EstatusSolicitud;
  /** Informativo (R-08). **Jamas** se usa para ordenar la fila. */
  solicitadoEn: string;
  adjudicadoEn?: string;
  venceEn?: string;
  comprobanteClaveS3?: string;
  /** Cuando se subio el comprobante. Es lo que ordena la bandeja de tesoreria. */
  comprobanteSubidoEn?: string;
  motivoRechazo?: string;
  /**
   * Correo del titular, copiado de la sesion al crear la solicitud (T1).
   *
   * No hay perfil de participante persistido todavia (`desafios-implementacion.md`
   * 8: el *upsert* de la Etapa 4 nunca llego a escribirse), asi que sin esta
   * copia tesoreria no tendria como saber a quien le pertenece un comprobante.
   * Es una excepcion deliberada a R-12 —igual que `PendienteDTO`—: el dato vive
   * en el item pero ninguna proyeccion hacia otro participante lo expone.
   */
  correoTitular?: string;
};

/**
 * Bandeja de tesoreria (PA-11) — api-contracts.md seccion 8.
 *
 * **Si expone identidad del titular**, a proposito: `correoTitular` es una
 * excepcion deliberada a R-12, acotada a `Autob_Operar_Tesoreria` y
 * `Autob_Auditar` por la guarda de `tesoreria:ver-bandeja`. Tesoreria necesita
 * saber a quien le pertenece cada comprobante.
 */
export type PendienteDTO = {
  solicitudId: string;
  loteId: string;
  convocatoriaId: string;
  correoTitular: string;
  adjudicadoEn: string;
  comprobanteSubidoEn: string;
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
  /**
   * Solo cuando esta `RECHAZADA_POR_TESORERIA` (R-16). Es el motivo del
   * **propio** rechazo, no un dato de tercero: R-12 protege la identidad de
   * otros participantes, no la razon que tesoreria le dio al titular sobre su
   * propia solicitud.
   */
  motivoRechazo?: string;
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
  // El barrido de la Etapa 10 tambien recoge lotes `EN_OFERTA` con fila viva
  // que nadie llego a adjudicar — el proceso que debia hacerlo murio entre las
  // dos escrituras que no pueden ir juntas en una transaccion (T1 y T5b/T6, ver
  // `modelo-datos-dynamodb.md` T5b). No es "primera adjudicacion": el lote ya
  // tuvo intentos previos, solo que ninguno la disparo.
  "RECUPERACION_POR_BARRIDO",
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
