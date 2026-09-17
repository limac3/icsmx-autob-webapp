// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import {
  cerrarLoteTrasConclusion,
  soltarMarcaDeCierre,
} from "@/lib/convocatorias/cerrarLoteTrasConclusion";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { listarConvocatorias } from "@/lib/convocatorias/listarConvocatorias";
import { registrar } from "@/lib/observabilidad/registro";
import type { Lote } from "@/types/lote";
import { adjudicarLote } from "./adjudicarLote";
import { cerrarFilaDelLote } from "./cerrarFilaDelLote";
import { vencerYReasignar } from "./vencerYReasignar";
import { barridoDeVencimientos } from "./barridoDeVencimientos";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/convocatorias/obtenerConvocatoria", () => ({
  obtenerConvocatoria: vi.fn(),
}));
vi.mock("@/lib/convocatorias/listarConvocatorias", () => ({
  listarConvocatorias: vi.fn(),
}));
vi.mock("./adjudicarLote", () => ({ adjudicarLote: vi.fn() }));
vi.mock("./cerrarFilaDelLote", () => ({ cerrarFilaDelLote: vi.fn() }));
vi.mock("./vencerYReasignar", () => ({ vencerYReasignar: vi.fn() }));
vi.mock("@/lib/observabilidad/registro", () => ({ registrar: vi.fn() }));
vi.mock("@/lib/convocatorias/cerrarLoteTrasConclusion", () => ({
  cerrarLoteTrasConclusion: vi.fn(),
  soltarMarcaDeCierre: vi.fn(),
}));

const cerrarTardio = vi.mocked(cerrarLoteTrasConclusion);
const soltarMarca = vi.mocked(soltarMarcaDeCierre);
const obtener = vi.mocked(obtenerConvocatoria);
const listar = vi.mocked(listarConvocatorias);
const adjudicar = vi.mocked(adjudicarLote);
const cerrar = vi.mocked(cerrarFilaDelLote);
const vencer = vi.mocked(vencerYReasignar);
const registro = vi.mocked(registrar);

const AHORA = new Date("2026-10-08T15:00:00.000Z");

const lote: Lote = {
  loteId: "L1",
  convocatoriaId: "C1",
  vehiculoId: "V1",
  precio: 100_000,
  estatus: "ADJUDICADO",
  contadorTurnos: 2,
  inicioVenta: "2026-10-01T00:00:00.000Z",
  finVenta: "2026-10-20T00:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  creadoEn: "2026-09-01T00:00:00.000Z",
  creadoPor: "P9",
};

const solicitudVencidaItem = (
  id: string,
  extra: Record<string, unknown> = {},
) => ({
  PK: `LOTE#${id}`,
  SK: "SOL#0000000001",
  solicitudId: `${id}-1`,
  loteId: id,
  convocatoriaId: "C1",
  participanteId: "P1",
  turno: 1,
  estatus: "ADJUDICADA",
  solicitadoEn: "2026-10-01T00:00:00.000Z",
  venceEn: "2026-10-08T00:00:00.000Z",
  ...extra,
});

/** Un lote tal como lo devuelve la particion `CIERRE_PENDIENTE` de GSI4. */
const loteMarcado = (
  loteId: string,
  estatus: Lote["estatus"],
): Record<string, unknown> => ({
  PK: `CONV#C1`,
  SK: `LOTE#${loteId}`,
  ...lote,
  loteId,
  vehiculoId: `V-${loteId}`,
  estatus,
  estatusConvocatoria: "CONCLUIDA",
  GSI4PK: "CIERRE_PENDIENTE",
  GSI4SK: `C1#${loteId}`,
});

