// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import type { ActorUsuario } from "@/types/auditoria";
import type { ConvocatoriaConLotes } from "@/types/convocatoria";
import type { EstatusLote, Lote } from "@/types/lote";
import { concluirConvocatoria } from "./concluirConvocatoria";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-11-01T18:30:00.000Z");

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Administrar_Convocatorias"],
};

const lote = (loteId: string, estatus: EstatusLote = "EN_OFERTA"): Lote => ({
  loteId,
  convocatoriaId: "C1",
  vehiculoId: `V-${loteId}`,
  precio: 180_000,
  estatus,
  contadorTurnos: 0,
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
});

const publicada: ConvocatoriaConLotes = {
  folio: "CONV-001",
  nombre: "Venta de octubre",
  convocatoriaId: "C1",
  tipo: "EMPLEADOS",
  descripcionParticipacion: "Abierta al personal.",
  publicadaEn: "2026-10-01T15:00:00.000Z",
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  estatus: "PUBLICADA",
  creadoEn: "2026-09-01T10:00:00.000Z",
  creadoPor: "P9",
  lotes: [lote("L1"), lote("L2")],
};

const deps = (falso: ClienteFalso) => ({
  cliente: falso.cliente,
  ahora: () => AHORA,
});

/**
 * Items de la n-esima **transaccion**, contando solo transacciones.
 *
 * Desde la Etapa 8 el cierre intercala una `Query` por lote para leer su fila
 * (R-18), asi que la posicion absoluta del comando ya no coincide con la de la
 * escritura que interesa.
 */
const itemsDe = (
  falso: ClienteFalso,
  posicion: number,
): Record<string, Record<string, unknown>>[] =>
  (transaccionesDe(falso)[posicion] ?? []) as Record<
    string,
    Record<string, unknown>
  >[];

const transaccionesDe = (falso: ClienteFalso) =>
  falso.comandos
    .filter((comando) => comando.nombre === "TransactWriteCommand")
    .map(
      (comando) =>
        comando.input.TransactItems as Record<
          string,
          Record<string, unknown>
        >[],
    );

/**
 * La transaccion que marca la convocatoria. Se identifica por su clave
 * completa: el cierre de un lote tambien actualiza un item con `SK = META`, el
 * del vehiculo.
 */
