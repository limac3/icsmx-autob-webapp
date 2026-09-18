import "server-only";

// Normalizacion de una fotografia de vehiculo: una imagen de entrada se
// convierte en las tres variantes WebP que las pantallas consumen.
//
// **Por que en la subida y no al leer.** Antes se guardaba el byte original sin
// tocarlo y **todas** las superficies pedian la misma URL: la tira de miniaturas
// de la galeria publica mide 100x100 px y descargaba la fotografia completa. Con
// `MAXIMO_FOTOGRAFIAS = 20` por vehiculo, el detalle de un lote podia bajar mas
// de 100 MB. Normalizar una vez en la subida cuesta segundos de CPU una sola
// vez; no normalizar los cobra en cada visita de cada comprador.
//
// **Por que WebP y no AVIF**, que comprime mejor: medido sobre la misma foto de
// 12 MP, WebP tarda ~385 ms por variante y AVIF ~8 650 ms. Catorce veces el CPU
// por alrededor de un 10 % menos de bytes, dentro de una Server Action que
// alguien esta esperando. WebP ademas tiene soporte universal desde 2020.
//
// **El original no se conserva.** La fotografia no es editable —se borra, no se
// reemplaza—, asi que las claves de S3 son estables y los objetos pueden
// servirse como inmutables (`CACHE_DE_FOTOGRAFIA` en `almacenamiento.ts`).

import sharp from "sharp";

import {
  ANCHOS_DE_VARIANTE,
  NOMBRES_DE_VARIANTE,
  type NombreDeVariante,
} from "@/types/vehiculo";
import { esTipoDeImagen, type TipoDeImagen } from "@/lib/domain/vehiculos";

// Los anchos viven en `@/types/vehiculo` y no aqui: este modulo importa `sharp`,
// y quien consume `Fotografia` incluye componentes de cliente.
//
// No hay una cuarta variante de 3072: en un monitor 4K el visor ampliado queda
// ligeramente suave, y a cambio costaria ~1 MB y ~1 s de codificacion por
// fotografia. Si algun dia hace falta el detalle real —un raspon, el numero de
// serie— eso pide una variante bajo demanda, no subirle el tope a todas.

/** El contentType de toda variante. La salida siempre es WebP. */
export const CONTENT_TYPE_DE_VARIANTE = "image/webp";

/**
 * Tope de pixeles de entrada.
 *
 * `MAXIMO_BYTES_FOTOGRAFIA` acota los **bytes**, que no es lo mismo: un WebP o
 * un PNG de pocos megabytes puede declarar dimensiones enormes y volverse una
 * bomba de descompresion al decodificarse. El valor por omision de sharp
 * (~268 MP) es demasiado laxo para esto; 80 MP cubre cualquier camara real con
 * holgura —una de 100 MP no existe en un telefono de flotilla— y acota la
 * memoria del proceso SSR.
 */
export const MAXIMO_PIXELES_ENTRADA = 80_000_000;

/** Calidad de la codificacion WebP. */
const CALIDAD_WEBP = 78;

/**
 * En un Lambda de uno o dos vCPU, dejar que libvips abra un hilo por nucleo
 * detectado solo agrega contencion, y su cache es memoria muerta en un proceso
 * que procesa una imagen y termina. Se fija al cargar el modulo, una vez.
 */
sharp.concurrency(1);
sharp.cache(false);

export type VarianteNormalizada = {
  nombre: NombreDeVariante;
  cuerpo: Uint8Array;
  ancho: number;
  alto: number;
  bytes: number;
};

export type MotivoDeRechazo = "no_decodificable" | "tipo_no_coincide";

export type ImagenNormalizada = {
  /** Las tres, siempre, y en orden ascendente de ancho. */
  variantes: readonly VarianteNormalizada[];
  /** Lo que sharp detecto de verdad, no lo que declaro el navegador. */
  formatoDetectado: string;
};

export type ResultadoDeNormalizacion =
  | { ok: true; imagen: ImagenNormalizada }
  | { ok: false; motivo: MotivoDeRechazo };

/**
 * Formato que sharp reporta, por cada tipo declarado que se admite.
 *
 * **`image/avif` se detecta como `"heif"`, no como `"avif"`.** AVIF es un
 * archivo HEIF con carga AV1, y libvips lo carga con el mismo lector, asi que
 * `metadata().format` devuelve el nombre del contenedor. Escribir `"avif"` aqui
 * rechazaria **todos** los AVIF con `tipo_no_coincide`, que es un mensaje que
 * manda a buscar el defecto exactamente al lado contrario.
 *
 * Consecuencia que conviene tener presente: por formato detectado, un AVIF y un
 * HEIC son **indistinguibles**, asi que para `image/avif` esta comprobacion
 * pierde filo. No abre un hueco — un HEIC de verdad no tiene decodificador HEVC
 * en esta libvips y muere antes, en `no_decodificable`— pero el motivo que
 * llega no sera el mas preciso.
 */
