// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { clave, PREFIJO_PARTICION_AUDITORIA } from "@/lib/data/claves";
import { AlmacenamientoAutob } from "./almacenamiento";
import { RolComputoSsr } from "./permisos";
import { TablaAutob } from "./tabla";

/**
 * Sintetiza la pila y verifica el CloudFormation resultante.
 *
 * No sustituye a la prueba de integracion contra AWS —esa comprueba que IAM **rechaza** de
 * verdad—, pero cubre lo que aquella no puede: que la politica exista, con las acciones
 * exactas, antes de desplegar nada. Un `Deny` mal escrito se detecta aqui, en segundos, y no
 * despues de un despliegue.
 */

// Sintetizar una pila de CDK cuesta segundos, no milisegundos. El limite de 5 s por omision
// es para pruebas puras; aqui se levanta el arbol completo de constructos.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// Llave publica real, generada al vuelo: no se versiona ningun material criptografico y el
// constructo recibe algo con la forma que CloudFront espera.
let llavePublicaPem: string;

beforeAll(() => {
  llavePublicaPem = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  }).publicKey;
});

// La pila no cambia entre pruebas: se sintetiza una vez por variante y se reutiliza.
const plantillas = new Map<boolean, Template>();

const sintetizar = (esSandbox = false): Template => {
  const yaSintetizada = plantillas.get(esSandbox);
  if (yaSintetizada) return yaSintetizada;

  const pila = new Stack(new App(), "Prueba", {
    env: { account: "111111111111", region: "us-east-1" },
  });
  const tabla = new TablaAutob(pila, "Tabla", { esSandbox });
  const almacenamiento = new AlmacenamientoAutob(pila, "Almacenamiento", {
    esSandbox,
    llavePublicaPem,
  });
  new RolComputoSsr(pila, "RolSsr", {
    tabla: tabla.tabla,
    bucket: almacenamiento.bucket,
  });

  const plantilla = Template.fromStack(pila);
  plantillas.set(esSandbox, plantilla);
  return plantilla;
};

describe("tabla unica", () => {
  it("usa PK/SK genericos, bajo demanda y PITR", () => {
    sintetizar().hasResourceProperties(
      "AWS::DynamoDB::GlobalTable",
      Match.objectLike({
        AttributeDefinitions: Match.arrayWith([
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
        ]),
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        BillingMode: "PAY_PER_REQUEST",
        Replicas: Match.arrayWith([
          Match.objectLike({
            PointInTimeRecoverySpecification: {
              PointInTimeRecoveryEnabled: true,
            },
          }),
        ]),
      }),
    );
  });

  /**
   * Claves esperadas de cada indice, en orden de declaracion.
   *
   * Se escriben literalmente y no se derivan del nombre: **la clave de un GSI
   * no se puede cambiar sin recrearlo**, asi que esta tabla es el contrato y no
   * una comodidad. Los cuatro primeros usan la convencion generica
   * `GSInPK`/`GSInSK` porque estan sobrecargados —GSI2 sirve cinco entidades—;
   * los cinco de la bitacora llevan nombre semantico porque cada uno responde
   * una sola pregunta, y asi se ve de un golpe que un item de negocio, al no
   * tener `mesPK`, no entra en ese indice.
   */
  const INDICES_ESPERADOS = [
    { nombre: "GSI1", pk: "GSI1PK", sk: "GSI1SK", proyeccion: "KEYS_ONLY" },
    { nombre: "GSI2", pk: "GSI2PK", sk: "GSI2SK", proyeccion: "ALL" },
    { nombre: "GSI3", pk: "GSI3PK", sk: "GSI3SK", proyeccion: "ALL" },
    { nombre: "GSI4", pk: "GSI4PK", sk: "GSI4SK", proyeccion: "ALL" },
    { nombre: "GSI5", pk: "mesPK", sk: "cronoSK", proyeccion: "ALL" },
    { nombre: "GSI6", pk: "tipoPK", sk: "cronoSK", proyeccion: "ALL" },
    { nombre: "GSI7", pk: "diaPK", sk: "agregadoSK", proyeccion: "ALL" },
    { nombre: "GSI8", pk: "diaPK", sk: "actorSK", proyeccion: "ALL" },
    { nombre: "GSI9", pk: "actorMesPK", sk: "cronoSK", proyeccion: "ALL" },
  ] as const;

  const indicesDeclarados = () =>
    Object.values(sintetizar().findResources("AWS::DynamoDB::GlobalTable"))[0]
      .Properties.GlobalSecondaryIndexes as Array<{
      IndexName: string;
      KeySchema: Array<{ AttributeName: string; KeyType: string }>;
      Projection: { ProjectionType: string };
    }>;

  it("declara los nueve GSIs con las claves y proyecciones de `modelo-datos-dynamodb.md`", () => {
    const indices = indicesDeclarados();

    expect(indices.map((indice) => indice.IndexName)).toEqual(
      INDICES_ESPERADOS.map((esperado) => esperado.nombre),
    );

    for (const [i, esperado] of INDICES_ESPERADOS.entries()) {
      expect(indices[i].KeySchema, `claves de ${esperado.nombre}`).toEqual([
        { AttributeName: esperado.pk, KeyType: "HASH" },
        { AttributeName: esperado.sk, KeyType: "RANGE" },
      ]);
      expect(
        indices[i].Projection.ProjectionType,
        `proyeccion de ${esperado.nombre}`,
      ).toBe(esperado.proyeccion);
    }
  });

  it("los cinco indices de la bitacora comparten atributos entre si", () => {
    // Es lo que mantiene el item de evento por debajo del minimo facturable de
    // 1 KB: siete atributos sirven a cinco indices, en vez de diez. Si alguien
    // les diera claves propias, el item crecería y cada evento empezaría a
    // costar 2 WCU en lugar de 1.
    const indices = indicesDeclarados();
    const claves = indices
      .filter((indice) => Number(indice.IndexName.slice(3)) >= 5)
      .flatMap((indice) => indice.KeySchema.map((k) => k.AttributeName));

    expect(new Set(claves).size).toBe(7);
    expect(claves).toHaveLength(10);
  });

  it("un entorno compartido retiene la tabla; un sandbox se la lleva", () => {
    const politica = (esSandbox: boolean) =>
      Object.values(
        sintetizar(esSandbox).findResources("AWS::DynamoDB::GlobalTable"),
      )[0].DeletionPolicy;
    expect(politica(false)).toBe("Retain");
    expect(politica(true)).toBe("Delete");
  });
});

