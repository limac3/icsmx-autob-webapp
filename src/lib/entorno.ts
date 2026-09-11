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