const FORMATO_ESPERADO: Record<TipoDeImagen, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "heif",
};

/**
 * Convierte una imagen de entrada en sus tres variantes WebP.
 *
 * Pura respecto al mundo: no toca S3 ni DynamoDB. Eso es deliberado y es lo que
 * hace que el fallo mas probable —que el archivo no sea una imagen— no requiera
 * compensar nada, porque ocurre antes de escribir el primer objeto.
 */
export const normalizarImagen = async (entrada: {
  bytes: Uint8Array;
  contentType: string;
}): Promise<ResultadoDeNormalizacion> => {
  const origen = sharp(entrada.bytes, {
    limitInputPixels: MAXIMO_PIXELES_ENTRADA,
    // El valor por omision es `"warning"`, que rechaza JPEG truncados —cosa
    // corriente en una foto pasada por mensajeria— que se decodifican
    // perfectamente. `"error"` solo aborta cuando la imagen de verdad no se
    // puede leer.
    failOn: "error",
  });

  let metadatos;
  try {
    metadatos = await origen.metadata();
  } catch {
    return { ok: false, motivo: "no_decodificable" };
  }

  /**
   * **Aqui deja de importar lo que dijo el navegador.** El `contentType` llega
   * de `File.type`, o sea del cliente: un archivo renombrado, un navegador que
   * manda `application/octet-stream` o algo que no es un navegador pasan o
   * fallan la lista blanca por razones equivocadas. `metadata().format` dice
   * que es en realidad.
   *
   * Se **compara** en vez de confiar solo en lo detectado: un PNG declarado
   * como JPEG no es peligroso, pero es senal de que algo esta mal en el camino
   * y callarlo esconderia el defecto.
   */
  if (
    !esTipoDeImagen(entrada.contentType) ||
    metadatos.format !== FORMATO_ESPERADO[entrada.contentType]
  ) {
    return { ok: false, motivo: "tipo_no_coincide" };
  }

  const variantes: VarianteNormalizada[] = [];

  // En serie y desde el origen, las dos cosas a proposito.
  //
  // En serie porque en paralelo el pico de memoria se triplica —una imagen
  // descomprimida de 12 MP son ~48 MB— y los hilos se pelean, a cambio de unos
  // 300 ms.
  //
  // Desde el origen y no en cascada (2048 -> 1280 -> 480) porque la cascada no
  // es mas rapida: libvips usa el `shrink-on-load` del decodificador JPEG, asi
  // que pedir 480 px desde un JPEG de 4032 no decodifica los 12 MP. En cascada
  // se pierde ese atajo y ademas se apilan perdidas de recompresion.
  for (const nombre of NOMBRES_DE_VARIANTE) {
    const salida = await origen
      .clone()
      // `rotate()` sin argumento hornea la orientacion del EXIF en los pixeles.
      // Sin esto, una foto vertical de telefono sale acostada en cuanto se
      // descarta el metadato — y se descarta, porque la codificacion no copia
      // el EXIF. Eso ademas **deja de publicar las coordenadas GPS** del patio
      // donde se tomo la fotografia, que hoy viajaban en el archivo original.
      .rotate()
      .resize({
        width: ANCHOS_DE_VARIANTE[nombre],
        // Sin `height` ni `fit`: se conserva la relacion de aspecto original y
        // el recorte a 4:3 lo hace el navegador con `object-fit: cover`.
        // Recortar en el servidor mutilaria el visor ampliado, que muestra la
        // fotografia completa.
        withoutEnlargement: true,
      })
      .webp({ quality: CALIDAD_WEBP })
      .toBuffer({ resolveWithObject: true });

    variantes.push({
      nombre,
      cuerpo: salida.data,
      // El ancho **real**, no el pedido: con `withoutEnlargement`, un original
      // de 600 px produce tres variantes de 600. Guardar la constante en vez de
      // la medida dejaria a las vistas emitiendo un `width` que miente.
      ancho: salida.info.width,
      alto: salida.info.height,
      bytes: salida.info.size,
    });
  }

  return {
    ok: true,
    imagen: { variantes, formatoDetectado: metadatos.format },
  };
};

export type Normalizador = typeof normalizarImagen;
