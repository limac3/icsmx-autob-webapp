import type { Rol, TipoParticipante } from "@/types/identidad";

// Traduccion linea por linea de agent_files/permission-matrix.md. Si este
// archivo y esa tabla discrepan, la tabla gana y este archivo se corrige
// (encabezado del propio documento).

export type RazonDenegacion =
  | "forbidden"
  | "not_owner"
  | "self_approval"
  | "wrong_participant_type"
  | "invalid_state";

export type DecisionPermiso =
  { permitido: true } | { permitido: false; razon: RazonDenegacion };

// Proyecciones de estado usadas solo para autorizar. El tipo de dominio
// completo de cada entidad se define en src/types/<dominio>.ts a partir de la
// Etapa 4; aqui solo se nombran, como literales sueltos, los valores que
// alguna guarda necesita comparar (igual que hace permission-matrix.md).
type EstatusVehiculo =
  "DISPONIBLE" | "EN_CONVOCATORIA" | "RESERVADO" | "VENDIDO" | "RETIRADO";

type EstatusConvocatoria =
  | "BORRADOR"
  | "EN_APROBACION"
  | "APROBADA"
  | "PUBLICADA"
  | "CONCLUIDA"
  | "OCULTA";

type EstatusSolicitud =
  | "EN_FILA"
  | "ADJUDICADA"
  | "EN_VERIFICACION"
  | "VENDIDA"
  | "CANCELADA_POR_VENCIMIENTO"
  | "RECHAZADA_POR_TESORERIA"
  | "CANCELADA_POR_PARTICIPANTE"
  | "CONGELADA"
  | "NO_ADJUDICADA";

type TipoConvocatoria = "EMPLEADOS" | "PUBLICO_GENERAL";

