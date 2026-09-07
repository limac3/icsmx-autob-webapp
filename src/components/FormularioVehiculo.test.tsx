import { vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import FormularioVehiculo from "./FormularioVehiculo";

// Las Server Actions se simulan porque su modulo arrastra todo el grafo del
// servidor —`server-only`, el cliente de DynamoDB, el de S3— que en el
// navegador no existe. En produccion el bundler de Next las sustituye por una
// referencia; aqui no hay tal transformacion. Lo que esta prueba comprueba es
// el componente, no la action: esa tiene la suya en `src/app/actions`.
// El estado inicial no se simula: vive en `@/types/formularioVehiculo`, que es
// un modulo sin I/O. Solo se simula lo que arrastra el grafo del servidor.
vi.mock("@/app/actions/vehiculos", () => ({
  guardarVehiculoDesdeFormulario: vi.fn(),
  retirarVehiculoDesdeFormulario: vi.fn(),
}));

const context = getTestContext();

genericTests(context, FormularioVehiculo, {
  diccionario: obtenerDiccionario("es"),
  modeloMaximo: 2027,
  vehiculoId: "V1",
  valores: {
    marca: "Nissan",
    version: "NP300",
    modelo: 2019,
    kilometraje: 148_320,
  },
});
