// Comprueba que `package-lock.json` este sincronizado con `package.json`.
//
// **Existe porque el despliegue corre `npm ci` y la compuerta no.** `npm ci`
// exige que los dos archivos coincidan exactamente y aborta si no; `npm install`
// —lo que se usa a diario— los reconcilia sobre la marcha y no se queja. El
// resultado es un desfase que **pasa toda la compuerta local en verde** y falla
// solo en el build de Amplify, con un `EUSAGE / Missing: <paquete> from lock
// file` que aparece minutos despues de empujar.
//
// Ocurrio de verdad: el lock llevaba desincronizado desde el 2026-09-08 —le
// faltaban cuatro entradas de `@opentelemetry/core@2.0.0`, que algunos paquetes
// de Amplify piden con version exacta— sin que nada lo delatara en local. Lo
// encontro el build #3 del primer despliegue. Ver `desafios-implementacion.md`
// 66.
//
// Se arregla con `npm install --package-lock-only`, que recalcula el lock sin
// tocar `node_modules`.
//
// **Es un paso de la compuerta y no una prueba de Vitest**, y la razon es la
// red: resolver el arbol consulta el registro. Las pruebas de este repositorio
// no dependen de red a proposito —las de integracion se omiten salvo bandera— y
// meter una que si dependa haria la suite intermitente.

import { spawnSync } from "node:child_process";

// `shell: true` es **obligatorio** en Windows, no una comodidad: el ejecutable
// real es `npm.cmd`, y desde el endurecimiento de CVE-2024-27980 Node se niega
// a lanzar un `.cmd` sin shell — `spawnSync npm.cmd EINVAL`. A cambio, Node
// avisa con DEP0190 de que los argumentos se concatenan sin escapar; aqui son
// dos literales y no hay entrada del usuario, asi que el aviso es ruido
// aceptado. Es la misma concesion que ya llevaba `verify-rapido.mjs`.
const resultado = spawnSync("npm", ["ci", "--dry-run"], {
  encoding: "utf8",
  shell: true,
});

if (resultado.error) {
  console.error(`No se pudo ejecutar "npm ci --dry-run": ${resultado.error}`);
  process.exit(1);
}

if (resultado.status !== 0) {
  const salida = `${resultado.stdout ?? ""}${resultado.stderr ?? ""}`;
  // Se reproduce la salida de npm en vez de resumirla: nombra los paquetes que
  // faltan, que es justo lo que hace accionable el fallo.
  console.error(salida.trim());
  console.error(
    "\npackage-lock.json no esta sincronizado con package.json.\n" +
      "El build de Amplify corre `npm ci` y va a fallar igual.\n" +
      "Arreglalo con:  npm install --package-lock-only",
  );
  process.exit(1);
}

console.log("package-lock.json sincronizado con package.json.");
