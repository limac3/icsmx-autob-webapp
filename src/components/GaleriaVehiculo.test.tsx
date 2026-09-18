import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agregarFotografia,
  editarDescripcionFotografia,
  eliminarFotografia,
  reordenarFotografias,
} from "@/app/actions/vehiculos";
import { LIMITES } from "@/lib/domain/vehiculos";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import { fuentesDePrueba } from "@/utils/fotografiaDePrueba";
import GaleriaVehiculo, {
  insertarBloque,
  moverEnLista,
  type FotografiaEnGaleria,
  type GaleriaVehiculoProps,
} from "./GaleriaVehiculo";

vi.mock("@/app/actions/vehiculos", () => ({
  agregarFotografia: vi.fn(),
  eliminarFotografia: vi.fn(),
  reordenarFotografias: vi.fn(),
  editarDescripcionFotografia: vi.fn(),
}));

// jsdom no implementa `DataTransfer`, y lo necesita el `FileInput` de Eden, que
// lo usa para sincronizar el valor del input con su estado interno. Se define un
// doble minimo en vez de sustituir el componente por un `<input type="file">`:
// la regla 10 dice usar Eden tal cual, y una carencia de jsdom no es razon para
// cambiar codigo de produccion. Ver desafios-implementacion.md seccion 20.
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
}

globalThis.DataTransfer ??=
  DataTransferFalso as unknown as typeof globalThis.DataTransfer;

// jsdom tampoco implementa `createObjectURL` ni `revokeObjectURL`: son parte de
// la API de archivos del navegador, no del DOM. Se sustituyen por espias para
// poder comprobar las dos mitades de la vista previa — que se crea una URL al
// elegir, y que **se revoca** al dejar de usarla, que es lo que evita retener
// el archivo en memoria mientras dure la pantalla.
const urlesCreadas: string[] = [];
const crearURL = vi.fn((_archivo: Blob): string => {
  const url = `blob:previsualizacion/${String(urlesCreadas.length)}`;
  urlesCreadas.push(url);
  return url;
});
const revocarURL = vi.fn();
URL.createObjectURL = crearURL as unknown as typeof URL.createObjectURL;
URL.revokeObjectURL = revocarURL as unknown as typeof URL.revokeObjectURL;

const diccionario = obtenerDiccionario("es");
const etiquetas = diccionario.vehiculos.fotografias;

const FOTOS: readonly FotografiaEnGaleria[] = [
  {
    fotoId: "F1",
    orden: 1,
    // La descripcion es el texto alternativo de la imagen: sin ella, axe
    // marca la violacion, que es exactamente lo que debe pasar.
    descripcion: "Frente del vehiculo",
    fuentes: fuentesDePrueba("F1"),
    esPrincipal: true,
  },
  {
    fotoId: "F2",
    orden: 2,
    descripcion: "Costado del vehiculo",
    fuentes: fuentesDePrueba("F2"),
    esPrincipal: false,
  },
  {
    fotoId: "F3",
    orden: 3,
    descripcion: "Interior del vehiculo",
    fuentes: fuentesDePrueba("F3"),
    esPrincipal: false,
  },
];

const context = getTestContext();

genericTests(context, GaleriaVehiculo, {
  vehiculoId: "V1",
  fotografias: FOTOS.slice(0, 2),
  diccionario,
  puedeEditar: true,
  idioma: "es",
});

// --- Calculo del nuevo orden -----------------------------------------------

