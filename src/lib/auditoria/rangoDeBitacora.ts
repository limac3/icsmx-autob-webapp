// La cota de tiempo de las consultas de bitacora, en la forma que DynamoDB
// entiende: dos instantes ISO que se comparan contra `cronoSK`.
//
// Puro y sin I/O. Vive aparte de los lectores porque **los cuatro la comparten**
// —GSI5, GSI6, GSI9 y las particiones de lote de la consulta 3b— y porque una
// cota que cada lector calculara por su cuenta es una cota que puede divergir:
// la misma pregunta devolveria conjuntos distintos segun el modo de consulta,
// que es exactamente el defecto de la seccion 44.

import {
  aIso,
  inicioDelDiaDeNegocio,
  sumarDiasDeNegocio,
} from "@/lib/domain/fechas";

export type CotaDeRango = {
  /** Inicio del primer dia, **inclusivo**. */
  desde: string;
  /**
   * Inicio del dia **siguiente** al ultimo.
   *
   * Se compara con `BETWEEN`, que es inclusivo, y aun asi el efecto es
   * exclusivo: ver `condicionDeRango`.
   */
  hasta: string;
};

/**
 * Convierte un rango de dias de negocio en la cota que se compara contra
 * `cronoSK`, o `undefined` si algun extremo no es un dia.
 *
 * **El limite superior es exclusivo, y esa es la decision de fondo.** `cronoSK`
 * es `<ocurridoEn>#<eventoId>`, asi que una cota inclusiva contra el ultimo
 * instante del rango dejaria fuera los eventos de ese mismo instante —la cadena
 * con sufijo ordena despues que su propio prefijo—, y arreglarlo obligaria a
 * inventar un centinela como el `U+FFFF` de `gsi2.cotaSuperiorPorFecha`. Con la
 * medianoche siguiente y `<`, la frontera cae en un punto donde no puede haber
 * ningun evento ambiguo y no hace falta ningun caracter magico.
 *
 * Las dos cotas salen de `inicioDelDiaDeNegocio`, o sea de la medianoche de
 * **Mexico**: es la misma frontera con la que `atributosDeEvento` calcula el
 * `dia` y el `mes` de cada evento. Cualquier otra —la medianoche UTC, por
 * ejemplo— movería el rango seis horas respecto de las particiones que se
 * consultan.
 */
export const cotaDeRango = (
  desde: string,
  hasta: string,
): CotaDeRango | undefined => {
  const inicio = inicioDelDiaDeNegocio(desde);
  const siguienteAlFin = sumarDiasDeNegocio(hasta, 1);
  const fin = siguienteAlFin
    ? inicioDelDiaDeNegocio(siguienteAlFin)
    : undefined;

  if (!inicio || !fin) return undefined;
  // Un rango invertido no se corrige: quien lo escribio espera esas fechas, y
  // devolverle el rango al derecho seria responder otra pregunta.
  if (inicio.getTime() >= fin.getTime()) return undefined;

  return { desde: aIso(inicio), hasta: aIso(fin) };
};

/**
 * Condicion de clave y valores para acotar por `cronoSK` dentro de una
 * particion.
 *
 * **Es `BETWEEN` y no dos comparaciones.** DynamoDB admite **una sola condicion
 * por clave** en una `KeyConditionExpression`: escribir
 * `cronoSK >= :a AND cronoSK < :b` se rechaza con
 * `ValidationException: KeyConditionExpressions must only contain one condition
 * per key`. No lo detecta ningun doble de cliente —un doble acepta cualquier
 * cadena— y solo aparece contra la tabla real.
 *
 * `BETWEEN` es inclusivo en los dos extremos, y aun asi el limite superior
 * queda **exclusivo del instante**: `cronoSK` es `<ocurridoEn>#<eventoId>`, y
 * toda cadena ordena despues que su propio prefijo, asi que un evento ocurrido
 * exactamente en la medianoche siguiente tiene `cronoSK` mayor que la cota y
 * queda fuera. La misma propiedad que obligaba a inventar un centinela cuando
 * la cota era el ultimo instante del rango, aqui trabaja a favor: la cota es la
 * medianoche siguiente, donde no puede haber ningun evento ambiguo.
 *
 * Se devuelve armada en vez de dejar que cada lector la escriba: son tres
 * lineas que tienen que coincidir exactamente en cuatro consultas, y el modo de
 * fallar de una discrepancia es devolver de menos sin avisar.
 */
export const condicionDeRango = (
  cota: CotaDeRango,
): {
  condicion: string;
  valores: Record<string, string>;
} => ({
  condicion: "cronoSK BETWEEN :desdeCrono AND :hastaCrono",
  valores: { ":desdeCrono": cota.desde, ":hastaCrono": cota.hasta },
});

/**
 * Lo mismo sobre la **tabla base**, cuya clave de ordenamiento tiene la misma
 * forma (`<ocurridoEn>#<eventoId>`) pero se llama `SK`.
 *
 * La usa la consulta 3b, que lee particiones de lote para encontrar lo que le
 * ocurrio a un participante.
 */
export const condicionDeRangoEnSK = (
  cota: CotaDeRango,
): {
  condicion: string;
  valores: Record<string, string>;
} => ({
  condicion: "SK BETWEEN :desdeCrono AND :hastaCrono",
  valores: { ":desdeCrono": cota.desde, ":hastaCrono": cota.hasta },
});
