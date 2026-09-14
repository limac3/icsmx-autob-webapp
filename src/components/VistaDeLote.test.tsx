import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import type { Lote } from "@/types/lote";
import type { Vehiculo } from "@/types/vehiculo";
import VistaDeLote, { type VistaDeLoteProps } from "./VistaDeLote";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// El bloque de accion es un componente cliente que importa las Server Actions;
// en jsdom no hay servidor al que llamar y estas pruebas no las ejercen.
vi.mock("@/app/actions/fila", () => ({
  solicitarCompra: vi.fn(),
  cancelarSolicitud: vi.fn(),
}));

vi.mock("@/app/actions/tesoreria", () => ({ subirComprobante: vi.fn() }));

// Mismo ruido que en `GaleriaPublica.test.tsx` y `BloqueDeAccionDeLote.test.tsx`:
// `useHasOverflow` arranca un `setTimeout` de 50 ms que aterriza fuera del
// `act` de la prueba.
vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
}));

// jsdom no implementa `DataTransfer`, y el `FileInput` del bloque de accion lo
// usa. Doble minimo, no un cambio al componente (regla 10) — ver
// `desafios-implementacion.md` seccion 20.
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

const diccionario = obtenerDiccionario("es");

const LOTE: Lote = {
  loteId: "L1",
  convocatoriaId: "CONV1",
  vehiculoId: "V1",
  precio: 185_000,
  estatus: "EN_OFERTA",
  contadorTurnos: 0,
  inicioVenta: "2026-09-05T15:00:00.000Z",
  finVenta: "2026-09-12T23:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  creadoEn: "2026-08-20T15:00:00.000Z",
  creadoPor: "okta|1",
};

const VEHICULO: Vehiculo = {
  vehiculoId: "V1",
  numeroEconomico: "ECO-1234",
  numeroDeSerie: "3N6AD33A9KK800001",
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 100_000,
  estatus: "EN_CONVOCATORIA",
  creadoEn: "2026-08-01T15:00:00.000Z",
  creadoPor: "okta|1",
  actualizadoEn: "2026-08-01T15:00:00.000Z",
  actualizadoPor: "okta|1",
};

const props: VistaDeLoteProps = {
  rutaDeLaConvocatoria: "/convocatorias/CONV1",
  convocatoriaId: "CONV1",
  lote: LOTE,
  vehiculo: VEHICULO,
  fotografias: [],
  tamanoFila: 3,
  estadoDeVenta: { fase: "VENTA_ABIERTA", cierraFormateado: "12 sep 2026" },
  miLugar: null,
  diccionario,
  idioma: "es",
};

const context = getTestContext();

genericTests(context, VistaDeLote, props);

describe("VistaDeLote", () => {
  // **Es el mismo componente que ve el participante y el que revisa quien
  // administra** (`/admin/convocatorias/[id]/vista-publica/lotes/[loteId]`).
  // Que sea uno solo es lo que hace que la vista previa sea una vista previa.

  const pintar = async (extra: Partial<VistaDeLoteProps> = {}) => {
    await act(async () => {
      context.root.render(<VistaDeLote {...props} {...extra} />);
    });
    return context.container.textContent ?? "";
  };

  const boton = (texto: string) =>
    [...context.container.querySelectorAll("button")].find((elemento) =>
      elemento.textContent?.includes(texto),
    );

  it("encabeza con el vehiculo y sus dos numeros de identificacion", async () => {
    // Dos unidades de la misma marca, version y anio se llaman igual: solo
    // estos numeros las distinguen.
    const texto = await pintar();

    expect(context.container.querySelector("h1")?.textContent).toBe(
      "Nissan NP300 2019",
    );
    expect(texto).toContain("ECO-1234");
    expect(texto).toContain("3N6AD33A9KK800001");
  });

  it("muestra el precio del lote y la cantidad en fila, nunca identidades", async () => {
    const texto = await pintar();

    expect(texto).toContain("185,000");
    expect(texto).toContain("3 en fila");
    expect(texto).not.toMatch(/@|participante/i);
  });

  it("vuelve a la pantalla desde la que se llego, no a una fija", async () => {
    // La vista previa tiene que volver a la vista previa: la convocatoria
    // publica le responde 404 a quien administra.
    await pintar({
      rutaDeLaConvocatoria: "/admin/convocatorias/CONV1/vista-publica",
    });

    expect(context.container.querySelector("a")?.getAttribute("href")).toBe(
      "/admin/convocatorias/CONV1/vista-publica",
    );
  });

  it("con la venta abierta ofrece solicitar", async () => {
    await pintar();

    expect(boton(diccionario.fila.solicitar)?.disabled).toBe(false);
  });

  it("en vista previa se ve el bloque de participacion y no se puede pulsar", async () => {
    // Ocultarlo dejaria fuera la mitad de la pantalla que se quiere revisar;
    // dejarlo vivo invitaria a formarse en una fila desde una pantalla de
    // revision.
    const texto = await pintar({ soloLectura: true });

    expect(texto).toContain(diccionario.fila.titulo);
    expect(texto).toContain(diccionario.fila.vistaPreviaSinAccion);
    expect(boton(diccionario.fila.solicitar)?.disabled).toBe(true);
  });

  it("deriva la fase del bloque de accion del estado de venta", async () => {
    // La traduccion vive en el componente y no en cada pagina: duplicada, era
    // una forma barata de que la vista previa mostrara otra cosa que la
    // pantalla real.
    const texto = await pintar({
      estadoDeVenta: { fase: "PUBLICADA_SIN_ABRIR", segundosParaAbrir: 3600 },
    });

    expect(texto).toContain(diccionario.fila.abreEn);
    expect(boton(diccionario.fila.solicitar)?.disabled).toBe(true);
  });
});
