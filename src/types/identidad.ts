// Fuente: agent_files/permission-matrix.md secciones 0 y 1, y
// agent_files/identidad-autorizacion.md secciones 3 a 5.

import type { TipoConvocatoria } from "./convocatoria";

/**
 * Catalogo completo de permisos de la aplicacion.
 *
 * EAS **no expone roles**: se le pregunta por estos nombres y responde un
 * booleano por cada uno. Esta lista es tambien la peticion que se le envia —
 * una sola por peticion HTTP, no una por pantalla (identidad-autorizacion 4.3).
 *
 * Los nombres estan **pendientes de confirmar con el equipo de EAS** (riesgo
 * R19). Lo confirmado es la semantica, no la nomenclatura.
 */
export const PERMISOS = [
  "Autob_Administrar_Vehiculos",
  "Autob_Administrar_Convocatorias",
  "Autob_Aprobar_Convocatorias",
  "Autob_Venta_a_empleados",
  "Autob_Venta_en_general",
  "Autob_Operar_Tesoreria",
  // Etapa 15 (R-23). **Por confirmar con EAS**, igual que los demas: el nombre
  // es una propuesta a granularidad de capacidad (riesgo R19).
  "Autob_Adjudicar_Convocatorias",
  "Autob_Auditar",
] as const;

export type Permiso = (typeof PERMISOS)[number];

/**
 * Que tipo de convocatoria habilita cada permiso de venta. Es la tercera pata
 * del gating triple (R-01), y reemplaza al antiguo `tipoParticipante`: el
 * acceso ya no se deduce de un rol, se lee de un permiso.
 */
export const TIPO_POR_PERMISO_DE_VENTA: Readonly<
  Record<TipoConvocatoria, Permiso>
> = {
  EMPLEADOS: "Autob_Venta_a_empleados",
  PUBLICO_GENERAL: "Autob_Venta_en_general",
};

export const tiposDeConvocatoriaPermitidos = (
  permisos: ReadonlySet<Permiso>,
): TipoConvocatoria[] =>
  (Object.keys(TIPO_POR_PERMISO_DE_VENTA) as TipoConvocatoria[]).filter(
    (tipo) => permisos.has(TIPO_POR_PERMISO_DE_VENTA[tipo]),
  );

export type Sesion = {
  /** Identificador interno estable. Hasta la Etapa 4 (upsert en DynamoDB) es
   * el propio `oktaSub` — ver la nota en src/lib/auth/session.ts. */
  participanteId: string;
  oktaSub: string;
  correo: string;
  nombre: string;
  /** Resueltos por EAS. La sesion **no lleva roles**: la aplicacion no los ve
   * fuera del simulador de desarrollo. */
  permisos: ReadonlySet<Permiso>;
  tiposDeConvocatoriaPermitidos: readonly TipoConvocatoria[];
};