/** Regla 5 de `CLAUDE.md`: la bitacora es append-only y lo garantiza IAM, no el codigo. */
describe("inmutabilidad de la bitacora", () => {
  const declaraciones = (): Array<Record<string, unknown>> =>
    Object.values(sintetizar().findResources("AWS::IAM::Policy")).flatMap(
      (politica) =>
        politica.Properties.PolicyDocument.Statement as Array<
          Record<string, unknown>
        >,
    );

  it("niega UpdateItem, DeleteItem y BatchWriteItem sobre items AUDIT#", () => {
    const negacion = declaraciones().find(
      (d) => d.Sid === "NegarMutacionDeBitacora",
    );

    expect(negacion).toBeDefined();
    expect(negacion?.Effect).toBe("Deny");
    expect(negacion?.Action).toEqual([
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:BatchWriteItem",
    ]);
    expect(negacion?.Condition).toEqual({
      "ForAnyValue:StringLike": { "dynamodb:LeadingKeys": ["AUDIT#*"] },
    });
  });

  it("**la condicion protege exactamente el prefijo que escribe `clave.evento`**", () => {
    // Es la invariante de la que depende toda la inmutabilidad de la bitacora, y
    // el modo de fallo es silencioso: si la `PK` del evento y esta condicion se
    // separaran, el `Deny` dejaria de aplicar sin que nada falle y la bitacora
    // pasaria a ser modificable. `permisos.ts` importa la constante en vez de
    // repetir el literal, asi que no pueden divergir; esta prueba comprueba que
    // ese acoplamiento sigue en pie y, sobre todo, que el prefijo con `*` casa
    // con una clave real.
    const negacion = declaraciones().find(
      (d) => d.Sid === "NegarMutacionDeBitacora",
    );
    const patron = (
      negacion?.Condition as Record<string, Record<string, string[]>>
    )["ForAnyValue:StringLike"]["dynamodb:LeadingKeys"][0];

    expect(patron).toBe(`${PREFIJO_PARTICION_AUDITORIA}*`);

    const claveReal = clave.evento(
      "LOTE",
      "L1",
      "2026-09-09T18:00:00.000Z",
      "E1",
    ).PK;
    expect(claveReal.startsWith(PREFIJO_PARTICION_AUDITORIA)).toBe(true);
    // Y el comodin de IAM casa con ella: `AUDIT#*` sobre `AUDIT#LOTE#L1`.
    expect(claveReal).toMatch(new RegExp(`^${patron.replace("*", ".*")}$`));
  });

  it("no niega PutItem: la regla 4 exige escribir el evento en la misma transaccion", () => {
    const negados = declaraciones()
      .filter((d) => d.Effect === "Deny")
      .flatMap((d) => (Array.isArray(d.Action) ? d.Action : [d.Action]));

    expect(negados).not.toContain("dynamodb:PutItem");
    expect(negados).not.toContain("dynamodb:ConditionCheckItem");
  });

  it("niega tambien las acciones PartiQL que mutan", () => {
    const negacion = declaraciones().find(
      (d) => d.Sid === "NegarPartiQLMutante",
    );
    expect(negacion?.Action).toEqual([
      "dynamodb:PartiQLUpdate",
      "dynamodb:PartiQLDelete",
    ]);
  });

  it("un comprobante de pago no se puede borrar", () => {
    const negacion = declaraciones().find(
      (d) => d.Sid === "NegarBorradoDeComprobantes",
    );
    expect(negacion?.Effect).toBe("Deny");
    expect(negacion?.Action).toEqual([
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
    ]);
  });
});

