// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as acciones from "./vehiculos";
import { getSession } from "@/lib/auth/session";
import { agregarFotografia as agregarFotografiaServicio } from "@/lib/vehiculos/agregarFotografia";
import { crearVehiculo as crearVehiculoServicio } from "@/lib/vehiculos/crearVehiculo";
import { editarVehiculo as editarVehiculoServicio } from "@/lib/vehiculos/editarVehiculo";
import { eliminarFotografia as eliminarFotografiaServicio } from "@/lib/vehiculos/eliminarFotografia";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import { reordenarFotografias as reordenarFotografiasServicio } from "@/lib/vehiculos/reordenarFotografias";
import { retirarVehiculo as retirarVehiculoServicio } from "@/lib/vehiculos/retirarVehiculo";
import { updateTag } from "next/cache";
import type { Sesion } from "@/types/identidad";
import type { VehiculoConFotografias } from "@/types/vehiculo";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/vehiculos/obtenerVehiculo", () => ({
  obtenerVehiculo: vi.fn(),
}));
vi.mock("@/lib/vehiculos/crearVehiculo", () => ({ crearVehiculo: vi.fn() }));
vi.mock("@/lib/vehiculos/editarVehiculo", () => ({ editarVehiculo: vi.fn() }));
vi.mock("@/lib/vehiculos/retirarVehiculo", () => ({
  retirarVehiculo: vi.fn(),
}));
vi.mock("@/lib/vehiculos/agregarFotografia", () => ({
  agregarFotografia: vi.fn(),
}));
vi.mock("@/lib/vehiculos/eliminarFotografia", () => ({
  eliminarFotografia: vi.fn(),
}));
vi.mock("@/lib/vehiculos/reordenarFotografias", () => ({
  reordenarFotografias: vi.fn(),
}));

const sesionSimulada = vi.mocked(getSession);
const lectura = vi.mocked(obtenerVehiculo);

const servicios = {
  crear: vi.mocked(crearVehiculoServicio),
  editar: vi.mocked(editarVehiculoServicio),
  retirar: vi.mocked(retirarVehiculoServicio),
  agregar: vi.mocked(agregarFotografiaServicio),
  eliminar: vi.mocked(eliminarFotografiaServicio),
  reordenar: vi.mocked(reordenarFotografiasServicio),
};

const sesion = (permisos: string[]): Sesion => ({
  participanteId: "P1",
  oktaSub: "okta|1",
  correo: "quien@example.org",
  nombre: "Quien Sea",
  permisos: new Set(permisos) as Sesion["permisos"],
  tiposDeConvocatoriaPermitidos: [],
});

const vehiculo: VehiculoConFotografias = {
  vehiculoId: "V1",
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 100_000,
  estatus: "DISPONIBLE",
  creadoEn: "2026-01-10T10:00:00.000Z",
  creadoPor: "P0",
  actualizadoEn: "2026-01-10T10:00:00.000Z",
  actualizadoPor: "P0",
  fotografiaPrincipalId: "F1",
  fotografias: [
    {
      fotoId: "F1",
      vehiculoId: "V1",
      orden: 1,
      claveS3: "vehiculos/V1/F1.jpg",
      contentType: "image/jpeg",
      bytes: 100,
      subidaEn: "2026-01-10T10:00:00.000Z",
      subidaPor: "P0",
    },
  ],
};

const datos = {
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 100_000,
};

const archivo = new File([new Uint8Array([1, 2])], "cualquiera.png", {
  type: "image/png",
});

/** Las seis acciones del contrato, invocadas con datos validos. */
const invocar = {
  crearVehiculo: () => acciones.crearVehiculo(datos),
  editarVehiculo: () => acciones.editarVehiculo("V1", { kilometraje: 1 }),
  retirarVehiculo: () => acciones.retirarVehiculo("V1", "siniestro"),
  agregarFotografia: () =>
    acciones.agregarFotografia({ vehiculoId: "V1", archivo }),
  eliminarFotografia: () => acciones.eliminarFotografia("V1", "F1"),
  reordenarFotografias: () => acciones.reordenarFotografias("V1", ["F1"]),
} as const;

const NOMBRES = Object.keys(invocar) as (keyof typeof invocar)[];

beforeEach(() => {
  vi.clearAllMocks();
  lectura.mockResolvedValue({ ok: true, data: vehiculo });
  for (const servicio of Object.values(servicios)) {
    servicio.mockResolvedValue({
      ok: true,
      data: { vehiculoId: "V1" },
    } as never);
  }
});

describe("sin sesion", () => {
  it.each(NOMBRES)("%s devuelve unauthorized", async (nombre) => {
    sesionSimulada.mockResolvedValue(null);
    await expect(invocar[nombre]()).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
  });

  it.each(NOMBRES)("%s no llega a leer ni a delegar", async (nombre) => {
    sesionSimulada.mockResolvedValue(null);
    await invocar[nombre]();

    expect(lectura).not.toHaveBeenCalled();
    for (const servicio of Object.values(servicios)) {
      expect(servicio).not.toHaveBeenCalled();
    }
  });
});

