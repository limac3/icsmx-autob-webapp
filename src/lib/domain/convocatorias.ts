// Reglas puras de la convocatoria. Sin I/O y sin reloj propio: el instante
// entra como argumento (AGENTS.md), para que las pruebas no dependan de la hora
// a la que corren.
//
// Fuente: agent_files/proyecto.md secciones 4.2 y 5.1, y R-14.

import { desdeIso } from "./fechas";
import type { DatosConvocatoria } from "@/types/convocatoria";
import { TIPOS_CONVOCATORIA } from "@/types/convocatoria";

export const LIMITES_CONVOCATORIA = {
  descripcionParticipacion: 2000,
  /**
   * Horas de liquidacion. El minimo es 1: con cero, `venceEn` coincidiria con
   * `adjudicadoEn` y la solicitud naceria vencida (R-13). El maximo son 30
   * dias, que no es una regla de negocio sino un tope de cordura para que un
   * cero de mas no deje un lote inmovilizado un ano.
   */
  horasLiquidacionMinimo: 1,
  horasLiquidacionMaximo: 24 * 30,
} as const;

export const MOTIVOS_INVALIDEZ_CONVOCATORIA = [
  "requerido",
  "muy_largo",
  "no_es_entero",
  "fuera_de_rango",
  "fecha_invalida",
  "orden_de_fechas",
  "sin_lotes",
] as const;

export type MotivoInvalidezConvocatoria =
  (typeof MOTIVOS_INVALIDEZ_CONVOCATORIA)[number];

/** Campo -> motivo. Vacio significa que los datos son validos. */
export type ErroresDeConvocatoria = Partial<
  Record<keyof DatosConvocatoria | "lotes", MotivoInvalidezConvocatoria>
>;

const CAMPOS_DE_FECHA = ["publicadaEn", "inicioVenta", "finVenta"] as const;

/**
 * Revisa los datos y devuelve **todos** los errores de una vez.
 *
 * No corta en el primero: quien captura merece ver la lista completa en un
 * envio, no descubrirlos de uno en uno.
 */
export const revisarDatosConvocatoria = (
  datos: DatosConvocatoria,
): ErroresDeConvocatoria => {
  const errores: ErroresDeConvocatoria = {};

  if (!(TIPOS_CONVOCATORIA as readonly string[]).includes(datos.tipo)) {
    errores.tipo = "requerido";
  }

  const descripcion = datos.descripcionParticipacion.trim();
  if (descripcion === "") {
    errores.descripcionParticipacion = "requerido";
  } else if (
    descripcion.length > LIMITES_CONVOCATORIA.descripcionParticipacion
  ) {
    errores.descripcionParticipacion = "muy_largo";
  }

  // Las tres fechas se parsean antes de compararlas: `desdeIso` rechaza el 30
  // de febrero, que el parser del navegador convierte en 2 de marzo en silencio
  // (desafios-implementacion.md seccion 16).
  const instantes = new Map<(typeof CAMPOS_DE_FECHA)[number], Date>();
  for (const campo of CAMPOS_DE_FECHA) {
    const crudo = datos[campo];
    if (crudo.trim() === "") {
      errores[campo] = "requerido";
      continue;
    }
    const instante = desdeIso(crudo);
    if (instante === undefined) {
      errores[campo] = "fecha_invalida";
      continue;
    }
    instantes.set(campo, instante);
  }

  // R-14: publicadaEn <= inicioVenta < finVenta. El error se marca en la fecha
  // **posterior** de cada par, que es la que el usuario mueve para arreglarlo.
  const publicada = instantes.get("publicadaEn");
  const inicio = instantes.get("inicioVenta");
  const fin = instantes.get("finVenta");

  if (publicada && inicio && publicada.getTime() > inicio.getTime()) {
    errores.inicioVenta ??= "orden_de_fechas";
  }
  if (inicio && fin && inicio.getTime() >= fin.getTime()) {
    errores.finVenta ??= "orden_de_fechas";
  }

  if (!Number.isInteger(datos.horasLiquidacion)) {
    errores.horasLiquidacion = "no_es_entero";
  } else if (
    datos.horasLiquidacion < LIMITES_CONVOCATORIA.horasLiquidacionMinimo ||
    datos.horasLiquidacion > LIMITES_CONVOCATORIA.horasLiquidacionMaximo
  ) {
    errores.horasLiquidacion = "fuera_de_rango";
  }

  return errores;
};

/**
 * Deja los datos como se guardan: sin espacios sobrantes y con las fechas en
 * ISO-8601 UTC canonico (R-04).
 *
 * Normalizar **despues** de validar seria al reves: `revisarDatosConvocatoria`
 * ya recorta antes de medir, asi que una descripcion de puros espacios cuenta
 * como vacia y no como valida de longitud tres.
 */
export const normalizarDatosConvocatoria = (
  datos: DatosConvocatoria,
): DatosConvocatoria => {
  const enIso = (crudo: string): string => {
    const instante = desdeIso(crudo);
    return instante ? instante.toISOString() : crudo;
  };

  return {
    tipo: datos.tipo,
    descripcionParticipacion: datos.descripcionParticipacion.trim(),
    publicadaEn: enIso(datos.publicadaEn),
    inicioVenta: enIso(datos.inicioVenta),
    finVenta: enIso(datos.finVenta),
    horasLiquidacion: datos.horasLiquidacion,
  };
};

export type RevisionDeConvocatoria =
  | { ok: true; datos: DatosConvocatoria }
  | { ok: false; errores: ErroresDeConvocatoria };

export const validarDatosConvocatoria = (
  datos: DatosConvocatoria,
): RevisionDeConvocatoria => {
  const errores = revisarDatosConvocatoria(datos);
  if (Object.keys(errores).length > 0) return { ok: false, errores };
  return { ok: true, datos: normalizarDatosConvocatoria(datos) };
};

/**
 * Precondiciones para mandar una convocatoria a aprobacion (proyecto.md 5.1).
 *
 * Es una comprobacion **aparte** de la de edicion porque exige algo que los
 * datos del formulario no contienen: que haya al menos un lote. Una
 * convocatoria vacia se puede guardar como borrador y seguir armandose; lo que
 * no se puede es mandarla a que alguien la apruebe.
 */
export const revisarEnvioAAprobacion = (entrada: {
  datos: DatosConvocatoria;
  cantidadDeLotes: number;
}): ErroresDeConvocatoria => {
  const errores = revisarDatosConvocatoria(entrada.datos);
  if (entrada.cantidadDeLotes <= 0) errores.lotes = "sin_lotes";
  return errores;
};
