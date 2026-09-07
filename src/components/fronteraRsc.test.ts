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
    if (!entrada.name.endsWith(".tsx")) return [];
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
