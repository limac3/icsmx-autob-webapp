import { vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import FormularioConvocatoria from "./FormularioConvocatoria";

// La action se simula porque su modulo arrastra todo el grafo del servidor
// —`server-only`, el cliente de DynamoDB— que en el navegador no existe.
vi.mock("@/app/actions/convocatorias", () => ({
  guardarConvocatoriaDesdeFormulario: vi.fn(),
}));

const context = getTestContext();

genericTests(context, FormularioConvocatoria, {
  diccionario: obtenerDiccionario("es"),
  convocatoriaId: "C1",
  valores: {
    tipo: "EMPLEADOS",
    descripcionParticipacion: "Abierta al personal de flotilla.",
    publicadaEn: { fecha: "2026-10-01", hora: "09:00" },
    inicioVenta: { fecha: "2026-10-05", hora: "09:00" },
    finVenta: { fecha: "2026-10-12", hora: "09:00" },
    horasLiquidacion: 48,
  },
});
