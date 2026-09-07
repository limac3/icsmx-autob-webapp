// @vitest-environment node
import { describe, expect, it } from "vitest";
import { revisarHtmlDeDescripcion } from "./htmlDeDescripcion";

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

  it("rechaza cualquier atributo que no sea href en un enlace", () => {
    expect(
      revisarHtmlDeDescripcion('<a href="/x" target="_blank">ir</a>'),
    ).toBe("etiqueta_no_admitida");
    expect(revisarHtmlDeDescripcion('<strong class="x">hola</strong>')).toBe(
      "etiqueta_no_admitida",
    );
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
});
