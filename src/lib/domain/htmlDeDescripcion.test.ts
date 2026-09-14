// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  revisarHtmlDeDescripcion,
  textoPlanoDeDescripcion,
} from "./htmlDeDescripcion";

describe("lo que el editor produce se acepta", () => {
  it.each([
    "<p>Abierta al personal de flotilla.</p>",
    "<p>Texto con <strong>negrita</strong> y <em>cursiva</em>.</p>",
    "<h2>Requisitos</h2><ul><li>Uno</li><li>Dos</li></ul>",
    "<blockquote>Una cita</blockquote><pre>codigo</pre>",
    "<p>Salto<br>de linea</p>",
    '<p>Ver <a href="https://churchofjesuschrist.org">el aviso</a>.</p>',
    "<p>Ruta interna: <a href='/ayuda'>ayuda</a>.</p>",
    "",
    "Texto sin ninguna etiqueta.",
  ])("acepta %s", (html) => {
    expect(revisarHtmlDeDescripcion(html)).toBeUndefined();
  });

  it("acepta un menor-que escapado, que es lo que el editor produce", () => {
    // Quien escribe "Precio < 200000" en el editor produce `&lt;`: un `<` suelto
    // no es HTML valido y ningun editor lo emite.
    expect(
      revisarHtmlDeDescripcion("<p>Precio &lt; 200000 pesos</p>"),
    ).toBeUndefined();
  });

  it("rechaza un menor-que sin escapar", () => {
    // Escribi esta prueba esperando que pasara y el validador la rechaza: el
    // `<` suelto y el `>` siguiente forman algo con pinta de etiqueta. Es el
    // lado correcto — si la cadena no es HTML bien formado, no sabemos como la
    // va a interpretar el navegador, y adivinar es justamente lo que rompe a
    // los saneadores.
    expect(revisarHtmlDeDescripcion("<p>Precio < 200000 pesos</p>")).toBe(
      "etiqueta_no_admitida",
    );
  });
});

describe("lo que no se reconoce se rechaza", () => {
  it("rechaza un script, que es lo que HtmlFragment deja pasar al DOM", () => {
    // El hallazgo que motiva este modulo: React neutraliza los manejadores de
    // evento y las URLs `javascript:`, pero renderiza el elemento `script`.
    expect(
      revisarHtmlDeDescripcion("<p>hola</p><script>alert(1)</script>"),
    ).toBe("etiqueta_no_admitida");
  });

  it.each([
    ['<iframe src="https://ejemplo.test"></iframe>', "iframe"],
    ["<style>body{display:none}</style>", "style"],
    ['<object data="x"></object>', "object"],
    ['<img src="x">', "img"],
    ['<form action="/robar"></form>', "form"],
    ['<svg><use href="x"/></svg>', "svg"],
  ])("rechaza %s", (html) => {
    expect(revisarHtmlDeDescripcion(html)).toBe("etiqueta_no_admitida");
  });

  it("rechaza un manejador de evento aunque la etiqueta este permitida", () => {
    expect(revisarHtmlDeDescripcion('<p onclick="alert(1)">hola</p>')).toBe(
      "etiqueta_no_admitida",
    );
  });

  it("admite lo que el editor produce al abrir en pestana nueva", () => {
    // `eden-rich-text-editor` tiene una casilla "abrir en pestana nueva" y su
    // exportador escribe estos dos atributos. Rechazarlos dejaba un formulario
    // imposible de guardar (desafios 73), igual que paso con `mailto:` (58).
    expect(
      revisarHtmlDeDescripcion(
        '<a href="https://ejemplo.test" target="_blank" rel="noopener">ir</a>',
      ),
    ).toBeUndefined();
    // Y en el orden inverso, que tambien es HTML valido.
    expect(
      revisarHtmlDeDescripcion(
        '<a rel="noopener noreferrer" target="_blank" href="/x">ir</a>',
      ),
    ).toBeUndefined();
  });

  it("rechaza atributos fuera de la lista, y valores fuera de lo previsto", () => {
    // El atributo no existe para un enlace.
    expect(
      revisarHtmlDeDescripcion('<a href="/x" download="a.pdf">ir</a>'),
    ).toBe("etiqueta_no_admitida");
    // El atributo si existe, pero con un valor que el editor no produce:
    // `_self` no aporta nada y `rel` arbitrario abre la puerta a mas.
    expect(revisarHtmlDeDescripcion('<a href="/x" target="_self">ir</a>')).toBe(
      "etiqueta_no_admitida",
    );
    expect(
      revisarHtmlDeDescripcion('<a href="/x" rel="cualquiera">ir</a>'),
    ).toBe("etiqueta_no_admitida");
    // Ningun otro elemento admite atributos.
    expect(revisarHtmlDeDescripcion('<strong class="x">hola</strong>')).toBe(
      "etiqueta_no_admitida",
    );
  });

  it("rechaza un atributo sin comillas aunque venga junto a otros validos", () => {
    // La propiedad que sostiene todo lo anterior: el resto se consume atributo
    // por atributo y lo que no encaja **cae**. Un escaneo global habria
    // reconocido el `href` e ignorado lo de al lado.
    expect(
      revisarHtmlDeDescripcion('<a href="/x" onclick=alert(1)>ir</a>'),
    ).toBe("etiqueta_no_admitida");
    expect(
      revisarHtmlDeDescripcion('<a href="/x" onclick="alert(1)">ir</a>'),
    ).toBe("etiqueta_no_admitida");
  });

  it("rechaza un enlace con atributos pero sin href", () => {
    expect(revisarHtmlDeDescripcion('<a target="_blank">ir</a>')).toBe(
      "etiqueta_no_admitida",
    );
  });

  it("sigue revisando el esquema aunque el href no sea el primer atributo", () => {
    expect(
      revisarHtmlDeDescripcion(
        '<a target="_blank" href="javascript:alert(1)">ir</a>',
      ),
    ).toBe("enlace_no_admitido");
  });

  it("rechaza un comentario, que puede esconder carga util", () => {
    expect(revisarHtmlDeDescripcion("<!-- <script>alert(1)</script> -->")).toBe(
      "etiqueta_no_admitida",
    );
  });

  it("rechaza el anidado que enganaria a un limpiador", () => {
    // `<scr<script>ipt>` es el ataque clasico contra quien **quita** en vez de
    // rechazar: al borrar el interior queda `<script>`. Aqui no aplica, porque
    // lo que no se reconoce no se limpia: se rechaza.
    expect(revisarHtmlDeDescripcion("<scr<script>ipt>alert(1)")).toBe(
      "etiqueta_no_admitida",
    );
  });

  it("rechaza una etiqueta de cierre con cosas pegadas", () => {
    expect(revisarHtmlDeDescripcion("<p>hola</p onclick=x>")).toBe(
      "etiqueta_no_admitida",
    );
  });
});