const escenario = (
  opciones: {
    vencidasGsi4?: Record<string, unknown>[];
    cierresPendientes?: Record<string, unknown>[];
    filaViva?: boolean;
  } = {},
) => {
  const dynamo = crearClienteFalso({
    responder: (comando: ComandoEnviado) => {
      if (comando.input.IndexName === "GSI4") {
        const pk = (
          comando.input.ExpressionAttributeValues as Record<string, string>
        )[":pk"];
        if (pk === "CIERRE_PENDIENTE") {
          return { Items: opciones.cierresPendientes ?? [] };
        }
        return { Items: opciones.vencidasGsi4 ?? [] };
      }
      if (comando.nombre === "QueryCommand") {
        // hayFilaViva: Select COUNT sobre la fila base.
        return { Count: opciones.filaViva ? 1 : 0 };
      }
      return {};
    },
  });
  return { dynamo, deps: { cliente: dynamo.cliente, ahora: () => AHORA } };
};

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
  listar.mockResolvedValue({ ok: true, data: [] });
  // Por omision el cierre no encuentra nada que cerrar: cada prueba que le
  // importa el cierre pone su propia respuesta.
  cerrar.mockResolvedValue({ ok: true, data: 0 });
  cerrarTardio.mockResolvedValue({
    ok: true,
    data: { loteId: "L1", vehiculoId: "V1" },
  });
  soltarMarca.mockResolvedValue({ ok: true, data: { loteId: "L1" } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("barridoDeVencimientos — recorrido de dias", () => {
  it("consulta GSI4 para tres dias hacia atras por omision", async () => {
    const { dynamo, deps } = escenario();

    await barridoDeVencimientos({}, deps);

    const particiones = dynamo.comandos
      .filter((c) => c.input.IndexName === "GSI4")
      .map(
        (c) =>
          (c.input.ExpressionAttributeValues as Record<string, string>)[":pk"],
      );
    // La cuarta no es un dia: es la particion fija de cierres pendientes
    // (R-11b), que se consulta una sola vez por corrida y no depende de
    // `diasHaciaAtras`.
    expect(particiones).toEqual([
      "VENCE#2026-10-08",
      "VENCE#2026-10-07",
      "VENCE#2026-10-06",
      "CIERRE_PENDIENTE",
    ]);
  });

  it("respeta diasHaciaAtras si se pide un valor distinto", async () => {
    const { dynamo, deps } = escenario();

    await barridoDeVencimientos({ diasHaciaAtras: 1 }, deps);

    const porDia = dynamo.comandos.filter(
      (c) =>
        c.input.IndexName === "GSI4" &&
        String(
          (c.input.ExpressionAttributeValues as Record<string, string>)[":pk"],
        ).startsWith("VENCE#"),
    );
    expect(porDia).toHaveLength(1);
  });
});

describe("barridoDeVencimientos — resolucion de vencidas", () => {
  it("cuenta reasignado y fila_agotada como resueltas", async () => {
    const { deps } = escenario({
      vencidasGsi4: [solicitudVencidaItem("L1"), solicitudVencidaItem("L2")],
    });
    obtener.mockResolvedValue({
      ok: true,
      data: { ...lote, lotes: [lote, { ...lote, loteId: "L2" }] } as never,
    });
    vencer
      .mockResolvedValueOnce({
        estado: "reasignado",
        turno: 2,
        solicitudId: "L1-2",
        participanteId: "P2",
        venceEn: "x",
      })
      .mockResolvedValueOnce({ estado: "fila_agotada" });

    const resultado = await barridoDeVencimientos({ diasHaciaAtras: 1 }, deps);

    expect(resultado.vencimientosResueltos).toBe(2);
    expect(resultado.errores).toBe(0);
  });

  it("cuenta abstenido y en_conflicto en sus propias categorias", async () => {
    const { deps } = escenario({
      vencidasGsi4: [solicitudVencidaItem("L1"), solicitudVencidaItem("L2")],
    });
    obtener.mockResolvedValue({
      ok: true,
      data: { ...lote, lotes: [lote, { ...lote, loteId: "L2" }] } as never,
    });
    vencer
      .mockResolvedValueOnce({ estado: "abstenido", reservasVigentes: 1 })
      .mockResolvedValueOnce({ estado: "en_conflicto" });

    const resultado = await barridoDeVencimientos({ diasHaciaAtras: 1 }, deps);

    expect(resultado.vencimientosAbstenidos).toBe(1);
    expect(resultado.errores).toBe(1);
  });

  it("no_vigente no cuenta como error — es la carrera inofensiva de D-7", async () => {
    const { deps } = escenario({ vencidasGsi4: [solicitudVencidaItem("L1")] });
    obtener.mockResolvedValue({
      ok: true,
      data: { ...lote, lotes: [lote] } as never,
    });
    vencer.mockResolvedValue({ estado: "no_vigente" });

    const resultado = await barridoDeVencimientos({ diasHaciaAtras: 1 }, deps);

    expect(resultado.errores).toBe(0);
    expect(resultado.vencimientosResueltos).toBe(0);
  });

  it("una solicitud que ya no esta ADJUDICADA se ignora sin leer el lote", async () => {
    const { deps } = escenario({
      vencidasGsi4: [
        solicitudVencidaItem("L1", { estatus: "EN_VERIFICACION" }),
      ],
    });

    const resultado = await barridoDeVencimientos({ diasHaciaAtras: 1 }, deps);

    expect(obtener).not.toHaveBeenCalled();
    expect(vencer).not.toHaveBeenCalled();
    expect(resultado.errores).toBe(0);
  });

  it("sin convocatoriaId (dato viejo) cuenta como error y no llama a vencerYReasignar", async () => {
    const item = solicitudVencidaItem("L1");
    delete (item as Record<string, unknown>).convocatoriaId;
    const { deps } = escenario({ vencidasGsi4: [item] });

    const resultado = await barridoDeVencimientos({ diasHaciaAtras: 1 }, deps);

    expect(vencer).not.toHaveBeenCalled();
    expect(resultado.errores).toBe(1);
  });

  it("si la convocatoria ya no existe, cuenta error y sigue con las demas", async () => {
    const { deps } = escenario({
      vencidasGsi4: [solicitudVencidaItem("L1"), solicitudVencidaItem("L2")],
    });
    obtener
      .mockResolvedValueOnce({ ok: false, error: "not_found" })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ...lote,
          loteId: "L2",
          lotes: [{ ...lote, loteId: "L2" }],
        } as never,
      });
    vencer.mockResolvedValue({ estado: "fila_agotada" });

    const resultado = await barridoDeVencimientos({ diasHaciaAtras: 1 }, deps);

    expect(resultado.errores).toBe(1);
    expect(resultado.vencimientosResueltos).toBe(1);
  });
});

