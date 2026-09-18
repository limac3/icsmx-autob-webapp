// Comprueba que `sharp` viaje completo en el artefacto y funcione en la
// plataforma de destino.
//
// **Existe porque el trazador de Next deja a medias las dependencias nativas de
// sharp, y el sintoma solo aparece desplegado.** `@vercel/nft` tiene un caso
// especial para sharp cuya guarda es `id.endsWith("sharp/lib/index.js")`, y ese
// archivo dejo de existir en sharp 0.34 —el punto de entrada paso a
// `dist/index.cjs`—, asi que nunca se activa. El camino generico si traza el
// `.node`, pero al buscar bibliotecas compartidas mira solo dentro del paquete
// del `.node` y **excluye `node_modules`**; `libvips-cpp.so.42` vive en el
// paquete hermano `@img/sharp-libvips-linux-x64` y el `.node` lo abre por
// `dlopen` a traves de su `DT_RPATH`, invisible para un trazador de JavaScript.
//
// En Windows el `.dll` esta junto al `.node`, en el mismo paquete, asi que ahi
// el trazado sale bien y el defecto no se ve. Por eso este script se ejecuta en
// el build de Amplify (`amplify.yml`) y no solo en la maquina de quien
// desarrolla: la comprobacion que importa es la del contenedor Linux.
//
// **Es un paso de compuerta y no una prueba de Vitest**, por la misma razon que
// `verificar-lock.mjs`: inspecciona el artefacto de `next build`, que no existe
// cuando corren las pruebas.
//
// Dos comprobaciones, y hacen falta las dos:
//
//   1. **Trazado.** Que los `.nft.json` mencionen el `.node` y el `.so`. Es lo
//      que atrapa el defecto descrito arriba, antes de desplegar.
//   2. **Ejecucion.** Un ciclo real de decodificar, rotar, redimensionar y
//      codificar. Es lo unico que atrapa un binario presente pero inservible:
//      los prebuilt de linux-x64 exigen microarquitectura x86-64-v2, y si el
//      computo fuera arm64 el binario instalado por el contenedor de build (x64)
//      no seria el que el runtime necesita.

import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { createRequire } from "node:module";

const fallar = (mensaje) => {
  console.error(`\nverificar-sharp: ${mensaje}`);
  process.exit(1);
};

// ---------------------------------------------------------------- 1. trazado

// `.nft.json` es el manifiesto que Next escribe por entrada del servidor: lista
// cada archivo que el artefacto tiene que llevar. Se leen todos y se junta la
// lista, en vez de adivinar en cual deberia aparecer sharp.
const trazados = [];
for await (const ruta of glob(".next/**/*.nft.json")) {
  trazados.push(ruta);
}

if (trazados.length === 0) {
  fallar(
    "no hay ningun .next/**/*.nft.json.\n" +
      "Este script corre **despues** de `npm run build`; revisa el orden en amplify.yml.",
  );
}

const archivos = trazados.flatMap((ruta) => {
  try {
    return JSON.parse(readFileSync(ruta, "utf8")).files ?? [];
  } catch (error) {
    fallar(`no se pudo leer ${ruta}: ${String(error)}`);
    return [];
  }
});

const hay = (patron) => archivos.some((archivo) => patron.test(archivo));

const binario = /@img[\\/]sharp-linux[^\\/]*[\\/].*\.node$/;
const biblioteca = /@img[\\/]sharp-libvips-linux[^\\/]*[\\/].*\.so(\.|$)/;

// En Windows no existe ningun paquete `*-linux-*`, asi que exigirlos
// convertiria este script en un fallo permanente en local. Ahi se ejecuta solo
// la comprobacion 2, que si vale en cualquier plataforma.
const esLinux = process.platform === "linux";

if (esLinux) {
  if (!hay(binario)) {
    fallar(
      "el artefacto no lleva el .node de @img/sharp-linux-*.\n" +
        "Revisa `outputFileTracingIncludes` en next.config.ts.",
    );
  }
  if (!hay(biblioteca)) {
    fallar(
      "el artefacto lleva el .node de sharp pero **no** libvips-cpp.so.\n" +
        "Es el defecto que este script existe para atrapar: el binario cargaria\n" +
        "la biblioteca por dlopen y fallaria con\n" +
        '  "libvips-cpp.so.42: cannot open shared object file".\n' +
        "Revisa la entrada @img/sharp-libvips-linux* de `outputFileTracingIncludes`.",
    );
  }
  console.log("verificar-sharp: el .node y libvips-cpp.so estan trazados.");
} else {
  console.log(
    `verificar-sharp: plataforma ${process.platform}; se omite la comprobacion de` +
      " trazado de Linux y se ejecuta solo el ciclo real.",
  );
}

// -------------------------------------------------------------- 2. ejecucion

const require = createRequire(import.meta.url);

let sharp;
try {
  sharp = require("sharp");
} catch (error) {
  fallar(`no se pudo cargar sharp: ${String(error)}`);
}

// La imagen de prueba la genera sharp: asi no hay binarios de fixture en el
// repositorio y la prueba no depende de ningun archivo.
const origen = await sharp({
  create: {
    width: 640,
    height: 480,
    channels: 3,
    background: { r: 120, g: 140, b: 160 },
  },
})
  .jpeg()
  .toBuffer();

const salida = await sharp(origen)
  .rotate()
  .resize({ width: 64 })
  .webp()
  .toBuffer();
const { format, width } = await sharp(salida).metadata();

if (format !== "webp" || width !== 64) {
  fallar(
    `el ciclo produjo ${String(format)} de ${String(width)} px; se esperaba webp de 64.`,
  );
}

// Se imprimen en el log del build a proposito: cuando algo falle en produccion,
// esta linea dice que libvips se desplego, y `heif` responde de una vez si esta
// version puede decodificar HEIC (hoy solo declara `.avif`).
console.log("verificar-sharp: ciclo real correcto.");
console.log(`  versiones: ${JSON.stringify(sharp.versions)}`);
console.log(
  `  heif admite: ${JSON.stringify(sharp.format.heif?.input?.fileSuffix ?? [])}`,
);