describe("enlaces", () => {
  it.each([
    '<a href="javascript:alert(1)">ir</a>',
    '<a href="vbscript:msgbox(1)">ir</a>',
    '<a href="  javascript:alert(1)">ir</a>',
  ])("rechaza el esquema de %s", (html) => {
    expect(revisarHtmlDeDescripcion(html)).toBe("enlace_no_admitido");
  });

  it("rechaza un data: con marcado dentro, aunque por otro motivo", () => {
    // Aqui el `<script>` del valor rompe la lectura de la etiqueta, asi que cae
    // como `etiqueta_no_admitida` y no como enlace. Lo que importa es que
    // **cae**: la prueba afirma el rechazo, no el motivo, porque atarla al
    // motivo la volveria fragil sin ganar nada.
    expect(
      revisarHtmlDeDescripcion(
        '<a href="data:text/html,<script>alert(1)</script>">ir</a>',
      ),
    ).toBeDefined();
  });

  it("acepta http y https", () => {
    expect(
      revisarHtmlDeDescripcion('<a href="http://ejemplo.test">ir</a>'),
    ).toBeUndefined();
    expect(
      revisarHtmlDeDescripcion('<a href="https://ejemplo.test">ir</a>'),
    ).toBeUndefined();
  });

  it("acepta mailto: — es la direccion de contacto del negocio", () => {
    // El defecto reportado: la descripcion real de una convocatoria lleva
    // "envie un correo a ventavehiculos@...", el editor ofrece el control de
    // enlace, y el servidor rechazaba lo que el editor acababa de crear. Que la
    // lista blanca sea mas estrecha que los controles habilitados es lo que la
    // cabecera de `htmlDeDescripcion.ts` advierte que no debe pasar.
    expect(
      revisarHtmlDeDescripcion(
        '<a href="mailto:ventavehiculos@churchofjesuschrist.org">escribir</a>',
      ),
    ).toBeUndefined();
  });

  it("sigue rechazando los esquemas que ejecutan codigo", () => {
    // La guarda de que admitir `mailto:` no relajo el resto: es la unica
    // adicion, y se hizo porque no ejecuta nada.
    for (const html of [
      '<a href="javascript:alert(1)">ir</a>',
      '<a href="JaVaScRiPt:alert(1)">ir</a>',
      '<a href="mailtoo:algo">ir</a>',
      '<a href="x-mailto:algo">ir</a>',
    ]) {
      expect(revisarHtmlDeDescripcion(html)).toBe("enlace_no_admitido");
    }
  });
});

