import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import LotesDeConvocatoria, {
  type LoteEnPantalla,
  type VehiculoDisponible,
} from "./LotesDeConvocatoria";

const incluirSimulado = vi.fn();
const retirarSimulado = vi.fn();

vi.mock("@/app/actions/convocatorias", () => ({
  incluirVehiculoDesdeFormulario: (
    ...argumentos: unknown[]
  ): Promise<unknown> => incluirSimulado(...argumentos) as Promise<unknown>,
  retirarLoteDesdeFormulario: (...argumentos: unknown[]): Promise<unknown> =>
    retirarSimulado(...argumentos) as Promise<unknown>,
}));

// `FormField` y `CardView` arrastran `Fade`, que mide el desbordamiento con un
// `setTimeout` de 50 ms y aterriza fuera del `act` de la prueba.
vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
}));

const context = getTestContext();
const diccionario = obtenerDiccionario("es");

const lote = (cambios: Partial<LoteEnPantalla> = {}): LoteEnPantalla => ({
  loteId: "L1",
  vehiculoId: "V1",
  vehiculo: "Nissan NP300 2019",
  precio: 185_000,
  estatus: "EN_OFERTA",
  puedeRetirarse: true,
  ...cambios,
});

const disponibles: VehiculoDisponible[] = [
  { vehiculoId: "V2", etiqueta: "Toyota Hilux 2020" },
];

genericTests(context, LotesDeConvocatoria, {
  convocatoriaId: "C1",
  lotes: [lote()],
  disponibles,
  editable: true,
  diccionario,
  idioma: "es" as const,
});

const pintar = async (
  props: Partial<Parameters<typeof LotesDeConvocatoria>[0]> = {},
) => {
  await act(async () => {
    context.root.render(
      <LotesDeConvocatoria
        convocatoriaId="C1"
        lotes={[lote()]}
        disponibles={disponibles}
        editable
        diccionario={diccionario}
        idioma="es"
        {...props}
      />,
    );
  });
};

const textos = () => context.container.textContent ?? "";

/**
 * Botones de la tabla, no de todo el componente.
 *
 * El `DialogModal` monta su contenido aunque este cerrado —el `<dialog>` sin
 * `open` no es visible ni accesible, pero sus nodos existen—, asi que buscar en
 * todo el contenedor encontraria siempre el "Retirar" del dialogo y ninguna
 * prueba de "no se ofrece retirar" podria fallar.
 */
const botonesDeLaTabla = () =>
  [...context.container.querySelectorAll("table button")].map((boton) =>
    boton.textContent?.trim(),
  );

describe("la tabla de lotes", () => {
  it("muestra el precio formateado, no el numero crudo", async () => {
    await pintar();

    expect(textos()).toContain("$185,000");
    expect(textos()).not.toContain("185000");
  });

  it("traduce el estatus del lote y nunca muestra el ENUM (regla 11)", async () => {
    await pintar({ lotes: [lote({ estatus: "NO_VENDIDO" })] });

    expect(textos()).toContain(diccionario.estatusLote.NO_VENDIDO);
    expect(textos()).not.toContain("NO_VENDIDO");
  });

  it("dice que no hay nada incluido en vez de pintar una tabla vacia", async () => {
    await pintar({ lotes: [] });

    expect(textos()).toContain(diccionario.convocatorias.sinLotes);
    expect(context.container.querySelector("table")).toBeNull();
  });

  it("un lote retirado conserva su motivo a la vista", async () => {
    // Retirar no borra: el auditor tiene que poder ver que ese vehiculo estuvo
    // incluido, a que precio y por que salio.
    await pintar({
      lotes: [
        lote({ estatus: "RETIRADO", motivoRetiro: "Se vendio por otra via" }),
      ],
    });

    expect(textos()).toContain("Se vendio por otra via");
    expect(textos()).toContain("$185,000");
  });
});

