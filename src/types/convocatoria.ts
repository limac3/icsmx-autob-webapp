// Fuente: agent_files/proyecto.md secciones 4.2 y 5.1.

import type { Lote } from "./lote";

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

/**
 * Lo que captura quien crea o edita una convocatoria (proyecto.md 4.2).
 *
 * Las tres fechas son **cadenas ISO-8601 UTC**, no `Date` (R-04). Persistir y
 * transportar el instante ya serializado evita que una capa lo reinterprete en
 * la zona del servidor; la conversion a `America/Mexico_City` ocurre solo al
 * presentar (regla 9).
 */
export type DatosConvocatoria = {
  /**
   * Folio: el identificador con el que la organizacion nombra la convocatoria.
   * **Lo teclea el operador y es unico**, garantizado por un centinela
   * (`clave.centinelaDeIdentificador`), no por una lectura previa.
   *
   * No es la clave del item ni el ancla de la bitacora — eso sigue siendo el
   * `convocatoriaId` interno—, y por eso **se puede corregir** sin partir la
   * historia. Misma division que D-15 para `participanteId`.
   */
  folio: string;
  /**
   * Cadena corta para identificarla en pantalla.
   *
   * Sin ella, una convocatoria solo se distinguia por su tipo y sus fechas, y
   * las listas y las opciones de auditoria tenian que ofrecer un ULID. **No es
   * unica**: dos ventas recurrentes pueden llamarse igual y el folio las
   * distingue.
   */
  nombre: string;
  tipo: TipoConvocatoria;
  descripcionParticipacion: string;
  publicadaEn: string;
  inicioVenta: string;
  finVenta: string;
  horasLiquidacion: number;
};

/** Los campos capturables, para recorrerlos sin escribirlos dos veces. */
export const CAMPOS_CONVOCATORIA = [
  "folio",
  "nombre",
  "tipo",
  "descripcionParticipacion",
  "publicadaEn",
  "inicioVenta",
  "finVenta",
  "horasLiquidacion",
] as const satisfies readonly (keyof DatosConvocatoria)[];

/** El registro completo, tal como vive en `CONV#<id> / META`. */
export type Convocatoria = DatosConvocatoria & {
  convocatoriaId: string;
  estatus: EstatusConvocatoria;
  creadoEn: string;
  creadoPor: string;
  actualizadoEn?: string;
  actualizadoPor?: string;
  /** Presente solo si esta `OCULTA`; el motivo es obligatorio al ocultar. */
  motivoOcultamiento?: string;
};

/**
 * La convocatoria con sus lotes, tal como la devuelve PA-04: una sola `Query`
 * sobre la particion `CONV#<id>`.
 *
 * Los lotes cuelgan de la convocatoria justamente para que la pantalla de
 * detalle sea **una** lectura. Partirla en dos reintroduciria la posibilidad de
 * mostrar una convocatoria con los lotes de otro instante.
 */
export type ConvocatoriaConLotes = Convocatoria & {
  lotes: Lote[];
};
