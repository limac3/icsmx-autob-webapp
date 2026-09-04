import { RemovalPolicy } from "aws-cdk-lib";
import {
  AttributeType,
  Billing,
  ProjectionType,
  TableEncryptionV2,
  TableV2,
} from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

/**
 * Tabla unica del sistema (`modelo-datos-dynamodb.md`).
 *
 * `PK`/`SK` genericos porque conviven en ella participantes, vehiculos, convocatorias,
 * lotes, solicitudes, centinelas, eventos de auditoria y mensajes de correo. La forma
 * concreta de cada clave la construye `src/lib/data`, no la infraestructura.
 */
export class TablaAutob extends Construct {
  readonly tabla: TableV2;

  constructor(
    scope: Construct,
    id: string,
    opciones: { readonly esSandbox: boolean },
  ) {
    super(scope, id);

    this.tabla = new TableV2(this, "Tabla", {
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "SK", type: AttributeType.STRING },

      // Bajo demanda: la carga es a rafagas y la apertura de una convocatoria concentra
      // casi toda la escritura del ciclo (seccion 8 de `modelo-datos-dynamodb.md`).
      billing: Billing.onDemand(),

      // Unica red de seguridad ante un error de datos: la bitacora no se puede reescribir.
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: TableEncryptionV2.awsManagedKey(),

      // Sin TTL en ningun item: nada del dominio caduca solo, y una expiracion automatica
      // sobre la bitacora violaria R-20.

      // Un `ampx sandbox delete` debe poder llevarse su propia tabla; la de un entorno
      // compartido jamas se borra por un despliegue.
      removalPolicy: opciones.esSandbox
        ? RemovalPolicy.DESTROY
        : RemovalPolicy.RETAIN,

      globalSecondaryIndexes: [
        {
          // GSI1 — identidad alterna. PA-01: participante por `oktaSub`.
          // KEYS_ONLY basta: solo resuelve `oktaSub` -> `participanteId`, y el perfil
          // completo se lee despues con un `GetItem` sobre la tabla base.
          indexName: "GSI1",
          partitionKey: { name: "GSI1PK", type: AttributeType.STRING },
          sortKey: { name: "GSI1SK", type: AttributeType.STRING },
          projectionType: ProjectionType.KEYS_ONLY,
        },
        {
          // GSI2 — listados por estatus. PA-03, PA-05, PA-06, PA-11, PA-13.
          indexName: "GSI2",
          partitionKey: { name: "GSI2PK", type: AttributeType.STRING },
          sortKey: { name: "GSI2SK", type: AttributeType.STRING },
          projectionType: ProjectionType.ALL,
        },
        {
          // GSI3 — por participante. PA-09: mis solicitudes.
          indexName: "GSI3",
          partitionKey: { name: "GSI3PK", type: AttributeType.STRING },
          sortKey: { name: "GSI3SK", type: AttributeType.STRING },
          projectionType: ProjectionType.ALL,
        },
        {
          // GSI4 — trabajo pendiente, disperso a proposito. PA-10 y PA-14.
          // Sus claves solo existen mientras el item requiere atencion, asi que el indice
          // contiene exactamente el trabajo pendiente y el barrido no filtra nada.
          indexName: "GSI4",
          partitionKey: { name: "GSI4PK", type: AttributeType.STRING },
          sortKey: { name: "GSI4SK", type: AttributeType.STRING },
          projectionType: ProjectionType.ALL,
        },
      ],
    });
  }
}
