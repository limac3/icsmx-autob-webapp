import type { FuentesDeImagen } from "@/types/media";
import {
  ANCHOS_DE_VARIANTE,
  NOMBRES_DE_VARIANTE,
  type Fotografia,
  type NombreDeVariante,
} from "@/types/vehiculo";

/**
 * Fotografia de galeria para las pruebas de los servicios de vehiculo.
 *
 * Existe porque el mismo constructor estaba copiado palabra por palabra en los
 * cuatro archivos de prueba de la galeria, mas el de las actions. Con
 * `variantes` obligatorio cada copia habria tenido que crecer con el mismo mapa
 * de tres entradas, que es la clase de duplicacion que despues deriva: basta que
 * alguien ajuste un ancho en una copia para que dos pruebas dejen de hablar del
 * mismo dato.
 *
 * Las claves siguen el formato que produce `claveDeFotografia`, para que una
 * prueba que las compare contra la salida real del servicio no pase por
 * casualidad.
 */
export const fotografiaDePrueba = (
  fotoId: string,
  orden: number,
  vehiculoId = "V1",
): Fotografia => ({
  fotoId,
  vehiculoId,
  orden,
  claveS3: `vehiculos/${vehiculoId}/${fotoId}-max.webp`,
  contentType: "image/webp",
  bytes: 1000,
  variantes: Object.fromEntries(
    NOMBRES_DE_VARIANTE.map((nombre) => [
      nombre,
      {
        claveS3: `vehiculos/${vehiculoId}/${fotoId}-${nombre}.webp`,
        ancho: ANCHOS_DE_VARIANTE[nombre],
        // Relacion 4:3, la de una camara de telefono.
        alto: Math.round((ANCHOS_DE_VARIANTE[nombre] * 3) / 4),
        bytes: ANCHOS_DE_VARIANTE[nombre],
      },
    ]),
  ) as Fotografia["variantes"],
  subidaEn: "2026-01-10T10:00:00.000Z",
  subidaPor: "P0",
});

/** Las tres claves de S3 de una fotografia, del mas chico al mas grande. */
export const clavesDePrueba = (
  fotoId: string,
  vehiculoId = "V1",
): readonly string[] =>
  NOMBRES_DE_VARIANTE.map(
    (nombre) => `vehiculos/${vehiculoId}/${fotoId}-${nombre}.webp`,
  );

/**
 * Fuentes ya firmadas, como las que un componente recibe del servidor.
 *
 * `variantes` acota cuantas candidatas trae; con una sola **no** se emite
 * `srcSet`, igual que hace `fuentesDeImagen`, porque un `srcSet` de una entrada
 * le quita el `alt` a la miniatura de Eden.
 */
export const fuentesDePrueba = (
  fotoId: string,
  variantes = 3,
): FuentesDeImagen => {
  const incluidas = NOMBRES_DE_VARIANTE.slice(0, variantes);
  const url = (nombre: NombreDeVariante) =>
    `https://cdn/${fotoId}-${nombre}.webp?firma`;
  const mayor = incluidas.at(-1) ?? "min";

  return {
    src: url(incluidas[0] ?? "min"),
    ...(incluidas.length > 1
      ? {
          srcSet: incluidas
            .map(
              (nombre) =>
                `${url(nombre)} ${String(ANCHOS_DE_VARIANTE[nombre])}w`,
            )
            .join(", "),
        }
      : {}),
    ancho: ANCHOS_DE_VARIANTE[mayor],
    alto: Math.round((ANCHOS_DE_VARIANTE[mayor] * 3) / 4),
  };
};
