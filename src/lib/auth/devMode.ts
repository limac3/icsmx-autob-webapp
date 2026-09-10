import "server-only";

export const MODOS_DEV_TOOLS = ["OFF", "MOCK_USERS", "FULL"] as const;
export type ModoDevTools = (typeof MODOS_DEV_TOOLS)[number];

const esModoValido = (valor: string): valor is ModoDevTools =>
  (MODOS_DEV_TOOLS as readonly string[]).includes(valor);

export const obtenerModoDevTools = (): ModoDevTools => {
  const crudo = process.env.ENABLE_DEV_TOOLS;
  if (!crudo) return "OFF";
  if (!esModoValido(crudo)) {
    console.warn(
      `[devMode] ENABLE_DEV_TOOLS="${crudo}" no es un valor valido ` +
        `(${MODOS_DEV_TOOLS.join(", ")}). Se usa OFF.`,
    );
    return "OFF";
  }
  return crudo;
};

export const ENTORNOS_APP = ["produccion", "pruebas"] as const;
export type EntornoApp = (typeof ENTORNOS_APP)[number];

/**
 * Entorno declarado del despliegue.
 *
 * **Ausente o desconocido es `produccion`**, y eso es lo que hace que la guarda
 * de abajo falle cerrada: olvidar la variable nunca concede nada. Un valor
 * invalido avisa en el registro en vez de lanzar, igual que
 * `ENABLE_DEV_TOOLS` — es la misma clase de error de configuracion y merece el
 * mismo trato.
 *
 * Solo tiene sentido en un despliegue compilado. En local no hace falta:
 * `NODE_ENV` ya no es produccion.
 */
export const obtenerEntornoApp = (): EntornoApp => {
  const crudo = process.env.APP_ENV;
  if (!crudo) return "produccion";
  if (!(ENTORNOS_APP as readonly string[]).includes(crudo)) {
    console.warn(
      `[devMode] APP_ENV="${crudo}" no es un valor valido ` +
        `(${ENTORNOS_APP.join(", ")}). Se asume produccion.`,
    );
    return "produccion";
  }
  return crudo as EntornoApp;
};

/**
 * Salvaguarda de la regla 15 de CLAUDE.md: el modo simulado nunca debe
 * activarse por descuido en un despliegue. Se invoca justo antes de usar el
 * mock, no al importar el modulo — este archivo tambien se importa durante
 * `next build`.
 *
 * **`NODE_ENV=production` no alcanza como criterio de "es produccion".** Amplify
 * Hosting compila y sirve toda rama en modo produccion, incluida una de
 * pruebas, asi que la condicion anterior hacia imposible desplegar un ambiente
 * de prueba con el conmutador de identidades — que es justo donde hace falta,
 * porque el flujo completo exige dos identidades distintas (R-05 impide aprobar
 * la propia convocatoria) y con `OFF` no hay forma de tenerlas sin dos personas
 * reales.
 *
 * Quien decide es `APP_ENV`, y decide **cerrado por omision**: sin la variable
 * el entorno es produccion y cualquier modo distinto de `OFF` lanza.
 */
export const exigirModoSeguro = (modo: ModoDevTools): void => {
  if (modo === "OFF") return;
  if (process.env.NODE_ENV !== "production") return;
  if (obtenerEntornoApp() === "pruebas") return;

  throw new Error(
    `ENABLE_DEV_TOOLS="${modo}" no esta permitido en un despliegue con ` +
      `APP_ENV=produccion (o sin APP_ENV, que se asume produccion). Un ` +
      `ambiente de pruebas se declara con APP_ENV=pruebas.`,
  );
};
