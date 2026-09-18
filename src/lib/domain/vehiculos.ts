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
import {
  normalizarIdentificadorDeNegocio,
  prepararIdentificadorDeNegocio,
} from "./identificadorDeNegocio";
import {
  NOMBRES_DE_VARIANTE,
  type DatosVehiculo,
  type Fotografia,
} from "@/types/vehiculo";
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
  /**
   * Pie de una fotografia de la galeria.
   *
   * **A diferencia de los demas, este no es una cota de tamano: es de
   * presentacion.** El pie se pinta debajo de una miniatura de 100 x 100 px en
   * la galeria publica y hace tambien de texto alternativo. Con los 200
   * caracteres que tenia, un pie ocupaba cinco o seis renglones y media mas que
   * la propia fotografia; 120 dan para una frase completa con detalle sin
   * convertir la tira en un parrafo, y son una longitud sana como alternativa
   * para un lector de pantalla.
   *
   * Vive aqui y no en `agregarFotografia` porque desde que la descripcion se
   * puede editar lo consumen dos servicios y la interfaz.
   */
  descripcionFotografia: 120,
  /**
   * Bytes de una fotografia, y **tambien** de una tanda completa.
   *
   * Es el mismo numero con dos lecturas. En el servidor acota **cada archivo**,
   * que es la frontera real: `agregarFotografia` recibe uno por llamada y lo
   * rechaza con `muy_grande`. En la pantalla acota la **suma de lo elegido**,
   * porque la subida multiple manda una peticion por fotografia y sin un tope
   * agregado nada impediria arrastrar cuarenta imagenes de 9 MB.
   *
   * Vive aqui y no solo en `src/lib/media/almacenamiento.ts` porque ese modulo
   * es `server-only` y el tope lo necesita ahora tambien el navegador. La
   * constante de alla se deriva de esta, para que no puedan separarse.
   *
   * **No confundir con `bodySizeLimit` de `next.config.ts`**, que son 11 MB: el
   * margen de 1 MB cubre las fronteras de `multipart/form-data` y existe para
   * que un archivo pasado de tamano llegue al servidor y lo rechace la
   * validacion del dominio, en vez de morir en el framework sin explicacion.
   * `next.config.test.ts` ata los dos numeros.
   */
  bytesDeFotografia: 10 * 1024 * 1024,
  /**
   * Fotografias por vehiculo.
   *
   * Aqui por lo mismo que `bytesDeFotografia`: desde que se pueden subir varias
   * de un tiro, la pantalla tiene que poder decir "con estas te pasas del
   * maximo" **antes** de empezar, en vez de subir las primeras y que la
   * vigesimoprimera falle a mitad de la tanda.
   */
  fotografiasPorVehiculo: 20,
} as const;

/**
 * Formatos que se admiten al subir una fotografia.
 *
 * **Es una lista blanca, y por eso importa lo que *no* esta.** `image/svg+xml`
 * quedaria fuera aunque librsvg viva dentro de libvips y por tanto un SVG si
 * decodificaria: un SVG es un documento con script, no una fotografia. Lo que
 * entra aqui se decodifica, se recomprime a WebP y el original se descarta
 * (`estrategia-aplicacion.md` 5.4), asi que la lista describe **entradas**, no
 * lo que se guarda.
 *
 * **`image/avif` se agrego despues**, cuando un operador subio uno en una tanda
 * y se llevo un rechazo que no explicaba nada. No era una limitacion tecnica:
 * sharp lo decodifica aqui sin problema —comprobado ejecutandolo— y sale por el
 * mismo camino que los demas. Estaba fuera porque nadie lo habia pedido.
 * `image/heic` sigue fuera, y eso si es una limitacion: libvips trae libheif
 * pero sin un decodificador HEVC (`api-contracts.md` seccion 2).
 *
 * **Vive en el dominio y no en `src/lib/media/almacenamiento.ts`**, que es
 * `server-only`: la pantalla necesita la misma lista para marcar un archivo no
 * admitido **antes** de empezar a subir la tanda. Con dos copias, agregar un
 * formato en un lado y olvidarlo en el otro dejaria la pantalla rechazando lo
 * que el servidor acepta, o al reves.
 */
