// Fuente: agent_files/proyecto.md seccion 5, las cuatro tablas de transicion.
//
// Toda transicion se valida en el servidor contra estas tablas (P-1). La UI
// puede ocultar lo que no aplica, pero **ocultar no es validar**: cada Server
// Action es invocable directamente por quien sepa hacerlo.
//
// Las tablas usan `Record<Estado, ...>` y no `Partial<Record<...>>` en el
// primer nivel: agregar un estatus a `src/types/` sin decidir que hace desde
// el es un error de compilacion, no un estado sin salidas que se descubre en
// produccion. Los estados terminales lo declaran con un objeto vacio, que es
// una afirmacion explicita y no un olvido.
//
// Lo que este archivo **no** decide son las guardas: "no puede aprobar quien
// la creo" (R-05) o "solo despues del fin de venta" son condiciones sobre el
// actor y el momento, no sobre la forma del grafo. Viven en
// `src/lib/auth/permisos.ts` y en `ventanas.ts`. Aqui solo esta la topologia.

import type { EstatusConvocatoria } from "@/types/convocatoria";
import type { EstatusLote } from "@/types/lote";
import type { EstatusSolicitud } from "@/types/solicitud";
import type { EstatusVehiculo } from "@/types/vehiculo";

type TablaDeTransiciones<
  Estado extends string,
  Evento extends string,
> = Readonly<Record<Estado, Readonly<Partial<Record<Evento, Estado>>>>>;

// --- Convocatoria (proyecto.md 5.1) ----------------------------------------

export type EventoConvocatoria =
  | "ENVIAR_A_APROBACION"
  | "APROBAR"
  | "RECHAZAR"
  | "PUBLICAR"
  | "CONCLUIR"
  | "OCULTAR"
  | "REACTIVAR";

export const ESTATUS_INICIAL_CONVOCATORIA: EstatusConvocatoria = "BORRADOR";

const CONVOCATORIA: TablaDeTransiciones<
  EstatusConvocatoria,
  EventoConvocatoria
> = {
  BORRADOR: { ENVIAR_A_APROBACION: "EN_APROBACION", OCULTAR: "OCULTA" },
  // El rechazo devuelve a BORRADOR con motivo en la bitacora, en lugar de
  // introducir un estatus RECHAZADA (proyecto.md, seccion 8).
  EN_APROBACION: {
    APROBAR: "APROBADA",
    RECHAZAR: "BORRADOR",
    OCULTAR: "OCULTA",
  },
  APROBADA: { PUBLICAR: "PUBLICADA", OCULTAR: "OCULTA" },
  // Ocultar una convocatoria publicada es legitimo en el grafo, pero R-06 lo
  // prohibe si existe alguna solicitud: dejaria participantes en una fila
  // invisible. Esa guarda la aplica `convocatoria:ocultar` en permisos.ts.
  PUBLICADA: { CONCLUIR: "CONCLUIDA", OCULTAR: "OCULTA" },
  OCULTA: { REACTIVAR: "BORRADOR" },
  CONCLUIDA: {},
};

// --- Vehiculo (proyecto.md 5.2) --------------------------------------------

export type EventoVehiculo =
  | "INCLUIR_EN_CONVOCATORIA"
  | "RETIRAR_DE_CONVOCATORIA"
  | "ADJUDICAR_SU_LOTE"
  | "LIBERAR"
  | "AVALAR_PAGO"
  | "CONCLUIR_SIN_VENTA"
  | "RETIRAR_DEL_CATALOGO";

export const ESTATUS_INICIAL_VEHICULO: EstatusVehiculo = "DISPONIBLE";

const VEHICULO: TablaDeTransiciones<EstatusVehiculo, EventoVehiculo> = {
  DISPONIBLE: {
    INCLUIR_EN_CONVOCATORIA: "EN_CONVOCATORIA",
    RETIRAR_DEL_CATALOGO: "RETIRADO",
  },
  EN_CONVOCATORIA: {
    RETIRAR_DE_CONVOCATORIA: "DISPONIBLE",
    ADJUDICAR_SU_LOTE: "RESERVADO",
    CONCLUIR_SIN_VENTA: "DISPONIBLE",
  },
  // Liberar cubre por igual el vencimiento del plazo, el rechazo de tesoreria
  // y la cancelacion del participante: los tres devuelven el vehiculo a la
  // convocatoria para el siguiente de la fila.
  RESERVADO: { LIBERAR: "EN_CONVOCATORIA", AVALAR_PAGO: "VENDIDO" },
  VENDIDO: {},
  // RETIRADO no es terminal por naturaleza sino por decision: reincorporar un
  // vehiculo al catalogo no esta en el alcance (proyecto.md 5.2).
  RETIRADO: {},
};

// --- Lote (proyecto.md 5.3) ------------------------------------------------

export type EventoLote =
  "ADJUDICAR" | "LIBERAR" | "AVALAR_PAGO" | "CONCLUIR_CONVOCATORIA" | "RETIRAR";

export const ESTATUS_INICIAL_LOTE: EstatusLote = "EN_OFERTA";

