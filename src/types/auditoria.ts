import type { TipoDeAgregado } from "@/lib/data/claves";
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
  "SOLICITUD_CANCELADA_POR_LIMITE",
  "LOTE_ADJUDICADO",
  // Los dos siguientes ya no se escriben: los producia el congelamiento de la
  // version anterior de R-09, retirada en la Etapa 14. Siguen en el catalogo
  // porque la bitacora es append-only y las historias ya escritas los traen.
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

// --- DTOs de lectura (Etapa 11) ----------------------------------------------
//
// Fuente: api-contracts.md seccion 6. Estos tipos son la forma que un evento
// crudo de DynamoDB toma **fuera** de `src/lib/data`, para el auditor.
//
// A diferencia de `PendienteDTO` o `MiLugarDTO`, aqui exponer identidades no
// es una excepcion: es el proposito completo de la pantalla. R-12 protege al
// **participante**, no al auditor con `Autob_Auditar` (trazabilidad-auditoria
// 2.4). No hay nada que acotar en este tipo.

/** Un evento de la bitacora, tal como lo lee el auditor (PA-12, PA-13). */
export type EventoDTO = {
  eventoId: string;
  tipo: TipoDeEvento;
  /** ISO-8601 UTC. La pantalla lo formatea en hora de negocio al presentar. */
  ocurridoEn: string;
  /**
   * Agregado del que este evento es historia — el `AUDIT#<agregado>#<id>` de su
   * particion.
   *
   * Opcionales porque salen de la **clave** y no de los atributos: quien lee
   * PA-12 ya sabe de que agregado pregunto y puede no necesitarlos, pero quien
   * lee PA-13 recibe eventos de todo el sistema mezclados y sin esto no puede
   * decir de que habla cada uno.
   */
  agregado?: TipoDeAgregado;
  agregadoId?: string;
  actorTipo: TipoDeActor;
  actorId: string;
  actorPermisos?: readonly Permiso[];
  correlacionId: string;
  vehiculoId?: string;
  convocatoriaId?: string;
  loteId?: string;
  solicitudId?: string;
  estadoAnterior?: string;
  estadoNuevo?: string;
  motivo?: string;
  datos?: Record<string, unknown>;
};

/** Una pagina de `EventoDTO`, con cursor opaco para la siguiente. */
export type PaginaDeEventosDTO = {
  eventos: readonly EventoDTO[];
  cursor?: string;
};

/**
 * La historia de un turno dentro de un lote — la unidad de la reconstruccion
 * de fila (`reconstruirFila`, `ui-ux-requerimientos.md` 7).
 *
 * `participanteId` sale del `actorId` de su propio `SOLICITUD_CREADA`: quien
 * pide entrar a la fila es quien firma esa entrada de la bitacora
 * (`src/lib/fila/solicitarCompra.ts`), asi que no hace falta ninguna lectura
 * adicional para saber de quien es el turno.
 */
export type SolicitudHistoricaDTO = {
  turno: number;
  participanteId: string;
  eventos: readonly EventoDTO[];
};

/**
 * Reconstruccion completa de la fila de un lote.
 *
 * `eventosDelLote` son los que no pertenecen a ningun turno especifico —hoy
 * solo `FILA_AGOTADA`— y por eso no encajan en ningun `SolicitudHistoricaDTO`.
 */
export type FilaHistoricaDTO = {
  loteId: string;
  solicitudes: readonly SolicitudHistoricaDTO[];
  eventosDelLote: readonly EventoDTO[];
};

/** Cada una de las seis comprobaciones de `trazabilidad-auditoria.md` 5.1. */
export type VeredictoDeComprobacion = "cumple" | "incumple" | "informativo";

/**
 * Union discriminada y no un `detalle: string`: la prueba y la pantalla
 * necesitan los datos crudos (que turno, que par de turnos) para poder
 * traducir y probar sin depender de un texto compuesto en un idioma fijo
 * (regla 11 de CLAUDE.md).
 */
export type ComprobacionDeIntegridad =
  | {
      clave: "turnosContiguos";
      veredicto: VeredictoDeComprobacion;
      /** Huecos entre turnos consecutivos. Informativos, nunca un defecto. */
      huecos: readonly number[];
      /** Un turno emitido dos veces si es un defecto del contador atomico. */
      duplicados: readonly number[];
    }
  | {
      clave: "ordenDeAdjudicacion";
      veredicto: VeredictoDeComprobacion;
      /**
       * Turnos vivos, mas pequenos que el adjudicado, sin `SOLICITUD_OMITIDA`.
       *
       * **Una adjudicacion manual no produce estos saltos** (R-23): saltarse el
       * orden es su proposito. Lo que si se exige ahi es la firma, y su
       * ausencia va en el campo siguiente.
       */
      saltosSinJustificar: readonly {
        turnoSaltado: number;
        turnoAdjudicado: number;
      }[];
      /**
       * Turnos adjudicados con `motivoAdjudicacion = DECISION_MANUAL` pero sin
       * actor humano o sin motivo. Es la senal de que algo automatico decidio
       * donde debia decidir una persona.
       */
      decisionesManualesSinFirma: readonly number[];
    }
  | {
      clave: "unaAdjudicacionVigente";
      veredicto: VeredictoDeComprobacion;
      /** Un turno se adjudico sin que el anterior hubiera cerrado su ciclo. */
      conflictos: readonly { turnoVigente: number; turnoNuevo: number }[];
    }
  | {
      clave: "vencimientosConTiempo";
      veredicto: VeredictoDeComprobacion;
      /** `SOLICITUD_VENCIDA` con `detectadoEn` anterior a su propio `venceEn`. */
      turnosConFechaInconsistente: readonly number[];
    }
  | {
      clave: "transicionesConEvento";
      veredicto: VeredictoDeComprobacion;
      /** Estatus vigente sin un evento que lo explique — posible regla 4 rota. */
      turnosSinExplicar: readonly number[];
    }
  | {
      clave: "motivosObligatorios";
      veredicto: VeredictoDeComprobacion;
      eventosSinMotivo: readonly string[];
    };

export type ClaveDeComprobacion = ComprobacionDeIntegridad["clave"];

export type ResultadoVerificacion = {
  loteId: string;
  comprobaciones: readonly ComprobacionDeIntegridad[];
};
