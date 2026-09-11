import type { NextConfig } from "next";

/**
 * Variables que el **servidor** necesita en ejecucion y que hay que incrustar
 * en compilacion.
 *
 * **Las variables de la consola de Amplify no llegan al computo SSR.** Llegan
 * al contenedor de build; el runtime de Next no las ve, y Next **no incrusta**
 * `process.env.X` por su cuenta —comprobado compilando con un marcador y
 * buscandolo en `.next/server`: no aparece—. El resultado fue un 500 en cada
 * peticion de la aplicacion desplegada, lanzado al evaluar el modulo de
 * middleware: "Falta configuracion de autenticacion requerida: AUTH0_DOMAIN".
 *
 * En local nunca se ve porque `next start` **si** carga `.env.local`, que esta
 * en `.gitignore` y por tanto no existe en el build. Esa es la razon de fondo
 * de que todo funcionara en la maquina y nada en el despliegue
 * (`desafios-implementacion.md` 72).
 *
 * El bloque `env` de Next las sustituye en tiempo de compilacion. Comprobado
 * igual, con marcador: quedan en los chunks de `.next/server` y **no** aparecen
 * en `.next/static`, o sea que no viajan al navegador. Lo que las mantiene
 * fuera del cliente no es este bloque sino que solo se lean desde modulos con
 * `import "server-only"`; este bloque no relaja esa frontera, la respeta.
 *
 * **La lista es explicita, no un `env | grep`.** Un barrido arrastraria
 * `NODE_AUTH_TOKEN` —credencial de Artifactory que no pinta nada en el
 * artefacto— y las credenciales de AWS del contenedor. Aqui solo entra lo que
 * el servidor lee de verdad. Los cuatro de CES **no** estan: los consume el
 * Lambda del barrido por `secret()`, no la aplicacion.
 *
 * Consecuencia operativa: cambiar una de estas en la consola exige
 * **redesplegar**, porque el valor se fija al compilar. Es la misma regla que
 * ya aplica a `APP_ENV` y `APP_BASE_URL` del Lambda (`runbooks.md` R-14).
 */
const VARIABLES_DEL_SERVIDOR = [
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH_SECRET",
  "APP_BASE_URL",
  "EAS_PROFILE_URL",
  "EAS_API_KEY",
  "AUTOB_TABLE_NAME",
  "AUTOB_MEDIA_BUCKET",
  "CLOUDFRONT_DOMAIN",
  "CLOUDFRONT_KEY_PAIR_ID",
  "CLOUDFRONT_PRIVATE_KEY",
  "APP_ENV",
  "ENABLE_DEV_TOOLS",
  "DEV_TOOLS_MOCK_ROLES",
  "DEV_TOOLS_MOCK_PERMISOS",
] as const;

/**
 * Solo las que existen. Una clave con `undefined` la incrustaria Next como la
 * cadena `"undefined"`, que pasaria las guardas de "esta puesta" y fallaria mas
 * tarde con un valor absurdo; omitirla deja la lectura en tiempo de ejecucion y
 * el error explicito de `requerido()`, que nombra la variable.
 */
const entornoDelServidor = Object.fromEntries(
  VARIABLES_DEL_SERVIDOR.flatMap((nombre) => {
    const valor = process.env[nombre];
    return valor === undefined || valor === "" ? [] : [[nombre, valor]];
  }),
);

// turbopack.root evita que Next infiera mal la raiz del proyecto: hay un
// lockfile en el directorio padre c:/Apps/node/ (riesgo R13 del plan de
// ejecucion). La CSP con nonce por peticion vive en src/proxy.ts (Etapa 2).
const nextConfig: NextConfig = {
  env: entornoDelServidor,
  poweredByHeader: false,
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // Habilita forbidden()/unauthorized() de next/navigation (Etapa 2: la
    // pagina protegida de prueba usa forbidden() para el rol insuficiente).
    authInterrupts: true,
    serverActions: {
      /**
       * Sin esto el tope es **1 MB** y la aplicacion prometia 10:
       * `MAXIMO_BYTES_FOTOGRAFIA` y `MAXIMO_BYTES_COMPROBANTE`
       * (`src/lib/media/almacenamiento.ts`) admiten 10 MB, pero el framework
       * rechazaba el cuerpo **antes** de llegar a la Server Action — o sea que
       * cualquier fotografia de celular fallaba con un error genérico, sin
       * pasar por las validaciones de tipo y tamano ni por la auditoria.
       *
       * **El margen de 1 MB sobre los 10 no es holgura, tiene funcion.** El
       * tope se aplica al cuerpo HTTP crudo, incluidos los 10-20 KB que
       * `multipart/form-data` agrega en fronteras y cabeceras de parte, asi que
       * exactamente 10 MB no alcanzaria para un archivo de 10 MB justos. Con el
       * margen, un archivo que se pasa del limite del dominio **llega al
       * servidor y lo rechaza la validacion del dominio con su mensaje
       * propio**, en vez de morir en el framework sin explicacion.
       *
       * `next.config.test.ts` ata este numero a esas dos constantes: si alguna
       * sube, la compuerta falla en vez de que el framework empiece a rechazar
       * en silencio.
       */
      bodySizeLimit: 11 * 1024 * 1024,
    },
  },
  // Cabeceras que no dependen de la peticion. Las que si —la CSP, con su nonce
  // por peticion— viven en `src/proxy.ts`.
  //
  // **Aqui y no en el proxy** porque el `matcher` del proxy excluye
  // `_next/static`, `favicon.ico`, `robots.txt` y `sitemap.xml`: los recursos
  // estaticos tambien tienen que llegar con `nosniff` y con HSTS, y por ese
  // camino no pasan.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Redundante con `frame-ancestors 'none'` de la CSP y se manda
          // igual: es lo que reconocen los escaneres corporativos y los
          // navegadores que no aplican CSP nivel 2.
          { key: "X-Frame-Options", value: "DENY" },
          // Ninguna pantalla usa camara, microfono, geolocalizacion ni pago.
          // Se niegan de forma explicita para que un `<iframe>` o un script
          // inyectado no pueda pedirlos en nombre del origen.
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=()," +
              " usb=(), display-capture=()",
          },
          // Aisla la ventana de cualquier abridor de otro origen: sin esto,
          // una pagina que abra la aplicacion conserva una referencia
          // `window.opener` utilizable para husmear la navegacion.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // Ninguna respuesta de esta aplicacion esta pensada para que la
          // cargue otro sitio. No afecta a las fotografias: esas las sirve
          // CloudFront con sus propias cabeceras, y quien autoriza que el
          // navegador las pida es `img-src` de la CSP.
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
