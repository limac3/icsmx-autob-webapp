import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RemovalPolicy } from "aws-cdk-lib";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  KeyGroup,
  PriceClass,
  PublicKey,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
} from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

/**
 * Ruta de la llave publica de CloudFront.
 *
 * `CLOUDFRONT_PUBLIC_KEY_PATH` la reubica cuando la llave de un entorno no vive en el
 * repositorio —y es tambien lo que permite sintetizar el backend en una prueba sin
 * versionar material criptografico.
 */
export const rutaLlavePublica = (): string =>
  process.env.CLOUDFRONT_PUBLIC_KEY_PATH ??
  join(
    dirname(fileURLToPath(import.meta.url)),
    "claves",
    "cloudfront-publica.pem",
  );

/**
 * Prefijo servido por CloudFront. Los comprobantes viven en `comprobantes/` y **jamas**
 * se sirven por aqui: se entregan por el Route Handler de descarga, que verifica permiso
 * y audita el acceso (`arquitectura-tecnica-aws.md`, seccion 2.3).
 */
const PREFIJO_PUBLICABLE = "vehiculos";

export const leerLlavePublica = (): string => {
  const ruta = rutaLlavePublica();
  if (!existsSync(ruta)) {
    throw new Error(
      [
        `Falta la llave publica de CloudFront en ${ruta}.`,
        "Sin ella la distribucion quedaria sirviendo las fotografias sin firma.",
        "Generar el par una sola vez y conservar la privada como secreto:",
        "  openssl genrsa -out cloudfront-privada.pem 2048",
        "  openssl rsa -pubout -in cloudfront-privada.pem -out amplify/claves/cloudfront-publica.pem",
        "La publica se versiona; la privada nunca. Ver `runbooks.md`.",
      ].join("\n"),
    );
  }
  return readFileSync(ruta, "utf8");
};

/**
 * Bucket privado de fotografias y comprobantes, mas la distribucion de CloudFront que
 * sirve unicamente las fotografias, con Origin Access Control y URLs firmadas.
 */
export class AlmacenamientoAutob extends Construct {
  readonly bucket: Bucket;
  readonly distribucion: Distribution;
  readonly grupoDeLlaves: KeyGroup;
  readonly llavePublica: PublicKey;

  constructor(
    scope: Construct,
    id: string,
    opciones: {
      readonly esSandbox: boolean;
      readonly llavePublicaPem?: string;
    },
  ) {
    super(scope, id);

    this.bucket = new Bucket(this, "Bucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: opciones.esSandbox
        ? RemovalPolicy.DESTROY
        : RemovalPolicy.RETAIN,
      autoDeleteObjects: opciones.esSandbox,
    });

    // La llave publica se versiona en el repositorio a proposito: rotarla invalida todas
    // las URLs firmadas vigentes, asi que debe ser estable entre despliegues.
    this.llavePublica = new PublicKey(this, "LlavePublica", {
      encodedKey: opciones.llavePublicaPem ?? leerLlavePublica(),
      comment: "Firma de URLs de fotografias de vehiculos",
    });

    this.grupoDeLlaves = new KeyGroup(this, "GrupoDeLlaves", {
      items: [this.llavePublica],
    });

    this.distribucion = new Distribution(this, "Distribucion", {
      comment: "Fotografias de vehiculos (icsmx-autob)",
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        // `originPath` acota el origen al prefijo publicable: una peticion a `/x.jpg`
        // resuelve `s3://<bucket>/vehiculos/x.jpg`. Es imposible alcanzar
        // `comprobantes/` por esta distribucion, aunque alguien lo intente.
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket, {
          originPath: `/${PREFIJO_PUBLICABLE}`,
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        // **Declarada a proposito, aunque sea la que CDK pone por omision.** Lo
        // que importa de `CACHING_OPTIMIZED` no es el TTL sino que **no incluye
        // el query string en la clave de cache**: cada URL firmada trae
        // `Expires`, `Signature` y `Key-Pair-Id` distintos, asi que una politica
        // que si los incluyera partiria la cache por usuario y por ventana de
        // firma, y convertiria cada render en un MISS contra S3. Heredarla por
        // omision dejaba todo el esquema dependiendo de una suerte.
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        // Sin grupo de llaves de confianza la distribucion serviria las fotografias a
        // cualquiera que conociera la URL. Con el, solo pasan las URLs firmadas.
        trustedKeyGroups: [this.grupoDeLlaves],
      },
      // Sin `errorResponses`: un 403 aqui significa "URL sin firmar o vencida", y cachear
      // esa respuesta solo estorbaria cuando la URL se vuelve a firmar.
    });
  }
}
