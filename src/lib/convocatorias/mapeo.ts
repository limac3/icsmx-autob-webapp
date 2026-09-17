// Traduccion entre el item crudo de DynamoDB y el registro tipado.
//
// Es el unico lugar donde un item puede estar mal formado: todo lo que sale de
// DynamoDB es `Record<string, unknown>`, y afirmarle un tipo con `as` seria
// mentirle al compilador sobre datos que pudo escribir una version anterior del
// codigo o una correccion manual.

import {
  ESTATUS_CONVOCATORIA,
  MODALIDADES_ADJUDICACION,
  TIPOS_CONVOCATORIA,
  type Convocatoria,
  type EstatusConvocatoria,
  type ModalidadAdjudicacion,
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

const esModalidad = (valor: unknown): valor is ModalidadAdjudicacion =>
  typeof valor === "string" &&
  (MODALIDADES_ADJUDICACION as readonly string[]).includes(valor);

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
  const limiteAdjudicaciones = entero(item.limiteAdjudicaciones);
  const limiteSolicitudes = entero(item.limiteSolicitudes);
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
    limiteAdjudicaciones === undefined ||
    limiteSolicitudes === undefined ||
    !creadoEn ||
    !creadoPor ||
    !esEstatusConvocatoria(item.estatus) ||
    !esTipo(item.tipo) ||
    !esModalidad(item.modalidadAdjudicacion)
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
    limiteAdjudicaciones,
    limiteSolicitudes,
    modalidadAdjudicacion: item.modalidadAdjudicacion,
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
  const limiteAdjudicaciones = entero(item.limiteAdjudicaciones);
  const limiteSolicitudes = entero(item.limiteSolicitudes);
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
    // Ver `Lote.limiteAdjudicaciones`: un lote sin sus topes es ilegible a
    // proposito. La alternativa —leer su ausencia como "sin tope"— dejaria una
    // propagacion a medias repartiendo vehiculos sin limite, en silencio.
    limiteAdjudicaciones === undefined ||
    limiteSolicitudes === undefined ||
    !creadoEn ||
    !creadoPor ||
    !esEstatusLote(item.estatus) ||
    !esTipo(item.tipoConvocatoria) ||
    !esEstatusConvocatoria(item.estatusConvocatoria) ||
    !esModalidad(item.modalidadAdjudicacion)
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
    limiteAdjudicaciones,
    limiteSolicitudes,
    modalidadAdjudicacion: item.modalidadAdjudicacion,
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

// --- Diagnostico de items que no se pueden mapear ---------------------------
//
// **Devolver `undefined` y seguir es correcto; hacerlo en silencio no.** Los dos
// mapeadores descartan el item mal formado para no tumbar la pantalla entera, y
// quien llama lo filtra. El problema es que ahi termina la historia: la
// convocatoria desaparece del listado sin error, sin hueco y sin linea de
// registro, y con ella la unica via para llegar a sus lotes y a sus vehiculos.
//
// Paso de verdad. Las Etapas 14 y 15 agregaron `limiteAdjudicaciones`,
// `limiteSolicitudes` y `modalidadAdjudicacion` como obligatorios, y las
// convocatorias creadas antes nunca los tuvieron: tres de cinco se volvieron
// invisibles en la pantalla de administracion, con dos vehiculos anclados a una
// de ellas y ninguna forma de concluirla. El sintoma que llego fue "los
// vehiculos quedaron anclados a convocatorias borradas" — y no habia ninguna
// borrada. `desafios-implementacion.md` 78.
//
// Estas funciones existen para que el descarte deje rastro. No deciden nada:
// los mapeadores siguen siendo la autoridad sobre que es mapeable, y la prueba
// de `mapeo.test.ts` exige que ambos coincidan campo por campo, para que no
// puedan separarse.

/** Presente y utilizable, o `undefined`. Cada entrada es `[campo, valor]`. */
type Campo = readonly [string, unknown];

const nombresAusentes = (campos: readonly Campo[]): string[] =>
  campos.filter(([, valor]) => valor === undefined).map(([campo]) => campo);

/**
 * Que le falta a un item para ser una convocatoria, por nombre de campo.
 *
 * Vacio significa que `aConvocatoria` lo va a mapear.
 */
export const camposFaltantesDeConvocatoria = (
  item: Record<string, unknown>,
): string[] =>
  nombresAusentes([
    ["convocatoriaId", texto(item.convocatoriaId)],
    ["folio", texto(item.folio)],
    ["nombre", texto(item.nombre)],
    ["descripcionParticipacion", texto(item.descripcionParticipacion)],
    ["publicadaEn", texto(item.publicadaEn)],
    ["inicioVenta", texto(item.inicioVenta)],
    ["finVenta", texto(item.finVenta)],
    ["horasLiquidacion", entero(item.horasLiquidacion)],
    ["limiteAdjudicaciones", entero(item.limiteAdjudicaciones)],
    ["limiteSolicitudes", entero(item.limiteSolicitudes)],
    ["creadoEn", texto(item.creadoEn)],
    ["creadoPor", texto(item.creadoPor)],
    ["estatus", esEstatusConvocatoria(item.estatus) ? item.estatus : undefined],
    ["tipo", esTipo(item.tipo) ? item.tipo : undefined],
    [
      "modalidadAdjudicacion",
      esModalidad(item.modalidadAdjudicacion)
        ? item.modalidadAdjudicacion
        : undefined,
    ],
  ]);

/** Lo mismo para un lote. Vacio significa que `aLote` lo va a mapear. */
export const camposFaltantesDeLote = (
  item: Record<string, unknown>,
): string[] =>
  nombresAusentes([
    ["loteId", texto(item.loteId)],
    ["convocatoriaId", texto(item.convocatoriaId)],
    ["vehiculoId", texto(item.vehiculoId)],
    ["precio", entero(item.precio)],
    ["contadorTurnos", entero(item.contadorTurnos)],
    ["inicioVenta", texto(item.inicioVenta)],
    ["finVenta", texto(item.finVenta)],
    ["horasLiquidacion", entero(item.horasLiquidacion)],
    ["limiteAdjudicaciones", entero(item.limiteAdjudicaciones)],
    ["limiteSolicitudes", entero(item.limiteSolicitudes)],
    ["creadoEn", texto(item.creadoEn)],
    ["creadoPor", texto(item.creadoPor)],
    ["estatus", esEstatusLote(item.estatus) ? item.estatus : undefined],
    [
      "tipoConvocatoria",
      esTipo(item.tipoConvocatoria) ? item.tipoConvocatoria : undefined,
    ],
    [
      "estatusConvocatoria",
      esEstatusConvocatoria(item.estatusConvocatoria)
        ? item.estatusConvocatoria
        : undefined,
    ],
    [
      "modalidadAdjudicacion",
      esModalidad(item.modalidadAdjudicacion)
        ? item.modalidadAdjudicacion
        : undefined,
    ],
  ]);
