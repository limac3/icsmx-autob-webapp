// Ejecuta el prototipo concurrente de la fila (riesgo R18) contra el sandbox.
//
// El prototipo se omite salvo que `PROTOTIPO_R18` valga "1". Este envoltorio
// existe para poner esa variable de forma portable: `VAR=1 npx vitest ...` es
// sintaxis de sh y no funciona en PowerShell, que es el shell primario de esta
// maquina. Se sigue el mismo patron que `scripts/verify-rapido.mjs`.
//
//   npx ampx sandbox          # en otra terminal, si no esta desplegado
//   npm run prototipo:fila
//
// Argumentos extra van a vitest:
//
//   npm run prototipo:fila -- --reporter=verbose
//
// Para mas rondas de la rafaga:
//
//   PROTOTIPO_REPETICIONES=10 npm run prototipo:fila     (bash)
//   $env:PROTOTIPO_REPETICIONES=10; npm run prototipo:fila   (PowerShell)

import { spawnSync } from "node:child_process";

const ARCHIVO = "src/lib/fila/prototipoDeFila.integracion.test.ts";

const resultado = spawnSync(
  "npx",
  ["vitest", "run", ARCHIVO, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    // Necesario en Windows, donde el ejecutable real es `npx.cmd`. No hay
    // entrada del usuario mas alla de los argumentos que ya recibe vitest.
    shell: true,
    env: { ...process.env, PROTOTIPO_R18: "1" },
  },
);

if (resultado.error) {
  console.error(`No se pudo ejecutar vitest: ${resultado.error}`);
  process.exit(1);
}

process.exit(resultado.status ?? 1);
