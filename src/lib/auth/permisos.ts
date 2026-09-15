import { TIPO_POR_PERMISO_DE_VENTA, type Permiso } from "@/types/identidad";
import type {
  EstatusConvocatoria,
  TipoConvocatoria,
} from "@/types/convocatoria";
import type { EstatusLote } from "@/types/lote";
import type { EstatusSolicitud } from "@/types/solicitud";
import type { EstatusVehiculo } from "@/types/vehiculo";

// Traduccion linea por linea de agent_files/permission-matrix.md. Si este
// archivo y esa tabla discrepan, la tabla gana y este archivo se corrige
// (encabezado del propio documento).
//
// Decide en dos tiempos, y la division no es casual (matriz, seccion 0):
//
//   1. CAPACIDAD    — la accion exige uno de los permisos que EAS concedio.
//                     Aqui no hay politica organizacional escrita: quien tiene
//                     cada permiso lo decide la organizacion en EAS.
//   2. APLICABILIDAD — la guarda contextual. Es lo unico que EAS no puede
//                     saber: estado, propiedad, auto-aprobacion, plazo.

export type RazonDenegacion =
  | "forbidden"
  | "not_owner"
  | "self_approval"
  | "sin_permiso_de_tipo"
  | "invalid_state";

export type DecisionPermiso =
  { permitido: true } | { permitido: false; razon: RazonDenegacion };

export type Contexto = {
  // Identidad del actor. La inyecta quien invoca puedeEjecutar a partir de la
  // sesion — nunca sale del input de negocio (AGENTS.md: "el actor sale de la
  // sesion, nunca del input").
  participanteId: string;

  // Datos del recurso sobre el que se ejecuta la accion. Cada guarda usa solo
  // los campos que le aplican; el resto queda undefined.
  creadoPor?: string;
  titularId?: string;
  estatusVehiculo?: EstatusVehiculo;
  estatusConvocatoria?: EstatusConvocatoria;
  estatusSolicitud?: EstatusSolicitud;
  estatusLote?: EstatusLote;
  tipoConvocatoria?: TipoConvocatoria;
  /**
   * La convocatoria se adjudica a mano (R-23). Booleano y no la modalidad
   * cruda porque las guardas afirman en positivo y `undefined` deniega
   * (regla 18): con un `ModalidadAdjudicacion | undefined`, olvidar pasarlo
   * seria indistinguible de "no es manual", y eso **abriria** la bandeja del
   * adjudicador en convocatorias automaticas.
   */
  modalidadManual?: boolean;

  // Ventanas de tiempo y consultas ya resueltas por quien invoca (con
  // src/lib/domain/fechas.ts y el acceso a datos de la Etapa 4/8).
  // puedeEjecutar es puro: nunca calcula fechas ni consulta la fila, solo
  // compone estos resultados ya evaluados.
  yaPublicada?: boolean;
  ventaAbierta?: boolean;
  ventaFinalizada?: boolean;
  dentroDePlazo?: boolean;
  tieneSolicitudViva?: boolean;
  tieneAlMenosUnLote?: boolean;
  fechasCoherentes?: boolean;
  loteSinSolicitudesVivas?: boolean;
  existeAlgunaSolicitud?: boolean;
  sinSolicitudesVivas?: boolean;
  motivoProvisto?: boolean;
};

type Guarda = (
  contexto: Contexto,
  permisos: ReadonlySet<Permiso>,
) => DecisionPermiso;

type DefinicionAccion = {
  /** Cualquiera de estos permisos concede la capacidad. */
  permisos: readonly Permiso[];
  guarda?: Guarda;
};

const permitir = (): DecisionPermiso => ({ permitido: true });
const denegar = (razon: RazonDenegacion): DecisionPermiso => ({
  permitido: false,
  razon,
});

// Toda precondicion booleana se afirma en positivo. `undefined` deniega.
//
// Es la correccion central de la Etapa 2.1: las guardas rechazaban solo
// `=== false`, asi que un campo de contexto olvidado por quien invoca se
// convertia en un permiso concedido. Un dato que no llego no es un dato que
// se cumple.
const confirmado = (valor: boolean | undefined): boolean => valor === true;

