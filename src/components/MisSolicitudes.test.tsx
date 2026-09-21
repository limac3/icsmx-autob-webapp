import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import MisSolicitudes, { type SolicitudEnLista } from "./MisSolicitudes";

// Mismo ruido de router y de deteccion de desbordamiento que
// `CatalogoConvocatorias.test.tsx`.
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const fila = (
  loteId: string,
  grupo: SolicitudEnLista["grupo"],
  extras: Partial<SolicitudEnLista> = {},
): SolicitudEnLista => ({
  solicitudId: `${loteId}-1`,
  loteId,
  convocatoriaId: "C1",
  convocatoriaFolio: "CONV-001",
  convocatoriaNombre: "Venta de septiembre",
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  precio: 180_000,
  estatus: "EN_FILA",
  miTurno: 3,
  solicitadoEn: "2026-09-10T10:00:00.000Z",
  grupo,
  ...extras,
});

const diccionario = obtenerDiccionario("es");

// `getTestContext` registra los `beforeEach` que montan el contenedor, asi que
// se llama una sola vez por modulo y no dentro de cada prueba.
const context = getTestContext();

const render = async (
  solicitudes: readonly SolicitudEnLista[],
  truncada = false,
) => {
  await act(async () => {
    context.root.render(
      <MisSolicitudes
        solicitudes={solicitudes}
        truncada={truncada}
        diccionario={diccionario}
        idioma="es"
      />,
    );
  });
  return context;
};

// Las tres formas de fila a la vez, incluida la que monta la cuenta regresiva:
// es la que mas marcado tiene y la que conviene que axe recorra. Puede llevar
// un temporizador vivo porque `genericTests` envuelve el recorrido de axe en
// `act` (ver `testHelpers.tsx`).
genericTests(context, MisSolicitudes, {
  solicitudes: [
    fila("L1", "REQUIERE_ATENCION", {
      estatus: "ADJUDICADA",
      venceEn: "2026-09-25T10:00:00.000Z",
      segundosParaVencer: 3_600 * 26,
    }),
    fila("L2", "ACTIVA"),
    fila("L3", "HISTORICA", { estatus: "NO_ADJUDICADA" }),
  ],
  truncada: false,
  diccionario,
  idioma: "es",
});

describe("MisSolicitudes", () => {
  // La fila de una adjudicacion viva monta el `setInterval` de
  // `CuentaRegresiva`. Con temporizadores falsos el tic no llega nunca por su
  // cuenta, asi que nada actualiza estado fuera de `act`. Mismo patron que
  // `CuentaRegresiva.test`.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("el vacio ofrece la accion que lo resuelve", async () => {
    const { container } = await render([]);

    expect(container.textContent).toContain(
      "Todavía no te has formado en ninguna fila.",
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/convocatorias",
    );
  });

  it("los grupos salen en orden y solo los que tienen filas", async () => {
    const { container } = await render([
      fila("L1", "REQUIERE_ATENCION", {
        estatus: "ADJUDICADA",
        segundosParaVencer: 3_600,
      }),
      fila("L3", "HISTORICA", { estatus: "VENDIDA" }),
    ]);

    const titulos = [...container.querySelectorAll("h2")].map(
      (h) => h.textContent,
    );
    expect(titulos).toEqual(["Requieren tu atención", "Historial"]);
  });

  it("la cuenta regresiva solo aparece con el plazo corriendo", async () => {
    const { container } = await render([
      fila("L1", "REQUIERE_ATENCION", {
        estatus: "ADJUDICADA",
        venceEn: "2026-09-25T10:00:00.000Z",
        segundosParaVencer: 3_600 * 26,
      }),
    ]);

    expect(container.textContent).toContain("Tiempo restante");
    expect(container.textContent).toContain("1 d 2 h");
  });

  it("un plazo vencido explica que pasa, y no pinta un contador en cero", async () => {
    const { container } = await render([
      fila("L1", "ACTIVA", {
        estatus: "ADJUDICADA",
        venceEn: "2026-09-12T10:00:00.000Z",
        plazoVencido: true,
      }),
    ]);

    expect(container.textContent).toContain("El plazo venció");
    expect(container.textContent).not.toContain("Tiempo restante");
  });

  it("nunca muestra el ENUM crudo (regla 11)", async () => {
    const { container } = await render([
      fila("L1", "HISTORICA", { estatus: "CANCELADA_POR_VENCIMIENTO" }),
    ]);

    expect(container.textContent).toContain(
      diccionario.estatusSolicitud.CANCELADA_POR_VENCIMIENTO,
    );
    expect(container.textContent).not.toContain("CANCELADA_POR_VENCIMIENTO");
  });

  it("enlaza al lote y nunca expone identidad de terceros", async () => {
    const { container } = await render([fila("L1", "ACTIVA")]);

    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/convocatorias/C1/lotes/L1",
    );
    expect(container.textContent).not.toMatch(/@|participante|correo/i);
  });

  it("avisa del truncado en vez de mostrar una lista incompleta que parece completa", async () => {
    const { container } = await render([fila("L1", "ACTIVA")], true);

    expect(container.textContent).toContain("Hay más historial");
  });
});
