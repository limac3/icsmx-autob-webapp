import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reordenarFotografias } from "@/app/actions/vehiculos";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import GaleriaVehiculo, {
  moverEnLista,
  type FotografiaEnGaleria,
  type GaleriaVehiculoProps,
} from "./GaleriaVehiculo";

vi.mock("@/app/actions/vehiculos", () => ({
  agregarFotografia: vi.fn(),
  eliminarFotografia: vi.fn(),
  marcarFotografiaPrincipal: vi.fn(),
  reordenarFotografias: vi.fn(),
}));

// jsdom no implementa `DataTransfer`, y lo necesitan dos cosas: el `FileInput`
// de Eden, que lo usa para sincronizar el valor del input con su estado
// interno, y el arrastre de la galeria. Se define un doble minimo en vez de
// sustituir el componente por un `<input type="file">`: la regla 10 dice usar
// Eden tal cual, y una carencia de jsdom no es razon para cambiar codigo de
// produccion. Ver desafios-implementacion.md seccion 20.
//
// `files` tiene que ser un `FileList` de verdad —jsdom valida el tipo al
// asignarlo a un input—, y la unica forma de obtener uno vacio sin
// `DataTransfer` es pedirselo a un input de archivo.
const listaVacia = (() => {
  const input = document.createElement("input");
  input.type = "file";
  return input.files;
})();

class DataTransferFalso {
  readonly items = { add: () => undefined };
  readonly files = listaVacia;
  readonly datos = new Map<string, string>();
  effectAllowed = "none";
  dropEffect = "none";

  setData(formato: string, valor: string) {
    this.datos.set(formato, valor);
  }

  getData(formato: string) {
    return this.datos.get(formato) ?? "";
  }
}

globalThis.DataTransfer ??=
  DataTransferFalso as unknown as typeof globalThis.DataTransfer;

const diccionario = obtenerDiccionario("es");
const etiquetas = diccionario.vehiculos.fotografias;

const FOTOS: readonly FotografiaEnGaleria[] = [
  {
    fotoId: "F1",
    orden: 1,
    // La descripcion es el texto alternativo de la imagen: sin ella, axe
    // marca la violacion, que es exactamente lo que debe pasar.
    descripcion: "Frente del vehiculo",
    url: "https://ejemplo.invalid/F1.jpg?Signature=x",
    esPrincipal: true,
  },
  {
    fotoId: "F2",
    orden: 2,
    descripcion: "Costado del vehiculo",
    url: "https://ejemplo.invalid/F2.jpg?Signature=y",
    esPrincipal: false,
  },
  {
    fotoId: "F3",
    orden: 3,
    descripcion: "Interior del vehiculo",
    url: "https://ejemplo.invalid/F3.jpg?Signature=z",
    esPrincipal: false,
  },
];

const context = getTestContext();

genericTests(context, GaleriaVehiculo, {
  vehiculoId: "V1",
  fotografias: FOTOS.slice(0, 2),
  diccionario,
  puedeEditar: true,
});

// --- Reordenamiento ---------------------------------------------------------

