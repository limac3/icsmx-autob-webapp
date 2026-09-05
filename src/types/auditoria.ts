import type { Permiso } from "./identidad";

// Fuente: agent_files/trazabilidad-auditoria.md secciones 2 y 3.

/**
 * Catalogo completo de eventos auditables.
 *
 * Esta entero desde la Etapa 5 aunque solo se usen los de vehiculo: el catalogo
 * es un documento acordado, y tenerlo completo convierte un nombre mal escrito
 * en un error de compilacion en vez de en un evento que nadie encuentra. Los
 * eventos son append-only, asi que un tipo equivocado no se puede corregir
 * despues.
 */
export const TIPOS_DE_EVENTO = [
  // Vehiculos
  "VEHICULO_REGISTRADO",
  "VEHICULO_EDITADO",
  "VEHICULO_FOTOGRAFIA_AGREGADA",
  "VEHICULO_FOTOGRAFIA_ELIMINADA",
  "VEHICULO_RETIRADO",

  // Convocatorias
  "CONVOCATORIA_CREADA",
  "CONVOCATORIA_EDITADA",
  "VEHICULO_INCLUIDO",
  "VEHICULO_RETIRADO_DE_CONVOCATORIA",
  "CONVOCATORIA_ENVIADA_A_APROBACION",
  "CONVOCATORIA_APROBADA",
  "CONVOCATORIA_RECHAZADA",
  "CONVOCATORIA_PUBLICADA",
  "CONVOCATORIA_OCULTA",
  "CONVOCATORIA_REACTIVADA",
  "CONVOCATORIA_CONCLUIDA",

  // Fila y adjudicacion
  "SOLICITUD_CREADA",
  "SOLICITUD_CANCELADA_POR_PARTICIPANTE",
  "LOTE_ADJUDICADO",
  "SOLICITUD_CONGELADA",
  "SOLICITUD_DESCONGELADA",
  "SOLICITUD_OMITIDA",
  "SOLICITUD_VENCIDA",
  "SOLICITUD_NO_ADJUDICADA",
  "FILA_AGOTADA",

  // Pago
  "COMPROBANTE_CARGADO",
  "PAGO_AVALADO",
  "PAGO_RECHAZADO",
  "COMPROBANTE_DESCARGADO",

  // Correo
  "CORREO_ENCOLADO",
  "CORREO_ENVIADO",
  "CORREO_FALLIDO",

  // Auditoria
  "BITACORA_EXPORTADA",
] as const;

export type TipoDeEvento = (typeof TIPOS_DE_EVENTO)[number];

/**
 * Eventos que exigen `motivo` — marcados con **M** en el catalogo.
 *
 * Es una lista y no una convencion de nombres porque el requisito es de
 * negocio: un retiro, un rechazo o una ocultacion sin explicacion dejan la
 * bitacora incapaz de responder "por que", que es justamente lo que se le va a
 * preguntar.
 */
export const EVENTOS_CON_MOTIVO_OBLIGATORIO = [
  "VEHICULO_RETIRADO",
  "CONVOCATORIA_RECHAZADA",
  "CONVOCATORIA_OCULTA",
  "PAGO_RECHAZADO",
  "CORREO_FALLIDO",
] as const satisfies readonly TipoDeEvento[];

export type EventoConMotivoObligatorio =
  (typeof EVENTOS_CON_MOTIVO_OBLIGATORIO)[number];

export const exigeMotivo = (tipo: TipoDeEvento): boolean =>
  (EVENTOS_CON_MOTIVO_OBLIGATORIO as readonly TipoDeEvento[]).includes(tipo);

/**
 * Quien actua.
 *
 * `SISTEMA` es el barrido y cualquier proceso automatico. La distincion importa
 * para el auditor: un vencimiento que nadie provoco no se lee igual que una
 * cancelacion que alguien pidio.
 */
export const TIPOS_DE_ACTOR = ["USUARIO", "SISTEMA"] as const;
export type TipoDeActor = (typeof TIPOS_DE_ACTOR)[number];

/** Identificador que se registra cuando el actor no es una persona. */
export const ACTOR_SISTEMA = "SISTEMA";

/**
 * Actor humano de una mutacion.
 *
 * Sale siempre de la sesion, nunca del input de negocio (AGENTS.md). `permisos`
 * guarda **los vigentes en ese momento**, no los actuales: si a alguien se le
 * revoca un permiso despues, la bitacora sigue mostrando con que autoridad
 * actuo. Reconstruirlo consultando EAS mas tarde daria una respuesta distinta y
 * equivocada (`trazabilidad-auditoria.md` 2.3).
 *
 * El documento llamaba a ese campo `actorRoles`. Se renombro al implementar la
 * Etapa 5: EAS entrega permisos y no roles desde la Etapa 2.1, asi que guardar
 * "roles" seria guardar algo que la aplicacion nunca tuvo.
 */
export type ActorUsuario = {
  tipo: "USUARIO";
  id: string;
  permisos: readonly Permiso[];
};

/** Quien ejecuta el acto: una persona con sus permisos, o el sistema. */
export type ActorDeEvento =
  ActorUsuario | { tipo: "SISTEMA"; id?: undefined; permisos?: undefined };
