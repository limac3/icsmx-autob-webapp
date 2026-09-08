import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import DictamenDePago from "./DictamenDePago";

const avalar = vi.fn();
const rechazar = vi.fn();

vi.mock("@/app/actions/tesoreria", () => ({
  avalarPago: (...args: unknown[]) => avalar(...args),
  rechazarPago: (...args: unknown[]) => rechazar(...args),
}));

// El `TextArea` y el `DialogModal` arrastran `Fade`, que mide el
// desbordamiento con un `setTimeout` de 50 ms y aterriza fuera del `act` de
// la prueba (mismo motivo que en `AccionesDeConvocatoria.test.tsx`).
vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
}));

const context = getTestContext();
const diccionario = obtenerDiccionario("es");

genericTests(context, DictamenDePago, {
  solicitudId: "L1-2",
  puedeDictaminar: true,
  diccionario,
});

const pintar = async (puedeDictaminar: boolean) => {
  await act(async () => {
    context.root.render(
      <DictamenDePago
        solicitudId="L1-2"
        puedeDictaminar={puedeDictaminar}
        diccionario={diccionario}
      />,
    );
  });
};

const boton = (texto: string) =>
  [...context.container.querySelectorAll("button")].find((elemento) =>
    elemento.textContent?.includes(texto),
  );

// React rastrea el valor anterior en el propio nodo para decidir si dispara
// el `onChange` sintetico; asignar `campo.value` a secas no lo engaña. El
// truco estandar es llamar al setter **nativo** del prototipo, que es lo que
// hace `fireEvent.change` de Testing Library por debajo.
const escribirMotivo = async (texto: string) => {
  const campo = context.container.querySelector(
    'textarea[name="motivo"]',
  ) as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("quien solo audita no ve los botones", () => {
  it("Autob_Auditar ve la pantalla pero no puede dictaminar", async () => {
    await pintar(false);

    expect(boton("Avalar pago")).toBeUndefined();
    expect(boton("Rechazar pago")).toBeUndefined();
  });
});

describe("avalar pago", () => {
  it("pide confirmacion antes de llamar a la action", async () => {
    await pintar(true);

    await act(async () => {
      boton("Avalar pago")?.click();
    });

    expect(avalar).not.toHaveBeenCalled();
    expect(context.container.textContent).toContain("marcado como vendido");
  });

  it("confirmado, avala de verdad y muestra el resultado", async () => {
    avalar.mockResolvedValue({ ok: true, data: { estatus: "VENDIDA" } });
    await pintar(true);

    await act(async () => {
      boton("Avalar pago")?.click();
    });
    await act(async () => {
      boton("Sí, continuar")?.click();
    });

    expect(avalar).toHaveBeenCalledWith({ solicitudId: "L1-2" });
    expect(context.container.textContent).toContain(
      diccionario.tesoreria.hechoAvalar,
    );
  });

  it("un error del servidor se muestra traducido", async () => {
    avalar.mockResolvedValue({ ok: false, error: "invalid_state" });
    await pintar(true);

    await act(async () => {
      boton("Avalar pago")?.click();
    });
    await act(async () => {
      boton("Sí, continuar")?.click();
    });

    expect(context.container.textContent).toContain(
      diccionario.errores.invalid_state,
    );
  });
});

describe("rechazar pago — R-16", () => {
  it("el boton de rechazar esta deshabilitado sin motivo", async () => {
    await pintar(true);

    expect(boton("Rechazar pago")?.disabled).toBe(true);
  });

  it("con motivo, pide confirmacion y advierte la reasignacion automatica", async () => {
    await pintar(true);
    await escribirMotivo("El comprobante no coincide con el monto");

    expect(boton("Rechazar pago")?.disabled).toBe(false);

    await act(async () => {
      boton("Rechazar pago")?.click();
    });

    expect(rechazar).not.toHaveBeenCalled();
    expect(context.container.textContent).toContain(
      "adjudicará automáticamente al siguiente participante",
    );
  });

  it("confirmado, rechaza con el motivo capturado", async () => {
    rechazar.mockResolvedValue({
      ok: true,
      data: { estatus: "RECHAZADA_POR_TESORERIA" },
    });
    await pintar(true);
    await escribirMotivo("Sin evidencia de pago");

    await act(async () => {
      boton("Rechazar pago")?.click();
    });
    await act(async () => {
      boton("Sí, continuar")?.click();
    });

    expect(rechazar).toHaveBeenCalledWith({
      solicitudId: "L1-2",
      motivo: "Sin evidencia de pago",
    });
    expect(context.container.textContent).toContain(
      diccionario.tesoreria.hechoRechazar,
    );
  });
});