describe("moverEnLista", () => {
  const letras = ["a", "b", "c", "d"] as const;

  it("mueve hacia adelante recorriendo a los de en medio", () => {
    expect(moverEnLista(letras, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("mueve hacia atras", () => {
    expect(moverEnLista(letras, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("dos movimientos contiguos equivalen a uno largo", () => {
    // Es la invariante que justifica que el arrastre y los botones compartan
    // esta funcion: soltar en la tercera posicion tiene que dejar la galeria
    // igual que pulsar "abajo" dos veces.
    const unPaso = moverEnLista(letras, 0, 1);
    expect(moverEnLista(unPaso, 1, 2)).toEqual(moverEnLista(letras, 0, 2));
  });

  it("devuelve la lista intacta si origen y destino coinciden", () => {
    expect(moverEnLista(letras, 2, 2)).toEqual([...letras]);
  });

  it("devuelve la lista intacta con indices fuera de rango", () => {
    // El unico origen de un indice invalido es un arrastre a medias; quedarse
    // quieto es la respuesta correcta, no lanzar.
    expect(moverEnLista(letras, -1, 2)).toEqual([...letras]);
    expect(moverEnLista(letras, 1, 9)).toEqual([...letras]);
  });

  it("no modifica la lista que recibe", () => {
    const original = [...letras];
    moverEnLista(original, 0, 3);
    expect(original).toEqual([...letras]);
  });
});

// --- Galeria en pantalla ----------------------------------------------------

const pintar = async (props: Partial<GaleriaVehiculoProps> = {}) => {
  await act(async () => {
    context.root.render(
      <GaleriaVehiculo
        vehiculoId="V1"
        fotografias={FOTOS}
        diccionario={diccionario}
        puedeEditar
        {...props}
      />,
    );
  });
};

const items = () => [...context.container.querySelectorAll("li")];

const boton = (etiqueta: string): HTMLButtonElement => {
  const encontrado = context.container.querySelector<HTMLButtonElement>(
    `[aria-label="${etiqueta}"]`,
  );
  if (!encontrado) throw new Error(`no hay boton "${etiqueta}"`);
  return encontrado;
};

const eventoDeArrastre = (
  tipo: string,
  transferencia: DataTransferFalso,
): Event => {
  const evento = new Event(tipo, { bubbles: true, cancelable: true });
  Object.defineProperty(evento, "dataTransfer", { value: transferencia });
  return evento;
};

const arrastrar = async (desde: number, hasta: number) => {
  const transferencia = new DataTransferFalso();
  const lanzar = async (tipo: string, indice: number) => {
    await act(async () => {
      items()[indice]?.dispatchEvent(eventoDeArrastre(tipo, transferencia));
    });
  };

  await lanzar("dragstart", desde);
  await lanzar("dragover", hasta);
  await lanzar("drop", hasta);
  return transferencia;
};

const ordenPedido = (): string[] => {
  const llamada = vi.mocked(reordenarFotografias).mock.calls[0];
  if (!llamada) throw new Error("no se pidio reordenar");
  return llamada[1];
};

beforeEach(() => {
  vi.mocked(reordenarFotografias).mockReset();
  vi.mocked(reordenarFotografias).mockResolvedValue({
    ok: true,
    data: { vehiculoId: "V1" },
  });
});

describe("reordenamiento con botones", () => {
  it("mover abajo intercambia con el siguiente", async () => {
    await pintar();

    await act(async () => {
      boton(`${etiquetas.moverAbajo}: 1`).click();
    });

    expect(ordenPedido()).toEqual(["F2", "F1", "F3"]);
  });

  it("mover arriba intercambia con el anterior", async () => {
    await pintar();

    await act(async () => {
      boton(`${etiquetas.moverArriba}: 3`).click();
    });

    expect(ordenPedido()).toEqual(["F1", "F3", "F2"]);
  });

  it("los extremos no se pueden sacar de la lista", async () => {
    // El primero no sube y el ultimo no baja: el boton esta deshabilitado, que
    // es lo que hace innecesario un mensaje de error despues.
    await pintar();

    expect(boton(`${etiquetas.moverArriba}: 1`).disabled).toBe(true);
    expect(boton(`${etiquetas.moverAbajo}: 3`).disabled).toBe(true);
  });
});

describe("reordenamiento por arrastre", () => {
  it("soltar sobre otra posicion manda el orden completo", async () => {
    await pintar();

    await arrastrar(2, 0);

    expect(ordenPedido()).toEqual(["F3", "F1", "F2"]);
  });

  it("da el mismo resultado que los botones para un movimiento contiguo", async () => {
    await pintar();
    await arrastrar(0, 1);
    const porArrastre = ordenPedido();

    vi.mocked(reordenarFotografias).mockClear();
    await pintar();
    await act(async () => {
      boton(`${etiquetas.moverAbajo}: 1`).click();
    });

    expect(porArrastre).toEqual(ordenPedido());
  });

  it("soltar sobre si mismo no escribe nada", async () => {
    await pintar();

    await arrastrar(1, 1);

    expect(reordenarFotografias).not.toHaveBeenCalled();
  });

  it("escribe en dataTransfer para que Firefox inicie el arrastre", async () => {
    await pintar();

    const transferencia = await arrastrar(2, 0);

    expect(transferencia.getData("text/plain")).toBe("F3");
    expect(transferencia.effectAllowed).toBe("move");
  });

  it("un arrastre que no nacio en la galeria no se admite", async () => {
    // Sin `dragstart` propio no hay origen, asi que `dragover` no llama a
    // `preventDefault` y el navegador rechaza el soltar. Es lo que deja que un
    // archivo traido del escritorio caiga en el formulario de subida.
    await pintar();
    const transferencia = new DataTransferFalso();
    const sobre = eventoDeArrastre("dragover", transferencia);

    await act(async () => {
      items()[0]?.dispatchEvent(sobre);
    });

    expect(sobre.defaultPrevented).toBe(false);
    expect(reordenarFotografias).not.toHaveBeenCalled();
  });

  it("solo se arrastra cuando se puede editar y hay a donde mover", async () => {
    await pintar();
    expect(items()[0]?.draggable).toBe(true);

    await pintar({ puedeEditar: false });
    expect(items()[0]?.draggable).toBe(false);

    await pintar({ fotografias: FOTOS.slice(0, 1) });
    expect(items()[0]?.draggable).toBe(false);
  });
});
