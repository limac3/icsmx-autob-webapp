// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Algunos componentes de Eden deciden que renderizar **comparando el tipo de
// sus hijos por identidad** (`child.type === Option`). Esa identidad no
// sobrevive la frontera de RSC: los hijos que crea un Server Component llegan
// como referencias perezosas, la comparacion falla y el componente toma el
// camino equivocado. Con `Select` eso es un 500; con `Table` es peor, porque no
// falla — las tarjetas de la vista movil se quedan sin etiquetas.
//
// Ninguna prueba de componente lo detecta: en jsdom todo se renderiza del lado
// del cliente y la identidad siempre coincide. De ahi esta invariante, que mira
// el codigo fuente en vez del render.
//
// Ver agent_files/desafios-implementacion.md seccion 23.

const SRC = join(fileURLToPath(import.meta.url), "..", "..");

/**
 * Simbolos cuya presencia obliga a `"use client"` en el archivo.
 *
 * Solo estan los verificados en el codigo de Eden. La misma familia incluye
 * `FieldSet` (busca `Hint` y `Legend`), `FormField` (busca `Hint` y `Label`, y
 * por eso aqui la etiqueta se pasa como **prop** y no como hijo) y `Fade`
 * (busca `Scrollable`); se agregan cuando alguna pantalla los use con esos
 * hijos, no antes, para que la lista no genere falsos positivos.
 */
const EXIGEN_CLIENTE = [
  {
    paquete: "@churchofjesuschrist/eden-table",
    simbolos: ["Table"],
    porque:
      "Table arma las columnas con child.type === ColGroup / === THead, y CardView" +
      " saca de ahi la etiqueta de cada celda en la vista movil",
  },
  {
    paquete: "@churchofjesuschrist/eden-form-parts",
    simbolos: ["Option", "OptGroup"],
    porque:
      "Select decide si monta su desplegable con child.type === Option; si falla," +
      " los Option se renderizan sin su contexto y la peticion revienta",
  },
] as const;

const archivosFuente = (directorio: string): string[] =>
  readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(directorio, entrada.name);
    if (entrada.isDirectory()) return archivosFuente(ruta);
    if (!entrada.name.endsWith(".tsx") && !entrada.name.endsWith(".ts"))
      return [];
    // Las pruebas quedan fuera a proposito: montan en jsdom, del lado del
    // cliente, donde esta frontera no existe.
    if (entrada.name.includes(".test.")) return [];
    return [ruta];
  });

const esCliente = (contenido: string): boolean =>
  /^\s*["']use client["']/.test(contenido);

const simbolosImportados = (contenido: string, paquete: string): string[] => {
  const patron = new RegExp(
    String.raw`import\s*\{([^}]*)\}\s*from\s*["']` + paquete + String.raw`["']`,
    "g",
  );
  return [...contenido.matchAll(patron)].flatMap((coincidencia) =>
    (coincidencia[1] ?? "")
      .split(",")
      .map(
        (bruto) =>
          bruto
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0],
      )
      .filter((nombre): nombre is string => Boolean(nombre)),
  );
};

describe("componentes de Eden que inspeccionan a sus hijos por identidad", () => {
  const archivos = archivosFuente(SRC);

  it("encuentra archivos que revisar", () => {
    // Si el barrido se rompe, todo lo de abajo pasa por vacio.
    expect(archivos.length).toBeGreaterThan(5);
  });

  it.each(EXIGEN_CLIENTE)(
    "todo archivo que use $simbolos de $paquete es componente cliente",
    ({ paquete, simbolos, porque }) => {
      const infractores = archivos
        .map((ruta) => ({ ruta, contenido: readFileSync(ruta, "utf8") }))
        .filter(({ contenido }) => {
          const importados = simbolosImportados(contenido, paquete);
          return simbolos.some((simbolo) => importados.includes(simbolo));
        })
        .filter(({ contenido }) => !esCliente(contenido))
        .map(({ ruta }) => ruta.slice(SRC.length + 1).replaceAll("\\", "/"));

      expect(infractores, porque).toEqual([]);
    },
  );
});

// --- "use server": solo funciones async ------------------------------------
//
// Un modulo `"use server"` no puede exportar nada que no sea una funcion async.
// Exportar un objeto, aunque solo lo use el cliente para inicializar
// `useActionState`, hace fallar la evaluacion del modulo:
//
//   A "use server" file can only export async functions, found object
//
// No lo detecta `tsc` —el tipo es correcto— ni `next build`: la compilacion
// pasa y la pagina revienta al servirse. Ver desafios-implementacion.md 24.

const esServidor = (contenido: string): boolean =>
  /^\s*["']use server["']/.test(contenido);

const exportacionesNoAsync = (contenido: string): string[] => {
  const valores = [
    ...contenido.matchAll(
      /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)[^=\n]*=\s*/gm,
    ),
  ]
    .filter((coincidencia) => {
      const resto = contenido.slice(
        (coincidencia.index ?? 0) + coincidencia[0].length,
      );
      return !resto.startsWith("async");
    })
    .map((coincidencia) => coincidencia[1] ?? "");

  const funciones = [
    ...contenido.matchAll(
      /^export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    ),
  ]
    .filter((coincidencia) => coincidencia[1] === undefined)
    .map((coincidencia) => coincidencia[2] ?? "");

  return [...valores, ...funciones];
};

describe('modulos "use server"', () => {
  const servidores = archivosFuente(SRC)
    .map((ruta) => ({ ruta, contenido: readFileSync(ruta, "utf8") }))
    .filter(({ contenido }) => esServidor(contenido));

  it("hay al menos un modulo de Server Actions que revisar", () => {
    expect(servidores.length).toBeGreaterThan(0);
  });

  it("solo exportan funciones async", () => {
    const infractores = servidores.flatMap(({ ruta, contenido }) =>
      exportacionesNoAsync(contenido).map(
        (nombre) =>
          `${ruta.slice(SRC.length + 1).replaceAll("\\", "/")}: ${nombre}`,
      ),
    );

    expect(
      infractores,
      'un modulo "use server" solo puede exportar funciones async; mover el valor a src/types/',
    ).toEqual([]);
  });
});
