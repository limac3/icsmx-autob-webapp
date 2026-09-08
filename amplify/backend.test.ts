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

const construirBackend = async (
  tipoDespliegue: "sandbox" | "branch",
  /**
   * Se fija siempre, aunque sea vacia. `backend.ts` carga `.env.local` cuando
   * existe, asi que dejarla sin declarar haria que la prueba dependiera de la
   * maquina: quien tuviera `ALARMAS_CORREO` en su archivo veria fallar la
   * afirmacion de "sin suscripcion". `process.loadEnvFile` no sobrescribe lo
   * que ya esta en el entorno, asi que este valor manda.
   */
  correoDeAvisos = "",
) => {
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
  vi.stubEnv("ALARMAS_CORREO", correoDeAvisos);
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
  it("sintetiza la pila completa con la tabla, el bucket y CloudFront", () => {
    const plantilla = Template.fromStack(sandbox.pila);

    plantilla.resourceCountIs("AWS::DynamoDB::GlobalTable", 1);
    plantilla.resourceCountIs("AWS::S3::Bucket", 1);
    plantilla.resourceCountIs("AWS::CloudFront::Distribution", 1);

    // El correo sale por CES, un servicio REST externo: no hay recursos de SES que declarar.
    plantilla.resourceCountIs("AWS::SES::EmailIdentity", 0);

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
});

describe("alarmas (Etapa 12)", () => {
  // Las cuatro senales de `arquitectura-tecnica-aws.md` 7. Se comprueban aqui
  // y no solo leyendo `alarmas.ts` porque lo que puede estar mal no es el
  // codigo del constructo sino el **cableado**: de que metrica cuelga cada
  // alarma y en que pila acaba cada filtro.

  it("las seis alarmas cuelgan del tema de avisos, en su pila propia", () => {
    const plantilla = Template.fromStack(sandbox.pilaDeAlarmas);

    plantilla.resourceCountIs("AWS::CloudWatch::Alarm", 6);
    plantilla.resourceCountIs("AWS::SNS::Topic", 1);

    // Sin `ALARMAS_CORREO` no hay suscripcion: las alarmas se ven en la
    // consola pero no avisan. Es la diferencia entre un sandbox personal y un
    // entorno vigilado, y la decide quien despliega.
    plantilla.resourceCountIs("AWS::SNS::Subscription", 0);
  });

  it("la alarma del barrido trata la ausencia de datos como fallo", () => {
    // R6. Un barrido que no corre **no publica ceros**: no publica nada. Con
    // el trato por omision la alarma se quedaria en `INSUFFICIENT_DATA` para
    // siempre, que es indistinguible de "todo bien" para quien no la mira.
    const plantilla = Template.fromStack(sandbox.pilaDeAlarmas);

    plantilla.hasResourceProperties(
      "AWS::CloudWatch::Alarm",
      Match.objectLike({
        AlarmName: Match.stringLikeRegexp("barrido-sin-ejecutar"),
        MetricName: "Invocations",
        Namespace: "AWS/Lambda",
        ComparisonOperator: "LessThanThreshold",
        Threshold: 1,
        TreatMissingData: "breaching",
      }),
    );
  });

  it("la contencion se vigila con TransactionConflict y no con condiciones fallidas", () => {
    // `ConditionalCheckFailedRequests` parece la metrica obvia y estaria
    // disparada siempre: la adjudicacion se gana con escritura condicional
    // (regla 6), asi que en cada lote N-1 intentos fallan su condicion **por
    // diseno**.
    const plantilla = Template.fromStack(sandbox.pilaDeAlarmas);

    plantilla.hasResourceProperties(
      "AWS::CloudWatch::Alarm",
      Match.objectLike({
        AlarmName: Match.stringLikeRegexp("contencion-de-transacciones"),
        MetricName: "TransactionConflict",
        Namespace: "AWS/DynamoDB",
      }),
    );

    const porCondicion = Object.values(
      plantilla.findResources("AWS::CloudWatch::Alarm"),
    ).filter(
      (alarma) =>
        alarma.Properties.MetricName === "ConditionalCheckFailedRequests",
    );
    expect(porCondicion).toHaveLength(0);
  });

  it("los filtros de metrica quedan en la pila de la funcion, no con las alarmas", () => {
    // El grupo de logs pertenece a la pila de la funcion. Un filtro en otra
    // pila obligaria a exportar su nombre por CloudFormation sin ganar nada.
    const alarmas = Template.fromStack(sandbox.pilaDeAlarmas);
    alarmas.resourceCountIs("AWS::Logs::MetricFilter", 0);

    const funciones = Template.fromStack(
      Stack.of(sandbox.backend.barrido.resources.lambda),
    );
    funciones.resourceCountIs("AWS::Logs::MetricFilter", 3);
  });

  it("los filtros leen los campos bajo $.message, que es donde los pone Lambda", () => {
    // Con `logging: { format: "json" }` el runtime envuelve lo que se pasa a
    // `console.info` en `{ timestamp, level, requestId, message }`. Un patron
    // sobre `$.errores` compila, se despliega y **no coincide con nada**: un
    // filtro que no coincide no da error, da silencio.
    const funciones = Template.fromStack(
      Stack.of(sandbox.backend.barrido.resources.lambda),
    );

    const patrones = Object.values(
      funciones.findResources("AWS::Logs::MetricFilter"),
    ).map((filtro) => String(filtro.Properties.FilterPattern));

    expect(patrones).toContain(
      '{ ($.message.operacion = "barridoDeVencimientos") && ($.message.errores > 0) }',
    );
    expect(patrones).toContain('{ $.message.operacion = "procesarOutbox" }');

    for (const filtro of Object.values(
      funciones.findResources("AWS::Logs::MetricFilter"),
    )) {
      const transformacion = filtro.Properties.MetricTransformations as {
        MetricValue: string;
        DefaultValue: number;
      }[];
      expect(transformacion[0]?.MetricValue).toMatch(/^\$\.message\./);
      // Sin `defaultValue`, una corrida que no coincide no publica punto
      // alguno y la alarma oscila entre OK e INSUFFICIENT_DATA.
      expect(transformacion[0]?.DefaultValue).toBe(0);
    }
  });

  it("el grupo de logs del barrido es un recurso de la pila, no uno que Lambda cree al vuelo", () => {
    // `AWS::Logs::MetricFilter` exige que el grupo exista al desplegarse. Sin
    // `logging.retention` en `barrido/resource.ts`, Amplify no lo declara y el
    // grupo solo nace en la primera invocacion: demasiado tarde.
    const funciones = Template.fromStack(
      Stack.of(sandbox.backend.barrido.resources.lambda),
    );

    funciones.resourceCountIs("AWS::Logs::LogGroup", 1);
    funciones.hasResourceProperties(
      "AWS::Logs::LogGroup",
      Match.objectLike({ RetentionInDays: 30 }),
    );
  });

  it("cada alarma avisa tambien al volver a la normalidad", () => {
    // Sin `OKActions`, quien recibio el aviso de que el barrido dejo de correr
    // no tiene forma de saber que ya se arreglo salvo entrar a la consola.
    const plantilla = Template.fromStack(sandbox.pilaDeAlarmas);

    for (const alarma of Object.values(
      plantilla.findResources("AWS::CloudWatch::Alarm"),
    )) {
      expect(alarma.Properties.AlarmActions).toHaveLength(1);
      expect(alarma.Properties.OKActions).toHaveLength(1);
    }
  });

  it("cada alarma dice en su descripcion a que runbook llevar el aviso", () => {
    const plantilla = Template.fromStack(sandbox.pilaDeAlarmas);

    for (const alarma of Object.values(
      plantilla.findResources("AWS::CloudWatch::Alarm"),
    )) {
      expect(String(alarma.Properties.AlarmDescription)).toMatch(
        /Runbook R-\d/,
      );
    }
  });
});

describe("suscripcion de avisos", () => {
  it("con ALARMAS_CORREO se suscribe esa direccion al tema", async () => {
    const conCorreo = await construirBackend("branch", "operador@example.org");
    const plantilla = Template.fromStack(conCorreo.pilaDeAlarmas);

    plantilla.hasResourceProperties(
      "AWS::SNS::Subscription",
      Match.objectLike({
        Protocol: "email",
        Endpoint: "operador@example.org",
      }),
    );
  });
});

describe("fallos de sintesis", () => {
  it("falta la llave publica y falla antes de crear una distribucion sin firma", async () => {
    vi.stubEnv("CLOUDFRONT_PUBLIC_KEY_PATH", join(temporal, "no-existe.pem"));
    vi.resetModules();

    await expect(import("./backend")).rejects.toThrow(
      /llave publica de CloudFront/,
    );
  });
});
