// @vitest-environment node
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import type { ActorUsuario } from "@/types/auditoria";
import type { Solicitud } from "@/types/fila";
import { subirComprobante, __test__ } from "./subirComprobante";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-10-07T15:00:00.000Z");
const ARCHIVO_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const solicitud: Solicitud = {
  solicitudId: "L1-2",
  loteId: "L1",
  convocatoriaId: "C1",
  participanteId: "P1",
  turno: 2,
  estatus: "ADJUDICADA",
  solicitadoEn: "2026-10-06T14:00:00.000Z",
  adjudicadoEn: "2026-10-06T15:00:00.000Z",
  venceEn: "2026-10-09T15:00:00.000Z",
};

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Venta_a_empleados"],
};

const archivo = {
  bytes: new Uint8Array([1, 2, 3]),
  contentType: "image/jpeg" as const,
};

const escenario = () => {
  const dynamo = crearClienteFalso();
  const s3 = crearClienteFalso<S3Client>();
  return {
    dynamo,
    s3,
    deps: {
      cliente: dynamo.cliente,
      s3: s3.cliente,
      ahora: () => AHORA,
      nuevoId: () => ARCHIVO_ID,
    },
  };
};

const itemsDe = (falso: ClienteFalso) =>
  falso.comandos.find((c) => c.nombre === "TransactWriteCommand")?.input
    .TransactItems as Record<string, Record<string, unknown>>[];

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
  vi.stubEnv("AUTOB_MEDIA_BUCKET", "bucket-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validacion de archivo", () => {
  it.each(["text/html", "image/gif", ""])(
    "rechaza el tipo %j",
    async (tipo) => {
      const { dynamo, s3, deps } = escenario();
      const resultado = await subirComprobante(
        { solicitud, archivo: { ...archivo, contentType: tipo }, actor },
        deps,
      );
      expect(resultado).toEqual({
        ok: false,
        error: "validation_failed",
        detalles: { archivo: "tipo_no_admitido" },
      });
      expect(dynamo.comandos).toHaveLength(0);
      expect(s3.comandos).toHaveLength(0);
    },
  );

  it("acepta un PDF, a diferencia de las fotografias de vehiculo", async () => {
    const { deps, s3 } = escenario();
    const resultado = await subirComprobante(
      {
        solicitud,
        archivo: { bytes: new Uint8Array([1]), contentType: "application/pdf" },
        actor,
      },
      deps,
    );
    expect(resultado.ok).toBe(true);
    expect(s3.comandos[0]?.input).toMatchObject({
      Key: "comprobantes/L1-2/01ARZ3NDEKTSV4RRFFQ69G5FAV.pdf",
    });
  });

  it("rechaza un archivo vacio", async () => {
    const { deps } = escenario();
    const resultado = await subirComprobante(
      {
        solicitud,
        archivo: { bytes: new Uint8Array([]), contentType: "image/jpeg" },
        actor,
      },
      deps,
    );
    expect(resultado).toEqual({
      ok: false,
      error: "validation_failed",
      detalles: { archivo: "vacio" },
    });
  });

  it("rechaza un archivo mayor a 10 MB", async () => {
    const { deps } = escenario();
    const resultado = await subirComprobante(
      {
        solicitud,
        archivo: {
          bytes: new Uint8Array(10 * 1024 * 1024 + 1),
          contentType: "image/jpeg",
        },
        actor,
      },
      deps,
    );
    expect(resultado).toEqual({
      ok: false,
      error: "validation_failed",
      detalles: { archivo: "muy_grande" },
    });
  });
});