const transaccionDeLaConvocatoria = (falso: ClienteFalso) =>
  transaccionesDe(falso).find((items) =>
    items.some((item) => {
      const clave = item.Update?.Key as Record<string, string> | undefined;
      return clave?.SK === "META" && clave.PK.startsWith("CONV#");
    }),
  ) ?? [];

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("guarda de conclusion", () => {
  it("deniega si no se confirma ninguna de las dos condiciones", async () => {
    // Cerrado por omision: hace falta que **una** este en `true`. Un
    // `undefined` no confirma nada, y concluir antes de tiempo cerraria filas
    // vivas.
    const falso = crearClienteFalso();
    const resultado = await concluirConvocatoria(
      { actual: publicada, actor },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(falso.comandos).toHaveLength(0);
  });

  it("basta con que la venta haya finalizado", async () => {
    const falso = crearClienteFalso();
    const resultado = await concluirConvocatoria(
      { actual: publicada, ventaFinalizada: true, actor },
      deps(falso),
    );

    expect(resultado.ok).toBe(true);
  });

  it("basta con que no queden solicitudes vivas", async () => {
    const falso = crearClienteFalso();
    const resultado = await concluirConvocatoria(
      { actual: publicada, sinSolicitudesVivas: true, actor },
      deps(falso),
    );

    expect(resultado.ok).toBe(true);
  });
});

describe("cierre de los lotes", () => {
  it("cierra los lotes antes de marcar la convocatoria", async () => {
    // El `estatusConvocatoria` del lote es una copia: marcar la convocatoria
    // primero dejaria lotes cuya copia sigue diciendo PUBLICADA y que el paso 1
    // de T1 aceptaria comprar, bajo una convocatoria ya concluida.
    const falso = crearClienteFalso();
    await concluirConvocatoria(
      { actual: publicada, ventaFinalizada: true, actor },
      deps(falso),
    );

    const transacciones = transaccionesDe(falso);
    expect(transacciones).toHaveLength(2);

    const primero = itemsDe(falso, 0)[0]?.Update as Record<string, unknown>;
    expect(primero.Key).toEqual({ PK: "CONV#C1", SK: "LOTE#L1" });

    const ultimo = itemsDe(falso, 1)[0]?.Update as Record<string, unknown>;
    expect(ultimo.Key).toEqual({ PK: "CONV#C1", SK: "META" });
  });

  it("lee las filas despues de cerrar los lotes y antes de marcar (R-18)", async () => {
    // El orden es la garantia: un lote ya cerrado no admite solicitudes nuevas
    // —el paso 1 de T1 exige EN_OFERTA o ADJUDICADO—, asi que la fila que se
    // cierra a continuacion es la definitiva. Al reves quedaria una ventana en
    // la que alguien se forma en una fila recien cerrada.
    const falso = crearClienteFalso();
    await concluirConvocatoria(
      { actual: publicada, ventaFinalizada: true, actor },
      deps(falso),
    );

    const nombres = falso.comandos.map((comando) => comando.nombre);
    expect(nombres).toEqual([
      "TransactWriteCommand", // los lotes sin vender
      "QueryCommand", // la fila de L1
      "QueryCommand", // la fila de L2
      "TransactWriteCommand", // la convocatoria
    ]);
  });

  it("recorre todos los lotes, no solo los que cierra", async () => {
    // Detras de un lote ADJUDICADO —o de uno VENDIDO— puede quedar gente
    // formada, y esa fila tampoco va a avanzar ya.
    const falso = crearClienteFalso();
    await concluirConvocatoria(
      {
        actual: {
          ...publicada,
          lotes: [lote("L1"), lote("L2", "VENDIDO"), lote("L3", "ADJUDICADO")],
        },
        ventaFinalizada: true,
        actor,
      },
      deps(falso),
    );

    const consultas = falso.comandos.filter(
      (comando) => comando.nombre === "QueryCommand",
    );
    expect(consultas).toHaveLength(3);
  });

  it("cada lote cuesta tres escrituras y ninguna es un evento", async () => {
    // `trazabilidad-auditoria.md` dice que CONVOCATORIA_CONCLUIDA lleva el
    // resumen; un evento por lote repetiria N veces el mismo hecho.
    const falso = crearClienteFalso();
    await concluirConvocatoria(
      { actual: publicada, ventaFinalizada: true, actor },
      deps(falso),
    );

    expect(itemsDe(falso, 0)).toHaveLength(6);
  });

  it("libera el centinela y devuelve el vehiculo a DISPONIBLE (R-11)", async () => {
    const falso = crearClienteFalso();
    await concluirConvocatoria(
      { actual: publicada, ventaFinalizada: true, actor },
      deps(falso),
    );

    const items = itemsDe(falso, 0);

    const centinela = items[1]?.Delete as Record<string, unknown>;
    expect(centinela.Key).toEqual({ PK: "VEH#V-L1", SK: "ACTIVO" });

    const vehiculo = items[2]?.Update as Record<string, unknown>;
    expect(vehiculo.Key).toEqual({ PK: "VEH#V-L1", SK: "META" });
    const valores = vehiculo.ExpressionAttributeValues as Record<
      string,
      unknown
    >;
    expect(valores[":disponible"]).toBe("DISPONIBLE");
    expect(valores[":estatusEsperado"]).toBe("EN_CONVOCATORIA");
    expect(valores[":gsi2pk"]).toBe("VEH_ESTATUS#DISPONIBLE");
  });

  it("no toca los lotes vendidos ni adjudicados", async () => {
    // Un lote ADJUDICADO sobrevive a la conclusion con su plazo intacto
    // (R-18): quien gano antes del cierre tiene derecho a terminar de pagar, y
    // su vehiculo sigue comprometido, asi que su centinela no se libera.
    const falso = crearClienteFalso();
    await concluirConvocatoria(
      {
        actual: {
          ...publicada,
          lotes: [lote("L1"), lote("L2", "VENDIDO"), lote("L3", "ADJUDICADO")],
        },
        ventaFinalizada: true,
        actor,
      },
      deps(falso),
    );

    const items = itemsDe(falso, 0);
    expect(items).toHaveLength(3);

    const claves = JSON.stringify(items);
    expect(claves).toContain("LOTE#L1");
    expect(claves).not.toContain("LOTE#L2");
    expect(claves).not.toContain("LOTE#L3");
    expect(claves).not.toContain("VEH#V-L3");
  });

  it("cuenta vendidos y no vendidos en el resultado y en el evento", async () => {
    const falso = crearClienteFalso();
    const resultado = await concluirConvocatoria(
      {
        actual: {
          ...publicada,
          lotes: [lote("L1"), lote("L2", "VENDIDO"), lote("L3", "VENDIDO")],
        },
        ventaFinalizada: true,
        actor,
      },
      deps(falso),
    );

    expect(resultado).toEqual({
      ok: true,
      data: {
        estatus: "CONCLUIDA",
        vendidos: 2,
        noVendidos: 1,
        filasCerradas: 0,
        comprometidos: 0,
      },
    });

    const evento = transaccionDeLaConvocatoria(falso)[1]?.Put as Record<
      string,
      unknown
    >;
    const item = evento.Item as Record<string, unknown>;
    expect(item.tipo).toBe("CONVOCATORIA_CONCLUIDA");
    expect(item.datos).toEqual({
      vendidos: 2,
      noVendidos: 1,
      filasCerradas: 0,
      comprometidos: 0,
    });
  });

  it("una convocatoria sin lotes en oferta solo escribe la convocatoria", async () => {
    const falso = crearClienteFalso();
    const resultado = await concluirConvocatoria(
      {
        actual: { ...publicada, lotes: [lote("L1", "VENDIDO")] },
        ventaFinalizada: true,
        actor,
      },
      deps(falso),
    );

    expect(resultado.ok).toBe(true);
    // Una sola escritura —la convocatoria—, mas la lectura de la fila de ese
    // lote: puede haber gente formada detras de un lote ya vendido.
    expect(transaccionesDe(falso)).toHaveLength(1);
    expect(
      falso.comandos.filter((comando) => comando.nombre === "QueryCommand"),
    ).toHaveLength(1);
  });

  it("cierra las filas vivas y lo cuenta en el evento (R-18)", async () => {
    // Sin esto, concluir deja participantes formados en una fila que ya no va
    // a avanzar, sin que nada se lo diga.
    const enFila = {
      PK: "LOTE#L1",
      SK: "SOL#0000000001",
      solicitudId: "L1-1",
      loteId: "L1",
      participanteId: "P7",
      turno: 1,
      estatus: "EN_FILA",
      solicitadoEn: "2026-10-06T15:00:00.000Z",
    };
    const falso = crearClienteFalso({
      responder: (comando) =>
        comando.nombre === "QueryCommand" &&
        (comando.input.ExpressionAttributeValues as Record<string, string>)[
          ":pk"
        ] === "LOTE#L1"
          ? { Items: [enFila] }
          : {},
    });

    const resultado = await concluirConvocatoria(
      {
        actual: { ...publicada, lotes: [lote("L1")] },
        ventaFinalizada: true,
        actor,
      },
      deps(falso),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.filasCerradas).toBe(1);

    const cierre = transaccionesDe(falso)[1]!;
    expect(cierre[0]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":destino": "NO_ADJUDICADA",
    });
    expect(cierre[1]?.Delete?.Key).toEqual({ PK: "LOTE#L1", SK: "PART#P7" });
    expect(cierre[2]?.Put?.Item).toMatchObject({
      tipo: "SOLICITUD_NO_ADJUDICADA",
    });

    const evento = transaccionDeLaConvocatoria(falso)[1]?.Put as Record<
      string,
      unknown
    >;
    expect((evento.Item as Record<string, unknown>).datos).toMatchObject({
      filasCerradas: 1,
    });
  });

  it("no marca la convocatoria si el cierre de filas falla", async () => {
    // Mismo criterio que con los lotes: el estado a medias es seguro —lotes
    // cerrados bajo una convocatoria todavia publicada— y repetir la operacion
    // reanuda desde donde quedo.
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "QueryCommand") {
          return {
            Items: [
              {
                PK: "LOTE#L1",
                SK: "SOL#0000000001",
                solicitudId: "L1-1",
                loteId: "L1",
                participanteId: "P7",
                turno: 1,
                estatus: "EN_FILA",
                solicitadoEn: "2026-10-06T15:00:00.000Z",
              },
            ],
          };
        }
        // La primera transaccion (los lotes) pasa; la del cierre de fila falla.
        const items = comando.input.TransactItems as unknown[];
        if (items.length === 3) throw new Error("red caida");
        return {};
      },
    });

    const resultado = await concluirConvocatoria(
      {
        actual: { ...publicada, lotes: [lote("L1")] },
        ventaFinalizada: true,
        actor,
      },
      deps(falso),
    );

    expect(resultado.ok).toBe(false);
    expect(transaccionDeLaConvocatoria(falso)).toEqual([]);
  });

  it("no marca la convocatoria si el cierre de lotes falla", async () => {
    // El estado a medias son lotes ya cerrados bajo una convocatoria todavia
    // publicada: no comprables, que es el lado seguro. Marcarla igual dejaria
    // lotes comprables bajo una convocatoria concluida.
    const falso = crearClienteFalso({ lanza: new Error("red caida") });
    const resultado = await concluirConvocatoria(
      { actual: publicada, ventaFinalizada: true, actor },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: false, error: "conflicto_concurrencia" });
    expect(falso.comandos).toHaveLength(1);
  });
});

