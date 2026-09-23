// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { consultarTamanoFila } from "@/lib/fila/conteosDeFila";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import type { Lote } from "@/types/lote";
import { exito } from "@/types/resultado";
import { fotografiaDePrueba } from "@/utils/fotografiaDePrueba";
import { lotesParaCatalogo } from "./lotesParaCatalogo";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/vehiculos/obtenerVehiculo", () => ({
  obtenerVehiculo: vi.fn(),
}));
vi.mock("@/lib/fila/conteosDeFila", () => ({
  consultarTamanoFila: vi.fn(),
}));

const leerVehiculo = vi.mocked(obtenerVehiculo);
const leerTamano = vi.mocked(consultarTamanoFila);

const lote: Lote = {
  loteId: "L1",
  convocatoriaId: "CONV1",
  vehiculoId: "V1",
  precio: 185_000,
  estatus: "EN_OFERTA",
  contadorTurnos: 0,
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  creadoEn: "2026-01-10T10:00:00.000Z",
  creadoPor: "P0",
};

const galeria = () => ({
  vehiculoId: "V1",
  numeroEconomico: "VEH-001",
  numeroDeSerie: "3N6AD33A9KK870001",
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 100_000,
  estatus: "DISPONIBLE" as const,
  creadoEn: "2026-01-10T10:00:00.000Z",
  creadoPor: "P0",
  actualizadoEn: "2026-01-10T10:00:00.000Z",
  actualizadoPor: "P0",
  fotografiaPrincipalId: "F1" as string | undefined,
  fotografias: [fotografiaDePrueba("F1", 1), fotografiaDePrueba("F2", 2)],
});

describe("lotesParaCatalogo", () => {
  it("firma solo la miniatura y la de detalle de la fotografia principal", async () => {
    // **La pantalla con mas imagenes de la aplicacion.** La tarjeta nunca pasa
    // de unos 485 px CSS, asi que la variante de 2048 solo la pediria una
    // densidad mayor que 4: ofrecerla seria peso que nadie necesita. Y solo la
    // principal: las demas fotografias del vehiculo no se ven aqui.
    leerVehiculo.mockResolvedValue(exito(galeria()));
    leerTamano.mockResolvedValue(exito(0));

    const firmar = vi.fn((clave: string) => `https://cdn/${clave}`);
    const resultado = await lotesParaCatalogo([lote], { firmar });

    expect(firmar.mock.calls.map(([clave]) => clave)).toEqual([
      "vehiculos/V1/F1-min.webp",
      "vehiculos/V1/F1-med.webp",
    ]);
    expect(resultado[0]?.fotografiaPrincipal?.srcSet).toContain("1280w");
    expect(resultado[0]?.fotografiaPrincipal?.srcSet).not.toContain("2048w");
  });

  it("un vehiculo ilegible no rompe la rejilla ni firma nada", async () => {
    // Misma tolerancia que ya tenia la pagina: el lote sale con los campos en
    // blanco y con su precio y estatus, que vienen del propio lote.
    leerVehiculo.mockResolvedValue({ ok: false, error: "not_found" });
    leerTamano.mockResolvedValue(exito(0));

    const firmar = vi.fn((clave: string) => `https://cdn/${clave}`);
    const resultado = await lotesParaCatalogo([lote], { firmar });

    expect(firmar).not.toHaveBeenCalled();
    expect(resultado[0]?.fotografiaPrincipal).toBeUndefined();
    expect(resultado[0]?.precio).toBe(185_000);
  });

  it("un lote retirado no se publica ni se lee su vehiculo", async () => {
    // La convocatoria se oculto, se reactivo a borrador para corregirla y se
    // volvio a publicar: el lote que se retiro en esa correccion no reaparece.
    // Y no solo desaparece de la rejilla — no se pide su vehiculo ni su fila,
    // que serian dos lecturas por algo que nadie va a ver.
    leerVehiculo.mockResolvedValue(exito(galeria()));
    leerTamano.mockResolvedValue(exito(0));
    // Los mocks no se limpian entre pruebas en este archivo, y aqui se cuentan
    // llamadas y no solo resultados.
    leerVehiculo.mockClear();
    leerTamano.mockClear();

    const firmar = vi.fn((clave: string) => `https://cdn/${clave}`);
    const resultado = await lotesParaCatalogo(
      [
        { ...lote, estatus: "RETIRADO" },
        { ...lote, loteId: "L2" },
      ],
      { firmar },
    );

    expect(resultado.map((uno) => uno.loteId)).toEqual(["L2"]);
    expect(leerVehiculo).toHaveBeenCalledTimes(1);
    expect(leerTamano).toHaveBeenCalledTimes(1);
  });

  it("un vehiculo sin principal designada no firma nada", async () => {
    leerVehiculo.mockResolvedValue(
      exito({ ...galeria(), fotografiaPrincipalId: undefined }),
    );
    leerTamano.mockResolvedValue(exito(0));

    const firmar = vi.fn((clave: string) => `https://cdn/${clave}`);
    const resultado = await lotesParaCatalogo([lote], { firmar });

    expect(firmar).not.toHaveBeenCalled();
    expect(resultado[0]?.fotografiaPrincipal).toBeUndefined();
  });
});
