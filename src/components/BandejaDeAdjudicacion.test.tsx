import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import BandejaDeAdjudicacion, {
  type LotePorDecidir,
} from "./BandejaDeAdjudicacion";

// Mismas dos razones que en `BandejaDeAprobacion.test.tsx`: `next/link`
// precarga por interseccion y `CardView` mide desbordamiento con un
// `setTimeout`, y las dos aterrizan fuera del `act` de la prueba.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
}));

const context = getTestContext();
const diccionario = obtenerDiccionario("es");

const lote = (cambios: Partial<LotePorDecidir> = {}): LotePorDecidir => ({
  convocatoriaId: "C1",
  loteId: "L1",
  vehiculo: "Nissan NP300 2019",
  identificadores: "1234 · VIN-0001",
  precio: "$150,000.00",
  convocatoria: "Venta de octubre",
  tamanoFila: 4,
  espera: "hace 2 días",
  ventaAbierta: false,
  ...cambios,
});

genericTests(context, BandejaDeAdjudicacion, {
  lotes: [lote()],
  diccionario,
});

const pintar = async (lotes: readonly LotePorDecidir[]) => {
  await act(async () => {
    context.root.render(
      <BandejaDeAdjudicacion lotes={lotes} diccionario={diccionario} />,
    );
  });
};

describe("bandeja del adjudicador", () => {
  it("cada fila lleva al detalle, que es donde se dictamina", async () => {
    // La bandeja no decide: duplicar los botones aqui daria dos vistas del
    // mismo dictamen que se separarian al primer cambio.
    await pintar([lote()]);

    const enlace = context.container.querySelector("a");
    expect(enlace?.getAttribute("href")).toBe("/adjudicacion/C1/L1");
  });

  it("avisa cuando la venta sigue abierta", async () => {
    await pintar([lote({ ventaAbierta: true })]);

    expect(context.container.textContent).toContain(
      diccionario.adjudicacion.ventaAbiertaAviso,
    );
  });

  it("no avisa cuando la venta ya cerro", async () => {
    await pintar([lote({ ventaAbierta: false })]);

    expect(context.container.textContent).not.toContain(
      diccionario.adjudicacion.ventaAbiertaAviso,
    );
  });

  it("muestra el tamano de la fila, jamas quien la forma (R-12)", async () => {
    // La bandeja es un listado: la identidad solo aparece en el detalle, tras
    // `adjudicacion:ver-fila-identificada`.
    await pintar([lote({ tamanoFila: 7 })]);

    expect(context.container.textContent).toContain("7");
  });

  it("muestra el precio y los identificadores del vehiculo, no solo su rotulo", async () => {
    // Antes la bandeja solo traia `vehiculoId`: el identificador interno, sin
    // marca, version, modelo ni precio — nada que permitiera reconocer el
    // vehiculo sin abrir el detalle.
    await pintar([lote()]);

    expect(context.container.textContent).toContain("Nissan NP300 2019");
    expect(context.container.textContent).toContain("1234 · VIN-0001");
    expect(context.container.textContent).toContain("$150,000.00");
  });

  it("no deja una linea vacia cuando el vehiculo no se pudo leer", async () => {
    await pintar([lote({ vehiculo: "VEH-999", identificadores: "" })]);

    expect(context.container.textContent).toContain("VEH-999");
  });

  it("sin lotes por decidir lo dice, en vez de una tabla vacia", async () => {
    await pintar([]);

    expect(context.container.textContent).toContain(
      diccionario.adjudicacion.sinPendientes,
    );
    expect(context.container.querySelector("table")).toBeNull();
  });
});
