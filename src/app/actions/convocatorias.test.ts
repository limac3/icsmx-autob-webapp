// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSession } from "@/lib/auth/session";
import { aprobarConvocatoria as aprobarServicio } from "@/lib/convocatorias/aprobarConvocatoria";
import { concluirConvocatoria as concluirServicio } from "@/lib/convocatorias/concluirConvocatoria";
import { crearConvocatoria as crearServicio } from "@/lib/convocatorias/crearConvocatoria";
import { editarConvocatoria as editarServicio } from "@/lib/convocatorias/editarConvocatoria";
import { enviarAAprobacion as enviarServicio } from "@/lib/convocatorias/enviarAAprobacion";
import { incluirVehiculo as incluirServicio } from "@/lib/convocatorias/incluirVehiculo";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { ocultarConvocatoria as ocultarServicio } from "@/lib/convocatorias/ocultarConvocatoria";
import { publicarConvocatoria as publicarServicio } from "@/lib/convocatorias/publicarConvocatoria";
import { reactivarConvocatoria as reactivarServicio } from "@/lib/convocatorias/reactivarConvocatoria";
import { rechazarConvocatoria as rechazarServicio } from "@/lib/convocatorias/rechazarConvocatoria";
import { retirarVehiculoDeConvocatoria as retirarServicio } from "@/lib/convocatorias/retirarVehiculoDeConvocatoria";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import type { ConvocatoriaConLotes } from "@/types/convocatoria";
import type { Sesion } from "@/types/identidad";
import type { Lote } from "@/types/lote";
import type { VehiculoConFotografias } from "@/types/vehiculo";
import * as acciones from "./convocatorias";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/convocatorias/obtenerConvocatoria", () => ({
  obtenerConvocatoria: vi.fn(),
}));
vi.mock("@/lib/vehiculos/obtenerVehiculo", () => ({
  obtenerVehiculo: vi.fn(),
}));
vi.mock("@/lib/convocatorias/crearConvocatoria", () => ({
  crearConvocatoria: vi.fn(),
}));
vi.mock("@/lib/convocatorias/editarConvocatoria", () => ({
  editarConvocatoria: vi.fn(),
}));
vi.mock("@/lib/convocatorias/incluirVehiculo", () => ({
  incluirVehiculo: vi.fn(),
}));
vi.mock("@/lib/convocatorias/retirarVehiculoDeConvocatoria", () => ({
  retirarVehiculoDeConvocatoria: vi.fn(),
}));
vi.mock("@/lib/convocatorias/enviarAAprobacion", () => ({
  enviarAAprobacion: vi.fn(),
}));
vi.mock("@/lib/convocatorias/aprobarConvocatoria", () => ({
  aprobarConvocatoria: vi.fn(),
}));
vi.mock("@/lib/convocatorias/rechazarConvocatoria", () => ({
  rechazarConvocatoria: vi.fn(),
}));
vi.mock("@/lib/convocatorias/publicarConvocatoria", () => ({
  publicarConvocatoria: vi.fn(),
}));
vi.mock("@/lib/convocatorias/ocultarConvocatoria", () => ({
  ocultarConvocatoria: vi.fn(),
}));
vi.mock("@/lib/convocatorias/reactivarConvocatoria", () => ({
  reactivarConvocatoria: vi.fn(),
}));
vi.mock("@/lib/convocatorias/concluirConvocatoria", () => ({
  concluirConvocatoria: vi.fn(),
}));

const sesionSimulada = vi.mocked(getSession);
const lectura = vi.mocked(obtenerConvocatoria);
const lecturaDeVehiculo = vi.mocked(obtenerVehiculo);

const servicios = {
  crear: vi.mocked(crearServicio),
  editar: vi.mocked(editarServicio),
  incluir: vi.mocked(incluirServicio),
  retirar: vi.mocked(retirarServicio),
  enviar: vi.mocked(enviarServicio),
  aprobar: vi.mocked(aprobarServicio),
  rechazar: vi.mocked(rechazarServicio),
  publicar: vi.mocked(publicarServicio),
  ocultar: vi.mocked(ocultarServicio),
  reactivar: vi.mocked(reactivarServicio),
  concluir: vi.mocked(concluirServicio),
};

const sesion = (permisos: string[], participanteId = "P1"): Sesion => ({
  participanteId,
  oktaSub: "okta|1",
  correo: "quien@example.org",
  nombre: "Quien Sea",
  permisos: new Set(permisos) as Sesion["permisos"],
  tiposDeConvocatoriaPermitidos: [],
});

const lote: Lote = {
  loteId: "L1",
  convocatoriaId: "C1",
  vehiculoId: "V1",
  precio: 180_000,
  estatus: "EN_OFERTA",
  contadorTurnos: 0,
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "BORRADOR",
  horasLiquidacion: 48,
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
};

