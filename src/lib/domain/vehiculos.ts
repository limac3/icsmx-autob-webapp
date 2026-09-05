// Validacion y normalizacion de los datos de un vehiculo.
//
// Puro y sin I/O: es lo que permite probar cada frontera sin base de datos y sin
// reloj del sistema. Fuente: `proyecto.md` 4.1 (atributos) y `api-contracts.md`
// seccion 2 (validaciones exigidas).
//
// Devuelve **todos** los errores de una vez y no el primero. Un formulario que
// corrige un campo, reenvia y descubre el siguiente error es un formulario que
// se abandona; y la accion del servidor tiene la misma informacion que la
// pantalla, asi que no hay razon para dosificarla.

import { diaDeNegocio } from "./fechas";
import type { DatosVehiculo } from "@/types/vehiculo";
import { exito, fallo, type Resultado } from "@/types/resultado";

/**
 * Lo mismo, ya recortado, con los opcionales vacios convertidos en ausentes.
 *
 * Es un tipo distinto a proposito: que el compilador distinga "lo que llego" de
 * "lo que se puede escribir" impide que un servicio persista sin normalizar.
 */
export type DatosVehiculoNormalizados = DatosVehiculo;

/**
 * Limites de longitud y rango.
 *
 * `api-contracts.md` fija tres: `modelo` entre 1950 y el anio siguiente al
 * actual, `kilometraje >= 0`, y `marca` y `version` no vacias. Los demas son
 * cotas de tamano, no reglas de negocio: acotan el item de DynamoDB —cuyo limite
 * duro son 400 KB— y evitan que un pegado accidental llene la pantalla.
 */
export const LIMITES = {
  marca: 60,
  version: 80,
  nivelEquipamiento: 80,
  especificacionMecanica: 500,
  condicionesMecanicas: 1_000,
  detallesEsteticos: 1_000,
  modeloMinimo: 1950,
  /**
   * Cota superior de kilometraje. No la pide el contrato; sin ella, un cero de
   * mas pasaria y quedaria publicado. Un vehiculo de flotilla por encima de
   * dos millones de kilometros es un error de captura, no un caso real.
   */
  kilometrajeMaximo: 2_000_000,
} as const;

/**
 * Motivos de rechazo. Son claves de diccionario, no texto: la interfaz nunca
 * muestra un codigo crudo (regla 11).
 */
export const MOTIVOS_INVALIDEZ = [
  "requerido",
  "muy_largo",
  "no_es_entero",
  "fuera_de_rango",
] as const;

export type MotivoInvalidez = (typeof MOTIVOS_INVALIDEZ)[number];

/** Campo -> motivo. Vacio significa que los datos son validos. */
export type ErroresDeVehiculo = Partial<
  Record<keyof DatosVehiculo, MotivoInvalidez>
>;

const CAMPOS_OPCIONALES = [
  "nivelEquipamiento",
  "especificacionMecanica",
  "condicionesMecanicas",
  "detallesEsteticos",
] as const;

/** Anio del modelo mas nuevo aceptable: el siguiente al actual en hora de Mexico. */
export const modeloMaximo = (ahora: Date): number =>
  Number(diaDeNegocio(ahora).slice(0, 4)) + 1;

const textoObligatorio = (
  valor: string,
  limite: number,
): MotivoInvalidez | undefined => {
  const recortado = valor.trim();
  if (recortado.length === 0) return "requerido";
  if (recortado.length > limite) return "muy_largo";
  return undefined;
};

/**
 * Revisa los datos y describe **todo** lo que esta mal.
 *
 * `ahora` se inyecta porque el limite superior de `modelo` depende del anio en
 * curso: sin inyectarlo, la prueba de esa frontera caducaria cada 1 de enero.
 */
export const revisarDatosVehiculo = (
  datos: DatosVehiculo,
  ahora: Date,
): ErroresDeVehiculo => {
  const errores: ErroresDeVehiculo = {};

  const marca = textoObligatorio(datos.marca, LIMITES.marca);
  if (marca) errores.marca = marca;

  const version = textoObligatorio(datos.version, LIMITES.version);
  if (version) errores.version = version;

  if (!Number.isInteger(datos.modelo)) {
    errores.modelo = "no_es_entero";
  } else if (
    datos.modelo < LIMITES.modeloMinimo ||
    datos.modelo > modeloMaximo(ahora)
  ) {
    errores.modelo = "fuera_de_rango";
  }

  if (!Number.isInteger(datos.kilometraje)) {
    errores.kilometraje = "no_es_entero";
  } else if (
    datos.kilometraje < 0 ||
    datos.kilometraje > LIMITES.kilometrajeMaximo
  ) {
    errores.kilometraje = "fuera_de_rango";
  }

  for (const campo of CAMPOS_OPCIONALES) {
    const valor = datos[campo];
    if (valor !== undefined && valor.trim().length > LIMITES[campo]) {
      errores[campo] = "muy_largo";
    }
  }

  return errores;
};

/**
 * Recorta y descarta los opcionales vacios.
 *
 * Un opcional en blanco se convierte en **ausente** y no en cadena vacia: el
 * cliente de DynamoDB descarta los `undefined`, asi que el atributo no se
 * escribe, y una lectura posterior distingue "no se capturo" de "se capturo
 * vacio" sin tener que adivinar.
 */
export const normalizarDatosVehiculo = (
  datos: DatosVehiculo,
): DatosVehiculoNormalizados => {
  const opcional = (valor: string | undefined): string | undefined => {
    const recortado = valor?.trim();
    return recortado ? recortado : undefined;
  };

  return {
    marca: datos.marca.trim(),
    version: datos.version.trim(),
    modelo: datos.modelo,
    kilometraje: datos.kilometraje,
    nivelEquipamiento: opcional(datos.nivelEquipamiento),
    especificacionMecanica: opcional(datos.especificacionMecanica),
    condicionesMecanicas: opcional(datos.condicionesMecanicas),
    detallesEsteticos: opcional(datos.detallesEsteticos),
  };
};

/**
 * Valida y normaliza en un solo paso, en la forma de retorno de la estrategia.
 *
 * Los servicios llaman a esta y no a las dos anteriores: asi es imposible
 * persistir datos validados pero sin normalizar, o normalizados pero sin
 * validar.
 */
export const validarDatosVehiculo = (
  datos: DatosVehiculo,
  ahora: Date,
): Resultado<DatosVehiculoNormalizados> => {
  const errores = revisarDatosVehiculo(datos, ahora);
  const campos = Object.keys(errores);
  if (campos.length > 0) {
    return fallo("validation_failed", errores as Record<string, string>);
  }
  return exito(normalizarDatosVehiculo(datos));
};