describe("sin el permiso de administrar vehiculos", () => {
  // La matriz concede estas seis acciones unicamente a
  // `Autob_Administrar_Vehiculos`. Un conjunto de permisos amplio pero
  // equivocado tiene que ser tan insuficiente como uno vacio.
  it.each(NOMBRES)("%s devuelve forbidden", async (nombre) => {
    sesionSimulada.mockResolvedValue(
      sesion([
        "Autob_Administrar_Convocatorias",
        "Autob_Aprobar_Convocatorias",
        "Autob_Operar_Tesoreria",
        "Autob_Auditar",
      ]),
    );

    await expect(invocar[nombre]()).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it.each(NOMBRES)("%s no delega en el servicio", async (nombre) => {
    // Ocultar el boton es cortesia; esto es la comprobacion de verdad.
    sesionSimulada.mockResolvedValue(sesion(["Autob_Auditar"]));
    await invocar[nombre]();

    for (const servicio of Object.values(servicios)) {
      expect(servicio).not.toHaveBeenCalled();
    }
  });

  it.each(NOMBRES)("%s no invalida cache", async (nombre) => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Auditar"]));
    await invocar[nombre]();
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("con el permiso", () => {
  beforeEach(() => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Administrar_Vehiculos"]));
  });

  it.each(NOMBRES)("%s delega e invalida cache", async (nombre) => {
    await expect(invocar[nombre]()).resolves.toMatchObject({ ok: true });
    expect(updateTag).toHaveBeenCalledWith("vehiculo:V1");
    expect(updateTag).toHaveBeenCalledWith("vehiculos");
  });

  it("el actor sale de la sesion, no del input", async () => {
    await acciones.crearVehiculo(datos);

    expect(servicios.crear).toHaveBeenCalledWith({
      datos,
      actor: {
        tipo: "USUARIO",
        id: "P1",
        permisos: ["Autob_Administrar_Vehiculos"],
      },
    });
  });

  it("pasa a los servicios el mismo vehiculo que evaluo el permiso", async () => {
    // Releerlo dentro del servicio abriria una ventana entre la decision de
    // permiso y la escritura.
    await acciones.editarVehiculo("V1", { kilometraje: 1 });

    expect(lectura).toHaveBeenCalledTimes(1);
    expect(servicios.editar).toHaveBeenCalledWith(
      expect.objectContaining({ actual: vehiculo }),
    );
  });

  it("convierte el archivo a bytes y conserva el tipo declarado", async () => {
    await acciones.agregarFotografia({ vehiculoId: "V1", archivo });

    expect(servicios.agregar).toHaveBeenCalledWith(
      expect.objectContaining({
        archivo: { bytes: new Uint8Array([1, 2]), contentType: "image/png" },
      }),
    );
  });

  it("no invalida cache cuando el servicio falla", async () => {
    servicios.editar.mockResolvedValue({
      ok: false,
      error: "validation_failed",
    });

    await expect(
      acciones.editarVehiculo("V1", { kilometraje: -1 }),
    ).resolves.toEqual({ ok: false, error: "validation_failed" });
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("vehiculo inexistente", () => {
  it("devuelve not_found sin delegar", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Administrar_Vehiculos"]));
    lectura.mockResolvedValue({ ok: false, error: "not_found" });

    await expect(
      acciones.editarVehiculo("V9", { kilometraje: 1 }),
    ).resolves.toEqual({ ok: false, error: "not_found" });
    expect(servicios.editar).not.toHaveBeenCalled();
  });
});

describe("guardas de estado", () => {
  beforeEach(() => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Administrar_Vehiculos"]));
  });

  it("no deja editar un vehiculo vendido", async () => {
    lectura.mockResolvedValue({
      ok: true,
      data: { ...vehiculo, estatus: "VENDIDO" },
    });
    await expect(
      acciones.editarVehiculo("V1", { kilometraje: 1 }),
    ).resolves.toEqual({ ok: false, error: "invalid_state" });
  });

  it("no deja retirar un vehiculo que esta en una convocatoria", async () => {
    lectura.mockResolvedValue({
      ok: true,
      data: { ...vehiculo, estatus: "EN_CONVOCATORIA" },
    });
    await expect(acciones.retirarVehiculo("V1", "x")).resolves.toEqual({
      ok: false,
      error: "invalid_state",
    });
  });

  it("no deja subir fotografias a un vehiculo vendido", async () => {
    lectura.mockResolvedValue({
      ok: true,
      data: { ...vehiculo, estatus: "VENDIDO" },
    });
    await expect(
      acciones.agregarFotografia({ vehiculoId: "V1", archivo }),
    ).resolves.toEqual({ ok: false, error: "invalid_state" });
  });
});