export type Contexto = {
  // Identidad del actor. La inyecta quien invoca puedeEjecutar a partir de la
  // sesion — nunca sale del input de negocio (AGENTS.md: "el actor sale de la
  // sesion, nunca del input").
  participanteId: string;
  tipoParticipante: TipoParticipante;

  // Datos del recurso sobre el que se ejecuta la accion. Cada guarda usa solo
  // los campos que le aplican; el resto queda undefined.
  creadoPor?: string;
  titularId?: string;
  estatusVehiculo?: EstatusVehiculo;
  estatusConvocatoria?: EstatusConvocatoria;
  estatusSolicitud?: EstatusSolicitud;
  tipoConvocatoria?: TipoConvocatoria;

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

type Guarda = (contexto: Contexto, roles: readonly Rol[]) => DecisionPermiso;

type DefinicionAccion = {
  roles: readonly Rol[];
  guarda?: Guarda;
};

const permitir = (): DecisionPermiso => ({ permitido: true });
const denegar = (razon: RazonDenegacion): DecisionPermiso => ({
  permitido: false,
  razon,
});

// Abreviaturas de agent_files/permission-matrix.md, usadas tal cual para que
// cada entrada de CATALOGO_ACCIONES se lea junto a la fila que traduce.
const ADM: Rol = "ADMINISTRADOR";
const APR: Rol = "APROBADOR_CONVOCATORIA";
const EMP: Rol = "EMPLEADO";
const OTR: Rol = "OTRO_USUARIO";
const TES: Rol = "OPERADOR_TESORERIA";
const AUD: Rol = "AUDITOR_CUMPLIMIENTO";

const ESTADOS_VIVOS_SOLICITUD: readonly EstatusSolicitud[] = [
  "EN_FILA",
  "CONGELADA",
  "ADJUDICADA",
];

const esPropio = (contexto: Contexto) =>
  contexto.titularId !== undefined &&
  contexto.titularId === contexto.participanteId;

// Seccion 3 de la matriz: gating triple para ver una convocatoria publicada
// (o el detalle de un lote suyo). Aplica por igual a los seis roles, sin
// excepcion administrativa (R-01 de proyecto.md).
const guardaGatingTriple: Guarda = (contexto) => {
  if (contexto.estatusConvocatoria !== "PUBLICADA") {
    return denegar("invalid_state");
  }
  if (contexto.yaPublicada === false) {
    return denegar("invalid_state");
  }
  if (
    contexto.tipoConvocatoria === "EMPLEADOS" &&
    contexto.tipoParticipante !== "EMPLEADO"
  ) {
    return denegar("wrong_participant_type");
  }
  return permitir();
};

const CATALOGO_ACCIONES = {
  // 1. Vehiculos
  "vehiculo:crear": { roles: [ADM] },
  "vehiculo:editar": {
    roles: [ADM],
    guarda: (c) =>
      c.estatusVehiculo === "RESERVADO" || c.estatusVehiculo === "VENDIDO"
        ? denegar("invalid_state")
        : permitir(),
  },
  "vehiculo:ver-catalogo": { roles: [ADM, APR, AUD] },
  "vehiculo:retirar": {
    roles: [ADM],
    guarda: (c) =>
      c.estatusVehiculo === "DISPONIBLE"
        ? permitir()
        : denegar("invalid_state"),
  },
  "vehiculo:subir-fotografia": {
    roles: [ADM],
    guarda: (c) =>
      c.estatusVehiculo === "VENDIDO" ? denegar("invalid_state") : permitir(),
  },
  "vehiculo:eliminar-fotografia": {
    roles: [ADM],
    // "No se puede dejar sin fotografia principal" depende de contar las
    // fotografias existentes: es una validacion de datos, no de permisos, y
    // se aplica en el servicio de la Etapa 5 (puedeEjecutar no consulta
    // datos).
    guarda: (c) =>
      c.estatusVehiculo === "VENDIDO" ? denegar("invalid_state") : permitir(),
  },

  // 2. Convocatorias — administracion
  "convocatoria:crear": { roles: [ADM] },
  "convocatoria:editar": {
    roles: [ADM],
    guarda: (c) => {
      if (c.estatusConvocatoria !== "BORRADOR") return denegar("invalid_state");
      if (c.fechasCoherentes === false) return denegar("invalid_state");
      return permitir();
    },
  },
  "convocatoria:ver-administracion": { roles: [ADM, APR, AUD] },
  "convocatoria:incluir-vehiculo": {
    roles: [ADM],
    guarda: (c) => {
      if (c.estatusConvocatoria !== "BORRADOR") return denegar("invalid_state");
      if (c.estatusVehiculo !== "DISPONIBLE") return denegar("invalid_state");
      return permitir();
    },
  },
  "convocatoria:retirar-vehiculo": {
    roles: [ADM],
    guarda: (c) => {
      if (c.estatusConvocatoria !== "BORRADOR") return denegar("invalid_state");
      if (c.loteSinSolicitudesVivas === false) return denegar("invalid_state");
      return permitir();
    },
  },
  "convocatoria:enviar-a-aprobacion": {
    roles: [ADM],
    guarda: (c) => {
      if (c.estatusConvocatoria !== "BORRADOR") return denegar("invalid_state");
      if (c.tieneAlMenosUnLote === false) return denegar("invalid_state");
      if (c.fechasCoherentes === false) return denegar("invalid_state");
      return permitir();
    },
  },
  "convocatoria:aprobar": {
    roles: [APR],
    guarda: (c) => {
      if (c.estatusConvocatoria !== "EN_APROBACION")
        return denegar("invalid_state");
      if (c.creadoPor === c.participanteId) return denegar("self_approval");
      return permitir();
    },
  },
  "convocatoria:rechazar": {
    roles: [APR],
    guarda: (c) => {
      if (c.estatusConvocatoria !== "EN_APROBACION")
        return denegar("invalid_state");
      if (c.creadoPor === c.participanteId) return denegar("self_approval");
      if (c.motivoProvisto === false) return denegar("invalid_state");
      return permitir();
    },
  },
  "convocatoria:publicar": {
    roles: [ADM],
    guarda: (c) =>
      c.estatusConvocatoria === "APROBADA"
        ? permitir()
        : denegar("invalid_state"),
  },
  "convocatoria:ocultar": {
    roles: [ADM],
    // proyecto.md 5.1 tiene dos filas para "Ocultar": desde BORRADOR /
    // EN_APROBACION / APROBADA sin guarda adicional, y desde PUBLICADA solo
    // si no existe ninguna solicitud (R-06). permission-matrix.md solo
    // menciona la segunda; ambas se conservan aqui porque la matriz no puede
    // contradecir la maquina de estados de la que depende.
    guarda: (c) => {
      if (c.estatusConvocatoria === "PUBLICADA") {
        return c.existeAlgunaSolicitud ? denegar("invalid_state") : permitir();
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
    roles: [ADM],
    guarda: (c) =>
      c.estatusConvocatoria === "OCULTA"
        ? permitir()
        : denegar("invalid_state"),
  },
  "convocatoria:concluir": {
    roles: [ADM],
    guarda: (c) => {
      if (c.estatusConvocatoria !== "PUBLICADA")
        return denegar("invalid_state");
      return c.ventaFinalizada || c.sinSolicitudesVivas
        ? permitir()
        : denegar("invalid_state");
    },
  },

  // 3. Convocatorias — participacion
  "convocatoria:ver-publicada": {
    roles: [ADM, APR, EMP, OTR, TES, AUD],
    guarda: guardaGatingTriple,
  },
  "lote:ver-detalle": {
    roles: [ADM, APR, EMP, OTR, TES, AUD],
    guarda: guardaGatingTriple,
  },

  // 4. Fila y solicitudes
  "solicitud:crear": {
    roles: [EMP, OTR],
    guarda: (c, roles) => {
      const gating = guardaGatingTriple(c, roles);
      if (!gating.permitido) return gating;
      if (c.ventaAbierta === false) return denegar("invalid_state");
      if (c.tieneSolicitudViva) return denegar("invalid_state");
      return permitir();
    },
  },
  "solicitud:ver-mi-lugar": {
    roles: [EMP, OTR],
    guarda: (c) => (esPropio(c) ? permitir() : denegar("not_owner")),
  },
  "solicitud:ver-mis-solicitudes": { roles: [EMP, OTR] },
  "solicitud:cancelar": {
    roles: [EMP, OTR],
    guarda: (c) => {
      if (!esPropio(c)) return denegar("not_owner");
      if (
        !c.estatusSolicitud ||
        !ESTADOS_VIVOS_SOLICITUD.includes(c.estatusSolicitud)
      ) {
        return denegar("invalid_state");
      }
      return permitir();
    },
  },
  "fila:ver-completa": { roles: [AUD] },

  // 5. Pago y tesoreria
  "comprobante:subir": {
    roles: [EMP, OTR],
    guarda: (c) => {
      if (!esPropio(c)) return denegar("not_owner");
      if (c.estatusSolicitud !== "ADJUDICADA") return denegar("invalid_state");
      if (c.dentroDePlazo === false) return denegar("invalid_state");
      return permitir();
    },
  },
  "comprobante:descargar": {
    roles: [EMP, OTR, TES, AUD],
    guarda: (c, roles) => {
      if (roles.includes(TES) || roles.includes(AUD)) return permitir();
      return esPropio(c) ? permitir() : denegar("not_owner");
    },
  },
  "tesoreria:ver-bandeja": { roles: [TES, AUD] },
  "pago:avalar": {
    roles: [TES],
    guarda: (c) =>
      c.estatusSolicitud === "EN_VERIFICACION"
        ? permitir()
        : denegar("invalid_state"),
  },
  "pago:rechazar": {
    roles: [TES],
    guarda: (c) => {
      if (c.estatusSolicitud !== "EN_VERIFICACION")
        return denegar("invalid_state");
      if (c.motivoProvisto === false) return denegar("invalid_state");
      return permitir();
    },
  },

  // 6. Auditoria
  "auditoria:ver-bitacora": { roles: [AUD] },
  "auditoria:ver-fila-historica": { roles: [AUD] },
  "auditoria:exportar": { roles: [AUD] },
} satisfies Record<string, DefinicionAccion>;

export type Accion = keyof typeof CATALOGO_ACCIONES;

/**
 * Decide si `roles` puede ejecutar `accion` sobre `contexto`. Pura: sin I/O,
 * sin red, sin base de datos — todo lo que la decision necesita ya llego en
 * `contexto`, resuelto por quien invoca.
 *
 * Cerrada por omision: una accion que no existe en el catalogo se deniega
 * (nunca `permitido: true`), incluso si el tipo `Accion` se burla con `as`.
 */
export const puedeEjecutar = ({
  accion,
  roles,
  contexto,
}: {
  accion: Accion;
  roles: readonly Rol[];
  contexto: Contexto;
}): DecisionPermiso => {
  const definicion: DefinicionAccion | undefined = CATALOGO_ACCIONES[accion];
  if (!definicion) return denegar("forbidden");

  const tieneRol = definicion.roles.some((rol) => roles.includes(rol));
  if (!tieneRol) return denegar("forbidden");

  if (!definicion.guarda) return permitir();
  return definicion.guarda(contexto, roles);
};

export const __test__ = { CATALOGO_ACCIONES };
