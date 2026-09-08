// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActorDeEvento } from "@/types/auditoria";
import { itemsDeEncoladoAdjudicacion } from "./outbox";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-10-08T15:00:00.000Z");
const actor: ActorDeEvento = { tipo: "SISTEMA" };

const datos = {
  solicitudId: "L1-2",
  loteId: "L1",
  convocatoriaId: "C1",
  vehiculoId: "V1",
  precio: 180_000,
  venceEn: "2026-10-10T15:00:00.000Z",
};

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("itemsDeEncoladoAdjudicacion", () => {
  it("no encola nada sin destinatario (D-6: el correo no bloquea la adjudicacion)", () => {
    const items = itemsDeEncoladoAdjudicacion({
      mensajeId: "M1",
      destinatario: undefined,
      datos,
      actor,
      ahora: AHORA,
    });

    expect(items).toEqual([]);
  });

  it("encola el mensaje PENDIENTE con las claves dispersas de GSI4", () => {
    const items = itemsDeEncoladoAdjudicacion({
      mensajeId: "M1",
      destinatario: "p2@example.org",
      datos,
      actor,
      ahora: AHORA,
    });

    expect(items).toHaveLength(2);
    expect(items[0]?.item.Put).toMatchObject({
      Item: {
        PK: "OUTBOX#M1",
        SK: "META",
        tipo: "ADJUDICACION",
        destinatario: "p2@example.org",
        estatus: "PENDIENTE",
        intentos: 0,
        GSI4PK: "OUTBOX_PENDIENTE",
        GSI4SK: AHORA.toISOString(),
        datos,
      },
      ConditionExpression: "attribute_not_exists(PK)",
    });
  });

  it("escribe CORREO_ENCOLADO en la misma lista, listo para la transaccion de T2/T5", () => {
    const items = itemsDeEncoladoAdjudicacion({
      mensajeId: "M1",
      destinatario: "p2@example.org",
      datos,
      actor,
      ahora: AHORA,
      correlacionId: "CORR1",
    });

    expect(items[1]?.item.Put).toMatchObject({
      Item: {
        tipo: "CORREO_ENCOLADO",
        correlacionId: "CORR1",
        solicitudId: "L1-2",
        loteId: "L1",
        datos: { mensajeId: "M1", destinatario: "p2@example.org" },
      },
      ConditionExpression: "attribute_not_exists(PK)",
    });
  });
});
