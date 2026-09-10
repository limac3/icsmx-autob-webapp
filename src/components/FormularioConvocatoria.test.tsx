import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { guardarConvocatoriaDesdeFormulario } from "@/app/actions/convocatorias";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import FormularioConvocatoria from "./FormularioConvocatoria";

// La action se simula porque su modulo arrastra todo el grafo del servidor
// —`server-only`, el cliente de DynamoDB— que en el navegador no existe.
vi.mock("@/app/actions/convocatorias", () => ({
  guardarConvocatoriaDesdeFormulario: vi.fn(),
}));

// La barra del editor usa `Fade`, y `Fade` mide el desbordamiento con un
// `setTimeout` de 50 ms que aterriza fuera del `act` de la prueba. Es la misma
// utilidad hoja que ya se simula en `TablaConvocatorias`: lo que aqui se
// comprueba es el marcado del formulario y su accesibilidad, no la deteccion de
// desbordamiento de Eden.
vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
}));

const context = getTestContext();

const diccionario = obtenerDiccionario("es");

const VALORES = {
  folio: "CONV-2026-001",
  nombre: "Venta de octubre",
  tipo: "EMPLEADOS",
  descripcionParticipacion: "Abierta al personal de flotilla.",
  publicadaEn: { fecha: "2026-10-01", hora: "09:00" },
  inicioVenta: { fecha: "2026-10-05", hora: "09:00" },
  finVenta: { fecha: "2026-10-12", hora: "09:00" },
  horasLiquidacion: 48,
};

genericTests(context, FormularioConvocatoria, {
  diccionario,
  convocatoriaId: "C1",
  valores: VALORES,
});

describe("errores que devuelve el servidor", () => {
  const control = (nombre: string) =>
    context.container.querySelector<HTMLInputElement>(`[name="${nombre}"]`)!;

  it("conserva lo capturado cuando el servidor rechaza", async () => {
    // **React 19 reinicia el formulario cuando la action termina**, y lo
    // reinicia a `defaultValue`. Sin devolver lo capturado, un folio duplicado
    // —el unico rechazo que el navegador no puede anticipar, porque lo decide
    // el centinela dentro de la transaccion— borraba la descripcion y las seis
    // mitades de fecha y hora.
    vi.mocked(guardarConvocatoriaDesdeFormulario).mockResolvedValue({
      estado: "error",
      error: "validation_failed",
      detalles: { folio: "duplicado" },
      intento: 1,
      capturado: {
        folio: "CONV-2026-777",
        nombre: "Venta de noviembre",
        tipo: "PUBLICO_GENERAL",
        descripcionParticipacion: "<p>Abierta a todo el publico.</p>",
        publicadaEnFecha: "2026-11-01",
        publicadaEnHora: "08:00",
        inicioVentaFecha: "2026-11-05",
        inicioVentaHora: "08:00",
        finVentaFecha: "2026-11-12",
        finVentaHora: "18:00",
        horasLiquidacion: "72",
      },
    });

    await act(async () => {
      context.root.render(
        <FormularioConvocatoria diccionario={diccionario} valores={VALORES} />,
      );
    });

    const formulario = context.container.querySelector("form")!;
    await act(async () => {
      formulario.requestSubmit();
    });
    // Eden reevalua dentro de un `requestAnimationFrame`: hay que dejar pasar
    // un cuadro o la prueba pasa o falla segun lo que tarde el entorno.
    await act(async () => {
      await new Promise<void>((resolver) => {
        requestAnimationFrame(() => {
          resolver();
        });
      });
    });

    expect(control("folio").value).toBe("CONV-2026-777");
    expect(control("nombre").value).toBe("Venta de noviembre");
    expect(control("finVentaHora").value).toBe("18:00");
    expect(control("horasLiquidacion").value).toBe("72");
    // El tipo es un grupo de radios: se conserva el que se habia elegido, no
    // el que traia la convocatoria.
    expect(
      context.container.querySelector<HTMLInputElement>(
        '[name="tipo"][value="PUBLICO_GENERAL"]',
      )!.checked,
    ).toBe(true);
    expect(control("folio").validationMessage).toBe(
      diccionario.validacionConvocatoria.duplicado,
    );
  });
});
