import { act } from "react";
import { describe, expect, it } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import Esqueleto from "./Esqueleto";

const diccionario = obtenerDiccionario("es");
const context = getTestContext();

genericTests(context, Esqueleto, { variante: "tabla" as const, diccionario });

describe("Esqueleto", () => {
  const render = async (props: Parameters<typeof Esqueleto>[0]) => {
    await act(async () => {
      context.root.render(<Esqueleto {...props} />);
    });
    return context.container;
  };

  it("anuncia la carga una sola vez, no una caja vacia por fila", async () => {
    // Lo que el lector de pantalla tiene que oir es "Cargando…", no seis
    // elementos sin nombre.
    const container = await render({
      variante: "tabla",
      cuantos: 6,
      diccionario,
    });

    const estado = container.querySelector('[role="status"]');
    expect(estado?.textContent).toBe(diccionario.comun.cargando);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });

  it("dibuja tantos elementos como se le piden", async () => {
    const container = await render({
      variante: "rejilla",
      cuantos: 3,
      diccionario,
    });

    expect(container.querySelectorAll(".esqueleto__rejilla-item")).toHaveLength(
      3,
    );
  });

  it("cada variante tiene su forma, que es la razon de que exista", async () => {
    // Un esqueleto de tarjetas donde viene una tabla reserva el sitio
    // equivocado, que es tan malo como no reservar ninguno.
    const tabla = await render({ variante: "tabla", diccionario });
    expect(tabla.querySelector(".esqueleto__tabla")).not.toBeNull();

    const rejilla = await render({ variante: "rejilla", diccionario });
    expect(rejilla.querySelector(".esqueleto__rejilla")).not.toBeNull();
  });
});