export const TIPOS_DE_IMAGEN = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
} as const;

export type TipoDeImagen = keyof typeof TIPOS_DE_IMAGEN;

export const esTipoDeImagen = (tipo: string): tipo is TipoDeImagen =>
  Object.hasOwn(TIPOS_DE_IMAGEN, tipo);

/** Para el `accept` del selector de archivos, derivado de la lista blanca. */
export const ACEPTA_IMAGENES = Object.keys(TIPOS_DE_IMAGEN).join(",");

/**
 * Motivos de rechazo. Son claves de diccionario, no texto: la interfaz nunca
 * muestra un codigo crudo (regla 11).
 */
export const MOTIVOS_INVALIDEZ = [
  "requerido",
  "muy_largo",
  "no_es_entero",
  "fuera_de_rango",
  // Del numero economico y del numero de serie: su alfabeto es lista blanca,
  // porque el valor entra en la clave de su centinela de unicidad.
  "caracter_no_permitido",
  /**
   * Tambien de los dos numeros, y el unico motivo que **`revisarDatosVehiculo`
   * nunca devuelve**: la unicidad no se puede decidir sin la base de datos, y
   * quien la decide es el centinela dentro de la transaccion.
   *
   * Aun asi vive en esta lista porque llega a la pantalla por el mismo camino
   * —campo -> motivo -> diccionario— y es la lista que la prueba de
   * diccionarios recorre para exigir etiqueta en los dos idiomas. Fuera de
   * aqui, un `duplicado` sin traducir se mostraria crudo (regla 11) y ninguna
   * compuerta lo detendria.
   */
  "duplicado",
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

  // Los dos identificadores de negocio se revisan **sobre su forma
  // normalizada**, que es lo que se va a guardar y lo que va a colisionar en el
  // centinela. Revisar el texto crudo daria un veredicto sobre otro valor.
  const numeroEconomico = prepararIdentificadorDeNegocio(datos.numeroEconomico);
  if (!numeroEconomico.ok) errores.numeroEconomico = numeroEconomico.motivo;

  const numeroDeSerie = prepararIdentificadorDeNegocio(datos.numeroDeSerie);
  if (!numeroDeSerie.ok) errores.numeroDeSerie = numeroDeSerie.motivo;

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
    // Mayusculas y recortados: es lo que hace real la unicidad, porque
    // `"ab-1"` y `"AB-1"` tienen que colisionar en el centinela.
    numeroEconomico: normalizarIdentificadorDeNegocio(datos.numeroEconomico),
    numeroDeSerie: normalizarIdentificadorDeNegocio(datos.numeroDeSerie),
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

/**
 * Como se nombra un vehiculo en una lista o un enlace: marca, version y
 * modelo. Nunca el `vehiculoId` interno, que no dice nada a quien administra.
 */
export const rotuloVehiculo = (
  vehiculo: Pick<DatosVehiculo, "marca" | "version" | "modelo">,
): string => `${vehiculo.marca} ${vehiculo.version} ${String(vehiculo.modelo)}`;

/**
 * Las claves de S3 de una fotografia: **las tres**, del mas chico al mas grande.
 *
 * Una fotografia es un item de DynamoDB y tres objetos de S3. Los dos sitios
 * que borran —la compensacion de una subida a medias y la baja de una
 * fotografia— tienen que alcanzar los tres, y derivarlas en cada uno invitaba a
 * que uno se quedara borrando solo `claveS3` y dejando dos huerfanos para
 * siempre en un bucket sin reglas de ciclo de vida.
 *
 * Se leen del item y no se reconstruyen desde el `fotoId`: si algun dia cambia
 * el formato de la clave, lo escrito sigue siendo la verdad.
 */
export const clavesDeLaFotografia = (
  foto: Pick<Fotografia, "variantes">,
): readonly string[] =>
  NOMBRES_DE_VARIANTE.map((nombre) => foto.variantes[nombre].claveS3);
