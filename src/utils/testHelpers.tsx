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

export const genericTests = <P extends object>(
  context: TestContext,
  Component: ComponentType<P>,
  props: P,
): void => {
  it("se renderiza sin errores", async () => {
    await act(async () => {
      context.root.render(<Component {...props} />);
    });

    expect(context.container).toBeTruthy();
  });

  it("no tiene violaciones de accesibilidad", async () => {
    await act(async () => {
      context.root.render(<Component {...props} />);
    });

    const resultados = await globalThis.axe(context.container);

    expect(resultados).toHaveNoViolations();
  });
};
