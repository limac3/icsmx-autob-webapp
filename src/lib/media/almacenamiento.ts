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

/**
 * Tipos de imagen admitidos y su extension canonica.
 *
 * La extension la decide **el servidor** a partir del tipo declarado, nunca el
 * nombre del archivo que manda el cliente: un `.jpg` en el nombre no dice nada
 * del contenido, y un nombre con `../` o con `#` podria fabricar una clave que
 * no le corresponde.
 */
export const TIPOS_DE_IMAGEN = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type TipoDeImagen = keyof typeof TIPOS_DE_IMAGEN;

/** Maximo por fotografia, segun `api-contracts.md` seccion 2. */
export const MAXIMO_BYTES_FOTOGRAFIA = 10 * 1024 * 1024;

export const esTipoDeImagen = (tipo: string): tipo is TipoDeImagen =>
  Object.hasOwn(TIPOS_DE_IMAGEN, tipo);

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
 * Clave de una fotografia. **La construye el servidor, siempre.**
 *
 * `vehiculos/<vehiculoId>/<fotoId>.<ext>`, con los dos identificadores
 * generados aqui: no interviene el nombre del archivo original.
 */
export const claveDeFotografia = (
  vehiculoId: string,
  fotoId: string,
  tipo: TipoDeImagen,
): string => `vehiculos/${vehiculoId}/${fotoId}.${TIPOS_DE_IMAGEN[tipo]}`;

export const guardarObjeto = async (
  entrada: {
    clave: string;
    cuerpo: Uint8Array;
    contentType: string;
  },
  deps: DepsDeAlmacenamiento = {},
): Promise<void> => {
  await (deps.cliente ?? obtenerClienteS3()).send(
    new PutObjectCommand({
      Bucket: nombreDeBucket(),
      Key: entrada.clave,
      Body: entrada.cuerpo,
      ContentType: entrada.contentType,
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

export const __test__ = {
  reiniciar: (): void => {
    memo = undefined;
  },
};
