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
import { puedeUsarBackendReal } from "@/utils/backendUtilizable";

/**
 * Prueba de integracion contra AWS real (Etapa 3).
 *
 * Comprueba lo que la prueba de sintesis no puede: que IAM **rechaza de verdad** modificar o
 * borrar un item `AUDIT#`, y que escribirlo si funciona. La diferencia importa — una
 * politica puede estar en la plantilla y aun asi no surtir efecto por una condicion mal
 * escrita.
 *
 * Delimita ademas **hasta donde llega** la garantia, que es menos de lo que se afirmo al
 * cerrar la Etapa 3: `PutItem` sobre una clave existente la reemplaza, y no se puede denegar
 * porque la regla 4 lo exige. La inmutabilidad frente a errores de codigo la da la escritura
 * condicional; frente a codigo deliberadamente mal escrito, ninguna de las dos basta (R20).
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
const hayBackend = puedeUsarBackendReal(salidas);

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

    // Los dos casos siguientes delimitan la garantia real, que es mas estrecha de lo que
    // decia la documentacion hasta la Etapa 2.1: el `Deny` de IAM cierra `UpdateItem`,
    // `DeleteItem` y `BatchWriteItem`, pero **no** puede cerrar `PutItem` — la regla 4 exige
    // escribir el evento en la misma transaccion que la mutacion, asi que el permiso tiene
    // que existir. Un `Put` con la misma clave reemplaza el item completo.

    it("IAM NO impide sobrescribir un evento con Put: por eso hace falta la condicion", async () => {
      const clave = {
        PK: { S: `AUDIT#sobrescritura#${Date.now()}` },
        SK: { S: `${new Date().toISOString()}#evento` },
      };

      await dynamo.send(
        new PutItemCommand({
          TableName: tabla,
          Item: { ...clave, actor: { S: "original" } },
        }),
      );

      // Esto tiene exito. No es un defecto de la politica: es su limite, y esta aqui escrito
      // para que nadie vuelva a afirmar que IAM por si solo hace la bitacora append-only.
      await expect(
        dynamo.send(
          new PutItemCommand({
            TableName: tabla,
            Item: { ...clave, actor: { S: "suplantado" } },
          }),
        ),
      ).resolves.toMatchObject({ $metadata: { httpStatusCode: 200 } });
    });

    it("la escritura condicional si cierra la sobrescritura", async () => {
      const clave = {
        PK: { S: `AUDIT#condicional#${Date.now()}` },
        SK: { S: `${new Date().toISOString()}#evento` },
      };

      await dynamo.send(
        new PutItemCommand({
          TableName: tabla,
          Item: { ...clave, actor: { S: "original" } },
          ConditionExpression: "attribute_not_exists(PK)",
        }),
      );

      // Es el mecanismo que toda escritura de evento debe usar (seccion 6 de
      // modelo-datos-dynamodb.md). Protege contra un error de codigo; no contra codigo que
      // deliberadamente omita la condicion — para eso hace falta un sumidero fuera del
      // alcance de la aplicacion, y es el riesgo R20 que atiende la Etapa 11.
      await expect(
        dynamo.send(
          new PutItemCommand({
            TableName: tabla,
            Item: { ...clave, actor: { S: "suplantado" } },
            ConditionExpression: "attribute_not_exists(PK)",
          }),
        ),
      ).rejects.toMatchObject({ name: "ConditionalCheckFailedException" });
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
