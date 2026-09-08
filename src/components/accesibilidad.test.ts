// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Etapa 12 — "accesibilidad: axe sin violaciones en todas las pantallas".
//
// Las violaciones concretas ya las detecta cada prueba de componente:
// `genericTests` de `src/utils/testHelpers.tsx` monta el componente y le pasa
// axe. Lo que **no** existia es lo que impide que llegue un componente nuevo
// sin esa comprobacion, y eso es lo que hace este archivo: un inventario que
// falla cuando alguien agrega un componente y no lo cubre.
//
// La diferencia importa. Una prueba que verifica 26 de 27 componentes pasa en
// verde; la que falta es justamente la que nadie revisara. Aqui la ausencia de
// una prueba **es** el fallo, igual que en la alarma del barrido la ausencia de
// datos es el fallo.
//
// **No cubre las paginas de `src/app/`**, y no por olvido: son Server
// Components asincronos que leen sesion y DynamoDB, asi que no se pueden montar
// en jsdom. Una pagina es una composicion de estos componentes mas su propio
// marcado de encuadre; lo primero queda cubierto aqui y lo segundo exige un
// navegador de verdad. Es el punto [OPERADOR] de la Etapa 12.

const DIRECTORIO = join(import.meta.dirname, ".");

/**
 * Componentes que no pasan por axe, con la razon por la que no pueden.
 *
 * Los tres son Server Components **asincronos**: devuelven una promesa, leen la
 * sesion o el idioma de la peticion, y `createRoot().render()` de jsdom no sabe
 * resolver eso. Sus pruebas los invocan como funcion y comprueban las props del
 * componente de Eden que devuelven, que es lo unico verificable sin un
 * navegador. Su marcado es el de `WorkforceHeader` y `WorkforceFooter`, que
 * Eden ya prueba por su cuenta.
 *
 * Cerrada a proposito: agregar una entrada exige escribir aqui por que, y eso
 * es mas incomodo que escribir la prueba. Es el efecto buscado.
 */
const SIN_AXE = new Map([
  ["EncabezadoAplicacion", "Server Component asincrono: lee la sesion"],
  ["PieAplicacion", "Server Component asincrono: lee el idioma de la peticion"],
  [
    "PanelDeIdentidadSimulada",
    "Server Component asincrono: lee la cookie de impersonacion",
  ],
]);

const componentes = readdirSync(DIRECTORIO)
  .filter((archivo) => archivo.endsWith(".tsx") && !archivo.includes(".test."))
  .map((archivo) => archivo.replace(/\.tsx$/, ""))
  .sort();

describe("inventario de accesibilidad de los componentes", () => {
  it("hay componentes que inventariar", () => {
    // Si el filtro se rompiera, todas las afirmaciones de abajo pasarian
    // sobre una lista vacia.
    expect(componentes.length).toBeGreaterThan(20);
  });

  it.each(componentes)(
    "%s pasa por axe, o declara por que no puede",
    (nombre) => {
      const razon = SIN_AXE.get(nombre);
      if (razon) {
        expect(
          razon.length,
          `la razon de ${nombre} esta vacia`,
        ).toBeGreaterThan(10);
        return;
      }

      const prueba = join(DIRECTORIO, `${nombre}.test.tsx`);
      const contenido = readFileSync(prueba, "utf8");

      expect(
        contenido,
        `${nombre}.test.tsx no llama a genericTests: sin eso el componente` +
          " nunca pasa por axe. Si no puede montarse en jsdom, agregarlo a" +
          " SIN_AXE con la razon.",
      ).toContain("genericTests");
    },
  );

  it("ninguna excepcion de SIN_AXE sobra", () => {
    // Una entrada que ya no corresponde a ningun archivo es una exencion
    // olvidada: el dia que alguien cree un componente con ese nombre, nacera
    // exento sin que nadie lo decida.
    for (const nombre of SIN_AXE.keys()) {
      expect(
        componentes,
        `SIN_AXE menciona ${nombre}, que ya no existe`,
      ).toContain(nombre);
    }
  });
});