const VENTA: readonly Permiso[] = [
  "Autob_Venta_a_empleados",
  "Autob_Venta_en_general",
];

// Estados desde los que el titular puede cancelar (matriz, seccion 5).
//
// **No es la lista de estados vivos**, que son cuatro e incluyen
// `EN_VERIFICACION` (`src/types/solicitud.ts`). La diferencia es intencional:
// una vez subido el comprobante, la maquina de estados de proyecto.md 5.4 no
// ofrece transicion a `CANCELADA_POR_PARTICIPANTE` — el caso lo resuelve
// tesoreria rechazando el pago, con motivo y bitacora (R-16).
const ESTADOS_CANCELABLES: readonly EstatusSolicitud[] = [
  "EN_FILA",
  "CONGELADA",
  "ADJUDICADA",
];

const esPropio = (contexto: Contexto) =>
  contexto.titularId !== undefined &&
  contexto.titularId === contexto.participanteId;

// Seccion 4 de la matriz: gating triple para ver una convocatoria publicada
// (o el detalle de un lote suyo). Aplica por igual a cualquiera que tenga un
// permiso de venta, sin excepcion administrativa (R-01 de proyecto.md).
const guardaGatingTriple: Guarda = (contexto, permisos) => {
  if (contexto.estatusConvocatoria !== "PUBLICADA") {
    return denegar("invalid_state");
  }
  if (!confirmado(contexto.yaPublicada)) {
    return denegar("invalid_state");
  }
  // Tercera pata: el permiso que corresponde al tipo. Sin tipo conocido no se
  // puede afirmar compatibilidad, asi que se deniega.
  if (contexto.tipoConvocatoria === undefined) {
    return denegar("invalid_state");
  }
  if (!permisos.has(TIPO_POR_PERMISO_DE_VENTA[contexto.tipoConvocatoria])) {
    return denegar("sin_permiso_de_tipo");
  }
  return permitir();
};

