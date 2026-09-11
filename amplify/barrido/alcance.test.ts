// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ningun archivo que el handler del barrido alcance puede llevar
 * `import "server-only"`.
 *
 * **Ya paso dos veces, y la segunda la causo la correccion de la primera.** El
 * paquete `server-only` decide entre un no-op y un `throw` segun la condicion
 * de exportacion `"react-server"`: Next la activa en su build, y el empaquetado
 * `esbuild` de `defineFunction` no, asi que cae siempre en el `throw` **al
 * importar el modulo** — no al llamarlo. Basta una arista nueva en el grafo de
 * importaciones para que la funcion falle en el arranque, en el 100% de sus
 * invocaciones.
 *
 * - Etapa 10 introdujo el problema y la Etapa 12 lo encontro siguiendo la alarma
 *   `barrido-con-errores` contra un sandbox real, no con una prueba
 *   (`desafios-implementacion.md` 53). Se quito la guarda de 17 archivos.
 * - Etapa 13 lo reintrodujo: su reconciliador de lotes publicados hizo que
 *   `barridoDeVencimientos.ts` importara `cerrarFilaDelLote.ts`, que si la
 *   llevaba (seccion 64).
 *
 * **Ninguna prueba podia verlo, y por eso esta es de otra clase.** Vitest no
 * pasa por el mismo empaquetado, y todo el repositorio hace
 * `vi.mock("server-only", () => ({}))`, que es justo lo que neutraliza el
 * sintoma. La unica forma de atraparlo sin AWS es **leer el grafo de
 * importaciones como texto**, que es lo que hace esto: no ejecuta nada, recorre
 * archivos.
 *
 * Lo que falla aqui no se arregla agregando una excepcion: se arregla quitando
 * la guarda del archivo, o dejando de importarlo desde el barrido.
 */

const RAIZ = join(import.meta.dirname, "..", "..");
const ENTRADA = join(RAIZ, "amplify", "barrido", "handler.ts");

const GUARDA = /^\s*import\s+["']server-only["']/m;
/** `from "x"` y tambien el `import "x"` de un efecto lateral. */
const REFERENCIAS = [
  /from\s+["']([^"']+)["']/g,
  /^\s*import\s+["']([^"']+)["']/gm,
];

/** Resuelve solo lo que es del repositorio: el alias `@/` y las rutas relativas. */
const resolverModulo = (
  desde: string,
  especificador: string,
): string | null => {
  let base: string;
  if (especificador.startsWith("@/")) {
    base = join(RAIZ, "src", especificador.slice(2));
  } else if (especificador.startsWith(".")) {
    base = join(dirname(desde), especificador);
  } else {
    return null; // dependencia de node_modules
  }

  const sinExtension = base.replace(/\.tsx?$/, "");
  for (const candidato of [
    `${sinExtension}.ts`,
    `${sinExtension}.tsx`,
    join(sinExtension, "index.ts"),
  ]) {
    if (existsSync(candidato)) return candidato;
  }
  return null;
};

/** Cierre transitivo desde el handler, con el camino que llevo a cada archivo. */
const recorrerDesdeElHandler = (): Map<string, string[]> => {
  const caminos = new Map<string, string[]>([[ENTRADA, [ENTRADA]]]);
  const porVisitar = [ENTRADA];

  while (porVisitar.length > 0) {
    const archivo = porVisitar.pop();
    if (!archivo) break;
    const camino = caminos.get(archivo) ?? [archivo];
    const fuente = readFileSync(archivo, "utf8");

    for (const patron of REFERENCIAS) {
      for (const coincidencia of fuente.matchAll(patron)) {
        const especificador = coincidencia[1];
        if (!especificador) continue;
        const destino = resolverModulo(archivo, especificador);
        if (!destino || caminos.has(destino)) continue;
        caminos.set(destino, [...camino, destino]);
        porVisitar.push(destino);
      }
    }
  }

  return caminos;
};

const comoRuta = (absoluta: string): string =>
  relative(RAIZ, absoluta).split(sep).join("/");

describe("el Lambda del barrido no puede alcanzar `server-only`", () => {
  const alcanzados = recorrerDesdeElHandler();

  it("el recorrido encuentra el grafo, no una lista vacia", () => {
    // Si el resolutor se rompiera, la afirmacion de abajo pasaria sobre nada.
    // El handler alcanza el motor de fila, la capa de datos, el correo y la
    // observabilidad: son decenas de archivos, no dos.
    expect(alcanzados.size).toBeGreaterThan(25);
    expect([...alcanzados.keys()].map(comoRuta)).toContain(
      "src/lib/correo/procesarOutbox.ts",
    );
    expect([...alcanzados.keys()].map(comoRuta)).toContain(
      "src/lib/fila/cerrarFilaDelLote.ts",
    );
  });

  it("ninguno de los archivos alcanzados lleva la guarda", () => {
    const culpables = [...alcanzados.entries()]
      .filter(([archivo]) => GUARDA.test(readFileSync(archivo, "utf8")))
      .map(([, camino]) => camino.map(comoRuta).join("\n    -> "));

    expect(
      culpables,
      culpables.length > 0
        ? `Estos archivos tumban el barrido en el arranque. Cadena de importacion:\n    ${culpables.join("\n\n    ")}`
        : "",
    ).toEqual([]);
  });

  it("los archivos de la aplicacion que el barrido NO alcanza si la conservan", () => {
    // La contraparte: quitar la guarda de los 17 archivos alcanzables fue una
    // concesion acotada, no un abandono de la frontera. Si alguien la quitara
    // de todo `src/lib` "por consistencia", esto lo delata.
    const conGuardaFueraDelBarrido = [
      "src/lib/convocatorias/crearConvocatoria.ts",
      "src/lib/vehiculos/obtenerVehiculo.ts",
      "src/lib/auth/devMode.ts",
    ];

    for (const ruta of conGuardaFueraDelBarrido) {
      const absoluta = join(RAIZ, ruta);
      expect(existsSync(absoluta), `${ruta} ya no existe`).toBe(true);
      expect(GUARDA.test(readFileSync(absoluta, "utf8")), ruta).toBe(true);
      expect([...alcanzados.keys()].map(comoRuta), ruta).not.toContain(ruta);
    }
  });
});
