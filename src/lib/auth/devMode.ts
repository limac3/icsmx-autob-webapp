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

// Salvaguarda de la regla 15 de CLAUDE.md: el modo simulado nunca debe
// activarse en produccion, ni siquiera por una variable de entorno mal
// puesta. Se invoca justo antes de usar el mock, no al importar el modulo —
// este archivo tambien se importa durante `next build`.
export const exigirModoSeguro = (modo: ModoDevTools): void => {
  if (modo !== "OFF" && process.env.NODE_ENV === "production") {
    throw new Error(
      `ENABLE_DEV_TOOLS="${modo}" no esta permitido con NODE_ENV=production.`,
    );
  }
};
