import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import BandejaDeAprobacion, {
  type PendienteDeAprobacion,
} from "./BandejaDeAprobacion";

// `next/link` observa la interseccion para precargar y dispara un `setState`
// fuera de `act` cuando el temporizador salta despues de desmontar. Es ruido
// del router, no del componente: aqui basta un ancla.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

// `CardView` arrastra `Fade`, que mide el desbordamiento con un `setTimeout` de
// 50 ms y aterriza fuera del `act` de la prueba.
vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
}));

const context = getTestContext();
const diccionario = obtenerDiccionario("es");

const pendiente = (
  cambios: Partial<PendienteDeAprobacion> = {},
): PendienteDeAprobacion => ({
  convocatoriaId: "C1",
  tipo: "EMPLEADOS",
  resumen: "Abierta al personal de flotilla.",
  creadoPor: "P9",
  espera: "hace 3 días",
  periodo: "5 oct 2026, 09:00 — 12 oct 2026, 09:00",
  ...cambios,
});

genericTests(context, BandejaDeAprobacion, {
  pendientes: [pendiente()],
  diccionario,
});

const pintar = async (pendientes: readonly PendienteDeAprobacion[]) => {
  await act(async () => {
    context.root.render(
      <BandejaDeAprobacion pendientes={pendientes} diccionario={diccionario} />,
    );
  });
};

describe("la bandeja", () => {
  it("dice que no hay nada en vez de pintar una tabla vacia", async () => {
    await pintar([]);

    expect(context.container.textContent).toContain(
      diccionario.aprobaciones.sinPendientes,
    );
    expect(context.container.querySelector("table")).toBeNull();
  });

  it("muestra quien la creo, que es lo que R-05 le impide aprobar", async () => {
    await pintar([pendiente({ creadoPor: "quien.la.creo" })]);

    expect(context.container.textContent).toContain("quien.la.creo");
  });

  it("respeta el orden en que llegan, que lo decide el servidor", async () => {
    // La antiguedad se calcula con la hora del servidor: reordenar aqui
    // mostraria una prioridad distinta a cada persona segun su reloj.
    await pintar([
      pendiente({ convocatoriaId: "C1", espera: "hace 9 días" }),
      pendiente({ convocatoriaId: "C2", espera: "hace 1 hora" }),
    ]);

    const filas = [...context.container.querySelectorAll("tbody tr")];
    expect(filas[0]?.textContent).toContain("hace 9 días");
    expect(filas[1]?.textContent).toContain("hace 1 hora");
  });

  it("cada fila lleva al detalle, que es donde se dictamina", async () => {
    await pintar([pendiente({ convocatoriaId: "C7" })]);

    const enlace = context.container.querySelector("a");
    expect(enlace?.getAttribute("href")).toBe("/admin/convocatorias/C7");
  });

  it("traduce el tipo y nunca muestra el ENUM (regla 11)", async () => {
    await pintar([pendiente()]);

    expect(context.container.textContent).toContain(
      diccionario.tiposConvocatoria.EMPLEADOS,
    );
    expect(context.container.textContent).not.toContain("EMPLEADOS");
  });
});
