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

        // --- GSI6 a GSI9: la bitacora, uno por pregunta del auditor ---------
        //
        // **Claves con nombre semantico**, a diferencia de los cuatro de arriba.
        // La convencion generica esta justificada donde el indice esta
        // sobrecargado —GSI2 sirve cinco entidades—, pero estos cinco tienen un
        // solo proposito cada uno, y el nombre hace evidente la propiedad que
        // sostiene el diseno: **un vehiculo no tiene `mesPK`, asi que no esta en
        // ese indice**. Al ser dispersos, los items de negocio no pagan ninguna
        // escritura por ellos; solo los eventos.
        //
        // Todos con `ALL` y no `KEYS_ONLY`: el evento pesa ~750 B, o sea que ya
        // redondea al minimo facturable de 1 KB y una proyeccion menor no ahorra
        // un solo WCU — solo obligaria a un `BatchGetItem` de hidratacion por
        // pagina. Y la proyeccion **no se puede modificar** sin recrear el
        // indice, asi que lo generoso va aqui (`modelo-datos-dynamodb.md` 8.1).
        // **GSI5 no existe, y su ausencia es una decision.** Iba a servir "todo
        // el rango, cronologico", con `mesPK`/`cronoSK`. Al reescribir los
        // lectores quedo sin ninguno: la pantalla exige al menos un criterio
        // —identificador, tipo de evento o participante— y los tres tienen su
        // propio indice, asi que nadie pregunta por el rango a secas. Un indice
        // con proyeccion `ALL` y sin lector cobra una escritura por evento a
        // cambio de nada, que es el mismo argumento con el que la bitacora
        // salio de GSI2.
        //
        // **Los atributos `mesPK` y `cronoSK` se siguen escribiendo.** Es la
        // regla que gobierna todo este modelo: lo irreversible son los
        // atributos, no los indices. A un evento append-only no se le pueden
        // agregar despues —IAM deniega `UpdateItem` y `attribute_not_exists(PK)`
        // rechaza un `Put` de reemplazo—, asi que un atributo que hoy no se
        // escribe es una pregunta que nunca se podra responder sobre los eventos
        // de hoy. El indice, en cambio, se crea cuando aparezca el lector y su
        // relleno vera todo lo ya escrito.

        {
          // GSI6 — un tipo de evento en el rango. El mes acota la particion
          // para que el tipo dominante no crezca sin cota.
          indexName: "GSI6",
          partitionKey: { name: "tipoPK", type: AttributeType.STRING },
          sortKey: { name: "cronoSK", type: AttributeType.STRING },
          projectionType: ProjectionType.ALL,
        },
        {
          // GSI7 — los agregados con actividad en un dia. `agregadoSK` agrupa
          // por valor antes que por tiempo, que es lo que permite obtener los
          // identificadores distintos saltando de grupo en grupo.
          indexName: "GSI7",
          partitionKey: { name: "diaPK", type: AttributeType.STRING },
          sortKey: { name: "agregadoSK", type: AttributeType.STRING },
          projectionType: ProjectionType.ALL,
        },
        {
          // GSI8 — las personas con actividad en un dia. Mismo salto que GSI7.
          indexName: "GSI8",
          partitionKey: { name: "diaPK", type: AttributeType.STRING },
          sortKey: { name: "actorSK", type: AttributeType.STRING },
          projectionType: ProjectionType.ALL,
        },
        {
          // GSI9 — lo que una persona firmo, con el rango en la clave de
          // ordenamiento. Por mes: por dia costaria hasta 90 `Query`.
          indexName: "GSI9",
          partitionKey: { name: "actorMesPK", type: AttributeType.STRING },
          sortKey: { name: "cronoSK", type: AttributeType.STRING },
          projectionType: ProjectionType.ALL,
        },
      ],
    });
  }
}
