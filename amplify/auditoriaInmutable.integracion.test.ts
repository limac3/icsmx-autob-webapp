// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Prueba de integracion contra AWS real (Etapa 3).
 *
 * Comprueba lo que la prueba de sintesis no puede: que IAM **rechaza de verdad** modificar o
 * borrar un item `AUDIT#`, y que escribirlo si funciona. La diferencia importa — una
 * politica puede estar en la plantilla y aun asi no surtir efecto por una condicion mal
 * escrita.
 *
 * Se ejecuta contra el sandbox personal. **Se omite** —no falla— cuando no hay
 * `amplify_outputs.json` o no hay credenciales: la compuerta de calidad tiene que poder
 * correr en una maquina sin AWS, y una prueba que falla por falta de infraestructura deja
 * de distinguir "roto" de "no desplegado".
 *
 *   npx ampx sandbox        # en otra terminal
 *   npx vitest run amplify/auditoriaInmutable.integracion.test.ts
 */

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type SalidasAutob = { tabla?: string; rolComputoSsr?: string };

const RUTA_SALIDAS = join(process.cwd(), "amplify_outputs.json");

const leerSalidas = (): SalidasAutob | null => {
  if (!existsSync(RUTA_SALIDAS)) return null;
  const salidas = JSON.parse(readFileSync(RUTA_SALIDAS, "utf8")) as {
    custom?: { autob?: SalidasAutob };
  };
  return salidas.custom?.autob ?? null;
};

const salidas = leerSalidas();
const hayBackend = Boolean(salidas?.tabla && salidas?.rolComputoSsr);

// `describe.skipIf` mantiene visible en el reporte que la prueba existe y por que no corrio.
describe.skipIf(!hayBackend)(
  "la bitacora es inmutable para el rol de la aplicacion",
  () => {
    const claveEvento = {
      PK: { S: `AUDIT#prueba#${Date.now()}` },
      SK: { S: `${new Date().toISOString()}#evento-de-prueba` },
    };
    const claveNegocio = {
      PK: { S: `VEH#prueba-${Date.now()}` },
      SK: { S: "META" },
    };

    let dynamo: DynamoDBClient;
    let tabla: string;

    beforeAll(async () => {
      tabla = salidas!.tabla!;

      // Se asume el rol real de computo SSR, no las credenciales del desarrollador: lo que se
      // prueba es la politica que corre en produccion, no la del que ejecuta la prueba.
      const sesion = await new STSClient({}).send(
        new AssumeRoleCommand({
          RoleArn: salidas!.rolComputoSsr!,
          RoleSessionName: "prueba-inmutabilidad-bitacora",
          DurationSeconds: 900,
        }),
      );

      const credenciales = sesion.Credentials;
      if (!credenciales?.AccessKeyId || !credenciales.SecretAccessKey) {
        throw new Error(
          "STS no devolvio credenciales para el rol de computo SSR.",
        );
      }

      dynamo = new DynamoDBClient({
        credentials: {
          accessKeyId: credenciales.AccessKeyId,
          secretAccessKey: credenciales.SecretAccessKey,
          sessionToken: credenciales.SessionToken,
        },
      });
    });

    afterAll(() => {
      dynamo?.destroy();
    });

    it("escribir un evento funciona: la regla 4 depende de ello", async () => {
      await expect(
        dynamo.send(
          new PutItemCommand({
            TableName: tabla,
            Item: {
              ...claveEvento,
              actor: { S: "prueba" },
              tipo: { S: "PRUEBA_INMUTABILIDAD" },
            },
          }),
        ),
      ).resolves.toMatchObject({ $metadata: { httpStatusCode: 200 } });
    });

    it("modificarlo lo rechaza IAM, no la aplicacion", async () => {
      await expect(
        dynamo.send(
          new UpdateItemCommand({
            TableName: tabla,
            Key: claveEvento,
            UpdateExpression: "SET actor = :otro",
            ExpressionAttributeValues: { ":otro": { S: "alterado" } },
          }),
        ),
      ).rejects.toMatchObject({ name: "AccessDeniedException" });
    });

    it("borrarlo lo rechaza IAM", async () => {
      await expect(
        dynamo.send(
          new DeleteItemCommand({ TableName: tabla, Key: claveEvento }),
        ),
      ).rejects.toMatchObject({ name: "AccessDeniedException" });
    });

    it("el mismo rol si modifica y borra un item que no es de la bitacora", async () => {
      await dynamo.send(
        new PutItemCommand({
          TableName: tabla,
          Item: { ...claveNegocio, estatus: { S: "DISPONIBLE" } },
        }),
      );

      // Sin esta comprobacion, un `Deny` demasiado amplio pasaria las dos pruebas anteriores
      // y romperia la aplicacion entera sin que ninguna prueba lo notara.
      await expect(
        dynamo.send(
          new UpdateItemCommand({
            TableName: tabla,
            Key: claveNegocio,
            UpdateExpression: "SET estatus = :nuevo",
            ExpressionAttributeValues: { ":nuevo": { S: "EN_CONVOCATORIA" } },
          }),
        ),
      ).resolves.toMatchObject({ $metadata: { httpStatusCode: 200 } });

      await expect(
        dynamo.send(
          new DeleteItemCommand({ TableName: tabla, Key: claveNegocio }),
        ),
      ).resolves.toMatchObject({ $metadata: { httpStatusCode: 200 } });
    });

    it("humo: la tabla responde a un Query", async () => {
      const resultado = await dynamo.send(
        new QueryCommand({
          TableName: tabla,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": claveEvento.PK },
          ConsistentRead: true,
        }),
      );

      expect(resultado.Items).toHaveLength(1);
      expect(resultado.Items?.[0].tipo?.S).toBe("PRUEBA_INMUTABILIDAD");
    });
  },
);
