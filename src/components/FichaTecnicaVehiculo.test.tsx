import { act } from "react";
import { describe, expect, it } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import FichaTecnicaVehiculo from "./FichaTecnicaVehiculo";

const context = getTestContext();

genericTests(context, FichaTecnicaVehiculo, {
  kilometraje: 100_000,
  nivelEquipamiento: "Full",
  especificacionMecanica: "Motor 2.5L",
  condicionesMecanicas: "Buenas",
  detallesEsteticos: "Rayones menores",
  diccionario: obtenerDiccionario("es"),
  idioma: "es",
});

describe("FichaTecnicaVehiculo", () => {
  it("siempre muestra el kilometraje", async () => {
    await act(async () => {
      context.root.render(
        <FichaTecnicaVehiculo
          kilometraje={50_000}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
    // Region fija de negocio (dinero.ts): "es" a secas escribiria "50.000",
    // que en Mexico se lee como decimales.
    expect(context.container.textContent).toContain("50,000 km");
  });

  it("omite las secciones opcionales que no llegaron", async () => {
    await act(async () => {
      context.root.render(
        <FichaTecnicaVehiculo
          kilometraje={50_000}
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
    expect(context.container.textContent).not.toContain(
      "Especificación mecánica",
    );
  });

  it("muestra las secciones opcionales que si llegaron", async () => {
    await act(async () => {
      context.root.render(
        <FichaTecnicaVehiculo
          kilometraje={50_000}
          especificacionMecanica="Motor 2.5L"
          diccionario={obtenerDiccionario("es")}
          idioma="es"
        />,
      );
    });
    expect(context.container.textContent).toContain("Motor 2.5L");
  });
});

describe("dos desplegables, con la division del formulario", () => {
  // Antes habia uno por campo —hasta cinco seguidos— y consultar un vehiculo
  // obligaba a abrirlos de uno en uno. La division es la misma que la de
  // `FormularioVehiculo`: especificacion es lo que el vehiculo **es**, condicion
  // lo que **tiene**. Que las dos pantallas partan el dato igual es lo que
  // permite capturar mirando una y revisar mirando la otra.
  const diccionario = obtenerDiccionario("es");

  const pintarTodo = async () => {
    await act(async () => {
      context.root.render(
        <FichaTecnicaVehiculo
          kilometraje={100_000}
          nivelEquipamiento="Full"
          especificacionMecanica="Motor 2.5L"
          condicionesMecanicas="Buenas"
          detallesEsteticos="Rayones menores"
          diccionario={diccionario}
          idioma="es"
        />,
      );
    });
  };

  const desplegables = () => [...context.container.querySelectorAll("details")];

  it("con todos los datos son exactamente dos", async () => {
    await pintarTodo();

    expect(desplegables()).toHaveLength(2);
    expect(
      desplegables().map((d) =>
        d.querySelector("summary")?.textContent?.trim(),
      ),
    ).toEqual([
      diccionario.vehiculos.seccionEspecificacion,
      diccionario.vehiculos.seccionCondicion,
    ]);
  });

  it("cada campo cae en el grupo que le toca", async () => {
    await pintarTodo();

    const [especificacion, condicion] = desplegables();

    expect(especificacion?.textContent).toContain("100,000 km");
    expect(especificacion?.textContent).toContain("Full");
    expect(especificacion?.textContent).toContain("Motor 2.5L");
    // Lo de condicion no se cuela en especificacion.
    expect(especificacion?.textContent).not.toContain("Rayones menores");

    expect(condicion?.textContent).toContain("Buenas");
    expect(condicion?.textContent).toContain("Rayones menores");
    expect(condicion?.textContent).not.toContain("Motor 2.5L");
  });

  it("cada dato lleva su etiqueta: agrupados, sin ella no se sabe que es que", async () => {
    // Con un desplegable por campo el titulo hacia de etiqueta. Agrupados, un
    // parrafo suelto de texto libre no dice si es la especificacion o el estado.
    await pintarTodo();

    const [especificacion] = desplegables();
    const etiquetas = [...(especificacion?.querySelectorAll("dt") ?? [])].map(
      (dt) => dt.textContent?.trim(),
    );
    expect(etiquetas).toEqual([
      diccionario.vehiculos.campos.kilometraje,
      diccionario.vehiculos.campos.nivelEquipamiento,
      diccionario.vehiculos.campos.especificacionMecanica,
    ]);
  });

  it("un grupo sin ningun dato no se pinta", async () => {
    // Un desplegable vacio invita a abrirlo para nada. `kilometraje` es
    // obligatorio, asi que solo le puede pasar a condicion.
    await act(async () => {
      context.root.render(
        <FichaTecnicaVehiculo
          kilometraje={50_000}
          diccionario={diccionario}
          idioma="es"
        />,
      );
    });

    expect(desplegables()).toHaveLength(1);
    expect(context.container.textContent).not.toContain(
      diccionario.vehiculos.seccionCondicion,
    );
  });
});