describe("barridoDeVencimientos — recuperacion de lotes libres", () => {
  it("no llama a adjudicarLote si el lote nunca tuvo una solicitud", async () => {
    const { deps } = escenario({ filaViva: true });
    listar.mockResolvedValue({
      ok: true,
      data: [{ convocatoriaId: "C1" } as never],
    });
    obtener.mockResolvedValue({
      ok: true,
      data: {
        convocatoriaId: "C1",
        lotes: [{ ...lote, estatus: "EN_OFERTA", contadorTurnos: 0 }],
      } as never,
    });

    await barridoDeVencimientos({ diasHaciaAtras: 0 }, deps);

    expect(adjudicar).not.toHaveBeenCalled();
  });

  it("no llama a adjudicarLote si tuvo solicitudes pero ninguna sigue EN_FILA", async () => {
    const { deps } = escenario({ filaViva: false });
    listar.mockResolvedValue({
      ok: true,
      data: [{ convocatoriaId: "C1" } as never],
    });
    obtener.mockResolvedValue({
      ok: true,
      data: {
        convocatoriaId: "C1",
        lotes: [{ ...lote, estatus: "EN_OFERTA", contadorTurnos: 3 }],
      } as never,
    });

    await barridoDeVencimientos({ diasHaciaAtras: 0 }, deps);

    expect(adjudicar).not.toHaveBeenCalled();
  });

  it("llama a adjudicarLote con RECUPERACION_POR_BARRIDO cuando hay fila viva y cuenta el resultado", async () => {
    const { deps } = escenario({ filaViva: true });
    listar.mockResolvedValue({
      ok: true,
      data: [{ convocatoriaId: "C1" } as never],
    });
    obtener.mockResolvedValue({
      ok: true,
      data: {
        convocatoriaId: "C1",
        lotes: [{ ...lote, estatus: "EN_OFERTA", contadorTurnos: 3 }],
      } as never,
    });
    adjudicar.mockResolvedValue({
      estado: "adjudicado",
      turno: 1,
      solicitudId: "L1-1",
      participanteId: "P1",
      venceEn: "x",
    });

    const resultado = await barridoDeVencimientos({ diasHaciaAtras: 0 }, deps);

    expect(adjudicar).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: "RECUPERACION_POR_BARRIDO" }),
      expect.anything(),
    );
    expect(resultado.lotesRecuperados).toBe(1);
  });

  it("NO adjudica un lote manual, ni con fila viva y el lote libre (R21)", async () => {
    // **El riesgo mas silencioso de la Etapa 15.** Un lote esperando la
    // decision del adjudicador es, para el resto de esta funcion,
    // indistinguible de uno automatico que se quedo sin adjudicar:
    // `EN_OFERTA`, con fila viva y sin `adjudicacionActual`. Sin la exclusion,
    // el barrido nocturno adjudicaria al turno menor por su cuenta y desharia
    // la modalidad entera — de madrugada, y con un evento que diria
    // `RECUPERACION_POR_BARRIDO`.
    const { deps } = escenario({ filaViva: true });
    listar.mockResolvedValue({
      ok: true,
      data: [{ convocatoriaId: "C1" } as never],
    });
    obtener.mockResolvedValue({
      ok: true,
      data: {
        convocatoriaId: "C1",
        lotes: [
          {
            ...lote,
            estatus: "EN_OFERTA",
            contadorTurnos: 3,
            modalidadAdjudicacion: "MANUAL",
          },
        ],
      } as never,
    });

    const resultado = await barridoDeVencimientos({ diasHaciaAtras: 0 }, deps);

    expect(adjudicar).not.toHaveBeenCalled();
    expect(resultado.lotesRecuperados).toBe(0);
  });

  it("no adjudica lotes ADJUDICADO, VENDIDO ni RETIRADO", async () => {
    const { deps } = escenario({ filaViva: true });
    listar.mockResolvedValue({
      ok: true,
      data: [{ convocatoriaId: "C1" } as never],
    });
    obtener.mockResolvedValue({
      ok: true,
      data: {
        convocatoriaId: "C1",
        lotes: [
          { ...lote, estatus: "ADJUDICADO", contadorTurnos: 3 },
          { ...lote, loteId: "L2", estatus: "VENDIDO", contadorTurnos: 3 },
        ],
      } as never,
    });

    await barridoDeVencimientos({ diasHaciaAtras: 0 }, deps);

    expect(adjudicar).not.toHaveBeenCalled();
  });
});

