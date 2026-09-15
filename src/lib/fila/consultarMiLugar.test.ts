// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import { consultarMiLugar, leerMiSolicitud } from "./consultarMiLugar";
import { vencerYReasignar } from "./vencerYReasignar";

vi.mock("server-only", () => ({}));
vi.mock("./vencerYReasignar", () => ({ vencerYReasignar: vi.fn() }));

const vencer = vi.mocked(vencerYReasignar);

const AHORA = "2026-10-06T15:00:00.000Z";

const solicitud = (extra: Record<string, unknown> = {}) => ({
  PK: "LOTE#L1",
  SK: "SOL#0000000004",
  solicitudId: "L1-4",
  loteId: "L1",
  participanteId: "P1",
  turno: 4,
  estatus: "EN_FILA",
  solicitadoEn: AHORA,
  ...extra,
});

/**
 * Centinela, solicitud y los dos conteos, en el orden en que se piden. El
 * primer `Get` es el centinela; el segundo, la solicitud.
 */
const escenario = (opciones: {
  centinela?: Record<string, unknown> | undefined;
  item?: Record<string, unknown> | undefined;
  tamano?: number;
  anteriores?: number;
}) => {
  let gets = 0;
  return (comando: ComandoEnviado): unknown => {
    if (comando.nombre === "GetCommand") {
      gets += 1;
      return gets === 1
        ? { Item: opciones.centinela }
        : { Item: opciones.item };
    }
    const valores = comando.input.ExpressionAttributeValues as Record<
      string,
      string
    >;
    // El conteo total llega hasta el turno maximo; el de "antes de mi" no.
    return valores[":hasta"] === "SOL#9999999999"
      ? { Count: opciones.tamano ?? 0 }
      : { Count: opciones.anteriores ?? 0 };
  };
};

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("privacidad de la proyeccion — R-12", () => {
  it("el DTO no contiene identidad de nadie, ni la propia", async () => {
    // Esta prueba es la que debe fallar si alguien agrega `participanteId` al
    // DTO "para tenerlo a mano". La regla no admite grados: ningun dato de
    // participante viaja al cliente.
    const falso = crearClienteFalso({
      responder: escenario({
        centinela: { turno: 4 },
        item: solicitud(),
        tamano: 7,
        anteriores: 2,
      }),
    });

    const resultado = await consultarMiLugar(
      { loteId: "L1", participanteId: "P1" },
      { cliente: falso.cliente },
    );
    if (!resultado.ok || !resultado.data)
      throw new Error("se esperaba un lugar");

    expect(Object.keys(resultado.data).sort()).toEqual(
      [
        "solicitudId",
        "loteId",
        "miTurno",
        "miPosicion",
        "tamanoFila",
        "estatus",
      ].sort(),
    );
    expect(JSON.stringify(resultado.data)).not.toContain("P1");
    expect(JSON.stringify(resultado.data)).not.toMatch(
      /participante|correo|nombre/i,
    );
  });

  it("motivoRechazo si viaja: es la razon del propio rechazo, no un dato de tercero (R-16)", async () => {
    const falso = crearClienteFalso({
      responder: escenario({
        centinela: { turno: 4 },
        item: solicitud({
          estatus: "RECHAZADA_POR_TESORERIA",
          motivoRechazo: "El comprobante no coincide con el monto",
        }),
        tamano: 1,
        anteriores: 0,
      }),
    });

    const resultado = await consultarMiLugar(
      { loteId: "L1", participanteId: "P1" },
      { cliente: falso.cliente },
    );
    if (!resultado.ok || !resultado.data)
      throw new Error("se esperaba un lugar");

    expect(resultado.data.motivoRechazo).toBe(
      "El comprobante no coincide con el monto",
    );
  });

  it("los agregados se piden con COUNT, no leyendo la fila", async () => {
    const falso = crearClienteFalso({
      responder: escenario({ centinela: { turno: 4 }, item: solicitud() }),
    });

    await consultarMiLugar(
      { loteId: "L1", participanteId: "P1" },
      { cliente: falso.cliente },
    );

    const consultas = falso.comandos.filter((c) => c.nombre === "QueryCommand");
    expect(consultas).toHaveLength(2);
    for (const consulta of consultas) {
      expect(consulta.input.Select).toBe("COUNT");
    }
  });
});

