import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import CuentaRegresiva from "./CuentaRegresiva";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const context = getTestContext();
genericTests(context, CuentaRegresiva, {
  segundosIniciales: 3_600,
  idioma: "es",
});

describe("CuentaRegresiva", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("muestra el valor inicial que calculo el servidor", async () => {
    await act(async () => {
      context.root.render(
        <CuentaRegresiva segundosIniciales={2 * 3_600} idioma="es" />,
      );
    });
    expect(context.container.textContent).toBe("2 h 0 min");
  });

  it("decrementa cada segundo sin volver a preguntarle al servidor", async () => {
    await act(async () => {
      context.root.render(
        <CuentaRegresiva segundosIniciales={61} idioma="es" />,
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(context.container.textContent).toBe("0 min");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("al llegar a cero, revalida contra el servidor una sola vez", async () => {
    await act(async () => {
      context.root.render(
        <CuentaRegresiva segundosIniciales={2} idioma="es" />,
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("un nuevo valor inicial reinicia el contador", async () => {
    await act(async () => {
      context.root.render(
        <CuentaRegresiva segundosIniciales={10} idioma="es" />,
      );
    });
    await act(async () => {
      context.root.render(
        <CuentaRegresiva segundosIniciales={3_600} idioma="es" />,
      );
    });
    expect(context.container.textContent).toBe("1 h 0 min");
  });
});