describe("lo que se puede hacer depende del estatus", () => {
  it("sin edicion no ofrece retirar ni incluir", async () => {
    // Fuera de BORRADOR el servidor rechaza las dos cosas; ofrecerlas solo
    // produciria un `invalid_state` con el formulario ya lleno.
    await pintar({ editable: false });

    expect(botonesDeLaTabla()).not.toContain(
      diccionario.convocatorias.retirarLote,
    );
    expect(context.container.querySelector("select")).toBeNull();
  });

  it("no ofrece retirar un lote con participantes formados, y dice por que", async () => {
    await pintar({ lotes: [lote({ puedeRetirarse: false })] });

    expect(botonesDeLaTabla()).not.toContain(
      diccionario.convocatorias.retirarLote,
    );
    expect(textos()).toContain(diccionario.convocatorias.loteConFila);
  });

  it("sin vehiculos disponibles lo dice en vez de mostrar un selector vacio", async () => {
    await pintar({ disponibles: [] });

    expect(context.container.querySelector("select")).toBeNull();
    expect(textos()).toContain(diccionario.convocatorias.sinDisponibles);
  });
});

describe("el selector de inclusion", () => {
  it("obliga a elegir con una opcion vacia, y no da por bueno el primero", async () => {
    // Sin la opcion vacia el navegador considera valido el primer vehiculo de
    // la lista, que es justo el que nadie escogio.
    await pintar();

    const select = context.container.querySelector("select");
    expect(select?.required).toBe(true);
    expect(select?.value).toBe("");

    const opciones = [...(select?.options ?? [])].map((opcion) => opcion.value);
    expect(opciones).toEqual(["", "V2"]);
  });

  it("el valor que se envia es el identificador, no la etiqueta", async () => {
    // Con el `Option` de Eden esto fallaria: deduce su valor con
    // `value || children`, asi que la opcion vacia enviaria su propio texto
    // —"Elige un vehiculo"— como identificador de vehiculo.
    await pintar();

    const opciones = [
      ...(context.container.querySelector("select")?.options ?? []),
    ];
    expect(opciones[0]?.value).toBe("");
    expect(opciones[0]?.textContent).toBe(
      diccionario.convocatorias.elegirVehiculo,
    );
    expect(opciones[1]?.value).toBe("V2");
  });

  it("acota el precio al rango que acepta el dominio", async () => {
    await pintar();

    const precio = context.container.querySelector<HTMLInputElement>(
      "input[name='precio']",
    );
    expect(precio?.min).toBe("1");
    expect(precio?.max).toBe("99999999");
    expect(precio?.step).toBe("1");
  });

  it("manda el identificador de la convocatoria, no el que teclee nadie", async () => {
    await pintar();

    const oculto = context.container.querySelector<HTMLInputElement>(
      "form.lotes__inclusion input[name='convocatoriaId']",
    );
    expect(oculto?.value).toBe("C1");
  });
});

describe("el dialogo de retiro", () => {
  const abrir = async () => {
    const boton = [
      ...context.container.querySelectorAll<HTMLButtonElement>("table button"),
    ].find(
      (uno) =>
        uno.textContent?.trim() === diccionario.convocatorias.retirarLote,
    );

    await act(async () => {
      boton?.click();
    });
  };

  const loteDelFormulario = () =>
    context.container.querySelector<HTMLInputElement>(
      "form.lotes__retiro input[name='loteId']",
    )?.value;

  it("no lleva ningun lote hasta que se pulsa retirar", async () => {
    await pintar();

    expect(loteDelFormulario()).toBe("");
  });

  it("al abrirse lleva el lote elegido y exige un motivo", async () => {
    // Un solo dialogo para toda la tabla: el lote pendiente vive en el estado.
    // Si esto se rompe, el retiro se aplicaria al lote equivocado.
    await pintar({
      lotes: [lote({ loteId: "L7", vehiculo: "Toyota Hilux 2020" })],
    });
    await abrir();

    expect(loteDelFormulario()).toBe("L7");

    // El motivo va a la bitacora: `VEHICULO_RETIRADO_DE_CONVOCATORIA` esta
    // marcado con M en el catalogo de eventos.
    const motivo = context.container.querySelector<HTMLTextAreaElement>(
      "textarea[name='motivo']",
    );
    expect(motivo?.required).toBe(true);
  });
});