describe("el lugar propio", () => {
  it("miPosicion es cuantos vivos van delante, mas uno", async () => {
    const falso = crearClienteFalso({
      responder: escenario({
        centinela: { turno: 4 },
        item: solicitud(),
        tamano: 7,
        anteriores: 2,
      }),
    });

    const resultado = await consultarMiLugar(
      { loteId: "L1", participanteId: "P1" },
      { cliente: falso.cliente },
    );
    if (!resultado.ok || !resultado.data)
      throw new Error("se esperaba un lugar");

    expect(resultado.data).toEqual({
      solicitudId: "L1-4",
      loteId: "L1",
      miTurno: 4,
      miPosicion: 3,
      tamanoFila: 7,
      estatus: "EN_FILA",
    });
  });

  it("miTurno sale de la clave y no cambia aunque la fila avance", async () => {
    // El turno es el numero asignado por el contador; la posicion es lo que se
    // mueve. Se exponen los dos porque responden preguntas distintas (R-12).
    const falso = crearClienteFalso({
      responder: escenario({
        centinela: { turno: 4 },
        item: solicitud(),
        tamano: 4,
        anteriores: 0,
      }),
    });

    const resultado = await consultarMiLugar(
      { loteId: "L1", participanteId: "P1" },
      { cliente: falso.cliente },
    );
    if (!resultado.ok || !resultado.data)
      throw new Error("se esperaba un lugar");

    expect(resultado.data.miTurno).toBe(4);
    expect(resultado.data.miPosicion).toBe(1);
  });

  it("una adjudicacion lleva su plazo; una en fila no", async () => {
    const adjudicada = crearClienteFalso({
      responder: escenario({
        centinela: { turno: 4 },
        item: solicitud({
          estatus: "ADJUDICADA",
          venceEn: "2026-10-08T15:00:00.000Z",
        }),
      }),
    });

    const conPlazo = await consultarMiLugar(
      { loteId: "L1", participanteId: "P1" },
      { cliente: adjudicada.cliente },
    );
    if (!conPlazo.ok || !conPlazo.data) throw new Error("se esperaba un lugar");
    expect(conPlazo.data.venceEn).toBe("2026-10-08T15:00:00.000Z");

    const enFila = crearClienteFalso({
      responder: escenario({ centinela: { turno: 4 }, item: solicitud() }),
    });
    const sinPlazo = await consultarMiLugar(
      { loteId: "L1", participanteId: "P1" },
      { cliente: enFila.cliente },
    );
    if (!sinPlazo.ok || !sinPlazo.data) throw new Error("se esperaba un lugar");
    expect(sinPlazo.data.venceEn).toBeUndefined();
  });

  it("lee con ConsistentRead: quien acaba de formarse tiene que verse", async () => {
    const falso = crearClienteFalso({
      responder: escenario({ centinela: { turno: 4 }, item: solicitud() }),
    });

    await consultarMiLugar(
      { loteId: "L1", participanteId: "P1" },
      { cliente: falso.cliente },
    );

    for (const get of falso.comandos.filter((c) => c.nombre === "GetCommand")) {
      expect(get.input.ConsistentRead).toBe(true);
    }
  });
});

describe("quien no esta en la fila", () => {
  it("sin centinela devuelve null, que no es un error", async () => {
    const falso = crearClienteFalso({
      responder: escenario({ centinela: undefined }),
    });

    const resultado = await consultarMiLugar(
      { loteId: "L1", participanteId: "P1" },
      { cliente: falso.cliente },
    );

    expect(resultado).toEqual({ ok: true, data: null });
    // No se cuenta nada: no hay lugar del que hablar.
    expect(
      falso.comandos.filter((c) => c.nombre === "QueryCommand"),
    ).toHaveLength(0);
  });

  it("un centinela sin su solicitud tambien devuelve null", async () => {
    const falso = crearClienteFalso({
      responder: escenario({ centinela: { turno: 4 }, item: undefined }),
    });

    const resultado = await consultarMiLugar(
      { loteId: "L1", participanteId: "P1" },
      { cliente: falso.cliente },
    );

    expect(resultado).toEqual({ ok: true, data: null });
  });
});

describe("leerMiSolicitud", () => {
  it("parte del centinela indexado por el participante de la sesion", async () => {
    // Es lo que hace imposible alcanzar la solicitud de otro: la clave lleva el
    // identificador de quien pregunta, no uno que venga del cliente.
    const falso = crearClienteFalso({
      responder: escenario({ centinela: { turno: 4 }, item: solicitud() }),
    });

    await leerMiSolicitud(
      { loteId: "L1", participanteId: "P1" },
      { cliente: falso.cliente },
    );

    expect(falso.comandos[0]?.input.Key).toEqual({
      PK: "LOTE#L1",
      SK: "PART#P1",
    });
  });

  it("devuelve la solicitud completa, que es lo que la cancelacion necesita", async () => {
    const falso = crearClienteFalso({
      responder: escenario({
        centinela: { turno: 4 },
        item: solicitud({ estatus: "ADJUDICADA" }),
      }),
    });

    const resultado = await leerMiSolicitud(
      { loteId: "L1", participanteId: "P1" },
      { cliente: falso.cliente },
    );
    if (!resultado.ok || !resultado.data)
      throw new Error("se esperaba solicitud");

    expect(resultado.data).toMatchObject({
      turno: 4,
      estatus: "ADJUDICADA",
      participanteId: "P1",
    });
  });
});

