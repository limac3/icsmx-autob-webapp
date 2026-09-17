// Ejecuta el barrido contra el sandbox, desde la terminal.
//
// **En local el barrido no corre solo.** Su unico invocador es el Lambda de
// `amplify/barrido/handler.ts`, que EventBridge dispara cada cinco minutos en
// AWS; `npm run dev` levanta Next.js y nada mas. Sin esto, los vencimientos en
// local solo se resuelven por la verificacion perezosa —cuando alguien mira la
// fila— y los cierres tardios de R-11b no se resuelven nunca, porque no hay
// pantalla que los mire.
//
// La corrida se omite salvo que `BARRIDO_LOCAL` valga "1". Este envoltorio
// existe para poner esa variable de forma portable: `VAR=1 npx vitest ...` es
// sintaxis de sh y no funciona en PowerShell, que es el shell primario de esta
// maquina. Mismo patron que `scripts/carga-apertura.mjs`.
//
//   npx ampx sandbox     # en otra terminal, si no esta desplegado
//   npm run barrido
//
// **Escribe en la tabla del sandbox**, igual que el barrido desplegado: vence
// adjudicaciones, reasigna lotes, cierra filas y devuelve vehiculos al
// catalogo. Es idempotente, asi que repetirlo es seguro.
//
// **El outbox no se despacha por omision.** `.env.local` trae credenciales de
// CES reales y `APP_ENV` sin definir vale `produccion`, asi que despacharlo
// manda correo de verdad. Es opt-in:
//
//   BARRIDO_OUTBOX=1 npm run barrido            (bash)
//   $env:BARRIDO_OUTBOX="1"; npm run barrido    (PowerShell)
//
// Mas dias de GSI4 hacia atras, si el barrido lleva tiempo sin correr:
//
//   BARRIDO_DIAS=10 npm run barrido
//
// Argumentos extra van a vitest:
//
//   npm run barrido -- --reporter=verbose

import { spawnSync } from "node:child_process";

const ARCHIVO = "src/lib/fila/barrido.integracion.test.ts";

const resultado = spawnSync(
  "npx",
  ["vitest", "run", ARCHIVO, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    // Necesario en Windows, donde el ejecutable real es `npx.cmd`. No hay
    // entrada del usuario mas alla de los argumentos que ya recibe vitest.
    shell: true,
    env: { ...process.env, BARRIDO_LOCAL: "1" },
  },
);

if (resultado.error) {
  console.error(`No se pudo ejecutar vitest: ${resultado.error}`);
  process.exit(1);
}

process.exit(resultado.status ?? 1);