describe("textoPlanoDeDescripcion", () => {
  it("quita el marcado y deja la frase legible", () => {
    // Sin esto, la celda del listado muestra las etiquetas a la vista: React
    // las escapa, asi que no es un agujero, pero si un listado ilegible.
    expect(
      textoPlanoDeDescripcion("<p>Abierta al <strong>personal</strong>.</p>"),
    ).toBe("Abierta al personal .");
  });

  it("no pega dos bloques que estaban separados", () => {
    // Sustituir la etiqueta por vacio en vez de por un espacio juntaria el
    // final de un parrafo con el principio del siguiente: "RequisitosUno".
    expect(textoPlanoDeDescripcion("<h2>Requisitos</h2><p>Uno</p>")).toBe(
      "Requisitos Uno",
    );
  });

  it("colapsa los espacios que deja el marcado", () => {
    expect(textoPlanoDeDescripcion("<p>Uno</p>\n\n  <p>Dos</p>")).toBe(
      "Uno Dos",
    );
  });

  it("descifra las entidades, que si no se leerian crudas", () => {
    expect(
      textoPlanoDeDescripcion("<p>Menos de 200&nbsp;000 &amp; algo</p>"),
    ).toBe("Menos de 200 000 & algo");
  });

  it("deja intacta una entidad que no reconoce", () => {
    // Inventarse un caracter para algo que no esta en la lista seria peor que
    // mostrarlo tal cual: la descripcion diria algo que nadie escribio.
    expect(textoPlanoDeDescripcion("<p>&copy; 2026</p>")).toBe("&copy; 2026");
  });

  it("recorta por palabra completa y marca el corte", () => {
    const largo = `<p>${"palabra ".repeat(40)}</p>`;
    const recorte = textoPlanoDeDescripcion(largo, 30);

    // El corte cae en el ultimo espacio que cabe, asi que sale por debajo del
    // maximo: lo que no puede es pasarse ni partir una palabra.
    expect(recorte.length).toBeLessThanOrEqual(31);
    expect(recorte).toBe("palabra palabra palabra…");
  });

  it("no recorta lo que ya cabe", () => {
    expect(textoPlanoDeDescripcion("<p>Corto</p>", 30)).toBe("Corto");
  });

  it("una descripcion sin texto queda vacia, no en espacios", () => {
    expect(textoPlanoDeDescripcion("<p></p><br>")).toBe("");
  });
});

describe("el contenido real que fallo en el ambiente de pruebas", () => {
  // **Esta es la prueba que mas vale de este archivo**: no es un caso inventado,
  // es la descripcion que una persona escribio y que el servidor rechazo con un
  // mensaje que no explicaba nada. Traia dos atributos que el editor pone solo:
  // `title` en el enlace y `value` en cada elemento de lista.
  //
  // El mismo texto pasaba en una maquina y fallaba en otra, y parecia una
  // diferencia de entorno. No lo era: solo una de las dos pruebas llevaba una
  // lista con vinetas.
  const DESCRIPCION_REAL =
    '<h4>Las condiciones físicas, mecánicas y legales que se muestran aquí son generales, verifique las mismas a detalle en las fotos publicadas y antes de ofertar haciendo una visita al sitio donde se encuentra el vehículo, ya que una vez confirmada su compra y enviado la ficha de depósito no habrá devoluciones de pagos realizados.</h4><p>Envíe un correo a <a href="mailto:ventavehiculos@churchofjesuschrist.org" title="ventavehiculos@churchofjesuschrist.org">ventavehiculos@churchofjesuschrist.org</a> indicando el ID en el cuerpo del correo y en el asunto del correo del auto de su interés.</p><p>Las solicitudes se tomarán en cuenta en orden cronológico.</p><p>Se le enviará la ficha de deposito correspondiente dos días después en caso de que sea adjudicado y tendrá 2 días hábiles para efectuar el pago (únicamente se aceptaran pagos por transferencia electrónica, NO efectivo), de lo contrario se pasará la oportunidad al siguiente interesado.</p><p>Al efectuarse el pago, deberá entregar la siguiente documentación en formato PDF:</p><ul><li value="1">Identificación oficial INE o pasaporte.</li><li value="2">Cédula del RFC con domicilio fiscal.</li><li value="3">Copia de la transferencia electrónica.</li><li value="4">Describa uso de CFDI, y regimen fiscal</li></ul><p>Las unidades se entregan sin verificación ambiental y con baja de placa.</p><h3>El vehículo se vende a satisfacción en las condiciones y estado en que se encuentra.</h3>';

  it("se acepta entera", () => {
    expect(revisarHtmlDeDescripcion(DESCRIPCION_REAL)).toBeUndefined();
  });

  it("cada uno de sus dos atributos, por separado", () => {
    expect(
      revisarHtmlDeDescripcion(
        '<a href="mailto:a@b.test" title="a@b.test">a</a>',
      ),
    ).toBeUndefined();
    expect(
      revisarHtmlDeDescripcion('<ul><li value="1">uno</li></ul>'),
    ).toBeUndefined();
  });

  it("y siguen acotados: ni titulo con etiquetas ni valor que no sea numero", () => {
    // `title` es texto inerte, pero no debe poder cerrar la etiqueta.
    expect(
      revisarHtmlDeDescripcion('<a href="/x" title="a<script>b">a</a>'),
    ).toBe("etiqueta_no_admitida");
    expect(revisarHtmlDeDescripcion('<li value="x">uno</li>')).toBe(
      "etiqueta_no_admitida",
    );
    // Y `value` solo existe para `li`: en un parrafo no significa nada.
    expect(revisarHtmlDeDescripcion('<p value="1">uno</p>')).toBe(
      "etiqueta_no_admitida",
    );
  });
});
