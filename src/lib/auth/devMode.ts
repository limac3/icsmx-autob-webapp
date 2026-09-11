import "server-only";
import { obtenerEntornoApp } from "@/lib/entorno";

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

// El entorno lo resuelve `src/lib/entorno.ts`, y vive alli y no aqui porque el
// Lambda del barrido tambien lo necesita: este archivo lleva `server-only` y
// aquel no puede (`desafios-implementacion.md` 53).
export { obtenerEntornoApp } from "@/lib/entorno";

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
