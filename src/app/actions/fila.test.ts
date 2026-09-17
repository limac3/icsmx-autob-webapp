// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateTag } from "next/cache";

import { getSession } from "@/lib/auth/session";
import { etiqueta } from "@/lib/cache";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { cancelarSolicitud as cancelarServicio } from "@/lib/fila/cancelarSolicitud";
import { consultarMiLugar, leerMiSolicitud } from "@/lib/fila/consultarMiLugar";
import { consultarTamanoFila } from "@/lib/fila/conteosDeFila";
import { registrarIntento } from "@/lib/fila/limiteDeTasa";
import { solicitarCompra as solicitarServicio } from "@/lib/fila/solicitarCompra";
import type { ConvocatoriaConLotes } from "@/types/convocatoria";
import type { Solicitud } from "@/types/fila";
import type { Sesion } from "@/types/identidad";
import type { Lote } from "@/types/lote";
import * as acciones from "./fila";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/convocatorias/obtenerConvocatoria", () => ({
  obtenerConvocatoria: vi.fn(),
}));
vi.mock("@/lib/fila/consultarMiLugar", () => ({
  consultarMiLugar: vi.fn(),
  leerMiSolicitud: vi.fn(),
}));
vi.mock("@/lib/fila/conteosDeFila", () => ({ consultarTamanoFila: vi.fn() }));
vi.mock("@/lib/fila/limiteDeTasa", () => ({ registrarIntento: vi.fn() }));
vi.mock("@/lib/fila/solicitarCompra", () => ({ solicitarCompra: vi.fn() }));
vi.mock("@/lib/fila/cancelarSolicitud", () => ({ cancelarSolicitud: vi.fn() }));

const sesionSimulada = vi.mocked(getSession);
const lectura = vi.mocked(obtenerConvocatoria);
const miSolicitud = vi.mocked(leerMiSolicitud);
const miLugar = vi.mocked(consultarMiLugar);
const tamano = vi.mocked(consultarTamanoFila);
const tasa = vi.mocked(registrarIntento);
const solicitar = vi.mocked(solicitarServicio);
const cancelar = vi.mocked(cancelarServicio);

const AHORA = new Date();
const enHoras = (horas: number) =>
  new Date(AHORA.getTime() + horas * 3_600_000).toISOString();

const lote: Lote = {
  loteId: "L1",
  convocatoriaId: "C1",
  vehiculoId: "V1",
  precio: 180_000,
  estatus: "EN_OFERTA",
  contadorTurnos: 0,
  inicioVenta: enHoras(-1),
  finVenta: enHoras(48),
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
};

const convocatoria: ConvocatoriaConLotes = {
  folio: "CONV-001",
  nombre: "Venta de octubre",
  convocatoriaId: "C1",
  tipo: "EMPLEADOS",
  descripcionParticipacion: "<p>Abierta al personal.</p>",
  publicadaEn: enHoras(-24),
  inicioVenta: enHoras(-1),
  finVenta: enHoras(48),
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  estatus: "PUBLICADA",
  creadoEn: "2026-09-01T10:00:00.000Z",
  creadoPor: "P9",
  lotes: [lote],
};

const sesion = (permisos: string[], participanteId = "P1"): Sesion => ({
  participanteId,
  oktaSub: "okta|1",
  correo: "quien@example.org",
  nombre: "Quien Sea",
  permisos: new Set(permisos) as Sesion["permisos"],
  tiposDeConvocatoriaPermitidos: ["EMPLEADOS"],
});

const solicitudPropia = (estatus: Solicitud["estatus"]): Solicitud => ({
  solicitudId: "L1-2",
  loteId: "L1",
  participanteId: "P1",
  turno: 2,
  estatus,
  solicitadoEn: enHoras(-1),
});

const entrada = { convocatoriaId: "C1", loteId: "L1" };

beforeEach(() => {
  vi.clearAllMocks();
  sesionSimulada.mockResolvedValue(sesion(["Autob_Venta_a_empleados"]));
  lectura.mockResolvedValue({ ok: true, data: convocatoria });
  miSolicitud.mockResolvedValue({ ok: true, data: null });
  tamano.mockResolvedValue({ ok: true, data: 0 });
  tasa.mockResolvedValue({ permitido: true, intentos: 1, ventana: 0 });
  solicitar.mockResolvedValue({
    ok: true,
    data: {
      solicitudId: "L1-1",
      turno: 1,
      ordenEnConvocatoria: 1,
      canceladaPorLimite: false,
      adjudicacion: { estado: "fila_agotada", turnosRevisados: 0 },
    },
  });
  miLugar.mockResolvedValue({
    ok: true,
    data: {
      solicitudId: "L1-1",
      loteId: "L1",
      miTurno: 1,
      miPosicion: 1,
      tamanoFila: 1,
      estatus: "EN_FILA",
    },
  });
  cancelar.mockResolvedValue({
    ok: true,
    data: {
      estatus: "CANCELADA_POR_PARTICIPANTE",
      liberoElLote: false,
    },
  });
});

