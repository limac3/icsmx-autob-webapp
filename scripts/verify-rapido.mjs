// `npm run verify` sin el chequeo de paquetes desactualizados.
//
// Ese chequeo consulta el registro paquete por paquete. Contra el Artifactory
// de la organizacion, en esta red, cada consulta tarda entre 5 y 21 segundos:
// domina el tiempo total (~95 s de los ~145 s) y deja la compuerta demasiado
// lenta para ejecutarla en cada iteracion. Ver desafios-implementacion.md
// seccion 15.
//
// Saltarlo no debilita la compuerta. El chequeo **nunca falla el build** —solo
// imprime una lista— y el propio festack lo describe como mantenimiento
// "mensual". Formato, lint, pruebas y el chequeo de dependencias sin usar se
// ejecutan igual.
//
// `festack-scripts-verify.mjs` lo omite cuando `CI` o `AGENT_ID` estan
// definidas; se usa la primera por ser la convencion conocida.
//
// Se delega en `npm run verify` en lugar de invocar festack directamente para
// que las dos variantes no puedan separarse: cualquier cambio en el script
// `verify` aplica aqui automaticamente.

// Antes de todo lo demas se comprueba el lock (`verificar-lock.mjs`, ~10 s):
// el despliegue corre `npm ci` y la compuerta no, asi que un desfase entre
// `package.json` y `package-lock.json` pasa en verde aqui y falla alla. Va
// primero porque es lo mas barato y lo que invalida el resto.

import { spawnSync } from "node:child_process";

// `node` si es un ejecutable directo: no necesita shell.
const lock = spawnSync(process.execPath, ["scripts/verificar-lock.mjs"], {
  stdio: "inherit",
});
if ((lock.status ?? 1) !== 0) {
  process.exit(lock.status ?? 1);
}

const resultado = spawnSync("npm", ["run", "verify"], {
  stdio: "inherit",
  // `shell` es necesario en Windows, donde el ejecutable real es `npm.cmd`.
  // No hay entrada del usuario en la linea de comandos, asi que no abre
  // superficie de inyeccion.
  shell: true,
  env: { ...process.env, CI: "1" },
});

if (resultado.error) {
  console.error(`No se pudo ejecutar "npm run verify": ${resultado.error}`);
  process.exit(1);
}

process.exit(resultado.status ?? 1);
