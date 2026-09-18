import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { retirarVehiculo } from "@/app/actions/vehiculos";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import RetirarVehiculo from "./RetirarVehiculo";

vi.mock("@/app/actions/vehiculos", () => ({
  guardarVehiculoDesdeFormulario: vi.fn(),
  retirarVehiculo: vi.fn(),
}));

const context = getTestContext();
const diccionario = obtenerDiccionario("es");
const etiquetas = diccionario.vehiculos;

genericTests(context, RetirarVehiculo, {
  vehiculoId: "V1",
  diccionario,
});

const pintar = async () => {
  await act(async () => {
    context.root.render(
      <RetirarVehiculo vehiculoId="V1" diccionario={diccionario} />,
    );
  });
};

const porTexto = (texto: string): HTMLButtonElement | undefined =>
  [...context.container.querySelectorAll("button")].find(
    (candidato) => candidato.textContent === texto,
  );

const pulsar = async (texto: string) => {
  await act(async () => {
    porTexto(texto)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const campoDeMotivo = () =>
  context.container.querySelector<HTMLTextAreaElement>(
    'textarea[name="motivo"]',
  );

/**
 * React sobrescribe el descriptor de `value` del elemento para detectar
 * cambios, asi que asignarlo directo le pasa desapercibido: hay que llamar al
 * setter **nativo** del prototipo. Mismo truco que `AccionesDeConvocatoria`.
 */
const escribirMotivo = async (valor: string) => {
  const campo = campoDeMotivo();
  if (!campo) throw new Error("no hay campo de motivo");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

/** El `<dialog>` que monta `ToolModal`, abierto o no. */
const modal = () => context.container.querySelector("dialog");

beforeEach(() => {
  vi.mocked(retirarVehiculo).mockReset();
  vi.mocked(retirarVehiculo).mockResolvedValue({
    ok: true,
    data: { vehiculoId: "V1" },
  });
});

/**
 * **Que el modal esta abierto no se comprueba por el atributo `open`.** jsdom
 * no implementa `HTMLDialogElement.showModal` —es `undefined`— y el modal de
 * Eden lo llama con `?.()`, asi que el `<dialog>` nunca lo recibe en prueba. Lo
 * que si es observable es que el modal **este montado o no**, porque
 * `RetirarVehiculo` lo monta bajo demanda; y eso es lo que importa, porque un
 * `<dialog>` cerrado conservaria sus hijos en el DOM.
 */
describe("el motivo ya no esta suelto en la pantalla", () => {
  it("de entrada no hay ningun campo de motivo", async () => {
    // **Es el defecto que el operador pidio corregir.** El campo obligatorio
    // estaba suelto sobre la pantalla de edicion, sin nada que dijera a que
    // pertenecia, con un boton terminal debajo.
    await pintar();

    expect(porTexto(etiquetas.retirarVehiculo)).toBeDefined();
    expect(campoDeMotivo()).toBeNull();
  });

  it("el boton lo abre, y el motivo aparece dentro del dialogo", async () => {
    await pintar();
    await pulsar(etiquetas.retirarVehiculo);

    const campo = campoDeMotivo();
    expect(campo).not.toBeNull();
    expect(modal()?.contains(campo ?? null)).toBe(true);
  });
});

describe("confirmacion", () => {
  it("advierte que el retiro no se puede deshacer, dentro del dialogo", async () => {
    await pintar();
    await pulsar(etiquetas.retirarVehiculo);

    expect(modal()?.textContent).toContain(etiquetas.retiroAviso);
  });

  it("sin motivo no se puede confirmar", async () => {
    // El motivo es obligatorio porque `VEHICULO_RETIRADO` esta marcado con M:
    // sin el, la bitacora no puede responder por que salio del catalogo.
    await pintar();
    await pulsar(etiquetas.retirarVehiculo);

    expect(porTexto(etiquetas.confirmarRetiro)?.disabled).toBe(true);
  });

  it("el boton de la pantalla no retira por si mismo", async () => {
    await pintar();
    await pulsar(etiquetas.retirarVehiculo);

    expect(retirarVehiculo).not.toHaveBeenCalled();
  });

  it("con motivo, confirmar retira y manda el motivo capturado", async () => {
    await pintar();
    await pulsar(etiquetas.retirarVehiculo);
    await escribirMotivo("Siniestro total");

    expect(porTexto(etiquetas.confirmarRetiro)?.disabled).toBe(false);
    await pulsar(etiquetas.confirmarRetiro);

    expect(retirarVehiculo).toHaveBeenCalledWith("V1", "Siniestro total");
  });

  it("cancelar cierra sin retirar nada", async () => {
    await pintar();
    await pulsar(etiquetas.retirarVehiculo);
    await escribirMotivo("Me equivoque de vehiculo");
    await pulsar(etiquetas.cancelar);

    expect(campoDeMotivo()).toBeNull();
    expect(retirarVehiculo).not.toHaveBeenCalled();
  });

  it("al lograrlo lo dice y no deja repetirlo", async () => {
    await pintar();
    await pulsar(etiquetas.retirarVehiculo);
    await escribirMotivo("Fin de vida util");
    await pulsar(etiquetas.confirmarRetiro);

    expect(context.container.textContent).toContain(etiquetas.retirado);
    expect(porTexto(etiquetas.retirarVehiculo)?.disabled).toBe(true);
  });

  it("un rechazo del servidor se muestra y no se da por hecho", async () => {
    vi.mocked(retirarVehiculo).mockResolvedValue({
      ok: false,
      error: "invalid_state",
    });
    await pintar();
    await pulsar(etiquetas.retirarVehiculo);
    await escribirMotivo("Baja administrativa");
    await pulsar(etiquetas.confirmarRetiro);

    expect(context.container.textContent).toContain(
      diccionario.errores.invalid_state,
    );
    expect(context.container.textContent).not.toContain(etiquetas.retirado);
  });
});