describe("barridoDeVencimientos — reconciliacion de filas en lotes ya cerrados", () => {
  // El cierre de la fila que `avalarPago` hace **fuera** de su transaccion
  // puede fallar con la venta ya firme. Antes eso duraba hasta que alguien
  // concluyera la convocatoria; ahora lo repara la corrida siguiente.

  const convocatoriaCon = (lotes: unknown[]) => {
    listar.mockResolvedValue({
      ok: true,
      data: [{ convocatoriaId: "C1" } as never],
    });
    obtener.mockResolvedValue({
      ok: true,
      data: { convocatoriaId: "C1", lotes } as never,
    });
  };

  it("cierra la fila viva de un lote VENDIDO y la cuenta", async () => {
    const { deps } = escenario({ filaViva: true });
    convocatoriaCon([{ ...lote, estatus: "VENDIDO", contadorTurnos: 3 }]);
    cerrar.mockResolvedValue({ ok: true, data: 2 });

    const resultado = await barridoDeVencimientos({ diasHaciaAtras: 0 }, deps);

    expect(cerrar).toHaveBeenCalledWith(
      expect.objectContaining({
        lote: expect.objectContaining({ estatus: "VENDIDO" }),
        actor: { tipo: "SISTEMA" },
      }),
      expect.anything(),
    );
    expect(resultado.filasCerradas).toBe(2);
  });

  it("tambien reconcilia un lote NO_VENDIDO", async () => {
    const { deps } = escenario({ filaViva: true });
    convocatoriaCon([{ ...lote, estatus: "NO_VENDIDO", contadorTurnos: 3 }]);
    cerrar.mockResolvedValue({ ok: true, data: 1 });

    const resultado = await barridoDeVencimientos({ diasHaciaAtras: 0 }, deps);

    expect(resultado.filasCerradas).toBe(1);
  });

  it("no cierra nada si el lote cerrado ya no tiene fila viva", async () => {
    const { deps } = escenario({ filaViva: false });
    convocatoriaCon([{ ...lote, estatus: "VENDIDO", contadorTurnos: 3 }]);

    await barridoDeVencimientos({ diasHaciaAtras: 0 }, deps);

    expect(cerrar).not.toHaveBeenCalled();
  });

  it("no cierra la fila de un lote ADJUDICADO: sigue abierta por R-17", async () => {
    // La distincion que importa: con el lote adjudicado los demas siguen
    // esperando legitimamente su turno si el ganador no paga.
    const { deps } = escenario({ filaViva: true });
    convocatoriaCon([{ ...lote, estatus: "ADJUDICADO", contadorTurnos: 3 }]);

    await barridoDeVencimientos({ diasHaciaAtras: 0 }, deps);

    expect(cerrar).not.toHaveBeenCalled();
  });

  it("un cierre que vuelve a fallar se registra y no cuenta como error del barrido", async () => {
    // `errores` mide vencidas sin resolver y es lo que dispara
    // `vencimientos-sin-resolver`, la alarma mas grave. Un cierre fallido no
    // puede cambiar lo que esa alarma significa.
    const { deps } = escenario({ filaViva: true });
    convocatoriaCon([{ ...lote, estatus: "VENDIDO", contadorTurnos: 3 }]);
    cerrar.mockResolvedValue({ ok: false, error: "conflicto_concurrencia" });

    const resultado = await barridoDeVencimientos({ diasHaciaAtras: 0 }, deps);

    expect(resultado.errores).toBe(0);
    expect(resultado.filasCerradas).toBe(0);
    expect(registro).toHaveBeenCalledWith(
      "warn",
      "cerrarFilaDelLote",
      expect.objectContaining({ loteId: "L1", desenlace: "rechazado" }),
    );
  });

  it("no adjudica el lote cerrado que reconcilia", async () => {
    const { deps } = escenario({ filaViva: true });
    convocatoriaCon([{ ...lote, estatus: "VENDIDO", contadorTurnos: 3 }]);
    cerrar.mockResolvedValue({ ok: true, data: 1 });

    await barridoDeVencimientos({ diasHaciaAtras: 0 }, deps);

    expect(adjudicar).not.toHaveBeenCalled();
  });
});

