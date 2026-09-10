import { vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import type { Vehiculo } from "@/types/vehiculo";
import TablaVehiculos from "./TablaVehiculos";

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

const context = getTestContext();

const vehiculo = (
  vehiculoId: string,
  estatus: Vehiculo["estatus"],
): Vehiculo => ({
  numeroEconomico: "VEH-001",
  numeroDeSerie: "3N6AD33A9KK870001",
  vehiculoId,
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 148_320,
  estatus,
  creadoEn: "2026-01-10T10:00:00.000Z",
  creadoPor: "P0",
  actualizadoEn: "2026-01-10T10:00:00.000Z",
  actualizadoPor: "P0",
});

genericTests(context, TablaVehiculos, {
  vehiculos: [
    vehiculo("V1", "DISPONIBLE"),
    vehiculo("V2", "EN_CONVOCATORIA"),
    vehiculo("V3", "VENDIDO"),
  ],
  diccionario: obtenerDiccionario("es"),
  idioma: "es" as const,
  puedeEditar: true,
});
