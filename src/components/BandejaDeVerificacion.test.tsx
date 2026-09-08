import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import BandejaDeVerificacion, {
  type PendienteDeVerificacion,
} from "./BandejaDeVerificacion";

// `next/link` observa la interseccion para precargar y dispara un `setState`
// fuera de `act` cuando el temporizador salta despues de desmontar. Es ruido
// del router, no del componente (BandejaDeAprobacion.test.tsx).
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

const pendiente = (
  cambios: Partial<PendienteDeVerificacion> = {},
): PendienteDeVerificacion => ({
  solicitudId: "L1-2",
  vehiculo: "Nissan NP300 2019",
  convocatoria: "De empleados",
  correoTitular: "titular@example.org",
  adjudicadoEn: "6 oct 2026, 09:00",
  comprobanteSubidoEn: "6 oct 2026, 10:00",
  ...cambios,
});

genericTests(context, BandejaDeVerificacion, {
  pendientes: [pendiente()],
  diccionario,
});

const pintar = async (pendientes: readonly PendienteDeVerificacion[]) => {
  await act(async () => {
    context.root.render(
      <BandejaDeVerificacion
        pendientes={pendientes}
        diccionario={diccionario}
      />,
    );
  });
};

describe("la bandeja de tesoreria", () => {
  it("dice que no hay nada en vez de pintar una tabla vacia", async () => {
    await pintar([]);

    expect(context.container.textContent).toContain(
      diccionario.tesoreria.sinPendientes,
    );
    expect(context.container.querySelector("table")).toBeNull();
  });

  it("muestra el correo del titular — excepcion deliberada a R-12", async () => {
    await pintar([pendiente({ correoTitular: "quien.pago@example.org" })]);

    expect(context.container.textContent).toContain("quien.pago@example.org");
  });

  it("cada fila lleva al detalle, que es donde se dictamina", async () => {
    await pintar([pendiente({ solicitudId: "L7-3" })]);

    const enlace = context.container.querySelector("a");
    expect(enlace?.getAttribute("href")).toBe("/tesoreria/verificacion/L7-3");
  });

  it("respeta el orden en que llegan — mas antiguas primero, lo decide el servidor", async () => {
    await pintar([
      pendiente({ solicitudId: "L1-2", comprobanteSubidoEn: "hace 9 días" }),
      pendiente({ solicitudId: "L1-3", comprobanteSubidoEn: "hace 1 hora" }),
    ]);

    const filas = [...context.container.querySelectorAll("tbody tr")];
    expect(filas[0]?.textContent).toContain("hace 9 días");
    expect(filas[1]?.textContent).toContain("hace 1 hora");
  });
});
