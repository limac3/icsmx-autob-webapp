import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import FormularioVehiculo from "./FormularioVehiculo";

// Las Server Actions se simulan porque su modulo arrastra todo el grafo del
// servidor —`server-only`, el cliente de DynamoDB, el de S3— que en el
// navegador no existe. En produccion el bundler de Next las sustituye por una
// referencia; aqui no hay tal transformacion. Lo que esta prueba comprueba es
// el componente, no la action: esa tiene la suya en `src/app/actions`.
// El estado inicial no se simula: vive en `@/types/formularioVehiculo`, que es
// un modulo sin I/O. Solo se simula lo que arrastra el grafo del servidor.
vi.mock("@/app/actions/vehiculos", () => ({
  guardarVehiculoDesdeFormulario: vi.fn(),
  retirarVehiculoDesdeFormulario: vi.fn(),
}));

const context = getTestContext();

genericTests(context, FormularioVehiculo, {
  diccionario: obtenerDiccionario("es"),
  modeloMaximo: 2027,
  vehiculoId: "V1",
  valores: {
    marca: "Nissan",
    version: "NP300",
    modelo: 2019,
    kilometraje: 148_320,
  },
});

describe("secciones del formulario", () => {
  const pintarVacio = async () => {
    await act(async () => {
      context.root.render(
        <FormularioVehiculo
          diccionario={obtenerDiccionario("es")}
          modeloMaximo={2027}
        />,
      );
    });
    // Dispara la validacion nativa: cada campo obligatorio vacio emite
    // `invalid`, que es lo que `useValidation` de Eden escucha.
    await act(async () => {
      context.container.querySelector("form")?.checkValidity();
    });
  };

  const hints = () => [
    ...context.container.querySelectorAll(".eden-form-part-hint"),
  ];

  it("cada campo invalido explica su error una sola vez", async () => {
    await pintarVacio();

    const obligatorios = context.container.querySelectorAll("[required]");
    expect(obligatorios.length).toBeGreaterThan(0);
    expect(hints()).toHaveLength(obligatorios.length);
  });

  it("la seccion no repite el error de su primer campo invalido", async () => {
    // El `FieldSet` de Eden esta hecho para agrupar `Radio` y `Checkbox`:
    // escucha `invalid` en fase de captura y publica al pie del grupo el
    // mensaje del primer elemento invalido. Con secciones de campos de texto
    // eso duplica cada error. Por eso la seccion es un `<fieldset>` nativo.
    await pintarVacio();

    const alPieDeLaSeccion = context.container.querySelectorAll(
      "fieldset > .eden-form-part-hint",
    );

    expect([...alPieDeLaSeccion].map((nodo) => nodo.textContent)).toEqual([]);
  });
});
