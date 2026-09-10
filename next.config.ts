import type { NextConfig } from "next";

// turbopack.root evita que Next infiera mal la raiz del proyecto: hay un
// lockfile en el directorio padre c:/Apps/node/ (riesgo R13 del plan de
// ejecucion). La CSP con nonce por peticion vive en src/proxy.ts (Etapa 2).
const nextConfig: NextConfig = {
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