const CATALOGO_ACCIONES = {
  // 1. Vehiculos
  "vehiculo:crear": { permisos: ["Autob_Administrar_Vehiculos"] },
  "vehiculo:editar": {
    permisos: ["Autob_Administrar_Vehiculos"],
    guarda: (c) => {
      if (c.estatusVehiculo === undefined) return denegar("invalid_state");
      return c.estatusVehiculo === "RESERVADO" ||
        c.estatusVehiculo === "VENDIDO"
        ? denegar("invalid_state")
        : permitir();
    },
  },
  "vehiculo:ver-catalogo": {
    permisos: [
      "Autob_Administrar_Vehiculos",
      "Autob_Administrar_Convocatorias",
      "Autob_Aprobar_Convocatorias",
      "Autob_Auditar",
    ],
  },
  "vehiculo:retirar": {
    permisos: ["Autob_Administrar_Vehiculos"],
    guarda: (c) =>
      c.estatusVehiculo === "DISPONIBLE"
        ? permitir()
        : denegar("invalid_state"),
  },
  "vehiculo:subir-fotografia": {
    permisos: ["Autob_Administrar_Vehiculos"],
    guarda: (c) => {
      if (c.estatusVehiculo === undefined) return denegar("invalid_state");
      return c.estatusVehiculo === "VENDIDO"
        ? denegar("invalid_state")
        : permitir();
    },
  },
  "vehiculo:eliminar-fotografia": {
    permisos: ["Autob_Administrar_Vehiculos"],
    // "No se puede dejar sin fotografia principal" depende de contar las
    // fotografias existentes: es una validacion de datos, no de permisos, y
    // se aplica en el servicio de la Etapa 5 (puedeEjecutar no consulta
    // datos).
    guarda: (c) => {
      if (c.estatusVehiculo === undefined) return denegar("invalid_state");
      return c.estatusVehiculo === "VENDIDO"
        ? denegar("invalid_state")
        : permitir();
    },
  },

  // 2. Convocatorias — administracion
  "convocatoria:crear": { permisos: ["Autob_Administrar_Convocatorias"] },
  "convocatoria:editar": {
    permisos: ["Autob_Administrar_Convocatorias"],
    guarda: (c) => {
      if (c.estatusConvocatoria !== "BORRADOR") return denegar("invalid_state");
      if (!confirmado(c.fechasCoherentes)) return denegar("invalid_state");
      return permitir();
    },
  },
  "convocatoria:ver-administracion": {
    permisos: [
      "Autob_Administrar_Convocatorias",
      "Autob_Aprobar_Convocatorias",
      "Autob_Auditar",
    ],
  },
  // La bandeja del aprobador. No revela nada que `ver-administracion` no
  // muestre ya en su pestana de `EN_APROBACION`: existe para que la pantalla de
  // dictamen tenga una puerta propia y la matriz diga de quien es.
  "convocatoria:ver-aprobaciones": {
    permisos: ["Autob_Aprobar_Convocatorias"],
  },
  "convocatoria:incluir-vehiculo": {
    permisos: ["Autob_Administrar_Convocatorias"],
    guarda: (c) => {
      if (c.estatusConvocatoria !== "BORRADOR") return denegar("invalid_state");
      if (c.estatusVehiculo !== "DISPONIBLE") return denegar("invalid_state");
      return permitir();
    },
  },
  "convocatoria:retirar-vehiculo": {
    permisos: ["Autob_Administrar_Convocatorias"],
    guarda: (c) => {
      if (c.estatusConvocatoria !== "BORRADOR") return denegar("invalid_state");
      if (!confirmado(c.loteSinSolicitudesVivas))
        return denegar("invalid_state");
      return permitir();
    },
  },
  "convocatoria:enviar-a-aprobacion": {
    permisos: ["Autob_Administrar_Convocatorias"],
    guarda: (c) => {
      if (c.estatusConvocatoria !== "BORRADOR") return denegar("invalid_state");
      if (!confirmado(c.tieneAlMenosUnLote)) return denegar("invalid_state");
      if (!confirmado(c.fechasCoherentes)) return denegar("invalid_state");
      return permitir();
    },
  },
  "convocatoria:aprobar": {
    permisos: ["Autob_Aprobar_Convocatorias"],
    guarda: (c) => {
      if (c.estatusConvocatoria !== "EN_APROBACION")
        return denegar("invalid_state");
      // Sin saber quien la creo no se puede descartar la auto-aprobacion.
      if (c.creadoPor === undefined) return denegar("invalid_state");
      if (c.creadoPor === c.participanteId) return denegar("self_approval");
      return permitir();
    },
  },
  "convocatoria:rechazar": {
    permisos: ["Autob_Aprobar_Convocatorias"],
    guarda: (c) => {
      if (c.estatusConvocatoria !== "EN_APROBACION")
        return denegar("invalid_state");
      if (c.creadoPor === undefined) return denegar("invalid_state");
      if (c.creadoPor === c.participanteId) return denegar("self_approval");
      if (!confirmado(c.motivoProvisto)) return denegar("invalid_state");
      return permitir();
    },
  },
  "convocatoria:publicar": {
    permisos: ["Autob_Administrar_Convocatorias"],
    guarda: (c) =>
      c.estatusConvocatoria === "APROBADA"
        ? permitir()
        : denegar("invalid_state"),
  },
  "convocatoria:ocultar": {
    permisos: ["Autob_Administrar_Convocatorias"],
    // proyecto.md 5.1 tiene dos filas para "Ocultar": desde BORRADOR /
    // EN_APROBACION / APROBADA sin guarda adicional, y desde PUBLICADA solo
    // si no existe ninguna solicitud (R-06).
    guarda: (c) => {
      if (c.estatusConvocatoria === "PUBLICADA") {
        // Hay que **saber** que no existe ninguna solicitud. Ignorarlo no
        // equivale a que no las haya: ocultar una convocatoria con fila viva
        // dejaria participantes formados en una cola invisible.
        return c.existeAlgunaSolicitud === false
          ? permitir()
          : denegar("invalid_state");
      }
      if (
        c.estatusConvocatoria === "BORRADOR" ||
        c.estatusConvocatoria === "EN_APROBACION" ||
        c.estatusConvocatoria === "APROBADA"
      ) {
        return permitir();
      }
      return denegar("invalid_state");
    },
  },
  "convocatoria:reactivar": {
    permisos: ["Autob_Administrar_Convocatorias"],
    guarda: (c) =>
      c.estatusConvocatoria === "OCULTA"
        ? permitir()
        : denegar("invalid_state"),
  },
  "convocatoria:concluir": {
    permisos: ["Autob_Administrar_Convocatorias"],
    guarda: (c) => {
      if (c.estatusConvocatoria !== "PUBLICADA")
        return denegar("invalid_state");
      return confirmado(c.ventaFinalizada) || confirmado(c.sinSolicitudesVivas)
        ? permitir()
        : denegar("invalid_state");
    },
  },

  // 3. Convocatorias — participacion
  "convocatoria:ver-publicada": {
    permisos: VENTA,
    guarda: guardaGatingTriple,
  },
  "lote:ver-detalle": {
    permisos: VENTA,
    guarda: guardaGatingTriple,
  },

  // 4. Fila y solicitudes
  "solicitud:crear": {
    permisos: VENTA,
    guarda: (c, permisos) => {
      const gating = guardaGatingTriple(c, permisos);
      if (!gating.permitido) return gating;
      if (!confirmado(c.ventaAbierta)) return denegar("invalid_state");
      // R-07: hay que saber que no tiene una solicitud viva en este lote.
      // Ignorarlo permitiria formarse dos veces.
      if (c.tieneSolicitudViva !== false) return denegar("invalid_state");
      return permitir();
    },
  },
  "solicitud:ver-mi-lugar": {
    permisos: VENTA,
    guarda: (c) => (esPropio(c) ? permitir() : denegar("not_owner")),
  },
  "solicitud:ver-mis-solicitudes": { permisos: VENTA },
  "solicitud:cancelar": {
    permisos: VENTA,
    guarda: (c) => {
      if (!esPropio(c)) return denegar("not_owner");
      if (
        !c.estatusSolicitud ||
        !ESTADOS_CANCELABLES.includes(c.estatusSolicitud)
      ) {
        return denegar("invalid_state");
      }
      return permitir();
    },
  },
  "fila:ver-completa": { permisos: ["Autob_Auditar"] },

  // 5. Pago y tesoreria
  "comprobante:subir": {
    permisos: VENTA,
    guarda: (c) => {
      if (!esPropio(c)) return denegar("not_owner");
      if (c.estatusSolicitud !== "ADJUDICADA") return denegar("invalid_state");
      if (!confirmado(c.dentroDePlazo)) return denegar("invalid_state");
      return permitir();
    },
  },
  "comprobante:descargar": {
    permisos: [...VENTA, "Autob_Operar_Tesoreria", "Autob_Auditar"],
    guarda: (c, permisos) => {
      if (
        permisos.has("Autob_Operar_Tesoreria") ||
        permisos.has("Autob_Auditar")
      ) {
        return permitir();
      }
      return esPropio(c) ? permitir() : denegar("not_owner");
    },
  },
  "tesoreria:ver-bandeja": {
    permisos: ["Autob_Operar_Tesoreria", "Autob_Auditar"],
  },
  "pago:avalar": {
    permisos: ["Autob_Operar_Tesoreria"],
    guarda: (c) =>
      c.estatusSolicitud === "EN_VERIFICACION"
        ? permitir()
        : denegar("invalid_state"),
  },
  "pago:rechazar": {
    permisos: ["Autob_Operar_Tesoreria"],
    guarda: (c) => {
      if (c.estatusSolicitud !== "EN_VERIFICACION")
        return denegar("invalid_state");
      if (!confirmado(c.motivoProvisto)) return denegar("invalid_state");
      return permitir();
    },
  },

  // 5b. Adjudicacion manual (R-23)
  //
  // `Autob_Auditar` ve pero no decide, igual que en tesoreria: quien fiscaliza
  // una decision no la toma.
  "adjudicacion:ver-bandeja": {
    permisos: ["Autob_Adjudicar_Convocatorias", "Autob_Auditar"],
  },
  "adjudicacion:ver-fila-identificada": {
    permisos: ["Autob_Adjudicar_Convocatorias", "Autob_Auditar"],
    // **La segunda accion del sistema que expone identidades de terceros**, y
    // la primera fuera de auditoria. Se acota a la modalidad que la justifica:
    // en una convocatoria automatica nadie necesita ver quien es quien, y R-12
    // vuelve a aplicar entera.
    guarda: (c) =>
      confirmado(c.modalidadManual) ? permitir() : denegar("invalid_state"),
  },
  "adjudicacion:adjudicar": {
    permisos: ["Autob_Adjudicar_Convocatorias"],
    guarda: (c) => {
      if (!confirmado(c.modalidadManual)) return denegar("invalid_state");
      if (c.estatusConvocatoria !== "PUBLICADA")
        return denegar("invalid_state");
      // El lote tiene que estar libre. Es cortesia, no la garantia: la autoridad
      // es `attribute_not_exists(adjudicacionActual)` dentro de la transaccion,
      // porque entre esta decision y la escritura cabe una carrera (regla 6).
      if (c.estatusLote !== "EN_OFERTA") return denegar("invalid_state");
      if (!confirmado(c.motivoProvisto)) return denegar("invalid_state");
      return permitir();
    },
  },

  // 6. Auditoria
  "auditoria:ver-bitacora": { permisos: ["Autob_Auditar"] },
  "auditoria:ver-fila-historica": { permisos: ["Autob_Auditar"] },
  "auditoria:exportar": { permisos: ["Autob_Auditar"] },
} satisfies Record<string, DefinicionAccion>;

