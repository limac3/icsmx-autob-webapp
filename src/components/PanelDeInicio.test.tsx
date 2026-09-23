import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import PanelDeInicio, { type PanelDeInicioProps } from "./PanelDeInicio";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

// `CuentaRegresiva` monta un intervalo y llama a `useRouter` al llegar a cero.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const diccionario = obtenerDiccionario("es");
const etiquetas = diccionario.inicio.siguientePaso;
const deBandeja = diccionario.inicio.pendientes;

const props: PanelDeInicioProps = {
  siguientePaso: {
    tipo: "PLAZO_CORRIENDO",
    convocatoriaId: "CONV1",
    loteId: "LOTE1",
    vehiculo: "Nissan 2019",
    venceEn: "2026-09-24T18:00:00.000Z",
    fechaFormateada: "24 de septiembre de 2026, 12:00",
    segundosParaVencer: 86_400,
  },
  pendientes: [],
  diccionario,
  idioma: "es",
};

const context = getTestContext();

genericTests(context, PanelDeInicio, props);

describe("PanelDeInicio", () => {
  const pintar = async (extra: Partial<PanelDeInicioProps> = {}) => {
    await act(async () => {
      context.root.render(<PanelDeInicio {...props} {...extra} />);
    });
    return context.container;
  };

  it("el plazo corriendo lleva al lote, que es donde se sube el comprobante", async () => {
    const contenedor = await pintar();
    const texto = contenedor.textContent ?? "";

    expect(texto).toContain("Nissan 2019");
    expect(texto).toContain("24 de septiembre de 2026, 12:00");
    expect(texto).toContain(diccionario.catalogo.horaDeNegocio);
    expect(contenedor.querySelector("a")?.getAttribute("href")).toBe(
      "/convocatorias/CONV1/lotes/LOTE1",
    );
  });

  it("con la lista truncada no afirma una fecha, y manda a la lista completa", async () => {
    const contenedor = await pintar({
      siguientePaso: { tipo: "PLAZO_CORRIENDO_SIN_PRECISAR" },
    });

    expect(contenedor.textContent).toContain(etiquetas.plazoSinPrecisar);
    expect(contenedor.textContent).not.toContain(etiquetas.plazoVence);
    expect(contenedor.querySelector("a")?.getAttribute("href")).toBe(
      "/mis-solicitudes",
    );
  });

  it("una venta abierta se nombra con cuantos vehiculos trae", async () => {
    const texto =
      (
        await pintar({
          siguientePaso: {
            tipo: "VENTA_ABIERTA",
            convocatoriaId: "CONV1",
            nombre: "Renovacion 2026",
            cantidadDeLotes: 3,
          },
        })
      ).textContent ?? "";

    expect(texto).toContain("Renovacion 2026");
    expect(texto).toContain(`3 ${etiquetas.ventaAbiertaLotes}`);
  });

  it("con varias abiertas cuenta en vez de elegir una", async () => {
    const texto =
      (
        await pintar({
          siguientePaso: { tipo: "VARIAS_VENTAS_ABIERTAS", cantidad: 2 },
        })
      ).textContent ?? "";

    expect(texto).toContain(`2 ${etiquetas.variasVentasAbiertas}`);
  });

  it("la proxima apertura dice cuando, en hora de negocio", async () => {
    const texto =
      (
        await pintar({
          siguientePaso: {
            tipo: "PROXIMA_APERTURA",
            nombre: "Octubre",
            inicioVenta: "2026-10-01T17:00:00.000Z",
            fechaFormateada: "1 de octubre de 2026, 11:00",
          },
        })
      ).textContent ?? "";

    expect(texto).toContain("1 de octubre de 2026, 11:00");
    expect(texto).toContain(diccionario.catalogo.horaDeNegocio);
  });

  it("las bandejas con trabajo se cuentan, en singular cuando toca", async () => {
    const texto =
      (
        await pintar({
          siguientePaso: undefined,
          pendientes: [
            { id: "aprobaciones", href: "/aprobaciones", cantidad: 1 },
            {
              id: "tesoreria",
              href: "/tesoreria/verificacion",
              cantidad: 4,
            },
          ],
        })
      ).textContent ?? "";

    expect(texto).toContain(`1 ${deBandeja.aprobacionesUna}`);
    expect(texto).toContain(`4 ${deBandeja.tesoreria}`);
  });

  it("adjudicacion se anuncia sin numero", async () => {
    const texto =
      (
        await pintar({
          siguientePaso: undefined,
          pendientes: [{ id: "adjudicacion", href: "/adjudicacion" }],
        })
      ).textContent ?? "";

    expect(texto).toContain(deBandeja.adjudicacion);
    expect(texto).not.toContain("undefined");
  });

  it("un fallo de lectura se dice, no se disfraza de pantalla vacia", async () => {
    const texto =
      (await pintar({ siguientePaso: undefined, fallo: true })).textContent ??
      "";

    expect(texto).toContain(etiquetas.errorTitulo);
    expect(texto).toContain(etiquetas.errorDescripcion);
  });

  it("sin paso y sin bandejas no dibuja un recuadro vacio", async () => {
    const contenedor = await pintar({
      siguientePaso: undefined,
      pendientes: [],
    });

    expect(contenedor.textContent).toBe("");
  });
});
