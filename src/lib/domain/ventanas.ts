// Fuente: proyecto.md R-01 y R-03, y modelo-datos-dynamodb.md T1 paso 1.
//
// Las tres ventanas de una convocatoria: cuando se vuelve visible, cuando abre
// la venta y cuando cierra. Publicacion y venta son momentos distintos (R-03):
// entre uno y otro el participante ve la convocatoria y sus vehiculos pero no
// puede solicitar.
//
// **Estas funciones son el espejo en memoria de las condiciones de DynamoDB.**
// El paso 1 de T1 condiciona la escritura con
// `inicioVenta <= :ahora AND finVenta > :ahora`; si este archivo usara otra
// inclusividad, la UI ofreceria un boton que la base de datos rechaza, o al
// reves. La igualdad de fronteras entre los dos esta cubierta por prueba.

import type { EstatusConvocatoria } from "@/types/convocatoria";

/**
 * Ventana de una convocatoria, ya deserializada.
 *
 * Se recibe como argumento, nunca se lee: `src/lib/domain` no toca datos
 * (estrategia P-2). Quien invoca convierte con `desdeIso` los atributos que
 * trae de DynamoDB.
 */
export type VentanaDeConvocatoria = {
  publicadaEn: Date;
  inicioVenta: Date;
  finVenta: Date;
};

/**
 * ¿Ya llego el momento de publicacion?
 *
 * **Inclusivo**: en el instante exacto de `publicadaEn` la convocatoria ya es
 * visible. Es la segunda pata del gating triple (R-01) y corresponde a la
 * condicion de rango `GSI2SK <= ahora` de PA-05.
 *
 * No mira el estatus. La condicion completa esta en `gating.ts`; separarlas
 * permite decir "esta publicada pero aun no abre" sin repetir el estatus.
 */
export const yaPublicada = (publicadaEn: Date, ahora: Date): boolean =>
  publicadaEn.getTime() <= ahora.getTime();

/**
 * ¿Esta abierta la venta?
 *
 * Intervalo **semiabierto** `[inicioVenta, finVenta)`, identico al del paso 1
 * de T1: en el instante exacto de apertura ya se puede solicitar, y en el
 * instante exacto de cierre ya no.
 *
 * El cierre exclusivo no es arbitrario: con ambos extremos inclusivos, dos
 * convocatorias consecutivas sobre el mismo vehiculo compartirian un
 * milisegundo en el que las dos aceptan solicitudes.
 */
export const ventaAbierta = (
  ventana: Pick<VentanaDeConvocatoria, "inicioVenta" | "finVenta">,
  ahora: Date,
): boolean =>
  ventana.inicioVenta.getTime() <= ahora.getTime() &&
  ahora.getTime() < ventana.finVenta.getTime();

/**
 * ¿Ya cerro la venta? Complemento exacto de la frontera superior de
 * `ventaAbierta`, no su negacion: antes de `inicioVenta` la venta no esta
 * abierta **ni** finalizada.
 */
export const ventaFinalizada = (finVenta: Date, ahora: Date): boolean =>
  finVenta.getTime() <= ahora.getTime();

/**
 * Coherencia de fechas — R-14.
 *
 * `publicadaEn <= inicioVenta < finVenta` y `horasLiquidacion > 0`. Se valida
 * al editar y al enviar a aprobacion; alimenta el campo `fechasCoherentes` del
 * contexto de `puedeEjecutar`.
 *
 * `publicadaEn == inicioVenta` es legitimo —una convocatoria que abre al
 * publicarse, sin ventana de preparacion (R-03)—, pero `inicioVenta` debe ser
 * estrictamente menor que `finVenta`: una ventana de duracion cero no acepta
 * ninguna solicitud y solo puede ser un error de captura.
 */
export const fechasCoherentes = (
  ventana: VentanaDeConvocatoria,
  horasLiquidacion: number,
): boolean =>
  ventana.publicadaEn.getTime() <= ventana.inicioVenta.getTime() &&
  ventana.inicioVenta.getTime() < ventana.finVenta.getTime() &&
  Number.isFinite(horasLiquidacion) &&
  horasLiquidacion > 0;

/** Momento del ciclo de vida en el que esta una convocatoria ya publicada. */
export type FaseDeVenta =
  "NO_VISIBLE" | "PUBLICADA_SIN_ABRIR" | "VENTA_ABIERTA" | "VENTA_CERRADA";

/**
 * Resume la ventana en una sola etiqueta, para la UI.
 *
 * Existe para que ninguna pantalla vuelva a componer a mano las tres
 * comparaciones: el error tipico —tratar "publicada pero sin abrir" como
 * "abierta"— es exactamente lo que R-03 prohibe.
 *
 * Solo describe el tiempo. Una convocatoria en `BORRADOR` cuyo `publicadaEn`
 * ya paso devuelve `PUBLICADA_SIN_ABRIR` o lo que corresponda; el estatus lo
 * pondera `gating.ts`.
 */
export const faseDeVenta = (
  ventana: VentanaDeConvocatoria,
  ahora: Date,
): FaseDeVenta => {
  if (!yaPublicada(ventana.publicadaEn, ahora)) return "NO_VISIBLE";
  if (ventaFinalizada(ventana.finVenta, ahora)) return "VENTA_CERRADA";
  if (ventaAbierta(ventana, ahora)) return "VENTA_ABIERTA";
  return "PUBLICADA_SIN_ABRIR";
};

/**
 * ¿Se puede concluir la convocatoria?
 *
 * Maquina de estados de `proyecto.md` 5.1: `PUBLICADA -> CONCLUIDA` exige
 * "solo despues del fin de venta, **o** sin solicitudes vivas". La disyuncion
 * es deliberada — una convocatoria en la que nadie se formo no tiene por que
 * esperar a su fecha de cierre.
 */
export const puedeConcluirse = (
  estatus: EstatusConvocatoria,
  finVenta: Date,
  ahora: Date,
  haySolicitudesVivas: boolean,
): boolean =>
  estatus === "PUBLICADA" &&
  (ventaFinalizada(finVenta, ahora) || !haySolicitudesVivas);
