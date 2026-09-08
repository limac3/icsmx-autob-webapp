// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import { consultarMiLugar, leerMiSolicitud } from "./consultarMiLugar";

vi.mock("server-only", () => ({}));

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
