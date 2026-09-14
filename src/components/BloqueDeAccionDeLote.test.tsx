import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import type { MiLugarDTO } from "@/types/fila";
import BloqueDeAccionDeLote, {
  type BloqueDeAccionDeLoteProps,
} from "./BloqueDeAccionDeLote";

const solicitar = vi.fn();
const cancelar = vi.fn();
const subir = vi.fn();

vi.mock("@/app/actions/fila", () => ({
  solicitarCompra: (...args: unknown[]) => solicitar(...args),
  cancelarSolicitud: (...args: unknown[]) => cancelar(...args),
}));

vi.mock("@/app/actions/tesoreria", () => ({
  subirComprobante: (...args: unknown[]) => subir(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// El `DialogModal` monta un `Fade` que consulta `useHasOverflow`, y ese hook
// arranca un `setTimeout` de 50 ms que en jsdom aterriza fuera del `act` de la
// prueba. Mismo ruido que en `TablaConvocatorias.test.tsx`.
vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
}));

// jsdom no implementa `DataTransfer`, y el `FileInput` de Eden lo usa para
// sincronizar el valor del input con su estado interno. Doble minimo, no un
// cambio al componente (regla 10) — ver desafios-implementacion.md seccion 20.
const listaVacia = (() => {
  const input = document.createElement("input");
  input.type = "file";
  return input.files;
})();

class DataTransferFalso {
  readonly items = { add: () => undefined };
  readonly files = listaVacia;
}

globalThis.DataTransfer ??=
  DataTransferFalso as unknown as typeof globalThis.DataTransfer;

const diccionario = obtenerDiccionario("es");

const base: BloqueDeAccionDeLoteProps = {
  convocatoriaId: "C1",
  loteId: "L1",
  miLugar: null,
  estatusLote: "EN_OFERTA",
  venta: { fase: "ABIERTA" },
  diccionario,
  idioma: "es",
};

const lugar = (
  estatus: MiLugarDTO["estatus"],
  extra: Partial<MiLugarDTO> = {},
): MiLugarDTO => ({
  solicitudId: "L1-4",
  loteId: "L1",
  miTurno: 4,
  miPosicion: 3,
  tamanoFila: 7,
  estatus,
  ...extra,
});

const context = getTestContext();

genericTests(context, BloqueDeAccionDeLote, base);

const pintar = async (props: Partial<BloqueDeAccionDeLoteProps>) => {
  await act(async () => {
    context.root.render(<BloqueDeAccionDeLote {...base} {...props} />);
  });
  return context.container;
};

const boton = (texto: string) =>
  [...context.container.querySelectorAll("button")].find((elemento) =>
    elemento.textContent?.includes(texto),
  );

describe("sin solicitud propia", () => {
  it("con la venta abierta ofrece solicitar", async () => {
    const contenedor = await pintar({});
    expect(contenedor.textContent).toContain("Solicitar compra");
    expect(boton("Solicitar compra")?.disabled).toBe(false);
  });

  it("antes de abrir muestra la cuenta regresiva y el boton deshabilitado", async () => {
    // El boton existe y no se puede pulsar: explica que la accion llegara. Al
    // llegar a cero se revalida contra el servidor, nunca contra el reloj del
    // navegador (R-04).
    const contenedor = await pintar({
      venta: { fase: "SIN_ABRIR", segundosParaAbrir: 3_600 * 26 },
    });

    expect(contenedor.textContent).toContain("1 d 2 h");
    expect(boton("Solicitar compra")?.disabled).toBe(true);
  });

  it("con la venta cerrada no ofrece nada", async () => {
    const contenedor = await pintar({ venta: { fase: "CERRADA" } });

    expect(contenedor.textContent).toContain("ya cerró");
    expect(boton("Solicitar compra")).toBeUndefined();
  });

  it("un lote ADJUDICADO sigue admitiendo fila (R-17)", async () => {
    await pintar({ estatusLote: "ADJUDICADO" });
    expect(boton("Solicitar compra")?.disabled).toBe(false);
  });

  it("un lote vendido lo dice y no ofrece boton", async () => {
    const contenedor = await pintar({ estatusLote: "VENDIDO" });

    expect(contenedor.textContent).toContain("vendido a otro participante");
    expect(boton("Solicitar compra")).toBeUndefined();
  });

  it("solicitar llama a la action con el lote de la pantalla", async () => {
    solicitar.mockResolvedValue({ ok: true, data: {} });
    await pintar({});

    await act(async () => {
      boton("Solicitar compra")?.click();
    });

    expect(solicitar).toHaveBeenCalledWith({
      convocatoriaId: "C1",
      loteId: "L1",
    });
  });

  it("un error del servidor se muestra traducido", async () => {
    solicitar.mockResolvedValue({ ok: false, error: "already_in_queue" });
    const contenedor = await pintar({});

    await act(async () => {
      boton("Solicitar compra")?.click();
    });

    expect(contenedor.textContent).toContain("Ya estás en la fila");
  });
});

describe("con solicitud propia", () => {
  it("EN_FILA muestra lugar, total y turno", async () => {
    const contenedor = await pintar({ miLugar: lugar("EN_FILA") });

    expect(contenedor.textContent).toContain("Tu lugar: 3 de 7");
    expect(contenedor.textContent).toContain("Turno asignado 4");
    expect(boton("Cancelar mi solicitud")).toBeDefined();
  });

  it("CONGELADA explica por que no avanza y conserva el lugar", async () => {
    const contenedor = await pintar({ miLugar: lugar("CONGELADA") });

    expect(contenedor.textContent).toContain("Tu lugar: 3 de 7");
    expect(contenedor.textContent).toContain(
      "adjudicación activa en otro vehículo",
    );
  });

  it("ADJUDICADA muestra el plazo con cuenta regresiva", async () => {
    const contenedor = await pintar({
      miLugar: lugar("ADJUDICADA", { venceEn: "2026-10-08T15:00:00.000Z" }),
      venceEnFormateado: "8 oct 2026, 09:00",
      segundosParaVencer: 3_600 * 5,
    });

    expect(contenedor.textContent).toContain("El vehículo es tuyo");
    expect(contenedor.textContent).toContain("8 oct 2026, 09:00");
    expect(contenedor.textContent).toContain("5 h 0 min");
  });

  it("ADJUDICADA ofrece subir comprobante", async () => {
    const contenedor = await pintar({
      miLugar: lugar("ADJUDICADA", { venceEn: "2026-10-08T15:00:00.000Z" }),
    });

    expect(contenedor.textContent).toContain("Subir comprobante");
  });

  it("subir comprobante abre el modal con el campo de archivo y el aviso de revision", async () => {
    // La subida real —FormData extrayendo un File de un `<input type=file>`—
    // no es simulable de forma confiable en jsdom (desafios-implementacion.md
    // 20); se prueba que el modal se abre con lo que pide la pantalla 3.6, y
    // el envio se deja al recorrido manual.
    await pintar({
      miLugar: lugar("ADJUDICADA", { venceEn: "2026-10-08T15:00:00.000Z" }),
    });

    await act(async () => {
      boton("Subir comprobante")?.click();
    });

    expect(context.container.textContent).toContain(
      "será revisado por tesorería",
    );
    expect(
      context.container.querySelector('input[name="archivo"]'),
    ).not.toBeNull();
  });

  it("CANCELADA_POR_VENCIMIENTO muestra la fecha de vencimiento", async () => {
    const contenedor = await pintar({
      miLugar: lugar("CANCELADA_POR_VENCIMIENTO"),
      venceEnFormateado: "8 oct 2026, 09:00",
    });

    expect(contenedor.textContent).toContain("venció el plazo de pago");
    expect(contenedor.textContent).toContain("8 oct 2026, 09:00");
  });

  it("RECHAZADA_POR_TESORERIA muestra el motivo", async () => {
    const contenedor = await pintar({
      miLugar: lugar("RECHAZADA_POR_TESORERIA", {
        motivoRechazo: "El comprobante no coincide con el monto",
      }),
    });

    expect(contenedor.textContent).toContain("rechazó el comprobante");
    expect(contenedor.textContent).toContain(
      "El comprobante no coincide con el monto",
    );
  });

  it("NO_ADJUDICADA explica que la convocatoria cerro antes de tiempo", async () => {
    const contenedor = await pintar({ miLugar: lugar("NO_ADJUDICADA") });

    expect(contenedor.textContent).toContain("cerró sin que te alcanzara");
  });

  it("EN_VERIFICACION no lleva cuenta regresiva", async () => {
    // Es un requisito, no un olvido: el reloj se detuvo al subir el
    // comprobante y dejarlo corriendo haria creer que se puede perder el
    // vehiculo por la demora de tesoreria.
    const contenedor = await pintar({
      miLugar: lugar("EN_VERIFICACION"),
      segundosParaVencer: 3_600,
    });

    expect(contenedor.textContent).toContain("Tesorería está revisando");
    expect(contenedor.textContent).not.toContain("Tiempo restante");
  });

  it("cancelar pide confirmacion antes de llamar a la action", async () => {
    await pintar({ miLugar: lugar("EN_FILA") });

    await act(async () => {
      boton("Cancelar mi solicitud")?.click();
    });

    expect(cancelar).not.toHaveBeenCalled();
    expect(context.container.textContent).toContain("pierdes tu turno");
  });

  it("la confirmacion de una adjudicacion advierte que el vehiculo se va", async () => {
    await pintar({
      miLugar: lugar("ADJUDICADA", { venceEn: "2026-10-08T15:00:00.000Z" }),
    });

    await act(async () => {
      boton("Cancelar mi solicitud")?.click();
    });

    expect(context.container.textContent).toContain(
      "pasa al siguiente participante",
    );
  });

  it("confirmada, cancela de verdad", async () => {
    cancelar.mockResolvedValue({ ok: true, data: {} });
    await pintar({ miLugar: lugar("EN_FILA") });

    await act(async () => {
      boton("Cancelar mi solicitud")?.click();
    });
    await act(async () => {
      boton("Sí, cancelar")?.click();
    });

    expect(cancelar).toHaveBeenCalledWith({
      convocatoriaId: "C1",
      loteId: "L1",
    });
  });
});

describe("privacidad — R-12", () => {
  it("nada de lo que se pinta menciona a otro participante", async () => {
    const contenedor = await pintar({ miLugar: lugar("EN_FILA") });

    // El DTO no trae identidades, asi que el componente no puede filtrarlas
    // aunque quisiera. La prueba fija esa propiedad en la frontera visible.
    expect(contenedor.textContent).not.toMatch(/@|participanteId/i);
  });
});

describe("vista previa administrativa — soloLectura", () => {
  // La propiedad es una sola y vale para toda la tabla de estados: **se ve
  // todo, no se pulsa nada**. Se fija sobre los dos estados con boton porque
  // son puertas distintas —una crea una solicitud, la otra la cancela— y basta
  // que una se quede viva para que una pantalla de revision actue sobre la
  // fila.

  it("lo dice, y deja el boton de solicitar deshabilitado", async () => {
    const contenedor = await pintar({ soloLectura: true });

    expect(contenedor.textContent).toContain(
      diccionario.fila.vistaPreviaSinAccion,
    );
    expect(boton("Solicitar compra")?.disabled).toBe(true);
  });

  it("tampoco deja cancelar una solicitud viva", async () => {
    await pintar({ miLugar: lugar("EN_FILA"), soloLectura: true });

    expect(boton("Cancelar mi solicitud")?.disabled).toBe(true);
  });

  it("sin el, nada cambia para el participante", async () => {
    const contenedor = await pintar({});

    expect(contenedor.textContent).not.toContain(
      diccionario.fila.vistaPreviaSinAccion,
    );
    expect(boton("Solicitar compra")?.disabled).toBe(false);
  });
});
