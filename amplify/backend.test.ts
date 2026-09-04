// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Sintetiza `backend.ts` completo.
 *
 * `infraestructura.test.ts` prueba cada constructo por separado; esta prueba cubre lo otro:
 * que el cableado entre ellos funcione —la pila, la deteccion de sandbox, los permisos de la
 * funcion de barrido, las salidas—. Es la unica verificacion de `backend.ts` disponible sin
 * credenciales de AWS, porque `ampx` no tiene un modo que solo sintetice.
 */

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const temporal = mkdtempSync(join(tmpdir(), "autob-backend-"));

afterAll(() => {
  rmSync(temporal, { recursive: true, force: true });
});

const construirBackend = async (tipoDespliegue: "sandbox" | "branch") => {
  // La llave publica se genera al vuelo en un directorio temporal: la prueba no depende de
  // que alguien haya corrido `openssl`, y no se versiona nada.
  const rutaLlave = join(temporal, `cloudfront-${tipoDespliegue}.pem`);
  writeFileSync(
    rutaLlave,
    generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    }).publicKey,
  );

  vi.stubEnv("CLOUDFRONT_PUBLIC_KEY_PATH", rutaLlave);
  vi.stubEnv("SES_IDENTIDAD", "no-reply@ejemplo.org");
  vi.stubEnv("AWS_REGION", "us-east-1");
  vi.stubEnv("CDK_DEFAULT_ACCOUNT", "111111111111");
  vi.stubEnv("CDK_DEFAULT_REGION", "us-east-1");
  vi.stubEnv(
    "CDK_CONTEXT_JSON",
    JSON.stringify({
      "amplify-backend-namespace": "autob",
      "amplify-backend-name": "prueba",
      "amplify-backend-type": tipoDespliegue,
    }),
  );

  // `resetModules` obliga a reevaluar `backend.ts`: define una `App` de CDK al importarse,
  // asi que dos variantes en el mismo proceso necesitan instancias distintas.
  vi.resetModules();
  return import("./backend");
};

// Sintetizar cuesta ~10 s porque empaqueta el Lambda del barrido. Se hace una sola vez.
let sandbox: Awaited<ReturnType<typeof construirBackend>>;

beforeAll(async () => {
  sandbox = await construirBackend("sandbox");
});

describe("backend.ts", () => {
  it("sintetiza la pila completa con la tabla, el bucket, CloudFront y el correo", () => {
    const plantilla = Template.fromStack(sandbox.pila);

    plantilla.resourceCountIs("AWS::DynamoDB::GlobalTable", 1);
    plantilla.resourceCountIs("AWS::S3::Bucket", 1);
    plantilla.resourceCountIs("AWS::CloudFront::Distribution", 1);
    plantilla.resourceCountIs("AWS::SES::EmailIdentity", 1);
    plantilla.resourceCountIs("AWS::SES::Template", 1);

    // Contar roles seria fragil —en sandbox el bucket agrega el suyo para autoborrarse—, asi
    // que se afirma lo que importa: hay exactamente un rol que Amplify Hosting puede asumir.
    const asumiblesPorAmplify = Object.values(
      plantilla.findResources("AWS::IAM::Role"),
    ).filter((rol) =>
      JSON.stringify(rol.Properties.AssumeRolePolicyDocument).includes(
        "amplify.amazonaws.com",
      ),
    );
    expect(asumiblesPorAmplify).toHaveLength(1);
  });

  it("el barrido hereda los mismos Deny que la aplicacion", () => {
    const funcion = sandbox.backend.barrido.resources.lambda;
    expect(funcion.role).toBeDefined();

    // El barrido vive en otra pila (la de funciones de Amplify). Que su politica lleve el
    // mismo `Deny` es lo que impide que la bitacora sea alterable por el camino de atras:
    // la funcion programada tiene tanto acceso a la tabla como la aplicacion.
    const plantillaFunciones = Template.fromStack(Stack.of(funcion));
    const sids = Object.values(
      plantillaFunciones.findResources("AWS::IAM::Policy"),
    ).flatMap((politica) =>
      (
        politica.Properties.PolicyDocument.Statement as Array<{ Sid?: string }>
      ).map((declaracion) => declaracion.Sid),
    );

    expect(sids).toContain("NegarMutacionDeBitacora");
    expect(sids).toContain("NegarPartiQLMutante");
    expect(sids).toContain("NegarBorradoDeComprobantes");
  });

  it("el barrido recibe el nombre de la tabla por variable de entorno", () => {
    const plantilla = Template.fromStack(
      Stack.of(sandbox.backend.barrido.resources.lambda),
    );

    plantilla.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Environment: Match.objectLike({
          Variables: Match.objectLike({ AUTOB_TABLE_NAME: Match.anyValue() }),
        }),
      }),
    );
  });

  it("falta SES_IDENTIDAD y falla con un mensaje que dice como arreglarlo", async () => {
    vi.stubEnv("SES_IDENTIDAD", "");
    vi.stubEnv(
      "CLOUDFRONT_PUBLIC_KEY_PATH",
      join(temporal, "cloudfront-sandbox.pem"),
    );
    vi.resetModules();

    // Sin fallback silencioso (regla 15): un backend sin identidad de correo no se despliega
    // a medias, falla al sintetizar.
    await expect(import("./backend")).rejects.toThrow(/SES_IDENTIDAD/);
  });

  it("falta la llave publica y falla antes de crear una distribucion sin firma", async () => {
    vi.stubEnv("SES_IDENTIDAD", "no-reply@ejemplo.org");
    vi.stubEnv("CLOUDFRONT_PUBLIC_KEY_PATH", join(temporal, "no-existe.pem"));
    vi.resetModules();

    await expect(import("./backend")).rejects.toThrow(
      /llave publica de CloudFront/,
    );
  });
});