export type Accion = keyof typeof CATALOGO_ACCIONES;

/**
 * **Solo el primer tiempo de `puedeEjecutar`: la capacidad.** ¿Alguno de los
 * permisos que EAS concedio habilita esta accion? Sin mirar el recurso.
 *
 * Existe para el menu de navegacion, y la distincion importa: un enlace es una
 * **puerta a una pantalla**, no una operacion sobre un recurso, asi que no hay
 * `contexto` que pasarle. Y como las guardas fallan cerradas por diseno (regla
 * 18), evaluarlas sin recurso denegaria siempre — el menu quedaria vacio para
 * todo el mundo.
 *
 * No relaja nada: la pantalla de destino vuelve a decidir con `puedeEjecutar`
 * completo, sobre el recurso que si tiene delante. Ocultar un enlace es
 * cortesia; la unica autorizacion que cuenta es la del servidor al servir la
 * pantalla (principio P-1).
 *
 * Cerrada por omision igual que `puedeEjecutar`: una accion fuera del catalogo
 * devuelve `false`.
 */
export const tieneCapacidad = ({
  accion,
  permisos,
}: {
  accion: Accion;
  permisos: ReadonlySet<Permiso>;
}): boolean => {
  const definicion: DefinicionAccion | undefined = CATALOGO_ACCIONES[accion];
  if (!definicion) return false;
  return definicion.permisos.some((permiso) => permisos.has(permiso));
};

