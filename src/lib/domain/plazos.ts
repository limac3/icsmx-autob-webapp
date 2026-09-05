// Fuente: proyecto.md R-13 y R-15, y modelo-datos-dynamodb.md T3 y T5.
//
// El plazo de liquidacion: cuanto tiempo tiene quien gana un lote para pagar.
//
// **Horas naturales, reloj corrido 24/7** (R-13). No se excluyen fines de
// semana ni dias festivos, y por eso este archivo no importa `fechas.ts`: el
// calculo es aritmetica de milisegundos UTC y no depende de la zona horaria.
// Cambiar a horas habiles obligaria a un calendario de festivos de Mexico —
// alternativa descartada por auditabilidad, no por dificultad.

const MILISEGUNDOS_POR_HORA = 60 * 60 * 1000;

/**
 * `venceEn = adjudicadoEn + horasLiquidacion` (R-13).
 *
 * `horasLiquidacion` es un atributo de la convocatoria que se desnormaliza en
 * el lote (modelo-datos 2.2) y viaja a la solicitud al adjudicar. Se exige
 * entero positivo: R-14 lo pide mayor que cero al validar la convocatoria, y
 * un valor fraccionario produciria vencimientos con milisegundos que ningun
 * operador puede explicar.
 *
 * Devuelve `undefined` en lugar de lanzar porque el valor puede venir de un
 * item viejo o de un formulario; quien invoca responde `validation_failed`.
 */
export const calcularVenceEn = (
  adjudicadoEn: Date,
  horasLiquidacion: number,
): Date | undefined => {
  if (!Number.isInteger(horasLiquidacion) || horasLiquidacion <= 0) {
    return undefined;
  }
  if (Number.isNaN(adjudicadoEn.getTime())) return undefined;

  return new Date(
    adjudicadoEn.getTime() + horasLiquidacion * MILISEGUNDOS_POR_HORA,
  );
};

/**
 * ¿Se vencio el plazo?
 *
 * **Inclusivo en `venceEn`**: en el instante exacto del vencimiento el plazo ya
 * paso. Es la condicion literal del item 1 de T5 (`venceEn <= :ahora`).
 */
export const estaVencido = (venceEn: Date, ahora: Date): boolean =>
  venceEn.getTime() <= ahora.getTime();

/**
 * ¿Sigue dentro del plazo? Complemento exacto de `estaVencido`, y condicion
 * literal del item 1 de T3 (`venceEn > :ahora`).
 *
 * Que sean complementarios importa: si una solicitud pudiera estar a la vez
 * vencida y en plazo, el barrido y la subida de comprobante competirian por el
 * mismo item con condiciones que ambas pasan. Y si pudiera no estar en
 * ninguna, quedaria bloqueada. Hay prueba de que la particion es exacta.
 */
export const dentroDePlazo = (venceEn: Date, ahora: Date): boolean =>
  ahora.getTime() < venceEn.getTime();

/**
 * Milisegundos que faltan para el vencimiento; `0` si ya paso.
 *
 * Para el contador de la UI. Nunca negativo: un "quedan -3 horas" no significa
 * nada para el participante, y quien necesita saber si vencio usa
 * `estaVencido`.
 */
export const tiempoRestante = (venceEn: Date, ahora: Date): number =>
  Math.max(0, venceEn.getTime() - ahora.getTime());
