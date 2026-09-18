import "server-only";

// Firma de URLs de fotografias — regla 13 de CLAUDE.md.
//
// El bucket es privado y la distribucion exige URLs firmadas
// (`arquitectura-tecnica-aws.md` 2.4), asi que sin esto no se ve ninguna
// fotografia. Las tres reglas que gobiernan este archivo:
//
//  1. **Se firma en SSR, en cada peticion.** Nunca en el cliente: la llave
//     privada no puede salir del servidor.
//  2. **Nunca se persiste una URL firmada.** Caduca; una guardada en DynamoDB
//     seria un enlace roto con fecha de caducidad y ademas un secreto de acceso
//     almacenado en claro.
//  3. **Nunca dentro de un bloque `"use cache"`.** Lo cacheado se reutiliza
//     entre peticiones y entre usuarios: una URL firmada cacheada se sirve ya
//     vencida a unos y todavia valida a otros que no deberian tenerla.
//     Que el vencimiento sea **determinista** dentro de su cubeta (ver abajo) no
//     relaja esta regla, y conviene decirlo porque invita a pensar lo contrario:
//     lo cacheado sobrevive a la cubeta en la que se produjo, asi que una URL
//     guardada en cache se sigue sirviendo despues de vencer. La determinacion
//     hace que el **navegador** pueda reusarla mientras vale; no autoriza al
//     servidor a guardarla.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

/**
 * Paso al que se redondea el vencimiento de la firma.
 *
 * Existe para que la URL sea **identica byte a byte** durante toda la cubeta,
 * en todos los renders y para todos los usuarios. Sin eso, cada render producia
 * un `Expires` distinto, o sea una URL distinta, y **el cache del navegador no
 * acertaba nunca**: volver al catalogo volvia a descargar todas las fotografias
 * aunque ya estuvieran en disco. El borde de CloudFront si acertaba —su politica
 * de cache no incluye el query string en la clave— pero el borde no le ahorra
 * bytes a quien navega.
 *
 * El redondeo es sobre el **epoch**, no sobre la hora local: una cubeta de una
 * hora es agnostica de zona, asi que la regla 9 (`America/Mexico_City`) no
 * interviene aqui. No hay que "arreglarlo" con `Intl`.
 */
export const CUBETA_DE_FIRMA_MS = 60 * 60 * 1000;

/**
 * Margen que se suma al final de la cubeta.
 *
 * Es lo que fija la vigencia **minima**: sin el, una peticion hecha en el ultimo
 * segundo de la cubeta recibiria una URL que vence en un segundo. Con una hora
 * de gracia, toda firma vale entre 1 y 2 horas.
 *
 * Antes eran diez minutos fijos, con el argumento de que una URL firmada es una
 * credencial portatil y quien la copia entra sin sesion. El argumento sigue en
 * pie, pero el plazo estaba mal elegido: el visor ampliado de la galeria de Eden
 * **monta su `<img>` al hacer clic, no al renderizar**, asi que leer la ficha de
 * un lote y despues abrir las fotografias daba 403 garantizado pasados diez
 * minutos — y con `loading="lazy"`, tambien un scroll tardio. Lo que protege el
 * acceso es el gating triple del servidor (regla 8), no este plazo; lo que este
 * plazo acota es cuanto vive un enlace copiado a una fotografia de un vehiculo
 * en venta, sin datos personales. Los comprobantes de pago no entran en el
 * calculo: `rutaPublica` lanza si la clave no esta bajo `vehiculos/`.
 *
 * **Residuo conocido:** una pestaña abierta mas de dos horas sigue quedandose
 * sin imagenes. Esto eleva el piso, no elimina el modo de fallo. Lo unico que lo
 * elimina es servir la distribucion desde un subdominio del mismo dominio
 * registrable que la aplicacion, que habilitaria cookies firmadas y URLs
 * estables — hoy imposible, porque `cloudfront.net` y `amplifyapp.com` estan en
 * la Public Suffix List y ningun navegador acepta una cookie para ellos.
 */
export const GRACIA_DE_FIRMA_MS = 60 * 60 * 1000;

/**
 * Instante en que vence la firma: el final de la cubeta en curso mas la gracia.
 *
 * Pura y exportada para poder probar las fronteras sin firmar nada.
 */
