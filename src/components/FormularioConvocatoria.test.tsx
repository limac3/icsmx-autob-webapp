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

  it("conserva la descripcion de forma que se pueda volver a enviar", async () => {
    // El hueco por el que paso el defecto: esta suite comprobaba folio, nombre,
    // horas y tipo, y **nunca la descripcion**. Y la descripcion es el unico
    // campo que no es un `input`: es el editor enriquecido de Eden, que
    // sincroniza su contenido a dos `textarea` propios —uno con `name` para el
    // `FormData`, otro con `required` para la validacion del navegador— desde
    // un `registerUpdateListener`, que **no dispara al montar**. Con el editor
    // restaurado desde `initialContent`, Lexical pintaba el texto y los dos
    // textarea seguian vacios: el navegador decia "Please fill out this field"
    // sobre un campo lleno, y el envio habria mandado la descripcion en blanco.
    vi.mocked(guardarConvocatoriaDesdeFormulario).mockResolvedValue({
      estado: "error",
      error: "validation_failed",
      detalles: { folio: "duplicado" },
      intento: 1,
      capturado: {
        folio: "1",
        nombre: "Septiembre de 2026",
        tipo: "EMPLEADOS",
        descripcionParticipacion: "<p>Usted puede comprar un vehiculo.</p>",
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
    await act(async () => {
      await new Promise<void>((resolver) => {
        requestAnimationFrame(() => {
          resolver();
        });
      });
    });

    // Lo que viaja en el `FormData`.
    expect(control("descripcionParticipacion").value).toContain(
      "Usted puede comprar un vehiculo",
    );

    // Y lo que el navegador valida: sin esto, el formulario queda imposible de
    // reenviar aunque el campo se vea lleno.
    expect(
      context.container.querySelector<HTMLTextAreaElement>(
        ".eden-rich-text-editor__textarea textarea, textarea.eden-rich-text-editor__textarea",
      )?.validationMessage,
    ).toBe("");
  });

  it("muestra en la descripcion el motivo que devolvio el servidor", async () => {
    // El defecto que costo un reporte: el servidor rechazaba la descripcion por
    // un enlace `mailto:` y devolvia el motivo en `detalles`, pero la pantalla
    // no lo mostraba. Eden pone `name` en el `textarea` que serializa el editor
    // y **no** en el que marca `required`, que es el que llega a `onValidate`;
    // con la busqueda por `control.name`, la descripcion era el unico campo
    // cuyo error del servidor no podia llegar nunca. En su lugar el navegador
    // escribia su propio "Please fill out this field" en ingles, sobre un campo
    // lleno y por una razon que no era la real.
    vi.mocked(guardarConvocatoriaDesdeFormulario).mockResolvedValue({
      estado: "error",
      error: "validation_failed",
      detalles: { descripcionParticipacion: "enlace_no_admitido" },
      intento: 1,
      capturado: {
        folio: "1",
        nombre: "Septiembre de 2026",
        tipo: "EMPLEADOS",
        descripcionParticipacion:
          '<p>Escriba a <a href="mailto:ventas@ejemplo.test">ventas</a>.</p>',
        publicadaEnFecha: "2026-11-01",
        publicadaEnHora: "08:00",
        inicioVentaFecha: "2026-11-05",
        inicioVentaHora: "08:00",
        finVentaFecha: "2026-11-12",
        finVentaHora: "18:00",
        horasLiquidacion: "48",
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
    await act(async () => {
      await new Promise<void>((resolver) => {
        requestAnimationFrame(() => {
          resolver();
        });
      });
    });

    // El control que valida el navegador es el `textarea` sin `name` de Eden.
    const validado = [
      ...context.container.querySelectorAll<HTMLTextAreaElement>("textarea"),
    ].find((campo) => campo.required);

    expect(validado?.validationMessage).toBe(
      diccionario.validacionConvocatoria.enlace_no_admitido,
    );
  });
});
