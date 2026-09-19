// Fuente: ui-ux-requerimientos.md 3.5.
//
// En que grupo cae cada solicitud propia en `/mis-solicitudes`. Vive en el
// dominio y no en el componente porque es decidible sin I/O y es la regla que
// decide **que ve primero** quien tiene un plazo corriendo.

import { esEstadoVivo, type EstatusSolicitud } from "@/types/solicitud";

export const GRUPOS_DE_MIS_SOLICITUDES = [
  "REQUIERE_ATENCION",
  "ACTIVA",
  "HISTORICA",
] as const;

export type GrupoDeMiSolicitud = (typeof GRUPOS_DE_MIS_SOLICITUDES)[number];

/**
 * `REQUIERE_ATENCION` es **solo** `ADJUDICADA` con el plazo todavia corriendo:
 * el unico caso en el que la persona puede hacer algo y perderlo si no lo hace.
 *
 * **Una `ADJUDICADA` con el plazo ya vencido no requiere atencion, y tampoco es
 * historica.** No requiere atencion porque ya no hay nada que hacer —`T3`
 * condiciona la subida a `venceEn > :ahora`, asi que el comprobante ya no
 * entra—, y no es historica porque la transicion aun no se ha escrito: la
 * escribira el barrido o la lectura del propio lote (D-7). Ponerla entre las
 * activas con su aviso es lo unico que no miente sobre ninguno de los dos
 * hechos; encabezar con ella una cuenta regresiva en cero seria cruel y falso.
 */
export const agruparMiSolicitud = (entrada: {
  estatus: EstatusSolicitud;
  plazoVencido: boolean;
}): GrupoDeMiSolicitud => {
  if (entrada.estatus === "ADJUDICADA") {
    return entrada.plazoVencido ? "ACTIVA" : "REQUIERE_ATENCION";
  }
  return esEstadoVivo(entrada.estatus) ? "ACTIVA" : "HISTORICA";
};

const PESO: Record<GrupoDeMiSolicitud, number> = {
  REQUIERE_ATENCION: 0,
  ACTIVA: 1,
  HISTORICA: 2,
};

/** Comparacion de cadenas ISO-8601 UTC, que ordenan lexicograficamente. */
const porCadena = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export type OrdenableComoMiSolicitud = {
  grupo: GrupoDeMiSolicitud;
  solicitadoEn: string;
  venceEn?: string;
};

/**
 * Primero los grupos en orden, y **dentro de "requieren tu atencion", el plazo
 * que vence antes va arriba** — no la solicitud mas reciente. Es el unico grupo
 * donde el orden decide algo: quien tiene tres adjudicaciones vivas necesita
 * ver primero la que esta a punto de perder, y esa puede ser la mas vieja.
 *
 * En los otros dos grupos manda `solicitadoEn` descendente: sin plazo de por
 * medio, lo reciente es lo que se esta buscando.
 */
export const ordenDeMisSolicitudes = (
  a: OrdenableComoMiSolicitud,
  b: OrdenableComoMiSolicitud,
): number => {
  if (a.grupo !== b.grupo) return PESO[a.grupo] - PESO[b.grupo];

  if (a.grupo === "REQUIERE_ATENCION" && a.venceEn && b.venceEn) {
    return porCadena(a.venceEn, b.venceEn);
  }
  return porCadena(b.solicitadoEn, a.solicitadoEn);
};
