// La compuerta **previa al despliegue**: `verify:rapido` mas la exigencia de
// que las suites de integracion hayan corrido de verdad.
//
// Por que existe, en una frase: sin ella, `verify:rapido` en una maquina sin
// sandbox omite la prueba de concurrencia de la fila y **reporta verde igual**,
// y ese verde es indistinguible del que si ejercito la regla 16. No hay CI que
// lo cubra, y el build de Amplify no puede correrlas —su rol no puede asumir el
// de computo SSR, y es correcto que no pueda (`desafios-implementacion.md` 70)—.
// Asi que el unico momento en que alguien puede comprobarlo es este, a mano,
// antes de desplegar.
//
// `EXIGIR_INTEGRACION=1` convierte la omision silenciosa en un fallo que nombra
// lo que falta. Requiere un sandbox levantado:
//
//   npx ampx sandbox        # en otra terminal
//   npm run verify:despliegue

import { spawnSync } from "node:child_process";

const resultado = spawnSync("npm", ["run", "verify:rapido"], {
  stdio: "inherit",
  // `shell` es necesario en Windows, donde el ejecutable real es `npm.cmd`.
  // No hay entrada del usuario en la linea de comandos.
  shell: true,
  env: { ...process.env, EXIGIR_INTEGRACION: "1" },
});

if (resultado.error) {
  console.error(
    `No se pudo ejecutar "npm run verify:rapido": ${resultado.error}`,
  );
  process.exit(1);
}

process.exit(resultado.status ?? 1);
