// Reglas puras de la convocatoria. Sin I/O y sin reloj propio: el instante
// entra como argumento (AGENTS.md), para que las pruebas no dependan de la hora
// a la que corren.
//
// Fuente: agent_files/proyecto.md secciones 4.2 y 5.1, y R-14.

import { desdeIso } from "./fechas";
import { revisarHtmlDeDescripcion } from "./htmlDeDescripcion";
import type { DatosConvocatoria } from "@/types/convocatoria";
import {
  MODALIDADES_ADJUDICACION,
  TIPOS_CONVOCATORIA,
} from "@/types/convocatoria";
import {
  normalizarIdentificadorDeNegocio,
  prepararIdentificadorDeNegocio,
} from "./identificadorDeNegocio";

export const LIMITES_CONVOCATORIA = {
  /** Cadena corta de identificacion en pantalla, no un titulo largo. */
  nombre: 80,
  /**
   * La descripcion es HTML del editor enriquecido, asi que el marcado cuenta:
   * 2000 caracteres bastaban para texto plano pero son poco texto con etiquetas.
   */
  descripcionParticipacion: 8000,
  /**
   * Horas de liquidacion. El minimo es 1: con cero, `venceEn` coincidiria con
   * `adjudicadoEn` y la solicitud naceria vencida (R-13). El maximo son 30
   * dias, que no es una regla de negocio sino un tope de cordura para que un
   * cero de mas no deje un lote inmovilizado un ano.
   */
  horasLiquidacionMinimo: 1,
  horasLiquidacionMaximo: 24 * 30,
  /**
   * Cupo de adjudicaciones por participante (R-09) y tope de solicitudes
   * (R-22). Los dos comparten rango porque los dos responden la misma clase de
   * pregunta —"cuantas veces"— y ninguno tiene sentido en cero.
   *
   * **El minimo es 1, y eso es una decision de negocio, no de cordura.** Con
   * cero, ningun participante podria adjudicarse nada y la convocatoria entera
   * seria inutil: se publicaria, se formaria la fila y no se entregaria un solo
   * vehiculo. Quien quiera una convocatoria sin adjudicaciones tiene la
   * herramienta correcta, que es no publicarla.
   *
   * El maximo es un tope de cordura contra un cero de mas al teclear.
   */
  limiteMinimo: 1,
  limiteMaximo: 999,
} as const;

export const MOTIVOS_INVALIDEZ_CONVOCATORIA = [
  "requerido",
  "muy_largo",
  "no_es_entero",
  "fuera_de_rango",
  "fecha_invalida",
  "orden_de_fechas",
  "sin_lotes",
  "etiqueta_no_admitida",
  "enlace_no_admitido",
  // Del folio: su alfabeto es lista blanca, porque el valor entra en la clave
  // de su centinela de unicidad.
  "caracter_no_permitido",
  /**
   * Del folio, y el unico motivo que **`revisarDatosConvocatoria` nunca
   * devuelve**: la unicidad la decide el centinela dentro de la transaccion,
   * no una lectura previa.
   *
   * Esta en la lista porque llega a la pantalla por el mismo camino y porque es
   * la lista que recorre la prueba de diccionarios; fuera de aqui, nada
   * obligaria a traducirlo (regla 11).
   */
  "duplicado",
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

  if (
    !(MODALIDADES_ADJUDICACION as readonly string[]).includes(
      datos.modalidadAdjudicacion,
    )
  ) {
    errores.modalidadAdjudicacion = "requerido";
  }

  // El folio se revisa **sobre su forma normalizada**, que es lo que se va a
  // guardar y lo que va a colisionar en el centinela.
  const folio = prepararIdentificadorDeNegocio(datos.folio);
  if (!folio.ok) errores.folio = folio.motivo;

  const nombre = datos.nombre.trim();
  if (nombre === "") {
    errores.nombre = "requerido";
  } else if (nombre.length > LIMITES_CONVOCATORIA.nombre) {
    errores.nombre = "muy_largo";
  }

  const descripcion = datos.descripcionParticipacion.trim();
  if (descripcion === "") {
    errores.descripcionParticipacion = "requerido";
  } else if (
    descripcion.length > LIMITES_CONVOCATORIA.descripcionParticipacion
  ) {
    errores.descripcionParticipacion = "muy_largo";
  } else {
    // La descripcion viene de un editor enriquecido y la ve todo participante:
    // es el objetivo de XSS almacenado mas valioso de la aplicacion. El editor
    // solo restringe al usuario honesto; la barrera esta aqui. Ver
    // `htmlDeDescripcion.ts` y desafios-implementacion.md seccion 27.
    const motivo = revisarHtmlDeDescripcion(descripcion);
    if (motivo) errores.descripcionParticipacion = motivo;
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

  // Los dos cupos se revisan igual, y es correcto que compartan codigo: lo que
  // los distingue es que uno se recupera y el otro no, y eso no es un asunto de
  // validacion sino del motor.
  for (const campo of CAMPOS_DE_CUPO) {
    const motivo = revisarCupo(datos[campo]);
    if (motivo) errores[campo] = motivo;
  }

  return errores;
};

const CAMPOS_DE_CUPO = ["limiteAdjudicaciones", "limiteSolicitudes"] as const;

/**
 * Un cupo valido es un entero dentro del rango. Se comprueba aparte para que
 * el formulario y la validacion usen exactamente el mismo criterio.
 */
export const revisarCupo = (
  valor: number,
): MotivoInvalidezConvocatoria | undefined => {
  if (!Number.isInteger(valor)) return "no_es_entero";
  if (
    valor < LIMITES_CONVOCATORIA.limiteMinimo ||
    valor > LIMITES_CONVOCATORIA.limiteMaximo
  ) {
    return "fuera_de_rango";
  }
  return undefined;
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
    // Mayusculas y recortado: es lo que hace real la unicidad, porque
    // `"a-1"` y `"A-1"` tienen que colisionar en el centinela.
    folio: normalizarIdentificadorDeNegocio(datos.folio),
    nombre: datos.nombre.trim(),
    tipo: datos.tipo,
    descripcionParticipacion: datos.descripcionParticipacion.trim(),
    publicadaEn: enIso(datos.publicadaEn),
    inicioVenta: enIso(datos.inicioVenta),
    finVenta: enIso(datos.finVenta),
    horasLiquidacion: datos.horasLiquidacion,
    limiteAdjudicaciones: datos.limiteAdjudicaciones,
    limiteSolicitudes: datos.limiteSolicitudes,
    modalidadAdjudicacion: datos.modalidadAdjudicacion,
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
 * Precio de un lote. Entero de pesos, sin centavos: el importe se acuerda en
 * cifras cerradas y guardar decimales invitaria a compararlos con `===`.
 *
 * El maximo no es una regla de negocio sino un tope de cordura —un cero de mas
 * al teclear— que ademas mantiene el valor lejos de `Number.MAX_SAFE_INTEGER`.
 */
export const PRECIO_MAXIMO_LOTE = 99_999_999;

export const revisarPrecio = (
  precio: number,
): MotivoInvalidezConvocatoria | undefined => {
  if (!Number.isInteger(precio)) return "no_es_entero";
  if (precio <= 0 || precio > PRECIO_MAXIMO_LOTE) return "fuera_de_rango";
  return undefined;
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
