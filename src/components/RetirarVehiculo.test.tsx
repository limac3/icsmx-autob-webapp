import { vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import RetirarVehiculo from "./RetirarVehiculo";

vi.mock("@/app/actions/vehiculos", () => ({
  ESTADO_FORMULARIO_INICIAL: { estado: "inicial" },
  guardarVehiculoDesdeFormulario: vi.fn(),
  retirarVehiculoDesdeFormulario: vi.fn(),
}));

const context = getTestContext();

genericTests(context, RetirarVehiculo, {
  vehiculoId: "V1",
  diccionario: obtenerDiccionario("es"),
});