const LOTE: TablaDeTransiciones<EstatusLote, EventoLote> = {
  EN_OFERTA: {
    ADJUDICAR: "ADJUDICADO",
    CONCLUIR_CONVOCATORIA: "NO_VENDIDO",
    RETIRAR: "RETIRADO",
  },
  // ADJUDICADO -> EN_OFERTA es el ciclo que sostienen R-15, R-16 y R-17: un
  // lote vuelve a la oferta tantas veces como haga falta hasta venderse o
  // hasta que la convocatoria concluya.
  ADJUDICADO: { LIBERAR: "EN_OFERTA", AVALAR_PAGO: "VENDIDO" },
  VENDIDO: {},
  // NO_VENDIDO es terminal **para el lote**, no para el vehiculo: este vuelve
  // a DISPONIBLE y puede reofertarse en otra convocatoria con una fila nueva
  // (R-11). Es justamente lo que compra separar lote de vehiculo (D-3).
  NO_VENDIDO: {},
  RETIRADO: {},
};

// --- Solicitud de compra (proyecto.md 5.4) ---------------------------------

export type EventoSolicitud =
  | "ADJUDICAR"
  | "CANCELAR"
  | "CONGELAR"
  | "DESCONGELAR"
  | "NO_ADJUDICAR"
  | "SUBIR_COMPROBANTE"
  | "VENCER_PLAZO"
  | "AVALAR_PAGO"
  | "RECHAZAR_PAGO";

export const ESTATUS_INICIAL_SOLICITUD: EstatusSolicitud = "EN_FILA";

const SOLICITUD: TablaDeTransiciones<EstatusSolicitud, EventoSolicitud> = {
  EN_FILA: {
    ADJUDICAR: "ADJUDICADA",
    CANCELAR: "CANCELADA_POR_PARTICIPANTE",
    CONGELAR: "CONGELADA",
    NO_ADJUDICAR: "NO_ADJUDICADA",
  },
  // DESCONGELAR conserva el turno original (R-09): el estatus vuelve a
  // EN_FILA pero la clave `SOL#<turno:010d>` no se reescribe nunca, asi que
  // el lugar en la fila es inmutable por construccion.
  //
  // CANCELAR desde CONGELADA lo exige R-09: "sus CONGELADA permanecen
  // congeladas hasta que las cancele o el lote se resuelva".
  CONGELADA: {
    DESCONGELAR: "EN_FILA",
    CANCELAR: "CANCELADA_POR_PARTICIPANTE",
    NO_ADJUDICAR: "NO_ADJUDICADA",
  },
  ADJUDICADA: {
    SUBIR_COMPROBANTE: "EN_VERIFICACION",
    VENCER_PLAZO: "CANCELADA_POR_VENCIMIENTO",
    CANCELAR: "CANCELADA_POR_PARTICIPANTE",
  },
  // Sin CANCELAR ni VENCER_PLAZO: una vez subido el comprobante el reloj se
  // detiene (proyecto.md 5.4), y la demora de tesoreria nunca perjudica al
  // participante. El caso de arrepentimiento lo resuelve tesoreria rechazando
  // el pago, con motivo y bitacora (R-16).
  EN_VERIFICACION: {
    AVALAR_PAGO: "VENDIDA",
    RECHAZAR_PAGO: "RECHAZADA_POR_TESORERIA",
  },
  VENDIDA: {},
  CANCELADA_POR_VENCIMIENTO: {},
  RECHAZADA_POR_TESORERIA: {},
  CANCELADA_POR_PARTICIPANTE: {},
  NO_ADJUDICADA: {},
};

// --- Consulta ---------------------------------------------------------------

/**
 * Las cuatro maquinas, accesibles por nombre.
 *
 * Se exponen juntas para que las pruebas de invariante —que ningun estado
 * quede sin declarar, que todo destino sea alcanzable— recorran las cuatro
 * sin listarlas a mano y sigan valiendo cuando se agregue una quinta.
 */
export const MAQUINAS = {
  convocatoria: CONVOCATORIA,
  vehiculo: VEHICULO,
  lote: LOTE,
  solicitud: SOLICITUD,
} as const;

export type NombreDeMaquina = keyof typeof MAQUINAS;

type EstadoDe<M extends NombreDeMaquina> = keyof (typeof MAQUINAS)[M] & string;
type EventoDe<M extends NombreDeMaquina> =
  keyof (typeof MAQUINAS)[M][EstadoDe<M>] & string;

/**
 * Estado destino de aplicar `evento` sobre `origen`, o `undefined` si la
 * transicion no existe.
 *
 * Devolver el destino en vez de un booleano evita que quien invoca lo escriba
 * a mano: el destino sale de la tabla, asi que no hay forma de guardar un
 * estatus que la maquina no contempla.
 */
export const transicion = <M extends NombreDeMaquina>(
  maquina: M,
  origen: EstadoDe<M>,
  evento: EventoDe<M>,
): EstadoDe<M> | undefined => {
  const desdeOrigen = MAQUINAS[maquina][origen] as
    Readonly<Record<string, EstadoDe<M>>> | undefined;
  return desdeOrigen?.[evento];
};

export const esTransicionValida = <M extends NombreDeMaquina>(
  maquina: M,
  origen: EstadoDe<M>,
  evento: EventoDe<M>,
): boolean => transicion(maquina, origen, evento) !== undefined;

/**
 * Eventos disponibles desde un estado. Para que la UI muestre solo las
 * acciones que el grafo admite — sin que eso sustituya la validacion del
 * servidor, que ocurre igual.
 */
export const eventosDisponibles = <M extends NombreDeMaquina>(
  maquina: M,
  origen: EstadoDe<M>,
): EventoDe<M>[] =>
  Object.keys(MAQUINAS[maquina][origen] ?? {}) as EventoDe<M>[];

/** Un estado es terminal si no tiene ninguna salida. */
export const esEstadoTerminal = <M extends NombreDeMaquina>(
  maquina: M,
  estado: EstadoDe<M>,
): boolean => eventosDisponibles(maquina, estado).length === 0;
