import { vi } from "vitest";
import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import GaleriaVehiculo from "./GaleriaVehiculo";

vi.mock("@/app/actions/vehiculos", () => ({
  agregarFotografia: vi.fn(),
  eliminarFotografia: vi.fn(),
  marcarFotografiaPrincipal: vi.fn(),
  reordenarFotografias: vi.fn(),
}));

// jsdom no implementa `DataTransfer`, y el `FileInput` de Eden lo usa para
// sincronizar el valor del input con su estado interno. Se define un doble
// minimo en vez de sustituir el componente por un `<input type="file">`: la
// regla 10 dice usar Eden tal cual, y una carencia de jsdom no es razon para
// cambiar codigo de produccion. Ver desafios-implementacion.md seccion 20.
//
// `files` tiene que ser un `FileList` de verdad —jsdom valida el tipo al
// asignarlo a un input—, y la unica forma de obtener uno vacio sin
// `DataTransfer` es pedirselo a un input de archivo.
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

const context = getTestContext();

genericTests(context, GaleriaVehiculo, {
  vehiculoId: "V1",
  fotografias: [
    {
      fotoId: "F1",
      orden: 1,
      // La descripcion es el texto alternativo de la imagen: sin ella, axe
      // marca la violacion, que es exactamente lo que debe pasar.
      descripcion: "Frente del vehiculo",
      url: "https://ejemplo.invalid/F1.jpg?Signature=x",
      esPrincipal: true,
    },
    {
      fotoId: "F2",
      orden: 2,
      descripcion: "Costado del vehiculo",
      url: "https://ejemplo.invalid/F2.jpg?Signature=y",
      esPrincipal: false,
    },
  ],
  diccionario: obtenerDiccionario("es"),
  puedeEditar: true,
});
