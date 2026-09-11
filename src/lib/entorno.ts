/**
 * Entorno declarado del despliegue — decision **D-18**.
 *
 * `produccion` | `pruebas`, y **ausente o desconocido es `produccion`**. Esa
 * asimetria es toda la propiedad: olvidar la variable nunca concede nada, ni
 * herramientas de desarrollo (`auth/devMode.ts`) ni el descarte de correos sin
 * configuracion de CES (`correo/procesarOutbox.ts`). Falla cerrada (regla 18).
 *
 * Existe porque `NODE_ENV` no distingue produccion de pruebas: Amplify Hosting
 * compila y sirve **toda** rama en modo produccion.
 *
 * **Sin `import "server-only"`, y no por olvido.** El Lambda del barrido
 * alcanza este archivo a traves de `procesarOutbox`, y ese paquete resuelve a
 * su rama de `throw` bajo el empaquetado `esbuild` de `defineFunction` — es el
 * fallo que tuvo al barrido caido en el 100% de sus invocaciones durante dos
 * etapas (`desafios-implementacion.md` 53). Vive aqui, fuera de
 * `auth/devMode.ts`, precisamente para que aquel pueda conservar la guarda:
 * leer una variable de entorno no necesita proteccion de frontera.
 */

export const ENTORNOS_APP = ["produccion", "pruebas"] as const;
export type EntornoApp = (typeof ENTORNOS_APP)[number];

/**
 * Un valor invalido avisa en el registro y se asume `produccion`, en vez de
 * lanzar: es la misma clase de error de configuracion que `ENABLE_DEV_TOOLS` y
 * merece el mismo trato. `production` en ingles es el error probable, y cae del
 * lado seguro.
 */
export const obtenerEntornoApp = (): EntornoApp => {
  const crudo = process.env.APP_ENV;
  if (!crudo) return "produccion";
  if (!(ENTORNOS_APP as readonly string[]).includes(crudo)) {
    console.warn(
      `[entorno] APP_ENV="${crudo}" no es un valor valido ` +
        `(${ENTORNOS_APP.join(", ")}). Se asume produccion.`,
    );
    return "produccion";
  }
  return crudo as EntornoApp;
};

/** Atajo legible para las guardas que solo distinguen los dos casos. */
export const esEntornoDePruebas = (): boolean =>
  obtenerEntornoApp() === "pruebas";

/**
 * URL base de la aplicacion, **sin barra final**.
 *
 * Se normaliza porque los dos consumidores concatenan una ruta que ya empieza
 * con `/`: la plantilla del correo arma
 * `${base}/convocatorias/<id>/lotes/<id>` y el SDK de Auth0 arma
 * `${appBaseUrl}/auth/callback`. Con una barra final —que es como se pega una
 * URL desde el navegador, y como quedo puesta en la consola de Amplify— sale
 * `https://host//convocatorias/...` y `https://host//auth/callback`; el
 * segundo **no coincide** con la URL de callback registrada en Okta y el login
 * falla con un error que no menciona la barra.
 *
 * Normalizar no oculta una configuracion mala: las dos formas designan la misma
 * URL, y aceptarlas las dos evita un fallo cuya causa no se adivina. Lo que si
 * seria ocultar es inventar un valor: sin la variable se cae al `localhost` del
 * desarrollo, que es visible de inmediato en cualquier despliegue.
 */
export const urlBaseDeLaApp = (): string => {
  // **Vacia cuenta como ausente, y `??` no lo haria.** `??` solo atrapa
  // `undefined`, asi que una variable borrada en la consola —que queda como
  // cadena vacia— daba `""`, y de ahi salian rutas sin host: `/auth/callback`
  // en vez de `https://host/auth/callback`. Lo encontro la prueba escrita para
  // documentar el respaldo, no una revision. Se recorta tambien el espacio, que
  // es lo que sobra al pegar un valor.
  const crudo = process.env.APP_BASE_URL?.trim();
  const base = crudo ? crudo : "http://localhost:3000";
  return base.replace(/\/+$/, "");
};