const convocatoria: ConvocatoriaConLotes = {
  convocatoriaId: "C1",
  tipo: "EMPLEADOS",
  descripcionParticipacion: "Abierta al personal.",
  publicadaEn: "2026-10-01T15:00:00.000Z",
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  horasLiquidacion: 48,
  estatus: "BORRADOR",
  creadoEn: "2026-09-01T10:00:00.000Z",
  // Distinto de "P1" para que R-05 no interfiera en el barrido.
  creadoPor: "P9",
  lotes: [lote],
};

const vehiculo: VehiculoConFotografias = {
  vehiculoId: "V1",
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 100_000,
  estatus: "DISPONIBLE",
  creadoEn: "2026-08-01T10:00:00.000Z",
  creadoPor: "P9",
  actualizadoEn: "2026-08-01T10:00:00.000Z",
  actualizadoPor: "P9",
  fotografias: [],
};

/**
 * Cada action con el estatus desde el que su transicion es legitima y el
 * permiso que exige. Es lo que permite recorrerlas todas sin escribir once
 * pruebas casi iguales.
 */
const INVOCAR = {
  crearConvocatoria: {
    permiso: "Autob_Administrar_Convocatorias",
    estatus: "BORRADOR" as const,
    llamar: () =>
      acciones.crearConvocatoria({
        tipo: "EMPLEADOS",
        descripcionParticipacion: "Texto",
        publicadaEn: "2026-10-01T15:00:00.000Z",
        inicioVenta: "2026-10-05T15:00:00.000Z",
        finVenta: "2026-10-12T15:00:00.000Z",
        horasLiquidacion: 48,
      }),
  },
  editarConvocatoria: {
    permiso: "Autob_Administrar_Convocatorias",
    estatus: "BORRADOR" as const,
    llamar: () => acciones.editarConvocatoria("C1", { horasLiquidacion: 24 }),
  },
  incluirVehiculo: {
    permiso: "Autob_Administrar_Convocatorias",
    estatus: "BORRADOR" as const,
    llamar: () =>
      acciones.incluirVehiculo({
        convocatoriaId: "C1",
        vehiculoId: "V1",
        precio: 180_000,
      }),
  },
  retirarVehiculoDeConvocatoria: {
    permiso: "Autob_Administrar_Convocatorias",
    estatus: "BORRADOR" as const,
    llamar: () =>
      acciones.retirarVehiculoDeConvocatoria({
        convocatoriaId: "C1",
        loteId: "L1",
        motivo: "Se daño",
      }),
  },
  enviarAAprobacion: {
    permiso: "Autob_Administrar_Convocatorias",
    estatus: "BORRADOR" as const,
    llamar: () => acciones.enviarAAprobacion("C1"),
  },
  aprobarConvocatoria: {
    permiso: "Autob_Aprobar_Convocatorias",
    estatus: "EN_APROBACION" as const,
    llamar: () => acciones.aprobarConvocatoria("C1"),
  },
  rechazarConvocatoria: {
    permiso: "Autob_Aprobar_Convocatorias",
    estatus: "EN_APROBACION" as const,
    llamar: () => acciones.rechazarConvocatoria("C1", "Fechas mal"),
  },
  publicarConvocatoria: {
    permiso: "Autob_Administrar_Convocatorias",
    estatus: "APROBADA" as const,
    llamar: () => acciones.publicarConvocatoria("C1"),
  },
  ocultarConvocatoria: {
    permiso: "Autob_Administrar_Convocatorias",
    estatus: "BORRADOR" as const,
    llamar: () => acciones.ocultarConvocatoria("C1", "Se cancela"),
  },
  reactivarConvocatoria: {
    permiso: "Autob_Administrar_Convocatorias",
    estatus: "OCULTA" as const,
    llamar: () => acciones.reactivarConvocatoria("C1"),
  },
  concluirConvocatoria: {
    permiso: "Autob_Administrar_Convocatorias",
    estatus: "PUBLICADA" as const,
    llamar: () => acciones.concluirConvocatoria("C1"),
  },
};

const NOMBRES = Object.keys(INVOCAR) as (keyof typeof INVOCAR)[];

beforeEach(() => {
  vi.clearAllMocks();
  lectura.mockResolvedValue({ ok: true, data: convocatoria });
  lecturaDeVehiculo.mockResolvedValue({ ok: true, data: vehiculo });
  for (const servicio of Object.values(servicios)) {
    servicio.mockResolvedValue({ ok: true, data: {} } as never);
  }
});

describe("sin sesion", () => {
  it.each(NOMBRES)("%s responde unauthorized", async (nombre) => {
    sesionSimulada.mockResolvedValue(null);

    const resultado = await INVOCAR[nombre].llamar();

    expect(resultado).toEqual({ ok: false, error: "unauthorized" });
    for (const servicio of Object.values(servicios)) {
      expect(servicio).not.toHaveBeenCalled();
    }
  });
});

