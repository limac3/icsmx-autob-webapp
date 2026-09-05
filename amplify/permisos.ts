import {
  AccountRootPrincipal,
  CompositePrincipal,
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import type { IGrantable, IRole } from "aws-cdk-lib/aws-iam";
import type { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import type { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export type RecursosAutob = {
  readonly tabla: TableV2;
  readonly bucket: Bucket;
};

/**
 * `Deny` explicito de toda modificacion y borrado sobre items `AUDIT#` (regla 5 de
 * `CLAUDE.md`).
 *
 * Es la unica garantia de inmutabilidad que **no depende de que el codigo este bien
 * escrito**: un `Deny` explicito no lo sobrescribe ningun `Allow`, ni siquiera uno que se
 * agregue por descuido mas adelante.
 *
 * Cubre tambien las transacciones sin nombrarlas: `TransactWriteItems` no es una accion de
 * IAM, se autoriza con las acciones de item subyacentes, asi que un `Update` sobre un
 * `AUDIT#` dentro de una transaccion cae en este mismo `Deny`.
 *
 * `PutItem` queda fuera a proposito: escribir el evento es justo lo que la regla 4 exige
 * dentro de la misma `TransactWriteItems` que la mutacion.
 */
const negarMutacionDeAuditoria = (tabla: TableV2): PolicyStatement[] => [
  new PolicyStatement({
    sid: "NegarMutacionDeBitacora",
    effect: Effect.DENY,
    actions: [
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      // `BatchWriteItem` tambien borra; omitirlo dejaria abierta la puerta que se cierra.
      "dynamodb:BatchWriteItem",
    ],
    resources: [tabla.tableArn],
    conditions: {
      "ForAnyValue:StringLike": { "dynamodb:LeadingKeys": ["AUDIT#*"] },
    },
  }),
  new PolicyStatement({
    // PartiQL son acciones de IAM distintas que tambien mutan. La aplicacion no las usa,
    // asi que se niegan sin condicion: mas simple y estrictamente mas seguro que
    // depender de que `LeadingKeys` se evalue igual en cada una de ellas.
    sid: "NegarPartiQLMutante",
    effect: Effect.DENY,
    actions: ["dynamodb:PartiQLUpdate", "dynamodb:PartiQLDelete"],
    resources: [tabla.tableArn],
  }),
];

/**
 * Permisos de minimo privilegio sobre la tabla y el bucket, mas los `Deny` que sostienen la
 * inmutabilidad de la bitacora y de los comprobantes.
 *
 * Se aplica igual al rol de computo SSR y al de la funcion de barrido: ambos tocan la
 * bitacora y ninguno de los dos debe poder alterarla.
 */
export const aplicarPermisosAutob = (
  destino: IGrantable,
  rol: IRole,
  recursos: RecursosAutob,
): void => {
  const { tabla, bucket } = recursos;

  tabla.grantReadWriteData(destino);

  for (const declaracion of negarMutacionDeAuditoria(tabla)) {
    rol.addToPrincipalPolicy(declaracion);
  }

  // Fotografias: se sustituyen y se retiran al editar el vehiculo.
  bucket.grantReadWrite(destino, "vehiculos/*");
  bucket.grantDelete(destino, "vehiculos/*");

  // Comprobantes: se cargan y se leen, nunca se borran. Un comprobante de pago es
  // evidencia; que no exista permiso de borrado lo vuelve una garantia y no un descuido.
  bucket.grantRead(destino, "comprobantes/*");
  bucket.grantPut(destino, "comprobantes/*");
  rol.addToPrincipalPolicy(
    new PolicyStatement({
      sid: "NegarBorradoDeComprobantes",
      effect: Effect.DENY,
      actions: ["s3:DeleteObject", "s3:DeleteObjectVersion"],
      resources: [bucket.arnForObjects("comprobantes/*")],
    }),
  );

  // Sin permisos de correo: el correo transaccional sale por CES, un servicio REST externo
  // con autenticacion basica. No es un servicio de AWS, asi que no hay nada que autorizar
  // en IAM — solo credenciales, que llegan como secretos al procesador del outbox.
};

/**
 * Rol de computo SSR de Amplify Hosting.
 *
 * Amplify Hosting no se declara con `defineBackend` —vive en la consola—, asi que el rol se
 * crea aqui con la relacion de confianza que Amplify exige y se adjunta despues en
 * **App settings > IAM roles > Compute role**. Su ARN sale en las salidas del backend.
 *
 * Crearlo aqui, y no a mano en la consola, es lo que hace que el `Deny` de la bitacora sea
 * parte de la infraestructura versionada y no de un procedimiento que alguien puede olvidar.
 */
export class RolComputoSsr extends Construct {
  readonly rol: Role;

  constructor(
    scope: Construct,
    id: string,
    recursos: RecursosAutob & { readonly esSandbox?: boolean },
  ) {
    super(scope, id);

    this.rol = new Role(this, "Rol", {
      // En un sandbox personal la cuenta tambien puede asumirlo. Es lo que permite que la
      // prueba de integracion ejerza **esta** politica y no una copia: sin ello habria que
      // probar contra un rol paralelo, y un rol paralelo se desincroniza del real.
      // En cualquier otro entorno solo Amplify Hosting lo asume.
      assumedBy: recursos.esSandbox
        ? new CompositePrincipal(
            new ServicePrincipal("amplify.amazonaws.com"),
            new AccountRootPrincipal(),
          )
        : new ServicePrincipal("amplify.amazonaws.com"),
      description: "Rol de computo SSR de icsmx-autob-webapp",
    });

    aplicarPermisosAutob(this.rol, this.rol, recursos);
  }
}
