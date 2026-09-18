"use client";

import {
  GalleryImageItem,
  MediaThumbnailGallery,
} from "@churchofjesuschrist/eden-media-thumbnail-gallery";
import { Text2 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import type { FuentesDeImagen } from "@/types/media";

/**
 * Galeria de solo lectura del vehiculo de un lote — pantalla 3.3.
 *
 * **Componente cliente en un solo archivo**, por la misma razon que
 * `CatalogoConvocatorias`: `MediaThumbnailGallery` distingue
 * `GalleryImageItem` de `GalleryVideoItem` por el tipo de sus hijos, y esa
 * identidad no sobrevive la frontera de RSC (`desafios-implementacion.md`
 * 23). Las URLs llegan **ya firmadas desde el servidor** (regla 13) y no se
 * guardan en ningun lado.
 *
 * **Sin `title` de galeria.** `MediaThumbnailGallery` pinta su `title` como un
 * `H3` **debajo** de la tira de miniaturas; con el nombre del vehiculo ahi, la
 * pantalla del lote lo mostraba dos veces seguidas —ese `H3` y el `H1` de
 * identificacion—. El encabezado de la seccion lo pone la pagina.
 *
 * **El pie de cada foto es `title`, no `caption`.** Es contraintuitivo y esta
 * verificado en el codigo del paquete: la galeria lee el `title` de cada hijo y
 * lo pasa como `description` al `Thumbnail`, que lo pinta debajo de la imagen.
 * `caption` solo viaja al visor ampliado (`MediaModal`), asi que por si solo no
 * se ve en la tira.
 *
 * **La galeria si entiende `srcSet`, y eso es lo que hace barata esta pantalla.**
 * Verificado en el codigo del paquete: `MediaThumbnailGallery` lo parsea con
 * `getThumbnailImage`, le da a la tira —100 x 100 px— la primera candidata de
 * mas de 100w, y reenvia el hijo completo al visor ampliado, que elige con
 * `sizes`. Antes la tira descargaba la fotografia original completa para
 * pintarla en un recuadro de 100 px: es el mayor ahorro de la aplicacion.
 *
 * **Y hay una trampa con un solo `srcSet`**: en esa rama `getThumbnailImage`
 * devuelve `{src, size}` **sin `alt`**, la imagen queda `role="presentation"` y
 * el boton que la envuelve se queda sin nombre accesible. `fuentesDeImagen` no
 * emite nunca un `srcSet` de una sola candidata, y la prueba de axe de aqui lo
 * vigila.
 */

export type FotografiaEnGaleria = {
  fotoId: string;
  /** Ya firmadas en el servidor (regla 13); no se guardan en ningun lado. */
  fuentes: FuentesDeImagen;
  descripcion?: string;
};

/**
 * Cuanto ocupa la fotografia en el visor ampliado, que es el unico `<img>` que
 * recibe este `sizes` —la tira usa el `src` que Eden ya eligio—.
 *
 * Leido del paquete, no supuesto: `MediaModal` maqueta con `width: 100vw`,
 * `max-width: 100dvw` y una sola columna (`grid-template-columns: 1fr`), asi
 * que la fotografia puede ocupar el ancho de la ventana. No hay margen lateral
 * reservado que descontar.
 *
 * Si una version futura de `eden-media-modal` estrecha el visor, esto sobra-
 * estima y el navegador baja una variante mas grande de la necesaria: es el
 * error barato de los dos.
 */
const TAMANOS_DEL_VISOR = "100vw";

export type GaleriaPublicaProps = {
  titulo: string;
  fotografias: readonly FotografiaEnGaleria[];
  diccionario: Diccionario;
};

const GaleriaPublica = ({
  titulo,
  fotografias,
  diccionario,
}: GaleriaPublicaProps) => {
  if (fotografias.length === 0) {
    return <Text2 renderAs="p">{diccionario.catalogo.sinFotografias}</Text2>;
  }

  return (
    <MediaThumbnailGallery title="" description="">
      {fotografias.map((foto) => (
        <GalleryImageItem
          key={foto.fotoId}
          src={foto.fuentes.src}
          {...(foto.fuentes.srcSet
            ? { srcSet: foto.fuentes.srcSet, sizes: TAMANOS_DEL_VISOR }
            : {})}
          width={foto.fuentes.ancho}
          height={foto.fuentes.alto}
          // Con pie visible la imagen **no** repite ese texto: axe lo marca
          // como violacion —el lector de pantalla lo anunciaria dos veces— y
          // tiene razon. `alt=""` la deja decorativa y quien anuncia es el pie,
          // que ademas es el nombre accesible del boton que la abre. Sin pie el
          // `alt` es el nombre del vehiculo, porque una imagen sin alternativa
          // si es un defecto.
          alt={foto.descripcion ? "" : titulo}
          {...(foto.descripcion ? { title: foto.descripcion } : {})}
        />
      ))}
    </MediaThumbnailGallery>
  );
};

export default GaleriaPublica;
