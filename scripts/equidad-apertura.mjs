// Mide la ventaja de automatizar el instante de apertura (Etapa 16) contra el
// sandbox.
//
// La prueba se omite salvo que `EQUIDAD_APERTURA` valga "1". Este envoltorio
// existe para poner esa variable de forma portable: `VAR=1 npx vitest ...` es
// sintaxis de sh y no funciona en PowerShell, que es el shell primario de esta
// maquina. Mismo patron que `scripts/carga-apertura.mjs`.
//
//   npx ampx sandbox          # en otra terminal, si no esta desplegado
//   npm run equidad:apertura
//
// La corrida tarda ~30 s: la mayor parte es la espera deliberada a que llegue
// `inicioVenta`, porque medir la apertura exige que la apertura ocurra.
//
// Forma del escenario (por lote: R disparos exactos, B bucles de reintento,
// H personas):
//
//   EQUIDAD_LOTES=10 EQUIDAD_HUMANOS=5 npm run equidad:apertura       (bash)
//   $env:EQUIDAD_LOTES=10; npm run equidad:apertura            (PowerShell)
//
// Imprime siempre el informe: turno obtenido por perfil, desfase real respecto
// de la apertura, inversiones de orden, tasa que sostiene un bucle de
// reintentos y latencia p50/p95. Esos numeros son el entregable —calibran el
// umbral de la limitacion de tasa y son la linea base de R26—, no las
// afirmaciones, que solo comprueban que el escenario se monto.
//
// Argumentos extra van a vitest:
//
//   npm run equidad:apertura -- --reporter=verbose

import { spawnSync } from "node:child_process";

const ARCHIVO = "src/lib/fila/equidadDeApertura.integracion.test.ts";

const resultado = spawnSync(
  "npx",
  ["vitest", "run", ARCHIVO, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    // Necesario en Windows, donde el ejecutable real es `npx.cmd`. No hay
    // entrada del usuario mas alla de los argumentos que ya recibe vitest.
    shell: true,
    env: { ...process.env, EQUIDAD_APERTURA: "1" },
  },
);

if (resultado.error) {
  console.error(`No se pudo ejecutar vitest: ${resultado.error}`);
  process.exit(1);
}

process.exit(resultado.status ?? 1);