describe("barridoDeVencimientos — cierres pendientes tras la conclusion (R-11b)", () => {
  it("cierra el lote que volvio a EN_OFERTA con su convocatoria ya concluida", async () => {
    const { deps } = escenario({
      cierresPendientes: [loteMarcado("L7", "EN_OFERTA")],
    });

    const resultado = await barridoDeVencimientos({}, deps);

    expect(cerrarTardio).toHaveBeenCalledTimes(1);
    expect(cerrarTardio.mock.calls[0]?.[0].lote).toMatchObject({
      loteId: "L7",
      vehiculoId: "V-L7",
      estatus: "EN_OFERTA",
    });
    expect(resultado.lotesLiberados).toBe(1);
  });

  it("deja intacto el lote que sigue ADJUDICADO: su plazo aun corre", async () => {
    const { deps } = escenario({
      cierresPendientes: [loteMarcado("L7", "ADJUDICADO")],
    });

    const resultado = await barridoDeVencimientos({}, deps);

    // Ni se cierra ni se le quita la marca: es exactamente el caso que el
    // indice existe para vigilar, y quitarla lo dejaria sin vigilancia.
    expect(cerrarTardio).not.toHaveBeenCalled();
    expect(soltarMarca).not.toHaveBeenCalled();
    expect(resultado.lotesLiberados).toBe(0);
  });

  it("suelta la marca del lote que si se vendio, sin cerrarlo", async () => {
    const { deps } = escenario({
      cierresPendientes: [loteMarcado("L7", "VENDIDO")],
    });

    const resultado = await barridoDeVencimientos({}, deps);

    expect(cerrarTardio).not.toHaveBeenCalled();
    expect(soltarMarca).toHaveBeenCalledTimes(1);
    expect(soltarMarca.mock.calls[0]?.[0].lote.loteId).toBe("L7");
    // Soltar una marca no es liberar un vehiculo: ese lote se vendio.
    expect(resultado.lotesLiberados).toBe(0);
  });

  it("suelta la marca de un lote que otra corrida ya cerro", async () => {
    const { deps } = escenario({
      cierresPendientes: [loteMarcado("L7", "NO_VENDIDO")],
    });

    await barridoDeVencimientos({}, deps);

    expect(cerrarTardio).not.toHaveBeenCalled();
    expect(soltarMarca).toHaveBeenCalledTimes(1);
  });

  it("un cierre tardio que falla se registra pero no cuenta como error", async () => {
    const { deps } = escenario({
      cierresPendientes: [loteMarcado("L7", "EN_OFERTA")],
    });
    cerrarTardio.mockResolvedValue({ ok: false, error: "invalid_state" });

    const resultado = await barridoDeVencimientos({}, deps);

    // `errores` es lo que dispara `vencimientos-sin-resolver`, la alarma mas
    // grave del sistema. Un cierre tardio fallido no significa eso: la marca
    // sigue en GSI4 y la corrida siguiente reintenta.
    expect(resultado.errores).toBe(0);
    expect(resultado.lotesLiberados).toBe(0);
    expect(registro).toHaveBeenCalledWith(
      "warn",
      "cerrarLoteTrasConclusion",
      expect.objectContaining({ loteId: "L7", desenlace: "rechazado" }),
    );
  });

  it("recorre varios lotes marcados y trata cada uno segun su estado", async () => {
    const { deps } = escenario({
      cierresPendientes: [
        loteMarcado("L1", "EN_OFERTA"),
        loteMarcado("L2", "ADJUDICADO"),
        loteMarcado("L3", "VENDIDO"),
        loteMarcado("L4", "EN_OFERTA"),
      ],
    });

    const resultado = await barridoDeVencimientos({}, deps);

    expect(cerrarTardio).toHaveBeenCalledTimes(2);
    expect(soltarMarca).toHaveBeenCalledTimes(1);
    expect(resultado.lotesLiberados).toBe(2);
  });

  it("consulta la particion fija una sola vez, sin filtro", async () => {
    const { dynamo, deps } = escenario();

    await barridoDeVencimientos({ diasHaciaAtras: 1 }, deps);

    const consultas = dynamo.comandos.filter(
      (c) =>
        c.input.IndexName === "GSI4" &&
        (c.input.ExpressionAttributeValues as Record<string, string>)[":pk"] ===
          "CIERRE_PENDIENTE",
    );
    expect(consultas).toHaveLength(1);
    // Sin `FilterExpression` a proposito: la particion contiene exactamente los
    // lotes que pueden necesitar cierre, asi que no hay nada que descartar.
    expect(consultas[0]?.input.FilterExpression).toBeUndefined();
  });
});