export const vencimientoDeFirma = (ahora: Date): Date =>
  new Date(
    Math.floor(ahora.getTime() / CUBETA_DE_FIRMA_MS) * CUBETA_DE_FIRMA_MS +
      CUBETA_DE_FIRMA_MS +
      GRACIA_DE_FIRMA_MS,
  );

const PREFIJO_PEM = "-----BEGIN";

type ConfiguracionDeFirma = {
  dominio: string;
  keyPairId: string;
  llavePrivada: string;
};

/** Lo que `npx ampx sandbox` publica y de aqui interesa comparar. */
export type SalidasDeSandbox = {
  distribucion?: string;
  llavePublicaCloudFront?: string;
};

/**
 * Compara el entorno con lo que el sandbox publico, y describe cada desfase.
 *
 * Existe porque el sintoma de este desfase **no es un error**: son URLs
 * firmadas contra un host que ya no existe, o sea fotografias que no cargan con
 * la consola limpia, sin nada en el servidor y sin nada en la red que apunte al
 * codigo. Costo medido: `ampx sandbox delete` y su redespliegue crearon una
 * distribucion nueva, `.env.local` se quedo con el dominio de la anterior, y la
 * galeria de vehiculos quedo muda hasta que alguien la reporto como "las ligas
 * estan rotas" — que es exactamente lo que parece.
 *
 * Es pura y recibe las salidas ya parseadas para poder probarla sin tocar el
 * disco ni el entorno.
 */
export const desfasesConElSandbox = (
  entorno: { dominio: string; keyPairId: string },
  publicado: SalidasDeSandbox | undefined,
): string[] => {
  if (!publicado) return [];

  const comparar = (
    variable: string,
    enEntorno: string,
    enSandbox: string | undefined,
  ): string | undefined =>
    enSandbox && enSandbox !== enEntorno
      ? `${variable}=${enEntorno} pero el sandbox desplegado dice ${enSandbox}`
      : undefined;

  return [
    comparar("CLOUDFRONT_DOMAIN", entorno.dominio, publicado.distribucion),
    comparar(
      "CLOUDFRONT_KEY_PAIR_ID",
      entorno.keyPairId,
      publicado.llavePublicaCloudFront,
    ),
  ].filter((mensaje) => mensaje !== undefined);
};

/**
 * Las salidas del sandbox, leidas una sola vez.
 *
 * `undefined` si el archivo no esta o no se puede leer: quien trabaja sin
 * sandbox propio no tiene por que ver un error. Se memoriza porque
 * `configuracionDeFirma` corre una vez por fotografia y por peticion.
 */
let salidasLeidas: SalidasDeSandbox | undefined | "sin-leer" = "sin-leer";

const salidasDelSandbox = (): SalidasDeSandbox | undefined => {
  if (salidasLeidas !== "sin-leer") return salidasLeidas;
  try {
    const crudo = readFileSync(
      join(process.cwd(), "amplify_outputs.json"),
      "utf8",
    );
    salidasLeidas = (
      JSON.parse(crudo) as { custom?: { autob?: SalidasDeSandbox } }
    ).custom?.autob;
  } catch {
    salidasLeidas = undefined;
  }
  return salidasLeidas;
};

/**
 * Lee la configuracion del entorno.
 *
 * Falla con un mensaje que dice **que** falta y **de donde** sale, en vez de
 * dejar que el SDK lance un error de criptografia diez lineas mas abajo. Es la
 * regla 15: sin fallback silencioso.
 *
 * En desarrollo falla tambien cuando el entorno **no coincide** con el sandbox
 * desplegado. No se corrige el valor sobre la marcha: eso seria el fallback
 * silencioso que la regla 15 prohibe, y ademas dejaria `.env.local` mintiendo
 * para siempre.
 */
