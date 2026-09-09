import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import FiltrosDeBitacora, {
  type FiltrosDeBitacoraProps,
} from "./FiltrosDeBitacora";

const context = getTestContext();
const etiquetas = obtenerDiccionario("es").auditoria;

const props = (
  cambios: Partial<FiltrosDeBitacoraProps> = {},
): FiltrosDeBitacoraProps => ({
  valores: {
    agregado: "",
    agregadoId: "",
    tipo: "",
    participanteId: "",
    desde: "2026-08-09",
    hasta: "2026-09-08",
  },
  tiposDeAgregado: [
    { valor: "LOTE", etiqueta: "Lote y su fila" },
    { valor: "VEHICULO", etiqueta: "Vehículo" },
  ],
  tiposDeEvento: [{ valor: "LOTE_ADJUDICADO", etiqueta: "Lote adjudicado" }],
  identificadores: [],
  participantes: [],
  etiquetas: {
    campoDesde: etiquetas.campoDesde,
    campoHasta: etiquetas.campoHasta,
    campoAgregado: etiquetas.campoAgregado,
    campoAgregadoId: etiquetas.campoAgregadoId,
    campoTipo: etiquetas.campoTipo,
    campoParticipante: etiquetas.campoParticipante,
    todosLosTipos: etiquetas.todosLosTipos,
    sinOpciones: etiquetas.sinOpciones,
    eligeTipoDeRegistro: etiquetas.eligeTipoDeRegistro,
    buscar: etiquetas.buscar,
    eligeIdentificador: etiquetas.eligeIdentificador,
  },
  ...cambios,
});

genericTests(context, FiltrosDeBitacora, props());

const pintar = async (cambios: Partial<FiltrosDeBitacoraProps> = {}) => {
  await act(async () => {
    context.root.render(<FiltrosDeBitacora {...props(cambios)} />);
  });
};

const campo = (nombre: string) =>
  context.container.querySelector<HTMLSelectElement | HTMLInputElement>(
    `[name="${nombre}"]`,
  );

describe("FiltrosDeBitacora", () => {
  it("es un formulario GET: el filtro queda en la URL y se puede compartir", async () => {
    await pintar();

    const formulario = context.container.querySelector("form");
    expect(formulario?.getAttribute("method")).toBe("get");
  });

  it("las fechas llegan con valor y no se pueden vaciar", async () => {
    await pintar();

    const desde = campo("desde");
    const hasta = campo("hasta");
    expect(
      desde?.getAttribute("value") ?? (desde as HTMLInputElement).value,
    ).toBe("2026-08-09");
    expect((hasta as HTMLInputElement).value).toBe("2026-09-08");
    expect(desde?.hasAttribute("required")).toBe(true);
    expect(hasta?.hasAttribute("required")).toBe(true);
  });

  it("sin tipo de registro elegido, el identificador esta deshabilitado y dice por que", async () => {
    await pintar();

    expect(campo("agregadoId")?.hasAttribute("disabled")).toBe(true);
    expect(context.container.textContent).toContain(
      etiquetas.eligeTipoDeRegistro,
    );
  });

  it("con tipo elegido pero sin actividad en el rango, lo dice en vez de ofrecer una lista vacia", async () => {
    await pintar({
      valores: { ...props().valores, agregado: "LOTE" },
      identificadores: [],
    });

    expect(campo("agregadoId")?.hasAttribute("disabled")).toBe(true);
    expect(context.container.textContent).toContain(etiquetas.sinOpciones);
  });

  it("presenta cada identificador con su etiqueta legible, no con el ULID a secas", async () => {
    await pintar({
      valores: { ...props().valores, agregado: "LOTE" },
      identificadores: [
        { valor: "01K4Z", etiqueta: "Nissan Versa 2019 · 12 mar 2026 · 01K4Z" },
      ],
    });

    const opciones = [
      ...context.container.querySelectorAll('[name="agregadoId"] option'),
    ];
    expect(opciones.at(-1)?.textContent).toBe(
      "Nissan Versa 2019 · 12 mar 2026 · 01K4Z",
    );
    expect(opciones.at(-1)?.getAttribute("value")).toBe("01K4Z");
  });

  it("presenta a los participantes por nombre y correo", async () => {
    await pintar({
      participantes: [
        { valor: "okta|1", etiqueta: "Ana Ramírez · ana@example.com · okta|1" },
      ],
    });

    expect(context.container.textContent).toContain("Ana Ramírez");
    expect(campo("participanteId")?.hasAttribute("disabled")).toBe(false);
  });

  it("muestra los avisos de una busqueda que no se puede ejecutar", async () => {
    await pintar({ avisos: [etiquetas.busqueda.sin_criterio] });

    expect(context.container.textContent).toContain(
      etiquetas.busqueda.sin_criterio,
    );
    expect(context.container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("reenvia el formulario al cambiar una fecha, porque eso cambia las opciones", async () => {
    await pintar();

    const formulario = context.container.querySelector("form");
    const reenviar = vi.fn();
    // jsdom no implementa requestSubmit sobre un formulario sin submitter.
    if (formulario) formulario.requestSubmit = reenviar;

    const desde = campo("desde") as HTMLInputElement;
    await act(async () => {
      // Asignar `.value` directamente no basta: React memoriza el valor del
      // campo y descarta el evento si cree que no cambio. Hay que pasar por el
      // `setter` nativo para que su rastreador lo vea, y despues emitir
      // `input`, que es el evento con el que React alimenta `onChange` en un
      // campo de texto.
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(desde, "2026-09-01");
      desde.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(reenviar).toHaveBeenCalled();
  });

  it("al cambiar de tipo de registro limpia el identificador antes de reenviar", async () => {
    // Sin esto la busqueda saldria con un par tipo/identificador imposible y
    // devolveria una tabla vacia sin explicar por que.
    await pintar({
      valores: { ...props().valores, agregado: "LOTE", agregadoId: "01K4Z" },
      identificadores: [{ valor: "01K4Z", etiqueta: "Nissan Versa · 01K4Z" }],
    });

    const formulario = context.container.querySelector("form");
    const identificador = campo("agregadoId") as HTMLSelectElement;
    let valorAlReenviar: string | undefined;
    if (formulario) {
      formulario.requestSubmit = () => {
        valorAlReenviar = identificador.value;
      };
    }

    const agregado = campo("agregado") as HTMLSelectElement;
    await act(async () => {
      agregado.value = "VEHICULO";
      agregado.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(valorAlReenviar).toBe("");
  });
});
