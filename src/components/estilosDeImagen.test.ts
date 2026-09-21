// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// **El defecto que este archivo existe para que no vuelva.**
//
// Toda fotografia de la aplicacion se renderiza con los atributos `width` y
// `height` del `<img>`, a proposito: es lo que permite al navegador reservar el
// hueco antes de descargar la imagen y lo que evita que la pagina salte. Pero
// el navegador los traduce a *presentational hints*, declaraciones de origen
// autor con la prioridad mas baja — no a "valores por omision que cualquier
// cosa pisa".
//
// La consecuencia es contraintuitiva: una hoja que declara `width: 100%` pisa
// el primero y deja el segundo en pie. Con **ancho y alto definidos**,
// `aspect-ratio` se ignora por especificacion. El sintoma es que cada imagen
// sale con la altura natural de su archivo, que es justo lo que el
// `aspect-ratio` pretendia uniformar.
//
// Paso en `.rejilla-lotes__foto` y no en `.galeria-vehiculo__imagen`, que si
// traia `height: auto`: la misma persona escribio las dos, asi que el
// conocimiento existia y lo que faltaba era algo que lo exigiera.
//
// **Ninguna prueba de componente puede verlo**: jsdom no calcula maquetacion,
// asi que `getComputedStyle` no resuelve `aspect-ratio` ni alturas. La unica
// comprobacion posible en proceso es leer la hoja, que es lo que se hace aqui.
// El precio es que esto mira texto CSS y no pixeles; la contrapartida es que
// falla en la compuerta y no semanas despues, sobre el entorno desplegado.

const DIRECTORIO = join(import.meta.dirname, ".");

/** Un bloque `selector { ... }` de una hoja, sin comentarios. */
type Regla = { selector: string; cuerpo: string; archivo: string };

const sinComentarios = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, "");

const reglasDe = (archivo: string): Regla[] => {
  const css = sinComentarios(readFileSync(join(DIRECTORIO, archivo), "utf8"));
  const reglas: Regla[] = [];

  for (const coincidencia of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (coincidencia[1] ?? "").trim();
    // Las at-rules (`@media`, `@keyframes`) anidan y este analizador no las
    // entiende. Se omiten: ninguna regla de imagen del proyecto vive dentro de
    // una, y si alguna llegara a vivir ahi es mejor no mirarla que mirarla mal.
    if (selector.startsWith("@") || selector === "") continue;
    reglas.push({ selector, cuerpo: coincidencia[2] ?? "", archivo });
  }

  return reglas;
};

const declara = (cuerpo: string, propiedad: string): string | undefined =>
  new RegExp(`(?:^|;)\\s*${propiedad}\\s*:\\s*([^;]+)`)
    .exec(cuerpo)?.[1]
    ?.trim();

const hojas = readdirSync(DIRECTORIO).filter((archivo) =>
  archivo.endsWith(".css"),
);

const todasLasReglas = hojas.flatMap(reglasDe);

describe("hojas de estilo de los componentes", () => {
  it("hay hojas que inspeccionar y el analizador las entiende", () => {
    // Si el filtro o la expresion se rompieran, todo lo de abajo pasaria sobre
    // una lista vacia — el modo de fallo que este archivo combate.
    expect(hojas.length).toBeGreaterThan(5);
    expect(todasLasReglas.length).toBeGreaterThan(20);
  });

  it("toda regla con aspect-ratio neutraliza el atributo height del <img>", () => {
    const sospechosas = todasLasReglas
      .filter((regla) => {
        const ratio = declara(regla.cuerpo, "aspect-ratio");
        // `aspect-ratio: auto` no uniforma nada: es justamente la renuncia, y
        // ahi el alto natural de la imagen es lo que se quiere.
        if (ratio === undefined || ratio === "auto") return false;

        // Basta con que el alto quede resuelto por CSS, sea `auto` o un valor
        // explicito. Lo que no puede pasar es que no se diga nada y gane el
        // atributo.
        return (
          declara(regla.cuerpo, "height") === undefined &&
          declara(regla.cuerpo, "block-size") === undefined &&
          declara(regla.cuerpo, "max-height") === undefined
        );
      })
      .map((regla) => `${regla.archivo}: ${regla.selector}`);

    expect(
      sospechosas,
      "Una regla con `aspect-ratio` y sin `height` deja en pie el" +
        " *presentational hint* del atributo `height` del `<img>`: con ancho y" +
        " alto definidos, `aspect-ratio` se ignora y cada imagen sale con su" +
        " altura natural. Agregar `height: auto`.",
    ).toEqual([]);
  });

  it("la rejilla del catalogo uniforma sus fotografias", () => {
    // El caso concreto que fallo, fijado aparte de la regla general: si alguien
    // reescribe la hoja, esto dice que se perdio.
    const regla = reglasDe("RejillaDeLotes.css").find(
      (una) => una.selector === ".rejilla-lotes__foto",
    );

    expect(regla).toBeDefined();
    expect(declara(regla?.cuerpo ?? "", "aspect-ratio")).toBe("4 / 3");
    expect(declara(regla?.cuerpo ?? "", "height")).toBe("auto");
    expect(declara(regla?.cuerpo ?? "", "object-fit")).toBe("cover");
  });
});