export const configuracionDeFirma = (): ConfiguracionDeFirma => {
  const dominio = process.env.CLOUDFRONT_DOMAIN;
  const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const crudo = process.env.CLOUDFRONT_PRIVATE_KEY;

  const faltantes = [
    dominio ? undefined : "CLOUDFRONT_DOMAIN",
    keyPairId ? undefined : "CLOUDFRONT_KEY_PAIR_ID",
    crudo ? undefined : "CLOUDFRONT_PRIVATE_KEY",
  ].filter((nombre) => nombre !== undefined);

  if (!dominio || !keyPairId || !crudo) {
    throw new Error(
      `Falta ${faltantes.join(", ")} para firmar URLs de CloudFront.` +
        " El dominio y el identificador de llave los publica `npx ampx sandbox`" +
        " en amplify_outputs.json (custom.autob); la llave privada es un secreto." +
        " Ver .env.local.example.",
    );
  }

  // Solo en desarrollo: desplegada, las variables las inyecta Amplify y
  // `amplify_outputs.json` no es la fuente de verdad de nada.
  if (process.env.NODE_ENV === "development") {
    const desfases = desfasesConElSandbox(
      { dominio, keyPairId },
      salidasDelSandbox(),
    );
    if (desfases.length > 0) {
      throw new Error(
        `.env.local no coincide con el sandbox desplegado: ${desfases.join("; ")}.` +
          " Recrear el sandbox cambia la distribucion de CloudFront, y una URL" +
          " firmada contra la anterior no falla: simplemente no carga ninguna" +
          " fotografia. Copia los valores de amplify_outputs.json (custom.autob).",
      );
    }
  }

  return { dominio, keyPairId, llavePrivada: normalizarLlave(crudo) };
};

/**
 * Devuelve el PEM con saltos de linea reales.
 *
 * Una llave privada no cabe en una variable de entorno de una sola linea, asi
 * que se guarda con los saltos escapados como `\n` —es lo que documenta
 * `.env.local.example`— y hay que deshacerlo antes de usarla. Se acepta tambien
 * la forma con saltos reales, porque los gestores de secretos de AWS si los
 * conservan y obligar a escaparlos seria una trampa.
 *
 * Los retornos de carro se quitan. `openssl` en Windows escribe el PEM con
 * CRLF, y al escapar solo los `\n` quedan CR sueltos **dentro** de la llave:
 * el decodificador la rechaza con `ERR_OSSL_UNSUPPORTED`, un error que no
 * menciona ni la variable ni el salto de linea. Un PEM no lleva CR en ningun
 * caso legitimo, asi que quitarlos no pierde nada.
 */
export const normalizarLlave = (crudo: string): string => {
  const conSaltos = crudo.includes("\\n")
    ? crudo.replaceAll("\\n", "\n")
    : crudo;
  const llave = conSaltos.replaceAll("\r", "");
  if (!llave.trimStart().startsWith(PREFIJO_PEM)) {
    throw new Error(
      "CLOUDFRONT_PRIVATE_KEY no parece un PEM: deberia empezar con '-----BEGIN'.",
    );
  }
  return llave;
};

export type DepsDeFirma = {
  ahora?: () => Date;
  configuracion?: ConfiguracionDeFirma;
};

/**
 * URL firmada para una clave de S3 dentro del prefijo `vehiculos/`.
 *
 * La distribucion apunta al origen con `originPath: /vehiculos`, asi que la
 * ruta publica es la clave **sin** ese prefijo. Traducirlo aqui es lo que
 * permite que el resto del codigo maneje una sola nocion de "clave S3".
 */
export const firmarFotografia = (
  claveS3: string,
  deps: DepsDeFirma = {},
): string => {
  const configuracion = deps.configuracion ?? configuracionDeFirma();
  const ahora = (deps.ahora ?? (() => new Date()))();

  const ruta = rutaPublica(claveS3);
  const vence = vencimientoDeFirma(ahora);

  return getSignedUrl({
    url: `https://${configuracion.dominio}/${ruta}`,
    keyPairId: configuracion.keyPairId,
    privateKey: configuracion.llavePrivada,
    dateLessThan: vence.toISOString(),
  });
};

export const PREFIJO_FOTOGRAFIAS = "vehiculos/";

/**
 * Quita el prefijo que la distribucion ya aporta.
 *
 * Rechaza cualquier clave fuera de `vehiculos/`. Es la ultima defensa de la
 * separacion que hace `originPath`: los comprobantes de pago viven en
 * `comprobantes/` y **jamas** se sirven por CloudFront — se entregan por el
 * Route Handler de descarga, que verifica permiso y audita el acceso. Un
 * descuido que pasara por aqui una clave de comprobante produciria una URL
 * firmada que no resuelve, pero tambien una fuga de la ruta interna.
 */
export const rutaPublica = (claveS3: string): string => {
  if (!claveS3.startsWith(PREFIJO_FOTOGRAFIAS)) {
    throw new Error(
      `Solo se firman claves bajo ${PREFIJO_FOTOGRAFIAS}; llego ${claveS3}`,
    );
  }
  return claveS3.slice(PREFIJO_FOTOGRAFIAS.length);
};
