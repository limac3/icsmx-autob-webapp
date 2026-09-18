import "server-only";

// Escritura y borrado de objetos en S3.
//
// La aplicacion **nunca** habla con S3 desde el navegador
// (`arquitectura-tecnica-aws.md` 1): el archivo llega a la Server Action y de
// ahi al bucket. No hay URL prefirmada de subida, y no es un descuido — con una
// prefirmada el cliente elegiria la clave del objeto, y la regla que impide que
// el cliente elija cualquier cosa es la misma que impide que elija su turno.

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { LIMITES } from "@/lib/domain/vehiculos";
import type { NombreDeVariante } from "@/types/vehiculo";

/**
 * Maximo por fotografia, segun `api-contracts.md` seccion 2.
 *
 * **Derivado del dominio, no escrito aqui otra vez.** Este modulo es
 * `server-only` y el mismo tope lo necesita tambien el navegador, donde acota la
 * suma de una tanda de subida multiple; con dos literales, bajar uno y olvidar
 * el otro dejaria la pantalla aceptando lo que el servidor rechaza.
 *
 * Por lo mismo, **la lista blanca de tipos de imagen tampoco vive aqui**: esta
 * en `src/lib/domain/vehiculos.ts` (`TIPOS_DE_IMAGEN`), porque la pantalla la
 * necesita para marcar un archivo no admitido antes de subir nada. Lo que si se
 * queda es `TIPOS_DE_COMPROBANTE`, mas abajo: un comprobante no se elige nunca
 * desde esta galeria y solo lo valida el servidor.
 *
 * Nunca se usa el nombre del archivo que manda el cliente: un `.jpg` en el
 * nombre no dice nada del contenido, y un nombre con `../` o con `#` podria
 * fabricar una clave que no le corresponde. Lo que el contenido es de verdad lo
 * dice `normalizarImagen`, comparando contra el tipo declarado.
 */
export const MAXIMO_BYTES_FOTOGRAFIA = LIMITES.bytesDeFotografia;

let memo: S3Client | undefined;

/**
 * Cliente diferido, igual que el de DynamoDB: `next build` evalua los modulos
 * al recolectar rutas, y la compuerta tiene que correr en una maquina sin AWS.
 */
export const obtenerClienteS3 = (): S3Client => {
  memo ??= new S3Client({});
  return memo;
};

export const nombreDeBucket = (): string => {
  const nombre = process.env.AUTOB_MEDIA_BUCKET;
  if (!nombre) {
    throw new Error(
      "Falta AUTOB_MEDIA_BUCKET. Lo crea `npx ampx sandbox`; ver .env.local.example",
    );
  }
  return nombre;
};

export type DepsDeAlmacenamiento = { cliente?: S3Client };

/**
 * Clave de una variante de fotografia. **La construye el servidor, siempre.**
 *
 * `vehiculos/<vehiculoId>/<fotoId>-<variante>.webp`, con los dos
 * identificadores generados aqui: no interviene el nombre del archivo original,
 * y ahora tampoco el tipo declarado por el cliente — la extension la decide el
 * formato de salida, que es siempre WebP.
 *
 * **El sufijo es el nombre de la variante, no su ancho.** Con el ancho en la
 * clave, una fotografia chica —que no se agranda— produciria `-400.webp` en vez
 * de `-min.webp`, y la clave dejaria de ser deducible desde el nombre de la
 * variante. Eso complica el borrado, que tiene que alcanzar las tres.
 */
export const claveDeFotografia = (
  vehiculoId: string,
  fotoId: string,
  variante: NombreDeVariante,
): string => `vehiculos/${vehiculoId}/${fotoId}-${variante}.webp`;

/**
 * Cache para un objeto que **nunca** se sobrescribe.
 *
 * Las fotografias son inmutables por construccion: su clave lleva el `fotoId`
 * que genero el servidor y la variante, y editar una fotografia no existe — se
 * borra y se sube otra, con identificador nuevo. Eso es lo que hace correcto
 * `immutable`, y es tambien lo que sostiene la cubeta de `cloudfrontSigner.ts`:
 * dentro de su ventana la URL es identica, asi que el navegador puede reusar lo
 * que ya tiene.
 *
 * **No vale para un comprobante de pago**, y por eso esto es un parametro y no
 * una constante enterrada en `guardarObjeto`: los comprobantes comparten esta
 * funcion y no deben salir con cache publica.
 */
