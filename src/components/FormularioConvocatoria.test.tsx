import { vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import FormularioConvocatoria from "./FormularioConvocatoria";

// La action se simula porque su modulo arrastra todo el grafo del servidor
// —`server-only`, el cliente de DynamoDB— que en el navegador no existe.
vi.mock("@/app/actions/convocatorias", () => ({
  guardarConvocatoriaDesdeFormulario: vi.fn(),
}));

// La barra del editor usa `Fade`, y `Fade` mide el desbordamiento con un
// `setTimeout` de 50 ms que aterriza fuera del `act` de la prueba. Es la misma
// utilidad hoja que ya se simula en `TablaConvocatorias`: lo que aqui se
// comprueba es el marcado del formulario y su accesibilidad, no la deteccion de
// desbordamiento de Eden.
vi.mock("@churchofjesuschrist/eden-has-overflow", () => ({
  useHasOverflow: () => [{ current: null }, { hasX: false }],
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
