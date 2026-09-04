import { obtenerDiccionario } from "@/dictionaries";
import { genericTests, getTestContext } from "@/utils/testHelpers";
import EstadoServicio from "./EstadoServicio";

const context = getTestContext();

genericTests(context, EstadoServicio, {
  estado: {
    estado: "ok",
    version: "0.1.0",
    tiempo: "2026-09-04T12:00:00.000Z",
  },
  diccionario: obtenerDiccionario("es"),
});