describe("T3 — subir comprobante", () => {
  it("sube a S3 antes que la transaccion de DynamoDB", async () => {
    const { dynamo, s3, deps } = escenario();

    const resultado = await subirComprobante(
      { solicitud, archivo, actor },
      deps,
    );

    expect(resultado).toEqual({
      ok: true,
      data: { estatus: "EN_VERIFICACION" },
    });
    expect(s3.comandos[0]?.nombre).toBe("PutObjectCommand");

    // El orden es la garantia de la regla 15: dejar una referencia en
    // DynamoDB antes de que el archivo exista mostraria un enlace roto.
    const s3Send = (
      s3.cliente as unknown as {
        send: { mock: { invocationCallOrder: number[] } };
      }
    ).send;
    const dynamoSend = (
      dynamo.cliente as unknown as {
        send: { mock: { invocationCallOrder: number[] } };
      }
    ).send;
    expect(s3Send.mock.invocationCallOrder[0]).toBeLessThan(
      dynamoSend.mock.invocationCallOrder[0]!,
    );
    expect(s3.comandos[0]?.input).toMatchObject({
      Bucket: "bucket-de-prueba",
      Key: "comprobantes/L1-2/01ARZ3NDEKTSV4RRFFQ69G5FAV.jpg",
      ContentType: "image/jpeg",
    });

    const items = itemsDe(dynamo);
    expect(items[0]?.Update).toMatchObject({
      Key: { PK: "LOTE#L1", SK: "SOL#0000000002" },
      ConditionExpression: "#estatus = :adjudicada AND venceEn > :ahora",
    });
    const expresion = String(items[0]?.Update?.UpdateExpression);
    expect(expresion).toContain("comprobanteClaveS3 = :claveS3");
    expect(expresion).toContain("REMOVE GSI4PK, GSI4SK");
    expect(items[0]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":claveS3": "comprobantes/L1-2/01ARZ3NDEKTSV4RRFFQ69G5FAV.jpg",
      ":gsi2pk": "SOL_ESTATUS#EN_VERIFICACION",
    });

    const evento = items[1]?.Put?.Item as Record<string, unknown>;
    expect(evento).toMatchObject({
      tipo: "COMPROBANTE_CARGADO",
      solicitudId: "L1-2",
    });
  });

  it("no compensa subiendo a S3 si la transaccion falla: el comprobante es evidencia", async () => {
    const dynamo = crearClienteFalso({
      lanza: new TransactionCanceledException({
        message: "cancelada",
        $metadata: {},
        CancellationReasons: [
          { Code: "ConditionalCheckFailed" },
          { Code: "None" },
        ],
      }),
    });
    const s3 = crearClienteFalso<S3Client>();

    const resultado = await subirComprobante(
      { solicitud, archivo, actor },
      {
        cliente: dynamo.cliente,
        s3: s3.cliente,
        ahora: () => AHORA,
        nuevoId: () => ARCHIVO_ID,
      },
    );

    expect(resultado.ok).toBe(false);
    // Un solo comando en S3: el Put de subida. Ningun DeleteObjectCommand —la
    // politica IAM lo niega de todos modos (amplify/permisos.ts)— y por tanto
    // ningun intento de compensacion, a diferencia de `agregarFotografia`.
    expect(s3.comandos.map((c) => c.nombre)).toEqual(["PutObjectCommand"]);
  });
});

describe("motivoDelRechazo — diagnostico sin releer", () => {
  it("invalid_state si ya no esta ADJUDICADA", () => {
    expect(
      __test__.motivoDelRechazo(
        { ...solicitud, estatus: "EN_VERIFICACION" },
        AHORA,
      ),
    ).toBe("invalid_state");
  });

  it("plazo_vencido si el plazo ya paso", () => {
    expect(
      __test__.motivoDelRechazo(
        { ...solicitud, venceEn: "2026-10-06T00:00:00.000Z" },
        AHORA,
      ),
    ).toBe("plazo_vencido");
  });

  it("plazo_vencido si no hay venceEn (dato inconsistente)", () => {
    expect(
      __test__.motivoDelRechazo({ ...solicitud, venceEn: undefined }, AHORA),
    ).toBe("plazo_vencido");
  });

  it("conflicto_concurrencia si estado y plazo lucen correctos", () => {
    // La unica explicacion que queda es que alguien mas escribio entre la
    // lectura y el intento.
    expect(__test__.motivoDelRechazo(solicitud, AHORA)).toBe(
      "conflicto_concurrencia",
    );
  });
});