describe("almacenamiento", () => {
  it("el bucket bloquea todo acceso publico, cifra y versiona", () => {
    sintetizar().hasResourceProperties(
      "AWS::S3::Bucket",
      Match.objectLike({
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        VersioningConfiguration: { Status: "Enabled" },
        BucketEncryption: Match.anyValue(),
      }),
    );
  });

  it("CloudFront exige URL firmada y solo alcanza el prefijo de fotografias", () => {
    const plantilla = sintetizar();
    const distribucion = Object.values(
      plantilla.findResources("AWS::CloudFront::Distribution"),
    )[0].Properties.DistributionConfig;

    expect(distribucion.DefaultCacheBehavior.TrustedKeyGroups).toHaveLength(1);
    expect(distribucion.Origins[0].OriginPath).toBe("/vehiculos");
    expect(distribucion.DefaultCacheBehavior.ViewerProtocolPolicy).toBe(
      "redirect-to-https",
    );

    // Origin Access Control: el bucket sigue privado y solo CloudFront lo alcanza.
    expect(distribucion.Origins[0].OriginAccessControlId).toBeDefined();
    plantilla.resourceCountIs("AWS::CloudFront::KeyGroup", 1);
  });
});

describe("rol de computo SSR", () => {
  it("solo Amplify Hosting puede asumirlo", () => {
    sintetizar().hasResourceProperties(
      "AWS::IAM::Role",
      Match.objectLike({
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Allow",
              Action: "sts:AssumeRole",
              Principal: { Service: "amplify.amazonaws.com" },
            }),
          ]),
        }),
      }),
    );
  });

  it("fuera de un sandbox, la cuenta no puede asumirlo", () => {
    const principales = Object.values(
      sintetizar().findResources("AWS::IAM::Role"),
    )
      .map((rol) => JSON.stringify(rol.Properties.AssumeRolePolicyDocument))
      .join("");

    // `AccountRootPrincipal` sintetiza como un `AWS: arn:...:root`. Que no aparezca es lo
    // que impide que las credenciales de una persona hereden los permisos de la aplicacion.
    expect(principales).not.toContain(":root");
  });

  it("en un sandbox la cuenta si lo asume, para poder probar la politica real", () => {
    const pila = new Stack(new App(), "Sandbox", {
      env: { account: "111111111111", region: "us-east-1" },
    });
    const tabla = new TablaAutob(pila, "Tabla", { esSandbox: true });
    const almacenamiento = new AlmacenamientoAutob(pila, "Almacenamiento", {
      esSandbox: true,
      llavePublicaPem,
    });
    new RolComputoSsr(pila, "RolSsr", {
      tabla: tabla.tabla,
      bucket: almacenamiento.bucket,
      esSandbox: true,
    });

    const confianza = JSON.stringify(
      Object.values(
        Template.fromStack(pila).findResources("AWS::IAM::Role"),
      ).map((rol) => rol.Properties.AssumeRolePolicyDocument),
    );

    expect(confianza).toContain("amplify.amazonaws.com");
    expect(confianza).toContain(":root");
  });
});