/**
 * Decide si `permisos` puede ejecutar `accion` sobre `contexto`. Pura: sin
 * I/O, sin red, sin base de datos — todo lo que la decision necesita ya llego
 * en `contexto`, resuelto por quien invoca.
 *
 * Cerrada por omision en los dos sentidos: una accion que no existe en el
 * catalogo se deniega (nunca `permitido: true`), y una guarda cuyo dato de
 * contexto no llego tambien deniega.
 */
export const puedeEjecutar = ({
  accion,
  permisos,
  contexto,
}: {
  accion: Accion;
  permisos: ReadonlySet<Permiso>;
  contexto: Contexto;
}): DecisionPermiso => {
  const definicion: DefinicionAccion | undefined = CATALOGO_ACCIONES[accion];
  if (!definicion) return denegar("forbidden");

  // 1. Capacidad — la concede EAS, no este archivo. Se delega para que exista
  // un solo lugar que la calcule: el menu pregunta lo mismo, sin el paso 2.
  if (!tieneCapacidad({ accion, permisos })) return denegar("forbidden");

  // 2. Aplicabilidad — lo unico que EAS no puede saber.
  if (!definicion.guarda) return permitir();
  return definicion.guarda(contexto, permisos);
};

export const __test__ = { CATALOGO_ACCIONES };
