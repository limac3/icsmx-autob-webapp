import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import { guardarVehiculoDesdeFormulario } from "@/app/actions/vehiculos";
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

  it("cada seccion sigue siendo un fieldset con su legend", async () => {
    // `Card` separa a la vista, pero lo que hace que un lector de pantalla
    // anuncie "Identificacion" como contexto de cada campo es el elemento. Si
    // alguien quita el `renderAs`, la tarjeta se ve igual y la semantica
    // desaparece sin ruido.
    await pintarVacio();

    const secciones = context.container.querySelectorAll(
      "fieldset.formulario-vehiculo__seccion",
    );

    expect(secciones).toHaveLength(3);
    for (const seccion of secciones) {
      expect(
        seccion.querySelector(":scope > legend")?.textContent,
      ).toBeTruthy();
    }
  });

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

describe("errores que devuelve el servidor", () => {
  const diccionario = obtenerDiccionario("es");

  const pintarLleno = async () => {
    await act(async () => {
      context.root.render(
        <FormularioVehiculo
          diccionario={diccionario}
          modeloMaximo={2027}
          vehiculoId="V1"
          valores={{
            // Completo a proposito: los controles son `required`, asi que un
            // campo vacio detiene el envio en la validacion nativa y la action
            // —que es lo que estas pruebas observan— nunca llega a correr.
            numeroEconomico: "VEH-001",
            numeroDeSerie: "3N6AD33A9KK870001",
            marca: "Nissan",
            version: "NP300",
            modelo: 2019,
            kilometraje: 148_320,
          }}
        />,
      );
    });
    return context.container.querySelector("form")!;
  };

  // Eden reevalua los controles dentro de un `requestAnimationFrame`, asi que
  // esperar al `act` no alcanza: hay que dejar pasar un cuadro. Sin esto la
  // prueba pasa o falla segun lo que tarde el entorno.
  const esperarUnCuadro = async () => {
    await act(async () => {
      await new Promise<void>((resolver) => {
        requestAnimationFrame(() => {
          resolver();
        });
      });
    });
  };

  const control = (nombre: string) =>
    context.container.querySelector<HTMLInputElement>(`[name="${nombre}"]`)!;

  it("marca el campo como invalido, no solo muestra un texto", async () => {
    // El defecto que cierra esta prueba: el mensaje viajaba por `description`
    // de `FormField`, que Eden documenta como texto de ayuda. Se leia, pero el
    // control quedaba valido —sin marco rojo y sin icono— porque el estado de
    // validez de Eden solo lo mueve `validationMessage`.
    vi.mocked(guardarVehiculoDesdeFormulario).mockResolvedValue({
      estado: "error",
      error: "validation_failed",
      detalles: { marca: "requerido" },
    });

    const formulario = await pintarLleno();
    expect(control("marca").validationMessage).toBe("");

    await act(async () => {
      formulario.requestSubmit();
    });
    await esperarUnCuadro();

    expect(control("marca").validationMessage).toBe(
      diccionario.validacionVehiculo.requerido,
    );
    // Y un campo que el servidor no senalo sigue limpio.
    expect(control("version").validationMessage).toBe("");
  });

  it("olvida el error del servidor en cuanto el usuario corrige el campo", async () => {
    // `setCustomValidity` persiste hasta que se limpia: sin el manejador de
    // `input` el campo seguiria rojo con el mensaje viejo aunque ya tuviera un
    // valor bueno.
    vi.mocked(guardarVehiculoDesdeFormulario).mockResolvedValue({
      estado: "error",
      error: "validation_failed",
      detalles: { marca: "requerido" },
    });

    const formulario = await pintarLleno();
    await act(async () => {
      formulario.requestSubmit();
    });
    await esperarUnCuadro();
    expect(control("marca").validationMessage).not.toBe("");

    // Solo el evento real de teclear: Eden ya escucha `input` y revalida.
    await act(async () => {
      control("marca").dispatchEvent(new Event("input", { bubbles: true }));
    });
    await esperarUnCuadro();

    expect(control("marca").validationMessage).toBe("");
  });

  it("conserva lo capturado cuando el servidor rechaza", async () => {
    // **React 19 reinicia el formulario cuando la action termina**, y lo
    // reinicia a `defaultValue`. Sin devolver lo capturado, un rechazo dejaba
    // todos los campos vacios con el error senalado sobre nada — y el rechazo
    // que solo el servidor puede emitir es el de un numero duplicado, justo
    // cuando el vehiculo entero ya esta escrito.
    vi.mocked(guardarVehiculoDesdeFormulario).mockResolvedValue({
      estado: "error",
      error: "validation_failed",
      detalles: { numeroEconomico: "duplicado" },
      capturado: {
        numeroEconomico: "VEH-777",
        numeroDeSerie: "3N6AD33A9KK870001",
        marca: "Nissan",
        version: "NP300",
        modelo: "2019",
        kilometraje: "148320",
      },
    });

    const formulario = await pintarLleno();
    await act(async () => {
      formulario.requestSubmit();
    });
    await esperarUnCuadro();

    expect(control("numeroEconomico").value).toBe("VEH-777");
    expect(control("kilometraje").value).toBe("148320");
    expect(control("numeroEconomico").validationMessage).toBe(
      diccionario.validacionVehiculo.duplicado,
    );
  });
});