describe("sin el permiso", () => {
  it.each(NOMBRES)("%s responde forbidden", async (nombre) => {
    const { estatus } = INVOCAR[nombre];
    // Con un permiso de otra area: la sesion existe y el recurso esta en el
    // estatus correcto, asi que lo unico que puede denegar es el permiso.
    sesionSimulada.mockResolvedValue(sesion(["Autob_Operar_Tesoreria"]));
    lectura.mockResolvedValue({
      ok: true,
      data: { ...convocatoria, estatus },
    });

    const resultado = await INVOCAR[nombre].llamar();

    expect(resultado).toEqual({ ok: false, error: "forbidden" });
    for (const servicio of Object.values(servicios)) {
      expect(servicio).not.toHaveBeenCalled();
    }
  });
});

describe("con el permiso y el estatus correctos", () => {
  it.each(NOMBRES)("%s delega en su servicio", async (nombre) => {
    const { permiso, estatus } = INVOCAR[nombre];
    sesionSimulada.mockResolvedValue(sesion([permiso]));
    lectura.mockResolvedValue({
      ok: true,
      data: { ...convocatoria, estatus },
    });

    const resultado = await INVOCAR[nombre].llamar();

    expect(resultado.ok).toBe(true);
  });
});

describe("invariantes del barrido", () => {
  it("invoca todas las actions exportadas", () => {
    // La misma invariante que en vehiculos, y por el mismo motivo: alli agregue
    // una septima action y olvide sumarla al barrido, con lo que se quedo sin
    // ninguna comprobacion de permiso mientras las demas seguian en verde.
    const exportadas = Object.entries(acciones)
      .filter(
        ([nombre, valor]) =>
          typeof valor === "function" && !nombre.endsWith("DesdeFormulario"),
      )
      .map(([nombre]) => nombre);

    expect([...NOMBRES].sort()).toEqual(exportadas.sort());
  });
});

describe("R-05 — separacion de funciones", () => {
  it("deniega aprobar a quien creo la convocatoria", async () => {
    // La guarda vive en permisos.ts y se alimenta de `creadoPor`; esta prueba
    // comprueba que la action **le pasa ese dato**. Sin el, la guarda deniega
    // por `invalid_state` y R-05 pareceria cumplirse por accidente.
    sesionSimulada.mockResolvedValue(
      sesion(["Autob_Aprobar_Convocatorias"], "P9"),
    );
    lectura.mockResolvedValue({
      ok: true,
      data: { ...convocatoria, estatus: "EN_APROBACION", creadoPor: "P9" },
    });

    const resultado = await acciones.aprobarConvocatoria("C1");

    expect(resultado).toEqual({ ok: false, error: "forbidden" });
    expect(servicios.aprobar).not.toHaveBeenCalled();
  });
});

describe("contexto derivado de los lotes", () => {
  it("no deja enviar a aprobacion una convocatoria sin lotes vivos", async () => {
    sesionSimulada.mockResolvedValue(
      sesion(["Autob_Administrar_Convocatorias"]),
    );
    lectura.mockResolvedValue({
      ok: true,
      data: { ...convocatoria, lotes: [{ ...lote, estatus: "RETIRADO" }] },
    });

    const resultado = await acciones.enviarAAprobacion("C1");

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(servicios.enviar).not.toHaveBeenCalled();
  });

  it("no deja ocultar una publicada donde alguien se formo (R-06)", async () => {
    sesionSimulada.mockResolvedValue(
      sesion(["Autob_Administrar_Convocatorias"]),
    );
    lectura.mockResolvedValue({
      ok: true,
      data: {
        ...convocatoria,
        estatus: "PUBLICADA",
        lotes: [{ ...lote, contadorTurnos: 3 }],
      },
    });

    const resultado = await acciones.ocultarConvocatoria("C1", "Ya no aplica");

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(servicios.ocultar).not.toHaveBeenCalled();
  });

  it("no deja retirar un lote en el que alguien se formo", async () => {
    sesionSimulada.mockResolvedValue(
      sesion(["Autob_Administrar_Convocatorias"]),
    );
    lectura.mockResolvedValue({
      ok: true,
      data: { ...convocatoria, lotes: [{ ...lote, contadorTurnos: 1 }] },
    });

    const resultado = await acciones.retirarVehiculoDeConvocatoria({
      convocatoriaId: "C1",
      loteId: "L1",
      motivo: "Se daño",
    });

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(servicios.retirar).not.toHaveBeenCalled();
  });

  it("no deja incluir un vehiculo que no esta DISPONIBLE", async () => {
    sesionSimulada.mockResolvedValue(
      sesion(["Autob_Administrar_Convocatorias"]),
    );
    lecturaDeVehiculo.mockResolvedValue({
      ok: true,
      data: { ...vehiculo, estatus: "VENDIDO" },
    });

    const resultado = await acciones.incluirVehiculo({
      convocatoriaId: "C1",
      vehiculoId: "V1",
      precio: 180_000,
    });

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(servicios.incluir).not.toHaveBeenCalled();
  });
});
