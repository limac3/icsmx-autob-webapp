import "server-only";

// Traduccion entre el item crudo de DynamoDB y el registro tipado.
//
// Es el unico lugar donde un item puede estar mal formado: todo lo que sale de
// DynamoDB es `Record<string, unknown>`, y afirmarle un tipo con `as` seria
// mentirle al compilador sobre datos que pudo escribir una version anterior del
// codigo o una correccion manual.

import {
  ESTATUS_CONVOCATORIA,
  TIPOS_CONVOCATORIA,
  type Convocatoria,
  type EstatusConvocatoria,
  type TipoConvocatoria,
} from "@/types/convocatoria";
import { ESTATUS_LOTE, type EstatusLote, type Lote } from "@/types/lote";

const texto = (valor: unknown): string | undefined =>
  typeof valor === "string" && valor.length > 0 ? valor : undefined;

const entero = (valor: unknown): number | undefined =>
  typeof valor === "number" && Number.isInteger(valor) ? valor : undefined;

const esEstatusConvocatoria = (valor: unknown): valor is EstatusConvocatoria =>
  typeof valor === "string" &&
  (ESTATUS_CONVOCATORIA as readonly string[]).includes(valor);

const esTipo = (valor: unknown): valor is TipoConvocatoria =>
  typeof valor === "string" &&
  (TIPOS_CONVOCATORIA as readonly string[]).includes(valor);

const esEstatusLote = (valor: unknown): valor is EstatusLote =>
  typeof valor === "string" &&
  (ESTATUS_LOTE as readonly string[]).includes(valor);

/**
 * Convierte un item en una convocatoria, o `undefined` si le falta algo
 * indispensable.
 *
 * Devolver `undefined` y no lanzar es deliberado: un item corrupto entre mil
 * debe desaparecer del listado, no tumbar la pantalla entera. Quien lee una
 * convocatoria concreta convierte ese `undefined` en `not_found`.
 */
export const aConvocatoria = (
  item: Record<string, unknown>,
): Convocatoria | undefined => {
  const convocatoriaId = texto(item.convocatoriaId);
  const folio = texto(item.folio);
  const nombre = texto(item.nombre);
  const descripcionParticipacion = texto(item.descripcionParticipacion);
  const publicadaEn = texto(item.publicadaEn);
  const inicioVenta = texto(item.inicioVenta);
  const finVenta = texto(item.finVenta);
  const horasLiquidacion = entero(item.horasLiquidacion);
  const creadoEn = texto(item.creadoEn);
  const creadoPor = texto(item.creadoPor);

  if (
    !convocatoriaId ||
    // Los dos son obligatorios: sin folio la convocatoria no se puede nombrar
    // en el inventario y su centinela quedaria huerfano; sin nombre, las listas
    // y las opciones de auditoria volverian a ofrecer un identificador crudo.
    !folio ||
    !nombre ||
    !descripcionParticipacion ||
    !publicadaEn ||
    !inicioVenta ||
    !finVenta ||
    horasLiquidacion === undefined ||
    !creadoEn ||
    !creadoPor ||
    !esEstatusConvocatoria(item.estatus) ||
    !esTipo(item.tipo)
  ) {
    return undefined;
  }

  return {
    convocatoriaId,
    folio,
    nombre,
    tipo: item.tipo,
    descripcionParticipacion,
    publicadaEn,
    inicioVenta,
    finVenta,
    horasLiquidacion,
    estatus: item.estatus,
    creadoEn,
    creadoPor,
    ...(texto(item.actualizadoEn)
      ? { actualizadoEn: texto(item.actualizadoEn) }
      : {}),
    ...(texto(item.actualizadoPor)
      ? { actualizadoPor: texto(item.actualizadoPor) }
      : {}),
    ...(texto(item.motivoOcultamiento)
      ? { motivoOcultamiento: texto(item.motivoOcultamiento) }
      : {}),
  };
};

/** Convierte un item en un lote, o `undefined` si le falta algo indispensable. */
export const aLote = (item: Record<string, unknown>): Lote | undefined => {
  const loteId = texto(item.loteId);
  const convocatoriaId = texto(item.convocatoriaId);
  const vehiculoId = texto(item.vehiculoId);
  const precio = entero(item.precio);
  const contadorTurnos = entero(item.contadorTurnos);
  const inicioVenta = texto(item.inicioVenta);
  const finVenta = texto(item.finVenta);
  const horasLiquidacion = entero(item.horasLiquidacion);
  const creadoEn = texto(item.creadoEn);
  const creadoPor = texto(item.creadoPor);

  if (
    !loteId ||
    !convocatoriaId ||
    !vehiculoId ||
    precio === undefined ||
    contadorTurnos === undefined ||
    !inicioVenta ||
    !finVenta ||
    horasLiquidacion === undefined ||
    !creadoEn ||
    !creadoPor ||
    !esEstatusLote(item.estatus) ||
    !esTipo(item.tipoConvocatoria) ||
    !esEstatusConvocatoria(item.estatusConvocatoria)
  ) {
    return undefined;
  }

  return {
    loteId,
    convocatoriaId,
    vehiculoId,
    precio,
    estatus: item.estatus,
    contadorTurnos,
    inicioVenta,
    finVenta,
    tipoConvocatoria: item.tipoConvocatoria,
    estatusConvocatoria: item.estatusConvocatoria,
    horasLiquidacion,
    creadoEn,
    creadoPor,
    ...(texto(item.motivoRetiro)
      ? { motivoRetiro: texto(item.motivoRetiro) }
      : {}),
    // La adjudicacion la escribe la Etapa 8. Se mapea desde ya para que un lote
    // leido despues de adjudicarse no pierda el dato al pasar por aqui.
    ...(texto(item.adjudicacionActual)
      ? { adjudicacionActual: texto(item.adjudicacionActual) }
      : {}),
    ...(texto(item.adjudicadoEn)
      ? { adjudicadoEn: texto(item.adjudicadoEn) }
      : {}),
    ...(texto(item.venceEn) ? { venceEn: texto(item.venceEn) } : {}),
    ...(entero(item.turnoAdjudicado) !== undefined
      ? { turnoAdjudicado: entero(item.turnoAdjudicado) }
      : {}),
  };
};