export const CACHE_DE_FOTOGRAFIA = "public, max-age=31536000, immutable";

export const guardarObjeto = async (
  entrada: {
    clave: string;
    cuerpo: Uint8Array;
    contentType: string;
    cacheControl?: string;
  },
  deps: DepsDeAlmacenamiento = {},
): Promise<void> => {
  await (deps.cliente ?? obtenerClienteS3()).send(
    new PutObjectCommand({
      Bucket: nombreDeBucket(),
      Key: entrada.clave,
      Body: entrada.cuerpo,
      ContentType: entrada.contentType,
      CacheControl: entrada.cacheControl,
    }),
  );
};

/**
 * Borra un objeto. Idempotente por parte de S3: borrar lo que no existe es
 * exito, que es justo lo que necesita una compensacion.
 */
export const borrarObjeto = async (
  clave: string,
  deps: DepsDeAlmacenamiento = {},
): Promise<void> => {
  await (deps.cliente ?? obtenerClienteS3()).send(
    new DeleteObjectCommand({ Bucket: nombreDeBucket(), Key: clave }),
  );
};

/**
 * Borra varias claves, en serie y sin abortar al primer fallo.
 *
 * Existe porque una fotografia son **tres** objetos desde que se normaliza, y
 * los dos sitios que borran —la compensacion de una subida a medias y el
 * borrado de una fotografia— tienen que alcanzar los tres. Devuelve las claves
 * que no se pudieron borrar, para que quien llama decida si eso le importa: en
 * una compensacion no le importa —un objeto huerfano es invisible, nadie firmara
 * su URL— pero callarlo del todo impediria registrarlo.
 */
export const borrarObjetos = async (
  claves: readonly string[],
  deps: DepsDeAlmacenamiento = {},
): Promise<readonly string[]> => {
  const fallidas: string[] = [];
  for (const clave of claves) {
    try {
      await borrarObjeto(clave, deps);
    } catch {
      fallidas.push(clave);
    }
  }
  return fallidas;
};

/**
 * Tipos admitidos para un comprobante de pago — `api-contracts.md` seccion 5.
 *
 * Distinto del catalogo de fotografias: un comprobante puede ser un PDF, y una
 * fotografia de vehiculo nunca lo es.
 */
export const TIPOS_DE_COMPROBANTE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
} as const;

export type TipoDeComprobante = keyof typeof TIPOS_DE_COMPROBANTE;

/** Maximo por comprobante, segun `api-contracts.md` seccion 5. */
export const MAXIMO_BYTES_COMPROBANTE = 10 * 1024 * 1024;

export const esTipoDeComprobante = (tipo: string): tipo is TipoDeComprobante =>
  Object.hasOwn(TIPOS_DE_COMPROBANTE, tipo);

/**
 * Clave de un comprobante. **La construye el servidor**, igual que
 * `claveDeFotografia` y por la misma razon.
 *
 * Vive bajo `comprobantes/`, un prefijo distinto de `vehiculos/` a proposito:
 * la distribucion de CloudFront tiene `originPath: /vehiculos`
 * (`cloudfrontSigner.ts`), asi que un comprobante es **estructuralmente**
 * inalcanzable por ahi. Solo lo entrega el Route Handler de descarga, que
 * verifica permiso y audita el acceso (`arquitectura-tecnica-aws.md` 2.3).
 */
export const claveDeComprobante = (
  solicitudId: string,
  archivoId: string,
  tipo: TipoDeComprobante,
): string =>
  `comprobantes/${solicitudId}/${archivoId}.${TIPOS_DE_COMPROBANTE[tipo]}`;

export const __test__ = {
  reiniciar: (): void => {
    memo = undefined;
  },
};