describe("lotes que sobreviven a la conclusion (R-11b)", () => {
  /** La transaccion que marca lotes comprometidos: un solo `Update` con GSI4. */
  const transaccionDeMarcas = (falso: ClienteFalso) =>
    transaccionesDe(falso).find((items) =>
      items.some(
        (item) =>
          (item.Update?.ExpressionAttributeValues as Record<string, string>)?.[
            ":gsi4pk"
          ] === "CIERRE_PENDIENTE",
      ),
    ) ?? [];

  it("un lote ADJUDICADO no se cierra ni pierde su centinela", async () => {
    const falso = crearClienteFalso();

    await concluirConvocatoria(
      {
        actual: { ...publicada, lotes: [lote("L1", "ADJUDICADO")] },
        ventaFinalizada: true,
        actor,
      },
      deps(falso),
    );

    // R-18: quien gano antes del cierre tiene derecho a terminar de pagar, y su
    // vehiculo sigue comprometido mientras tanto.
    const borrados = transaccionesDe(falso)
      .flat()
      .filter((item) => item.Delete !== undefined);
    expect(borrados).toHaveLength(0);
  });

  it("lo inscribe en GSI4 como trabajo pendiente", async () => {
    const falso = crearClienteFalso();

    const resultado = await concluirConvocatoria(
      {
        actual: { ...publicada, lotes: [lote("L1", "ADJUDICADO")] },
        ventaFinalizada: true,
        actor,
      },
      deps(falso),
    );

    const marcas = transaccionDeMarcas(falso);
    expect(marcas).toHaveLength(1);
    expect(marcas[0]?.Update?.Key).toEqual({ PK: "CONV#C1", SK: "LOTE#L1" });
    expect(marcas[0]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":gsi4pk": "CIERRE_PENDIENTE",
      ":gsi4sk": "C1#L1",
      ":estatusEsperado": "ADJUDICADO",
    });
    expect(resultado.ok && resultado.data.comprometidos).toBe(1);
  });

  it("le pone al dia el estatusConvocatoria desnormalizado", async () => {
    const falso = crearClienteFalso();

    await concluirConvocatoria(
      {
        actual: { ...publicada, lotes: [lote("L1", "ADJUDICADO")] },
        ventaFinalizada: true,
        actor,
      },
      deps(falso),
    );

    // Sin esto la copia del lote seguiria diciendo `PUBLICADA` para siempre, y
    // en cuanto el lote volviera a `EN_OFERTA` la condicion del paso 1 de T1 lo
    // daria por comprable bajo una convocatoria ya cerrada.
    expect(
      transaccionDeMarcas(falso)[0]?.Update?.ExpressionAttributeValues,
    ).toMatchObject({ ":concluida": "CONCLUIDA" });
  });

  it("marca despues de cerrar los no vendidos", async () => {
    const falso = crearClienteFalso();

    await concluirConvocatoria(
      {
        actual: {
          ...publicada,
          lotes: [lote("L1"), lote("L2", "ADJUDICADO")],
        },
        ventaFinalizada: true,
        actor,
      },
      deps(falso),
    );

    const transacciones = transaccionesDe(falso);
    const cierre = transacciones.findIndex((items) =>
      items.some((item) => item.Delete !== undefined),
    );
    const marca = transacciones.findIndex((items) =>
      items.some(
        (item) =>
          (item.Update?.ExpressionAttributeValues as Record<string, string>)?.[
            ":gsi4pk"
          ] === "CIERRE_PENDIENTE",
      ),
    );

    // El mismo orden que sostiene el resto de la conclusion: una interrupcion
    // deja lotes cerrados o marcados bajo una convocatoria todavia publicada
    // —el lado seguro—, nunca la convocatoria cerrada con lotes sueltos.
    expect(cierre).toBeGreaterThanOrEqual(0);
    expect(marca).toBeGreaterThan(cierre);
  });

  it("una convocatoria sin lotes comprometidos no escribe ninguna marca", async () => {
    const falso = crearClienteFalso();

    const resultado = await concluirConvocatoria(
      {
        actual: { ...publicada, lotes: [lote("L1"), lote("L2", "VENDIDO")] },
        ventaFinalizada: true,
        actor,
      },
      deps(falso),
    );

    expect(transaccionDeMarcas(falso)).toHaveLength(0);
    expect(resultado.ok && resultado.data.comprometidos).toBe(0);
  });

  it("el resumen del evento distingue no vendidos de comprometidos", async () => {
    const falso = crearClienteFalso();

    await concluirConvocatoria(
      {
        actual: {
          ...publicada,
          lotes: [
            lote("L1"),
            lote("L2", "VENDIDO"),
            lote("L3", "ADJUDICADO"),
            lote("L4", "ADJUDICADO"),
          ],
        },
        ventaFinalizada: true,
        actor,
      },
      deps(falso),
    );

    const item = transaccionDeLaConvocatoria(falso)[1]?.Put?.Item as Record<
      string,
      unknown
    >;
    expect(item.datos).toMatchObject({
      vendidos: 1,
      noVendidos: 1,
      comprometidos: 2,
    });
  });
});
