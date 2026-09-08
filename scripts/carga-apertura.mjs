// Ejecuta la prueba de carga de la apertura de una convocatoria (Etapa 12)
// contra el sandbox.
//
// La prueba se omite salvo que `CARGA_APERTURA` valga "1". Este envoltorio
// existe para poner esa variable de forma portable: `VAR=1 npx vitest ...` es
// sintaxis de sh y no funciona en PowerShell, que es el shell primario de esta
// maquina. Mismo patron que `scripts/prototipo-fila.mjs`.
//
//   npx ampx sandbox          # en otra terminal, si no esta desplegado
//   npm run carga:apertura
//
// Tamano del pico (L lotes x P participantes, todos a la vez):
//
//   CARGA_LOTES=20 CARGA_PARTICIPANTES=15 npm run carga:apertura        (bash)
//   $env:CARGA_LOTES=20; npm run carga:apertura                   (PowerShell)
//
// Imprime siempre el informe: latencias p50/p95/maxima, solicitudes por
// segundo y el reparto de rechazos por codigo. Esos numeros son el entregable
// —van a `UMBRAL_CONFLICTOS_POR_PERIODO` de `amplify/alarmas.ts` y a la
// revision de capacidad de `modelo-datos-dynamodb.md`—, no las afirmaciones,
// que solo detectan una degradacion catastrofica.
//
// Argumentos extra van a vitest:
//
//   npm run carga:apertura -- --reporter=verbose

import { spawnSync } from "node:child_process";

const ARCHIVO = "src/lib/fila/carga.integracion.test.ts";

const resultado = spawnSync(
  "npx",
  ["vitest", "run", ARCHIVO, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    // Necesario en Windows, donde el ejecutable real es `npx.cmd`. No hay
    // entrada del usuario mas alla de los argumentos que ya recibe vitest.
    shell: true,
    env: { ...process.env, CARGA_APERTURA: "1" },
  },
);

if (resultado.error) {
  console.error(`No se pudo ejecutar vitest: ${resultado.error}`);
  process.exit(1);
}

process.exit(resultado.status ?? 1);
