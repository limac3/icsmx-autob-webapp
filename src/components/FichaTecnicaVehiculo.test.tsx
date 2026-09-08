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