describe("moverEnLista", () => {
  const letras = ["a", "b", "c", "d"] as const;

  it("mueve hacia adelante recorriendo a los de en medio", () => {
    expect(moverEnLista(letras, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("mueve hacia atras", () => {
    expect(moverEnLista(letras, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("dos movimientos contiguos equivalen a uno largo", () => {
    const unPaso = moverEnLista(letras, 0, 1);
    expect(moverEnLista(unPaso, 1, 2)).toEqual(moverEnLista(letras, 0, 2));
  });

  it("devuelve la lista intacta si origen y destino coinciden", () => {
    expect(moverEnLista(letras, 2, 2)).toEqual([...letras]);
  });

  it("devuelve la lista intacta con indices fuera de rango", () => {
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
        idioma="es"
        {...props}
      />,
    );
  });
};

const items = () => [...context.container.querySelectorAll("li")];

const porTexto = (texto: string): HTMLButtonElement | undefined =>
  [...context.container.querySelectorAll("button")].find(
    (candidato) => candidato.textContent === texto,
  );

const pulsar = async (texto: string) => {
  await act(async () => {
    porTexto(texto)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

/** El `<dialog>` que monta el modal abierto, si hay alguno. */
const modal = () => context.container.querySelector("dialog");

const campoDeDescripcion = () =>
  context.container.querySelector<HTMLTextAreaElement>(
    'textarea[name="descripcion"]',
  );

const campoDePosicion = () =>
  context.container.querySelector<HTMLSelectElement>('select[name="posicion"]');

/**
 * React sobrescribe el descriptor de `value` del elemento para detectar
 * cambios, asi que asignarlo directo le pasa desapercibido: hay que llamar al
 * setter **nativo** del prototipo. Mismo truco que `AccionesDeConvocatoria`.
 */
const teclearEn = async (
  campo: HTMLTextAreaElement | HTMLSelectElement,
  valor: string,
  prototipo: { prototype: object },
) => {
  const setter = Object.getOwnPropertyDescriptor(
    prototipo.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const escribirDescripcion = async (valor: string) => {
  const campo = campoDeDescripcion();
  if (!campo) throw new Error("no hay campo de descripcion");
  await teclearEn(campo, valor, window.HTMLTextAreaElement);
};

const elegirPosicion = async (valor: string) => {
  const campo = campoDePosicion();
  if (!campo) throw new Error("no hay campo de posicion");
  await teclearEn(campo, valor, window.HTMLSelectElement);
};

const entradaDeArchivo = () =>
  context.container.querySelector<HTMLInputElement>('input[type="file"]');

/**
 * Elige archivos en el `FileInput`.
 *
 * `bytes` decide el tamano de cada uno, que es lo que hace comprobable el tope
 * de volumen de la tanda.
 */
const elegirArchivos = async (
  nombres: readonly string[],
  bytes = 1024,
  tipo = "image/jpeg",
) => {
  const entrada = entradaDeArchivo();
  if (!entrada) throw new Error("no hay entrada de archivo");
  await act(async () => {
    // jsdom valida el tipo al asignar `files`, asi que se define la propiedad
    // en vez de asignarla. Queda escribible porque `FileInput` la reescribe con
    // su propio `DataTransfer` al sincronizarse.
    Object.defineProperty(entrada, "files", {
      value: nombres.map(
        (nombre) => new File(["x".repeat(bytes)], nombre, { type: tipo }),
      ),
      writable: true,
      configurable: true,
    });
    entrada.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

/** Mezcla tipos en una sola seleccion, que es el caso que fallaba. */
const elegirMezcla = async (
  archivos: readonly { nombre: string; tipo: string }[],
) => {
  const entrada = entradaDeArchivo();
  if (!entrada) throw new Error("no hay entrada de archivo");
  await act(async () => {
    Object.defineProperty(entrada, "files", {
      value: archivos.map(
        ({ nombre, tipo }) => new File(["x"], nombre, { type: tipo }),
      ),
      writable: true,
      configurable: true,
    });
    entrada.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const elegirArchivo = (nombre: string) => elegirArchivos([nombre]);

const miniaturasElegidas = () => [
  ...context.container.querySelectorAll<HTMLElement>(
    ".galeria-vehiculo__elegida",
  ),
];

beforeEach(() => {
  for (const espia of [
    reordenarFotografias,
    editarDescripcionFotografia,
    eliminarFotografia,
    agregarFotografia,
  ]) {
    vi.mocked(espia).mockReset();
  }
  vi.mocked(reordenarFotografias).mockResolvedValue({
    ok: true,
    data: { vehiculoId: "V1" },
  });
  vi.mocked(editarDescripcionFotografia).mockResolvedValue({
    ok: true,
    data: { fotoId: "F1" },
  });
  vi.mocked(eliminarFotografia).mockResolvedValue({
    ok: true,
    data: { fotoId: "F1" },
  });
  vi.mocked(agregarFotografia).mockResolvedValue({
    ok: true,
    data: { fotoId: "F9" },
  });
  crearURL.mockClear();
  revocarURL.mockClear();
});

describe("la rejilla es solo fotografias", () => {
  it("cada fotografia muestra su descripcion completa, como texto", async () => {
    // **Es el defecto que el operador reporto.** La version anterior la metia
    // en un campo de una linea y quedaba recortada justo en lo que se venia a
    // leer. Ahora es un parrafo, que se ajusta en varias lineas.
    await pintar();

    const pies = items().map(
      (item) => item.querySelector(".galeria-vehiculo__pie")?.textContent,
    );
    expect(pies).toEqual([
      "Frente del vehiculo",
      "Costado del vehiculo",
      "Interior del vehiculo",
    ]);
    expect(
      context.container.querySelectorAll(".galeria-vehiculo__pie input"),
    ).toHaveLength(0);
  });

  it("sin descripcion lo dice, en vez de dejar un hueco", async () => {
    await pintar({ fotografias: [{ ...FOTOS[0]!, descripcion: undefined }] });

    expect(
      items()[0]?.querySelector(".galeria-vehiculo__pie")?.textContent,
    ).toBe(etiquetas.sinDescripcion);
  });

  it("el distintivo de principal va dentro de la fotografia", async () => {
    // Dentro del marco de la imagen y no debajo: asi se lee sobre la fotografia
    // que califica, y no se confunde con el pie de la de al lado.
    await pintar();

    const marco = items()[0]?.querySelector(".galeria-vehiculo__marco");
    expect(
      marco?.querySelector(".galeria-vehiculo__insignia")?.textContent,
    ).toBe(etiquetas.principal);
    expect(items()[1]?.querySelector(".galeria-vehiculo__insignia")).toBeNull();
  });

  it("bajo cada fotografia hay un solo boton: editar", async () => {
    // Antes habia cinco por fotografia —subir, bajar, marcar principal, editar
    // y eliminar—: con veinte, un tablero de cien botones sobre lo que se viene
    // a hacer, que es mirar las fotos.
    await pintar();

    for (const item of items()) {
      const botones = [...item.querySelectorAll("button")];
      expect(botones).toHaveLength(1);
      expect(botones[0]?.textContent).toBe(etiquetas.editar);
    }
  });

  it("todas las imagenes se piden con el mismo tamano declarado", async () => {
    await pintar();

    const imagenes = [
      ...context.container.querySelectorAll<HTMLImageElement>(
        "li .galeria-vehiculo__imagen",
      ),
    ];
    expect(imagenes).toHaveLength(3);
    expect(
      new Set(imagenes.map((imagen) => imagen.getAttribute("sizes"))).size,
    ).toBe(1);
  });

  it("sin permiso no hay boton de agregar ni de editar", async () => {
    await pintar({ puedeEditar: false });

    expect(porTexto(etiquetas.agregar)).toBeUndefined();
    expect(porTexto(etiquetas.editar)).toBeUndefined();
    // La galeria sigue viendose, con sus descripciones.
    expect(context.container.textContent).toContain("Frente del vehiculo");
  });

  it("la galeria vacia lo dice y deja agregar", async () => {
    await pintar({ fotografias: [] });

    expect(context.container.textContent).toContain(etiquetas.vacia);
    expect(porTexto(etiquetas.agregar)).toBeDefined();
  });
});

describe("modal de agregar", () => {
  it("no existe hasta que se pulsa agregar", async () => {
    await pintar();
    expect(modal()).toBeNull();

    await pulsar(etiquetas.agregar);

    expect(modal()).not.toBeNull();
    expect(entradaDeArchivo()).not.toBeNull();
  });

  it("el control de archivo admite arrastrar y soltar", async () => {
    // `isDroppable` de `FileInput` es lo que lo habilita; Eden marca la zona de
    // caida con sus propios manejadores, asi que lo observable es la etiqueta
    // que solo se pinta en ese modo.
    await pintar();
    await pulsar(etiquetas.agregar);

    expect(modal()?.textContent).toContain(etiquetas.arrastrarArchivos);
  });

  it("con la galeria vacia no pregunta la posicion", async () => {
    // La primera es la 1 y por tanto la principal: un campo con una sola
    // opcion es una pregunta sin respuestas.
    await pintar({ fotografias: [] });
    await pulsar(etiquetas.agregar);

    expect(campoDePosicion()).toBeNull();
  });

  it("con fotografias ofrece una posicion mas que las existentes", async () => {
    // Tres fotografias dejan cuatro sitios posibles para la nueva; sin el
    // cuarto no se podria dejar al final, que es el caso mas comun.
    await pintar();
    await pulsar(etiquetas.agregar);

    const opciones = [...(campoDePosicion()?.options ?? [])].map(
      (opcion) => opcion.value,
    );
    expect(opciones).toEqual(["1", "2", "3", "4"]);
    expect(campoDePosicion()?.value).toBe("4");
  });

  it("la posicion 1 se anuncia como la principal", async () => {
    await pintar();
    await pulsar(etiquetas.agregar);

    expect(campoDePosicion()?.options[0]?.textContent).toContain(
      etiquetas.sufijoPrincipal,
    );
  });

  it("sin archivo no se puede guardar", async () => {
    await pintar();
    await pulsar(etiquetas.agregar);

    expect(porTexto(etiquetas.guardar)?.disabled).toBe(true);
    await pulsar(etiquetas.guardar);
    expect(vi.mocked(agregarFotografia)).not.toHaveBeenCalled();
  });

  it("muestra la fotografia elegida antes de guardarla", async () => {
    await pintar();
    await pulsar(etiquetas.agregar);
    await elegirArchivo("frente.jpg");

    expect(crearURL).toHaveBeenCalledTimes(1);
    expect(miniaturasElegidas()).toHaveLength(1);
    expect(miniaturasElegidas()[0]?.querySelector("img")?.alt).toContain(
      "frente.jpg",
    );
  });

  it("guardar al final sube y no reordena", async () => {
    await pintar();
    await pulsar(etiquetas.agregar);
    await elegirArchivo("frente.jpg");
    await escribirDescripcion("Cofre");
    await pulsar(etiquetas.guardar);

    expect(agregarFotografia).toHaveBeenCalledWith(
      expect.objectContaining({ vehiculoId: "V1", descripcion: "Cofre" }),
    );
    expect(vi.mocked(reordenarFotografias)).not.toHaveBeenCalled();
  });

  it("guardar en la posicion 1 sube y la mueve al frente", async () => {
    // `agregarFotografia` siempre coloca al final, asi que la posicion elegida
    // se aplica con el reordenamiento, que es tambien lo que designa la
    // principal.
    await pintar();
    await pulsar(etiquetas.agregar);
    await elegirArchivo("frente.jpg");
    await elegirPosicion("1");
    await pulsar(etiquetas.guardar);

    expect(reordenarFotografias).toHaveBeenCalledWith("V1", [
      "F9",
      "F1",
      "F2",
      "F3",
    ]);
  });

  it("si la subida falla no se reordena nada", async () => {
    vi.mocked(agregarFotografia).mockResolvedValue({
      ok: false,
      error: "validation_failed",
    });
    await pintar();
    await pulsar(etiquetas.agregar);
    await elegirArchivo("frente.jpg");
    await elegirPosicion("1");
    await pulsar(etiquetas.guardar);

    expect(vi.mocked(reordenarFotografias)).not.toHaveBeenCalled();
    expect(context.container.textContent).toContain(
      diccionario.errores.validation_failed,
    );
  });

  it("cancelar cierra sin subir y revoca la vista previa", async () => {
    await pintar();
    await pulsar(etiquetas.agregar);
    await elegirArchivo("frente.jpg");
    const creada = crearURL.mock.results[0]?.value as string;

    await pulsar(etiquetas.cancelar);

    expect(modal()).toBeNull();
    expect(vi.mocked(agregarFotografia)).not.toHaveBeenCalled();
    expect(revocarURL).toHaveBeenCalledWith(creada);
  });
});

describe("subida de varias fotografias de un tiro", () => {
  const abrirConArchivos = async (
    nombres: readonly string[],
    bytes?: number,
  ) => {
    await pintar();
    await pulsar(etiquetas.agregar);
    await elegirArchivos(nombres, bytes);
  };

  it("el control admite varias", async () => {
    await pintar();
    await pulsar(etiquetas.agregar);

    expect(entradaDeArchivo()?.multiple).toBe(true);
  });

  it("pinta una miniatura por archivo, con su nombre", async () => {
    // **No es adorno.** `FileInput` deduplica por nombre de archivo, asi que dos
    // fotos distintas llamadas `IMG_0001.jpg` —lo normal en una camara— dejarian
    // caer la segunda en silencio. Viendolas, la que falta se nota.
    await abrirConArchivos(["frente.jpg", "costado.jpg", "interior.jpg"]);

    expect(miniaturasElegidas().map((una) => una.textContent)).toEqual([
      "frente.jpg",
      "costado.jpg",
      "interior.jpg",
    ]);
  });

  it("una peticion por fotografia, en el orden elegido", async () => {
    // Una peticion por archivo es lo que mantiene el tope de tamano del cuerpo
    // aplicado por fotografia, y le da a cada alta su transaccion y su evento.
    await abrirConArchivos(["a.jpg", "b.jpg", "c.jpg"]);
    await pulsar(etiquetas.guardar);

    expect(vi.mocked(agregarFotografia).mock.calls.length).toBe(3);
    expect(
      vi
        .mocked(agregarFotografia)
        .mock.calls.map(([entrada]) => entrada.archivo.name),
    ).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  it("la descripcion se guarda igual en todas", async () => {
    await abrirConArchivos(["a.jpg", "b.jpg"]);
    await escribirDescripcion("Lote de agosto");
    await pulsar(etiquetas.guardar);

    for (const [entrada] of vi.mocked(agregarFotografia).mock.calls) {
      expect(entrada.descripcion).toBe("Lote de agosto");
    }
  });

  it("la posicion es la de la primera y las demas la siguen", async () => {
    // Tres existentes (F1, F2, F3) y dos nuevas en la posicion 2: el bloque
    // entero entra ahi y las que estaban se corren detras.
    vi.mocked(agregarFotografia)
      .mockResolvedValueOnce({ ok: true, data: { fotoId: "N1" } })
      .mockResolvedValueOnce({ ok: true, data: { fotoId: "N2" } });
    await abrirConArchivos(["a.jpg", "b.jpg"]);
    await elegirPosicion("2");
    await pulsar(etiquetas.guardar);

    expect(reordenarFotografias).toHaveBeenCalledTimes(1);
    expect(reordenarFotografias).toHaveBeenCalledWith("V1", [
      "F1",
      "N1",
      "N2",
      "F2",
      "F3",
    ]);
  });

  it("al final no reordena nada", async () => {
    await abrirConArchivos(["a.jpg", "b.jpg"]);
    await pulsar(etiquetas.guardar);

    expect(vi.mocked(reordenarFotografias)).not.toHaveBeenCalled();
  });

  it("la ayuda de los dos campos cambia cuando son varias", async () => {
    await abrirConArchivos(["a.jpg", "b.jpg"]);

    expect(modal()?.textContent).toContain(etiquetas.descripcionParaTodas);
    expect(modal()?.textContent).toContain(etiquetas.posicionDelBloque);
  });

  it("con una sola no habla de bloques ni de todas", async () => {
    await abrirConArchivos(["a.jpg"]);

    expect(modal()?.textContent).not.toContain(etiquetas.descripcionParaTodas);
    expect(modal()?.textContent).not.toContain(etiquetas.posicionDelBloque);
  });

  it("si una falla a la mitad, se detiene y no reordena", async () => {
    // Las anteriores quedan subidas y visibles: es lo correcto, porque ya estan
    // en S3 y en la bitacora. Lo que no se hace es seguir con las siguientes ni
    // reordenar sobre un estado que no es el que se calculo.
    vi.mocked(agregarFotografia)
      .mockResolvedValueOnce({ ok: true, data: { fotoId: "N1" } })
      .mockResolvedValueOnce({ ok: false, error: "validation_failed" });
    await abrirConArchivos(["a.jpg", "b.jpg", "c.jpg"]);
    await elegirPosicion("1");
    await pulsar(etiquetas.guardar);

    expect(vi.mocked(agregarFotografia).mock.calls.length).toBe(2);
    expect(vi.mocked(reordenarFotografias)).not.toHaveBeenCalled();
    expect(context.container.textContent).toContain(
      diccionario.errores.validation_failed,
    );
  });

  it("el rechazo dice **que** fallo, no solo que algo fallo", async () => {
    // **Guardar solo el codigo general costo una tarde de diagnostico.** Con
    // `validation_failed` a secas la pantalla decia "Revisa los datos
    // capturados" sobre un modal donde no hay nada evidente que revisar, y el
    // motivo real —`no_es_permutacion`— era imposible de adivinar.
    vi.mocked(agregarFotografia).mockResolvedValue({
      ok: false,
      error: "validation_failed",
      detalles: { archivo: "muy_grande" },
    });
    await abrirConArchivos(["a.jpg"]);
    await pulsar(etiquetas.guardar);

    expect(context.container.textContent).toContain(
      diccionario.validacionVehiculo.muy_grande,
    );
  });

  it("revoca todas las URLs al cerrar", async () => {
    await abrirConArchivos(["a.jpg", "b.jpg", "c.jpg"]);
    const creadas = crearURL.mock.results.map(
      (resultado) => resultado.value as string,
    );

    await pulsar(etiquetas.cancelar);

    expect(creadas).toHaveLength(3);
    for (const url of creadas) expect(revocarURL).toHaveBeenCalledWith(url);
  });
});

describe("el tope de 10 MB es del total de la tanda", () => {
  const MEGA = 1024 * 1024;

  it("se pasa del volumen: avisa y no deja guardar", async () => {
    // Seis archivos de 2 MB son 12 MB. Cada uno cabe por separado; la tanda no.
    await pintar();
    await pulsar(etiquetas.agregar);
    await elegirArchivos(
      ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg", "f.jpg"],
      2 * MEGA,
    );

    expect(context.container.textContent).toContain(etiquetas.volumenExcedido);
    expect(porTexto(etiquetas.guardar)?.disabled).toBe(true);
  });

  it("el proceso se cancela entero: no sube ni una", async () => {
    // Cual dejar fuera es decision de quien sube, no del programa, asi que no
    // se recorta la tanda sola.
    await pintar();
    await pulsar(etiquetas.agregar);
    await elegirArchivos(["a.jpg", "b.jpg", "c.jpg"], 4 * MEGA);
    await pulsar(etiquetas.guardar);

    expect(vi.mocked(agregarFotografia)).not.toHaveBeenCalled();
  });

  it("justo por debajo del tope si se puede guardar", async () => {
    await pintar();
    await pulsar(etiquetas.agregar);
    await elegirArchivos(["a.jpg", "b.jpg"], 5 * MEGA - 1);

    expect(context.container.textContent).not.toContain(
      etiquetas.volumenExcedido,
    );
    expect(porTexto(etiquetas.guardar)?.disabled).toBe(false);
  });

  it("un solo archivo pasado del tope tambien se detiene aqui", async () => {
    await pintar();
    await pulsar(etiquetas.agregar);
    await elegirArchivos(["gigante.jpg"], 11 * MEGA);

    expect(porTexto(etiquetas.guardar)?.disabled).toBe(true);
  });

  it("avisa antes de empezar si la tanda se pasa del maximo por vehiculo", async () => {
    // Con 18 ya subidas y 5 elegidas, las tres ultimas fallarian a mitad de la
    // tanda con `demasiadas`. Es mejor decirlo antes de subir nada.
    const dieciocho = Array.from({ length: 18 }, (_, indice) => ({
      ...FOTOS[0]!,
      fotoId: `P${String(indice)}`,
      esPrincipal: indice === 0,
    }));
    await pintar({ fotografias: dieciocho });
    await pulsar(etiquetas.agregar);
    await elegirArchivos(["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg"]);

    expect(context.container.textContent).toContain(etiquetas.cupoExcedido);
    expect(porTexto(etiquetas.guardar)?.disabled).toBe(true);
  });
});

/**
 * Un archivo de formato no admitido se detiene **antes** de subir nada.
 *
 * Reporte de campo: un `.avif` en una tanda dejaba subidas las anteriores,
 * detenia el bucle y no aplicaba la posicion, con un "Revisa los datos
 * capturados" que no decia cual archivo era (`desafios-implementacion.md` 89).
 */
describe("archivos de formato no admitido", () => {
  const rechazadas = () => [
    ...context.container.querySelectorAll(
      ".galeria-vehiculo__elegida--rechazada",
    ),
  ];

  it("AVIF ya se admite y no se marca", async () => {
    await pintar();
    await pulsar(etiquetas.agregar);
    await elegirArchivos(["foto.avif"], 1024, "image/avif");

    expect(rechazadas()).toHaveLength(0);
    expect(porTexto(etiquetas.guardar)?.disabled).toBe(false);
  });

  it("marca solo el archivo que sobra, no la tanda entera", async () => {
    // Con siete archivos, saber que uno sobra no dice cual.
    await pintar();
    await pulsar(etiquetas.agregar);
    await elegirMezcla([
      { nombre: "a.jpg", tipo: "image/jpeg" },
      { nombre: "raro.gif", tipo: "image/gif" },
      { nombre: "c.png", tipo: "image/png" },
    ]);

    expect(miniaturasElegidas()).toHaveLength(3);
    expect(rechazadas()).toHaveLength(1);
    expect(rechazadas()[0]?.textContent).toContain("raro.gif");
  });

  it("dice el motivo en la propia miniatura", async () => {
    await pintar();
    await pulsar(etiquetas.agregar);
    await elegirArchivos(["raro.gif"], 1024, "image/gif");

    expect(rechazadas()[0]?.textContent).toContain(
      diccionario.validacionVehiculo.tipo_no_admitido,
    );
  });

  it("no deja empezar: ni una sola se sube", async () => {
    // **Es la correccion.** Antes, las anteriores al archivo malo si subian y
    // el reordenamiento nunca llegaba a correr.
    await pintar();
    await pulsar(etiquetas.agregar);
    await elegirMezcla([
      { nombre: "a.jpg", tipo: "image/jpeg" },
      { nombre: "raro.gif", tipo: "image/gif" },
    ]);

    expect(porTexto(etiquetas.guardar)?.disabled).toBe(true);
    await pulsar(etiquetas.guardar);

    expect(vi.mocked(agregarFotografia)).not.toHaveBeenCalled();
    expect(vi.mocked(reordenarFotografias)).not.toHaveBeenCalled();
  });

  it("explica que hacer, no solo que algo esta mal", async () => {
    await pintar();
    await pulsar(etiquetas.agregar);
    await elegirArchivos(["raro.gif"], 1024, "image/gif");

    expect(modal()?.textContent).toContain(etiquetas.tipoNoAdmitido);
  });
});

describe("insertarBloque", () => {
  const existentes = ["a", "b", "c"] as const;

  it("al frente", () => {
    expect(insertarBloque(existentes, ["x", "y"], 0)).toEqual([
      "x",
      "y",
      "a",
      "b",
      "c",
    ]);
  });

  it("en medio, y las que estaban se corren detras", () => {
    expect(insertarBloque(existentes, ["x", "y"], 1)).toEqual([
      "a",
      "x",
      "y",
      "b",
      "c",
    ]);
  });

  it("al final", () => {
    expect(insertarBloque(existentes, ["x"], 3)).toEqual(["a", "b", "c", "x"]);
  });

  it("conserva el orden del bloque", () => {
    // Es lo que hace que "las demas la siguen" signifique el orden en que se
    // eligieron y no uno cualquiera.
    expect(insertarBloque([], ["x", "y", "z"], 0)).toEqual(["x", "y", "z"]);
  });

  it("un indice imposible se acota en vez de lanzar", () => {
    expect(insertarBloque(existentes, ["x"], 99)).toEqual(["a", "b", "c", "x"]);
    expect(insertarBloque(existentes, ["x"], -5)).toEqual(["x", "a", "b", "c"]);
  });

  it("no modifica las listas que recibe", () => {
    const copia = [...existentes];
    insertarBloque(copia, ["x"], 1);
    expect(copia).toEqual([...existentes]);
  });
});

describe("modal de edicion", () => {
  const abrirEdicionDe = async (indice: number) => {
    await act(async () => {
      items()
        [indice]?.querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  it("no existe hasta que se pulsa editar", async () => {
    await pintar();
    expect(modal()).toBeNull();

    await abrirEdicionDe(1);

    expect(modal()).not.toBeNull();
    expect(campoDeDescripcion()?.value).toBe("Costado del vehiculo");
  });

  it("muestra la fotografia y no deja cambiarla", async () => {
    // Los bytes son inmutables: para cambiar la imagen se elimina y se sube
    // otra. Por eso aqui no hay control de archivo.
    await pintar();
    await abrirEdicionDe(1);

    expect(
      modal()?.querySelector(".galeria-vehiculo__imagen--modal"),
    ).not.toBeNull();
    expect(modal()?.querySelector('input[type="file"]')).toBeNull();
  });

  it("la posicion llega con la actual y se acota a las existentes", async () => {
    await pintar();
    await abrirEdicionDe(2);

    const opciones = [...(campoDePosicion()?.options ?? [])].map(
      (opcion) => opcion.value,
    );
    expect(opciones).toEqual(["1", "2", "3"]);
    expect(campoDePosicion()?.value).toBe("3");
  });

  it("con una sola fotografia no pregunta la posicion", async () => {
    await pintar({ fotografias: FOTOS.slice(0, 1) });
    await abrirEdicionDe(0);

    expect(campoDePosicion()).toBeNull();
  });

  it("guardar solo la descripcion no reordena", async () => {
    await pintar();
    await abrirEdicionDe(1);
    await escribirDescripcion("Costado izquierdo");
    await pulsar(etiquetas.guardar);

    expect(editarDescripcionFotografia).toHaveBeenCalledWith(
      "V1",
      "F2",
      "Costado izquierdo",
    );
    expect(vi.mocked(reordenarFotografias)).not.toHaveBeenCalled();
  });

  it("guardar solo la posicion no toca la descripcion", async () => {
    await pintar();
    await abrirEdicionDe(2);
    await elegirPosicion("1");
    await pulsar(etiquetas.guardar);

    expect(reordenarFotografias).toHaveBeenCalledWith("V1", ["F3", "F1", "F2"]);
    expect(vi.mocked(editarDescripcionFotografia)).not.toHaveBeenCalled();
  });

  it("guardar sin cambiar nada no escribe y cierra", async () => {
    // Los dos servicios ya devuelven exito sin escribir cuando no hay
    // diferencia; ahorrarse los dos viajes es lo que hace barato abrir el modal
    // solo para mirar.
    await pintar();
    await abrirEdicionDe(1);
    await pulsar(etiquetas.guardar);

    expect(vi.mocked(editarDescripcionFotografia)).not.toHaveBeenCalled();
    expect(vi.mocked(reordenarFotografias)).not.toHaveBeenCalled();
    expect(modal()).toBeNull();
  });

  it("una descripcion que ya venia larga no se manda: avisa y la conserva", async () => {
    // **El caso que `maxLength` no cubre.** El atributo frena el teclado pero no
    // recorta un valor que ya venia largo, y sin esta guarda se mandaba al
    // servidor, volvia rechazado y se perdia lo escrito.
    const largo = "x".repeat(LIMITES.descripcionFotografia + 1);
    await pintar();
    await abrirEdicionDe(1);
    await escribirDescripcion(largo);

    expect(porTexto(etiquetas.guardar)?.disabled).toBe(true);
    expect(modal()?.textContent).toContain(etiquetas.descripcionExcedida);

    await pulsar(etiquetas.guardar);

    expect(vi.mocked(editarDescripcionFotografia)).not.toHaveBeenCalled();
    expect(campoDeDescripcion()?.value).toBe(largo);
  });

  it("el campo lleva el tope como `maxLength`", async () => {
    await pintar();
    await abrirEdicionDe(1);

    expect(campoDeDescripcion()?.maxLength).toBe(LIMITES.descripcionFotografia);
  });

  it("cancelar cierra sin escribir", async () => {
    await pintar();
    await abrirEdicionDe(1);
    await escribirDescripcion("Otra cosa");
    await pulsar(etiquetas.cancelar);

    expect(modal()).toBeNull();
    expect(vi.mocked(editarDescripcionFotografia)).not.toHaveBeenCalled();
  });
});

/**
 * Eliminar exige confirmacion.
 *
 * **Que el modal esta abierto no se comprueba por el atributo `open`.** jsdom
 * no implementa `HTMLDialogElement.showModal` —es `undefined`— y el modal de
 * Eden lo llama con `?.()`, asi que el `<dialog>` nunca lo recibe en prueba. Lo
 * observable es que el modal **este montado o no**, porque la galeria los monta
 * bajo demanda; y eso es lo que importa, porque un `<dialog>` cerrado
 * conservaria sus hijos —y su boton de borrar— en el DOM.
 */
describe("eliminar pide confirmacion", () => {
  const abrirEdicionDe = async (indice: number) => {
    await act(async () => {
      items()
        [indice]?.querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  it("el boton de eliminar no borra: pide confirmacion primero", async () => {
    // Borrar destruye los objetos de S3 y no hay vuelta, asi que un clic sobre
    // el boton equivocado no puede ser suficiente.
    await pintar();
    await abrirEdicionDe(1);
    await pulsar(etiquetas.eliminar);

    expect(vi.mocked(eliminarFotografia)).not.toHaveBeenCalled();
    expect(modal()?.textContent).toContain(etiquetas.confirmarEliminarAviso);
  });

  it("la confirmacion sustituye al modal de edicion, no se anida", async () => {
    // Dos `<dialog>` abiertos a la vez dejan la pila del top layer a merced del
    // orden de cierre.
    await pintar();
    await abrirEdicionDe(1);
    await pulsar(etiquetas.eliminar);

    expect(context.container.querySelectorAll("dialog")).toHaveLength(1);
    expect(campoDeDescripcion()).toBeNull();
  });

  it("confirmar borra la fotografia que se estaba editando", async () => {
    await pintar();
    await abrirEdicionDe(1);
    await pulsar(etiquetas.eliminar);
    await pulsar(etiquetas.eliminarDefinitivo);

    expect(eliminarFotografia).toHaveBeenCalledWith("V1", "F2");
  });

  it("cancelar la confirmacion cierra sin borrar", async () => {
    await pintar();
    await abrirEdicionDe(1);
    await pulsar(etiquetas.eliminar);
    await pulsar(etiquetas.cancelar);

    expect(modal()).toBeNull();
    expect(vi.mocked(eliminarFotografia)).not.toHaveBeenCalled();
  });

  it("con una sola fotografia el boton esta deshabilitado", async () => {
    await pintar({ fotografias: FOTOS.slice(0, 1) });
    await abrirEdicionDe(0);

    expect(porTexto(etiquetas.eliminar)?.disabled).toBe(true);
  });
});
