// Fuente: agent_files/proyecto.md secciones 4.2 y 5.1.

/**
 * Tipo de convocatoria. Determina que permiso de venta da acceso (R-02); la
 * correspondencia vive en `TIPO_POR_PERMISO_DE_VENTA` de `identidad.ts`.
 */
export type TipoConvocatoria = "EMPLEADOS" | "PUBLICO_GENERAL";

export const TIPOS_CONVOCATORIA = [
  "EMPLEADOS",
  "PUBLICO_GENERAL",
] as const satisfies readonly TipoConvocatoria[];

/**
 * Estatus de la convocatoria.
 *
 * `EN_APROBACION` es una adicion deliberada a los cinco del enunciado
 * original: sin el no se distingue un borrador que se sigue editando de uno
 * que espera dictamen, y el aprobador no tiene bandeja. El rechazo devuelve a
 * `BORRADOR` con el motivo en la bitacora, en lugar de un estatus `RECHAZADA`
 * (proyecto.md 5.1 y seccion 8).
 *
 * `PUBLICADA` **no** significa visible: hace falta ademas `publicadaEn <=
 * ahora` (R-01). Ver `src/lib/domain/gating.ts`.
 */
export type EstatusConvocatoria =
  | "BORRADOR"
  | "EN_APROBACION"
  | "APROBADA"
  | "PUBLICADA"
  | "CONCLUIDA"
  | "OCULTA";

export const ESTATUS_CONVOCATORIA = [
  "BORRADOR",
  "EN_APROBACION",
  "APROBADA",
  "PUBLICADA",
  "CONCLUIDA",
  "OCULTA",
] as const satisfies readonly EstatusConvocatoria[];
