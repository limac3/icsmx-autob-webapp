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

/**
 * Esquemas admisibles en un enlace. Nada de `javascript:` ni `data:`, que son
 * los dos que ejecutan codigo.
 *
 * **`mailto:` se admite, y no es una concesion.** La descripcion de la
 * participacion es donde el negocio pone su direccion de contacto —"envie un
 * correo a ventavehiculos@..."— y la barra del editor ofrece el control de
 * enlace, asi que un usuario honesto lo produce sin salirse de lo que la
 * aplicacion le habilita. Dejarlo fuera hacia lo que la cabecera de este
 * archivo advierte que no debe pasar: **la lista blanca mas estrecha que los
 * controles del editor**, o sea el servidor rechazando lo que el editor acaba
 * de crear. Y no abre nada: `mailto:` no ejecuta codigo — abre el cliente de
 * correo con la direccion puesta, y sus parametros (`?subject=`, `?body=`) solo
 * rellenan texto.
 *
 * Costo real de la omision: un formulario imposible de guardar y un mensaje que
 * no decia por que (`desafios-implementacion.md` 58).
 */
const ENLACE_ADMISIBLE = /^(https?:\/\/|mailto:|\/)/i;

// Cada `<...>` del documento. Se recorre entero: lo que no encaje con esta
// forma —un `<` suelto en el texto— no es una etiqueta y no se examina.
const ETIQUETA = /<([^>]*)>/g;

// Nombre de la etiqueta y si es de cierre.
const NOMBRE = /^\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/;

/**
 * Un atributo con valor entrecomillado, **anclado al principio** de lo que
 * queda por examinar.
 *
 * Se consume el resto atributo por atributo y **si algo no encaja, se
 * rechaza**. Esa es la propiedad que hay que conservar: un `onclick=alert(1)`
 * sin comillas no encaja con esta forma, y como el resto no queda vacio, la
 * etiqueta cae. Un escaneo global con `matchAll` habria reconocido los
 * atributos buenos e ignorado la basura entre ellos.
 */
const ATRIBUTO = /^\s*([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)')\s*/;

/**
 * Atributos admisibles **por elemento**, con los valores que cada uno puede
 * tomar. Un elemento que no aparece aqui no admite ninguno.
 *
 * **La lista sale de lo que el editor emite, no de lo que parece prudente**, y
 * cada entrada se gano con un formulario que no se podia guardar:
 *
 * - `target` y `rel`: los escribe el exportador de `LinkNode` cuando se marca
 *   la casilla "abrir en pestana nueva".
 * - `title`: Lexical lo pone en el enlace junto al `href`. Es texto inerte —lo
 *   que el navegador muestra al pasar el raton— y el serializador ya escapa su
 *   contenido; se acota a texto sin `<` ni `>` para que no pueda cerrar la
 *   etiqueta.
 * - `value` en `<li>`: Lexical lo emite en **cada** elemento de lista, tambien
 *   en listas con vinetas. Es el numero de orden y se acota a digitos.
 *
 * Esta ultima es la que explica por que el mismo texto pasaba en una maquina y
 * fallaba en otra: no era el entorno, era que solo una de las dos pruebas
 * llevaba una lista (`desafios-implementacion.md` 73).
 *
 * `rel` se acota a los dos valores que **quitan** capacidad a la pestana nueva.
 * No se exige junto a `target` porque los navegadores actuales ya implican
 * `noopener`, y exigirlo volveria a poner al servidor por delante del editor.
 */
const ATRIBUTOS_POR_ETIQUETA: Record<string, Record<string, RegExp>> = {
  a: {
    target: /^_blank$/,
    rel: /^(noopener|noreferrer)(\s+(noopener|noreferrer))*$/,
    title: /^[^<>]*$/,
  },
  li: { value: /^\d{1,4}$/ },
};

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

    const nombreEtiqueta = etiqueta.toLowerCase();
    const admisibles = ATRIBUTOS_POR_ETIQUETA[nombreEtiqueta];
    // Un elemento que no figura en el mapa no admite atributo alguno.
    if (!admisibles) return "etiqueta_no_admitida";

    let pendiente = resto;
    let tieneHref = false;

    while (pendiente !== "") {
      const atributo = ATRIBUTO.exec(pendiente);
      // Queda algo que no tiene forma de atributo entrecomillado: se rechaza
      // sin intentar interpretarlo.
      if (!atributo) return "etiqueta_no_admitida";

      const nombreAtributo = (atributo[1] ?? "").toLowerCase();
      const valor = (atributo[3] ?? atributo[4] ?? "").trim();

      // `href` se trata aparte porque su fallo tiene motivo propio: lo que
      // importa de un enlace no es que lleve el atributo, es a donde apunta.
      if (nombreAtributo === "href" && nombreEtiqueta === "a") {
        tieneHref = true;
        if (!ENLACE_ADMISIBLE.test(valor)) return "enlace_no_admitido";
      } else {
        const patron = admisibles[nombreAtributo];
        if (!patron || !patron.test(valor)) return "etiqueta_no_admitida";
      }

      pendiente = pendiente.slice(atributo[0].length);
    }

    // Un `<a>` con atributos pero sin `href` no es un enlace: es una etiqueta
    // con adornos, y no hay control del editor que la produzca.
    if (nombreEtiqueta === "a" && !tieneHref) return "etiqueta_no_admitida";
  }

  return undefined;
};

/**
 * Entidades que puede producir el editor. La lista corta basta: el marcado
 * permitido no admite nada que necesite mas.
 */
const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  nbsp: " ",
};

const ENTIDAD = /&(#?\w+);/g;

/**
 * Texto plano de una descripcion, para listados y resumenes.
 *
 * **Existe porque la descripcion dejo de ser texto.** Desde que se captura con
 * el editor enriquecido, pintarla directamente en una celda muestra
 * `<p>Abierta al <strong>personal</strong>.</p>` con las etiquetas a la vista:
 * React escapa la cadena, asi que no es un agujero de seguridad, pero si es un
 * listado ilegible.
 *
 * No sustituye al render de la descripcion completa —eso es `HtmlFragment` en
 * la pantalla del participante—, sino que resuelve el caso contrario: donde
 * cabe una linea y el formato estorba.
 */
export const textoPlanoDeDescripcion = (html: string, maximo = 160): string => {
  const texto = html
    .replace(ETIQUETA, " ")
    .replace(
      ENTIDAD,
      (crudo, nombre: string) => ENTIDADES[nombre.toLowerCase()] ?? crudo,
    )
    .replace(/\s+/g, " ")
    .trim();

  if (texto.length <= maximo) return texto;

  // Se corta en el ultimo espacio para no partir una palabra por la mitad.
  const recorte = texto.slice(0, maximo);
  const espacio = recorte.lastIndexOf(" ");
  return `${(espacio > 0 ? recorte.slice(0, espacio) : recorte).trimEnd()}…`;
};
