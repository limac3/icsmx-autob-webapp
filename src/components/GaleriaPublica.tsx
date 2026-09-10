"use client";

import {
  GalleryImageItem,
  MediaThumbnailGallery,
} from "@churchofjesuschrist/eden-media-thumbnail-gallery";
import { Text2 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";

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
 */

export type FotografiaEnGaleria = {
  fotoId: string;
  url: string;
  descripcion?: string;
};

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
          src={foto.url}
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
