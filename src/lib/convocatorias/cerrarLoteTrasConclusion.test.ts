// @vitest-environment node
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import type { EstatusLote, Lote } from "@/types/lote";
import {
  cerrarLoteTrasConclusion,
  soltarMarcaDeCierre,
} from "./cerrarLoteTrasConclusion";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-12-01T09:00:00.000Z");

const lote = (estatus: EstatusLote = "EN_OFERTA"): Lote => ({
  loteId: "L7",
  convocatoriaId: "C1",
  vehiculoId: "V7",
  precio: 180_000,
  estatus,
  contadorTurnos: 4,
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  // Ya concluida: es la copia que `concluirConvocatoria` puso al marcarlo.
  estatusConvocatoria: "CONCLUIDA",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
});

const deps = (falso: ClienteFalso) => ({
  cliente: falso.cliente,
  ahora: () => AHORA,
});

const itemsDe = (
  falso: ClienteFalso,
): Record<string, Record<string, unknown>>[] =>
  (falso.comandos[0]?.input.TransactItems ?? []) as Record<
    string,
    Record<string, unknown>
  >[];

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("cerrarLoteTrasConclusion — las cuatro escrituras", () => {
  it("cierra el lote, libera el centinela, devuelve el vehiculo y deja el evento", async () => {
    const falso = crearClienteFalso();

    const resultado = await cerrarLoteTrasConclusion(
      { lote: lote() },
      deps(falso),
    );

    expect(resultado).toEqual({
      ok: true,
      data: { loteId: "L7", vehiculoId: "V7" },
    });

    // Una sola transaccion: el cierre y su evento no pueden separarse (regla 4).
    expect(falso.comandos).toHaveLength(1);
    expect(falso.comandos[0]?.nombre).toBe("TransactWriteCommand");

    const items = itemsDe(falso);
    expect(items).toHaveLength(4);
    expect(items[0]?.Update?.Key).toEqual({ PK: "CONV#C1", SK: "LOTE#L7" });
    expect(items[1]?.Delete?.Key).toEqual({ PK: "VEH#V7", SK: "ACTIVO" });
    expect(items[2]?.Update?.Key).toEqual({ PK: "VEH#V7", SK: "META" });
    expect(items[3]?.Put).toBeDefined();
  });

  it("el lote queda NO_VENDIDO y sale de GSI4 en el mismo acto", async () => {
    const falso = crearClienteFalso();

    await cerrarLoteTrasConclusion({ lote: lote() }, deps(falso));

    const actualizacion = itemsDe(falso)[0]?.Update;
    expect(actualizacion?.ExpressionAttributeValues).toMatchObject({
      ":destino": "NO_VENDIDO",
      ":estatusEsperado": "EN_OFERTA",
    });
    // Resolver el lote y sacarlo del indice de trabajo pendiente son la misma
    // escritura: sin esto habria una ventana en la que el lote ya esta cerrado
    // y el barrido lo sigue viendo como pendiente.
    expect(actualizacion?.UpdateExpression).toContain(
      "REMOVE #gsi4pk, #gsi4sk",
    );
  });

  it("el vehiculo vuelve a DISPONIBLE y se reapunta su particion de GSI2", async () => {
    const falso = crearClienteFalso();

    await cerrarLoteTrasConclusion({ lote: lote() }, deps(falso));

    const vehiculo = itemsDe(falso)[2]?.Update;
    expect(vehiculo?.ExpressionAttributeValues).toMatchObject({
      ":disponible": "DISPONIBLE",
      ":estatusEsperado": "EN_CONVOCATORIA",
      ":gsi2pk": "VEH_ESTATUS#DISPONIBLE",
    });
    // Sin quitar `convocatoriaId` el vehiculo seguiria apuntando a una
    // convocatoria concluida en la que ya no participa.
    expect(vehiculo?.UpdateExpression).toContain("REMOVE #convocatoriaId");
  });

  it("escribe el evento anclado al lote, firmado por el SISTEMA", async () => {
    const falso = crearClienteFalso();

    await cerrarLoteTrasConclusion({ lote: lote() }, deps(falso));

    const evento = itemsDe(falso)[3]?.Put;
    const item = evento?.Item as Record<string, unknown>;
    expect(item.tipo).toBe("LOTE_CERRADO_TRAS_CONCLUSION");
    expect(item.actorTipo).toBe("SISTEMA");
    expect(item.loteId).toBe("L7");
    expect(item.vehiculoId).toBe("V7");
    expect(item.estadoAnterior).toBe("EN_OFERTA");
    expect(item.estadoNuevo).toBe("NO_VENDIDO");
    // Append-only (regla 5): IAM no puede impedir la sobrescritura de un `Put`.
    expect(evento?.ConditionExpression).toBe("attribute_not_exists(PK)");
  });

  it("el evento explica por que este lote se cerro solo y tarde", async () => {
    const falso = crearClienteFalso();

    await cerrarLoteTrasConclusion({ lote: lote() }, deps(falso));

    const item = itemsDe(falso)[3]?.Put?.Item as Record<string, unknown>;
    expect(item.datos).toMatchObject({
      razon: "ADJUDICACION_CAIDA_TRAS_CONCLUSION",
      vehiculoLiberado: "V7",
    });
  });
});

