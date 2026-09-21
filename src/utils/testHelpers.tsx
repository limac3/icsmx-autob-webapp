import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

// Patron tomado de icsmx-camp-webapp (src/utils/testHelpers.jsx), adaptado a
// TypeScript. getTestContext() monta un contenedor real por prueba;
// genericTests() cubre el render sin fallo y la ausencia de violaciones de
// accesibilidad (axe se configura globalmente en vitest-javascript.setup.mjs
// de festack-scripts).

export type TestContext = {
  container: HTMLDivElement;
  root: Root;
};

export const getTestContext = (): TestContext => {
  const context = {} as TestContext;

  beforeEach(() => {
    context.container = document.createElement("div");
    document.body.appendChild(context.container);
    context.root = createRoot(context.container);
  });

  afterEach(() => {
    act(() => {
      context.root.unmount();
    });
    context.container.remove();
  });

  return context;
};

/**
 * Limite de las dos pruebas genericas, muy por encima de los 5 s por omision.
 *
 * No es holgura por si acaso: `axe` recorre el arbol renderizado con decenas de
 * reglas, y los componentes de Eden montan sus propias hojas de estilo que jsdom
 * reparsea. Un formulario con editor enriquecido tarda ~1 s solo, y **el limite
 * se cruza cuando la compuerta corre las 128 suites en paralelo** — no siempre
 * en el mismo archivo, que es lo que lo delata como contencion de maquina y no
 * como una prueba lenta en particular.
 *
 * Se pone aqui y no en cada archivo porque el defecto era de la utilidad
 * compartida: una compuerta que falla a veces se empieza a reintentar en vez de
 * leerse, y eso cuesta mucho mas que unos segundos de limite.
 */
const LIMITE_DE_PRUEBA_GENERICA = 30_000;

export const genericTests = <P extends object>(
  context: TestContext,
  Component: ComponentType<P>,
  props: P,
): void => {
  it(
    "se renderiza sin errores",
    async () => {
      await act(async () => {
        context.root.render(<Component {...props} />);
      });

      expect(context.container).toBeTruthy();
    },
    LIMITE_DE_PRUEBA_GENERICA,
  );

  it(
    "no tiene violaciones de accesibilidad",
    async () => {
      // **El recorrido de axe va DENTRO del `act`**, y no es cosmetico.
      //
      // Un componente con temporizador propio —`CuentaRegresiva` monta un
      // `setInterval` de un segundo— sigue vivo mientras axe recorre el arbol,
      // y ese recorrido tarda cerca de un segundo. Con el `await` fuera del
      // `act`, el tic caia en tierra de nadie: un `setState` sin envolver, que
      // el setup de festack convierte en excepcion y **hace fallar la compuerta
      // con exit 1 sin marcar ninguna prueba en rojo**.
      //
      // Era flaky por carga —pasaba en `verify:rapido` y fallaba en
      // `verify:despliegue`, que corre mas lento— y por tanto de la peor clase:
      // el sintoma no apunta al componente que lo causa, sino al que se estaba
      // ejecutando cuando el temporizador salto.
      //
      // Se arregla aqui y no en cada prueba porque el defecto es del helper:
      // cualquier componente con un temporizador lo hereda. Y **no** con
      // `vi.useFakeTimers()`, que fue el primer intento: axe usa
      // temporizadores para sus propias fases y con el reloj detenido no
      // termina nunca — la prueba se agota a los 30 s.
      let resultados: unknown;
      await act(async () => {
        context.root.render(<Component {...props} />);
        resultados = await globalThis.axe(context.container);
      });

      expect(resultados).toHaveNoViolations();
    },
    LIMITE_DE_PRUEBA_GENERICA,
  );
};