describe("verificacion perezosa (D-7, camino B)", () => {
  const AHORA_TARDE = new Date("2026-10-08T16:00:00.000Z");

  const conLoteYSolicitudReleida = (opciones: {
    tamano?: number;
    anteriores?: number;
    releida?: Record<string, unknown>;
  }) => {
    let gets = 0;
    return (comando: ComandoEnviado): unknown => {
      if (comando.nombre === "GetCommand") {
        gets += 1;
        const key = comando.input.Key as { PK: string; SK: string };
        if (key.PK.startsWith("CONV#")) {
          return {
            Item: {
              loteId: "L1",
              convocatoriaId: "C1",
              vehiculoId: "V1",
              precio: 100_000,
              estatus: "ADJUDICADO",
              contadorTurnos: 4,
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
            },
          };
        }
        if (key.SK === "PART#P1") return { Item: { turno: 4 } };
        // Primera lectura de la solicitud: vencida. Segunda (tras resolver): la releida.
        return gets <= 2
          ? {
              Item: solicitud({
                estatus: "ADJUDICADA",
                venceEn: "2026-10-08T15:00:00.000Z",
                convocatoriaId: "C1",
              }),
            }
          : { Item: opciones.releida ?? solicitud() };
      }
      const valores = comando.input.ExpressionAttributeValues as Record<
        string,
        string
      >;
      return valores[":hasta"] === "SOL#9999999999"
        ? { Count: opciones.tamano ?? 0 }
        : { Count: opciones.anteriores ?? 0 };
    };
  };

  it("resuelve T5 antes de responder cuando la adjudicacion propia ya vencio", async () => {
    vencer.mockResolvedValue({
      estado: "reasignado",
      turno: 5,
      solicitudId: "L1-5",
      participanteId: "P5",
      venceEn: "x",
    });
    const falso = crearClienteFalso({
      responder: conLoteYSolicitudReleida({
        releida: solicitud({ estatus: "CANCELADA_POR_VENCIMIENTO" }),
      }),
    });

    const resultado = await consultarMiLugar(
      { loteId: "L1", participanteId: "P1" },
      { cliente: falso.cliente, ahora: () => AHORA_TARDE },
    );

    expect(vencer).toHaveBeenCalledWith(
      expect.objectContaining({ detectadoPor: "VERIFICACION_PEREZOSA" }),
      expect.anything(),
    );
    if (!resultado.ok || !resultado.data)
      throw new Error("se esperaba un lugar");
    // El DTO refleja el estado **post-resolucion**, no el que se leyo primero.
    expect(resultado.data.estatus).toBe("CANCELADA_POR_VENCIMIENTO");
  });

  it("no llama a T5 si la adjudicacion todavia esta en plazo", async () => {
    const falso = crearClienteFalso({
      responder: escenario({
        centinela: { turno: 4 },
        item: solicitud({
          estatus: "ADJUDICADA",
          venceEn: "2026-10-08T15:00:00.000Z",
        }),
      }),
    });

    await consultarMiLugar(
      { loteId: "L1", participanteId: "P1" },
      {
        cliente: falso.cliente,
        ahora: () => new Date("2026-10-08T14:00:00.000Z"),
      },
    );

    expect(vencer).not.toHaveBeenCalled();
  });

  it("si T5 se abstiene, muestra la solicitud tal como se leyo, sin fallar", async () => {
    vencer.mockResolvedValue({ estado: "abstenido", reservasVigentes: 1 });
    const falso = crearClienteFalso({
      responder: conLoteYSolicitudReleida({}),
    });

    const resultado = await consultarMiLugar(
      { loteId: "L1", participanteId: "P1" },
      { cliente: falso.cliente, ahora: () => AHORA_TARDE },
    );

    if (!resultado.ok || !resultado.data)
      throw new Error("se esperaba un lugar");
    expect(resultado.data.estatus).toBe("ADJUDICADA");
  });
});