describe("cerrarLoteTrasConclusion — lo que no hace", () => {
  it.each(["ADJUDICADO", "VENDIDO", "NO_VENDIDO", "RETIRADO"] as const)(
    "rechaza un lote %s sin escribir nada",
    async (estatus) => {
      const falso = crearClienteFalso();

      const resultado = await cerrarLoteTrasConclusion(
        { lote: lote(estatus) },
        deps(falso),
      );

      expect(resultado).toEqual({ ok: false, error: "invalid_state" });
      expect(falso.comandos).toHaveLength(0);
    },
  );

  it("un segundo cierre del mismo lote no inventa exito", async () => {
    // Lo que ocurre de verdad si dos corridas se solapan: la condicion del
    // primer item no se cumple y DynamoDB cancela la transaccion entera. Es la
    // idempotencia del barrido, y no depende de que nadie se coordine.
    const falso = crearClienteFalso({
      lanza: new TransactionCanceledException({
        message: "cancelada",
        $metadata: {},
        CancellationReasons: [
          { Code: "ConditionalCheckFailed" },
          { Code: "None" },
          { Code: "None" },
          { Code: "None" },
        ],
      }),
    });

    const resultado = await cerrarLoteTrasConclusion(
      { lote: lote() },
      deps(falso),
    );

    // El codigo sale del `siFalla` del item que cancelo: el lote ya no estaba
    // `EN_OFERTA`.
    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
  });

  it("no libera el vehiculo si el centinela ya no esta", async () => {
    // El segundo item cancela: otra corrida ya borro el centinela. Que la
    // transaccion sea una sola es lo que impide que el vehiculo quede
    // `DISPONIBLE` con su lote todavia en oferta.
    const falso = crearClienteFalso({
      lanza: new TransactionCanceledException({
        message: "cancelada",
        $metadata: {},
        CancellationReasons: [
          { Code: "None" },
          { Code: "ConditionalCheckFailed" },
          { Code: "None" },
          { Code: "None" },
        ],
      }),
    });

    const resultado = await cerrarLoteTrasConclusion(
      { lote: lote() },
      deps(falso),
    );

    expect(resultado.ok).toBe(false);
  });
});

describe("soltarMarcaDeCierre", () => {
  it("quita solo las claves de GSI4, sin tocar el estado del lote", async () => {
    const falso = crearClienteFalso();

    const resultado = await soltarMarcaDeCierre(
      { lote: lote("VENDIDO") },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: true, data: { loteId: "L7" } });
    expect(falso.comandos).toHaveLength(1);

    const entrada = falso.comandos[0]?.input as Record<string, unknown>;
    expect(falso.comandos[0]?.nombre).toBe("UpdateCommand");
    expect(entrada.Key).toEqual({ PK: "CONV#C1", SK: "LOTE#L7" });
    expect(entrada.UpdateExpression).toBe("REMOVE #gsi4pk, #gsi4sk");
    // Ni `SET` ni nada del vehiculo: soltar la marca no es cerrar el lote.
    expect(String(entrada.UpdateExpression)).not.toContain("SET");
  });

  it("condiciona sobre el estatus leido, para no desmarcar lo que volvio a EN_OFERTA", async () => {
    const falso = crearClienteFalso();

    await soltarMarcaDeCierre({ lote: lote("VENDIDO") }, deps(falso));

    const entrada = falso.comandos[0]?.input as Record<string, unknown>;
    expect(entrada.ConditionExpression).toBe(
      "attribute_exists(SK) AND #estatus = :estatus",
    );
    expect(entrada.ExpressionAttributeValues).toEqual({
      ":estatus": "VENDIDO",
    });
  });

  it("devuelve conflicto si la condicion falla", async () => {
    const falso = crearClienteFalso({
      lanza: Object.assign(new Error("condicion"), {
        name: "ConditionalCheckFailedException",
      }),
    });

    const resultado = await soltarMarcaDeCierre(
      { lote: lote("VENDIDO") },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: false, error: "conflicto_concurrencia" });
  });
});
