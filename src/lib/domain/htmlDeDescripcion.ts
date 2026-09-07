// Validacion del HTML que produce el editor enriquecido.
//
// **Por que existe.** `descripcionParticipacion` la ve todo participante, asi
// que es el objetivo de XSS almacenado mas valioso de la aplicacion. El editor
// solo restringe al usuario honesto: la action recibe una cadena, y un POST
// fabricado puede mandar la que sea.
//
// **Por que no basta `HtmlFragment`.** Se midio (ver
// `desafios-implementacion.md` seccion 27): React neutraliza los manejadores de
// evento en cadena —`onerror`, `onclick`— y las URLs `javascript:`, pero un
// `<script>` se renderiza como elemento igual. En un navegador, un `script`
// creado por `createElement` con texto antes de insertarse **si se ejecuta**.
//
// **Por que rechaza en vez de limpiar.** Limpiar exige entender toda la entrada
// para decidir que quitar, y ahi es donde los saneadores se rompen: basta una
// forma que el limpiador interprete distinto que el navegador. Rechazar solo
// exige reconocer lo permitido; **todo lo que no se reconoce se rechaza**, que
// es el lado seguro. Y como el editor va con `availableControls` restringido, un
// usuario honesto nunca produce algo fuera de esta lista.

/**
 * Lo unico que puede aparecer en una descripcion. Coincide con los controles
 * que se le habilitan al editor: si se habilita uno mas, hay que agregarlo aqui
 * o el servidor rechazara lo que el editor acaba de producir.
 */
export const ETIQUETAS_PERMITIDAS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "ul",
  "ol",
  "li",
  "a",
] as const;

/** Esquemas admisibles en un enlace. Nada de `javascript:` ni `data:`. */
const ENLACE_ADMISIBLE = /^(https?:\/\/|\/)/i;

// Cada `<...>` del documento. Se recorre entero: lo que no encaje con esta
// forma —un `<` suelto en el texto— no es una etiqueta y no se examina.
const ETIQUETA = /<([^>]*)>/g;

// Nombre de la etiqueta y si es de cierre.
const NOMBRE = /^\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/;

// `href="..."` o `href='...'`, que es lo unico que se admite como atributo.
const HREF = /^href\s*=\s*("([^"]*)"|'([^']*)')$/i;

export type MotivoDeHtml = "etiqueta_no_admitida" | "enlace_no_admitido";

/**
 * Revisa el HTML de una descripcion. `undefined` significa que se puede
 * guardar.
 */
export const revisarHtmlDeDescripcion = (
  html: string,
): MotivoDeHtml | undefined => {
  for (const coincidencia of html.matchAll(ETIQUETA)) {
    const interior = coincidencia[1] ?? "";

    // Comentarios, declaraciones y secciones CDATA: no hacen falta para una
    // descripcion y son una forma clasica de esconder carga util.
    if (interior.startsWith("!") || interior.startsWith("?")) {
      return "etiqueta_no_admitida";
    }

    const nombre = NOMBRE.exec(interior);
    if (!nombre) return "etiqueta_no_admitida";

    const [, cierre, etiqueta = ""] = nombre;
    if (
      !(ETIQUETAS_PERMITIDAS as readonly string[]).includes(
        etiqueta.toLowerCase(),
      )
    ) {
      return "etiqueta_no_admitida";
    }

    // Una etiqueta de cierre no lleva atributos; si trae algo mas, no es lo que
    // aparenta.
    const resto = interior
      .slice(nombre[0].length)
      .replace(/\/\s*$/, "")
      .trim();
    if (cierre === "/") {
      if (resto !== "") return "etiqueta_no_admitida";
      continue;
    }

    if (resto === "") continue;

    // El unico atributo admitido, en el unico elemento que lo admite.
    if (etiqueta.toLowerCase() !== "a") return "etiqueta_no_admitida";

    const enlace = HREF.exec(resto);
    if (!enlace) return "etiqueta_no_admitida";

    const destino = (enlace[2] ?? enlace[3] ?? "").trim();
    if (!ENLACE_ADMISIBLE.test(destino)) return "enlace_no_admitido";
  }

  return undefined;
};
