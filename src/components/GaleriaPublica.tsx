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
    <MediaThumbnailGallery title={titulo} description="">
      {fotografias.map((foto) => (
        <GalleryImageItem
          key={foto.fotoId}
          src={foto.url}
          alt={foto.descripcion ?? titulo}
        />
      ))}
    </MediaThumbnailGallery>
  );
};

export default GaleriaPublica;