describe("solicitarCompra — autorizacion", () => {
  it("con permiso de venta del tipo, entra a la fila", async () => {
    const resultado = await acciones.solicitarCompra(entrada);

    expect(resultado.ok).toBe(true);
    expect(solicitar).toHaveBeenCalledTimes(1);
  });

  it("sin sesion no llega a leer nada", async () => {
    sesionSimulada.mockResolvedValue(null);

    expect(await acciones.solicitarCompra(entrada)).toEqual({
      ok: false,
      error: "unauthorized",
    });
    expect(lectura).not.toHaveBeenCalled();
    expect(solicitar).not.toHaveBeenCalled();
  });

  it("sin el permiso del tipo responde not_found, no forbidden (R-01)", async () => {
    // Un 403 confirmaria que el lote existe. Quien no tiene acceso al tipo no
    // puede distinguir "no existe" de "no es para ti".
    sesionSimulada.mockResolvedValue(sesion(["Autob_Venta_en_general"]));

    expect(await acciones.solicitarCompra(entrada)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(solicitar).not.toHaveBeenCalled();
  });

  it("un permiso administrativo no habilita solicitar", async () => {
    // "Quien configura la venta no participa en ella" — y la aplicacion no lo
    // codifica: simplemente `solicitud:crear` exige un permiso de venta.
    sesionSimulada.mockResolvedValue(
      sesion([
        "Autob_Administrar_Convocatorias",
        "Autob_Aprobar_Convocatorias",
      ]),
    );

    expect(await acciones.solicitarCompra(entrada)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("una convocatoria que no existe no revela nada distinto", async () => {
    lectura.mockResolvedValue({ ok: false, error: "not_found" });

    expect(await acciones.solicitarCompra(entrada)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("un lote de otra convocatoria tampoco existe para esta", async () => {
    expect(
      await acciones.solicitarCompra({ convocatoriaId: "C1", loteId: "OTRO" }),
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("solicitarCompra — limitacion de tasa (Etapa 16)", () => {
  it("un intento estrangulado no consume turno", async () => {
    // **Es la verificacion central de la Etapa 16.** El contador de turnos vive
    // dentro de `solicitarCompra`, tres pasos mas adentro; si el servicio no se
    // invoca, no hay `ADD` que gastar. Que la limitacion no queme turnos es lo
    // que impide que castigue con huecos de fila a quien solo reintento.
    tasa.mockResolvedValue({ permitido: false, intentos: 11, ventana: 0 });

    expect(await acciones.solicitarCompra(entrada)).toEqual({
      ok: false,
      error: "limite_de_tasa",
    });
    expect(solicitar).not.toHaveBeenCalled();
  });

  it("estrangula antes de leer la convocatoria", async () => {
    // El intento rechazado no le cuesta al sistema ni una lectura. Es tambien
    // lo que hace que el mecanismo sirva de algo: el perfil que hay que acotar
    // dispara **antes** de la apertura, y esos intentos mueren en la guarda de
    // `solicitud:crear` sin llegar nunca al motor de fila.
    tasa.mockResolvedValue({ permitido: false, intentos: 11, ventana: 0 });

    await acciones.solicitarCompra(entrada);

    expect(lectura).not.toHaveBeenCalled();
    expect(miSolicitud).not.toHaveBeenCalled();
  });

  it("sin sesion no se cuenta ningun intento", async () => {
    // Contar antes de identificar dejaria el contador a merced de cualquiera y
    // sin participante a quien atribuirlo.
    sesionSimulada.mockResolvedValue(null);

    expect(await acciones.solicitarCompra(entrada)).toEqual({
      ok: false,
      error: "unauthorized",
    });
    expect(tasa).not.toHaveBeenCalled();
  });

  it("cuenta el intento contra el participante de la sesion, no contra uno del cliente", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Venta_a_empleados"], "P7"));

    await acciones.solicitarCompra(entrada);

    expect(tasa).toHaveBeenCalledWith({
      participanteId: "P7",
      convocatoriaId: "C1",
    });
  });

  it("cancelar no pasa por la limitacion de tasa", async () => {
    // Acota la carrera por la apertura, que es donde esta el incentivo de
    // automatizar. Cancelar no compite por nada, y estrangularlo solo impediria
    // salirse de una fila.
    miSolicitud.mockResolvedValue({
      ok: true,
      data: solicitudPropia("EN_FILA"),
    });

    await acciones.cancelarSolicitud(entrada);

    expect(tasa).not.toHaveBeenCalled();
  });
});

describe("solicitarCompra — guardas de negocio", () => {
  it("antes de que abra la venta responde invalid_state", async () => {
    lectura.mockResolvedValue({
      ok: true,
      data: { ...convocatoria, inicioVenta: enHoras(2) },
    });

    expect(await acciones.solicitarCompra(entrada)).toEqual({
      ok: false,
      error: "invalid_state",
    });
    expect(solicitar).not.toHaveBeenCalled();
  });

  it("despues del cierre tampoco se puede solicitar", async () => {
    lectura.mockResolvedValue({
      ok: true,
      data: {
        ...convocatoria,
        inicioVenta: enHoras(-48),
        finVenta: enHoras(-1),
      },
    });

    expect(await acciones.solicitarCompra(entrada)).toEqual({
      ok: false,
      error: "invalid_state",
    });
  });

  it("con una solicitud viva propia, R-07 lo impide antes de tocar el contador", async () => {
    miSolicitud.mockResolvedValue({
      ok: true,
      data: solicitudPropia("EN_FILA"),
    });

    expect(await acciones.solicitarCompra(entrada)).toEqual({
      ok: false,
      error: "invalid_state",
    });
    expect(solicitar).not.toHaveBeenCalled();
  });

  it("una convocatoria aun no publicada no es visible", async () => {
    lectura.mockResolvedValue({
      ok: true,
      data: { ...convocatoria, publicadaEn: enHoras(2) },
    });

    expect(await acciones.solicitarCompra(entrada)).toEqual({
      ok: false,
      error: "invalid_state",
    });
  });
});

describe("solicitarCompra — resultado", () => {
  it("el actor sale de la sesion, nunca del input", async () => {
    await acciones.solicitarCompra(entrada);

    expect(solicitar.mock.calls[0]?.[0]).toMatchObject({
      participanteId: "P1",
      actor: { tipo: "USUARIO", id: "P1" },
    });
  });

  it("devuelve el lugar leido despues de intentar adjudicar", async () => {
    miLugar.mockResolvedValue({
      ok: true,
      data: {
        solicitudId: "L1-1",
        loteId: "L1",
        miTurno: 1,
        miPosicion: 1,
        tamanoFila: 1,
        estatus: "ADJUDICADA",
        venceEn: enHoras(48),
      },
    });

    const resultado = await acciones.solicitarCompra(entrada);

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.estatus).toBe("ADJUDICADA");
  });

  it("invalida la fila del lote y la vista de su convocatoria", async () => {
    await acciones.solicitarCompra(entrada);

    expect(vi.mocked(updateTag)).toHaveBeenCalledWith(etiqueta.lote("L1"));
    expect(vi.mocked(updateTag)).toHaveBeenCalledWith(
      etiqueta.convocatoria("C1"),
    );
  });

  it("un fallo del servicio no invalida cache", async () => {
    solicitar.mockResolvedValue({ ok: false, error: "already_in_queue" });

    expect(await acciones.solicitarCompra(entrada)).toEqual({
      ok: false,
      error: "already_in_queue",
    });
    expect(vi.mocked(updateTag)).not.toHaveBeenCalled();
  });
});

describe("cancelarSolicitud", () => {
  beforeEach(() => {
    miSolicitud.mockResolvedValue({
      ok: true,
      data: solicitudPropia("EN_FILA"),
    });
  });

  it("cancela la propia y devuelve el estatus nuevo", async () => {
    const resultado = await acciones.cancelarSolicitud(entrada);

    expect(resultado).toEqual({
      ok: true,
      data: { estatus: "CANCELADA_POR_PARTICIPANTE" },
    });
    expect(cancelar.mock.calls[0]?.[0]).toMatchObject({
      solicitud: { participanteId: "P1", turno: 2 },
      actor: { id: "P1" },
    });
  });

  it("no recibe ningun identificador de solicitud del cliente", async () => {
    // La solicitud se alcanza desde el centinela, que esta indexado por el
    // participante de la sesion: cancelar la de otro no es una guarda que se
    // pueda olvidar, es una clave que no se puede construir.
    await acciones.cancelarSolicitud(entrada);

    expect(miSolicitud.mock.calls[0]?.[0]).toEqual({
      loteId: "L1",
      participanteId: "P1",
    });
  });

  it("sin solicitud viva responde not_found", async () => {
    miSolicitud.mockResolvedValue({ ok: true, data: null });

    expect(await acciones.cancelarSolicitud(entrada)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(cancelar).not.toHaveBeenCalled();
  });

  it("desde EN_VERIFICACION la guarda lo impide", async () => {
    // El reloj ya se detuvo; el arrepentimiento lo resuelve tesoreria (R-16).
    miSolicitud.mockResolvedValue({
      ok: true,
      data: solicitudPropia("EN_VERIFICACION"),
    });

    expect(await acciones.cancelarSolicitud(entrada)).toEqual({
      ok: false,
      error: "invalid_state",
    });
    expect(cancelar).not.toHaveBeenCalled();
  });

  it("sin permiso de venta no cancela", async () => {
    sesionSimulada.mockResolvedValue(sesion(["Autob_Operar_Tesoreria"]));

    expect(await acciones.cancelarSolicitud(entrada)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(cancelar).not.toHaveBeenCalled();
  });

  it("una convocatoria ya concluida no impide cancelar lo propio", async () => {
    // R-18 deja viva la adjudicacion tras concluir; quien la tiene puede
    // renunciar a ella.
    lectura.mockResolvedValue({
      ok: true,
      data: { ...convocatoria, estatus: "CONCLUIDA" },
    });
    miSolicitud.mockResolvedValue({
      ok: true,
      data: solicitudPropia("ADJUDICADA"),
    });

    const resultado = await acciones.cancelarSolicitud(entrada);

    expect(resultado.ok).toBe(true);
  });
});
