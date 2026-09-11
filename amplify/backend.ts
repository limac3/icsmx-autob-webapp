import { existsSync } from "node:fs";
import { defineBackend, secret } from "@aws-amplify/backend";
import { CDKContextKey } from "@aws-amplify/platform-core";
import { Duration } from "aws-cdk-lib";
import { LogGroup, type ILogGroup } from "aws-cdk-lib/aws-logs";
// Las extensiones `.ts` son obligatorias y literales. `ampx` ejecuta este archivo con el
// *type stripping* nativo de Node, cuyo resolvedor ESM no completa extensiones **ni mapea
// `.js` a `.ts`**: hay que nombrar el archivo que existe en disco.
import { AlarmasAutob } from "./alarmas.ts";
import { AlmacenamientoAutob } from "./almacenamiento.ts";
import { barrido } from "./barrido/resource.ts";
import { aplicarPermisosAutob, RolComputoSsr } from "./permisos.ts";
import { TablaAutob } from "./tabla.ts";

/**
 * Backend de icsmx-autob-webapp.
 *
 * No se declaran `defineAuth` ni `defineData`: la identidad la da Okta directamente
 * (`identidad-autorizacion.md`) y el modelo es una tabla unica propia, no un esquema de
 * AppSync. Todo lo demas son constructos CDK dentro de una pila propia.
 *
 * Tampoco hay recursos de correo. El correo transaccional sale por **CES** (Church Email
 * Service), un servicio REST externo con autenticacion basica: no es infraestructura de AWS
 * y no se declara aqui. Sus credenciales se inyectan al procesador del outbox en la Etapa 10.
 */
export const backend = defineBackend({ barrido });

// `ampx` no lee `.env.local` por su cuenta. Cargarlo aqui es lo que permite que la misma
// configuracion que documenta `.env.local.example` sirva para el sandbox, sin pedirle a nadie
// que exporte variables a mano. En CI el archivo no existe y mandan las del entorno.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

// Se exporta para que `backend.test.ts` pueda sintetizarla y verificar el cableado; `ampx`
// solo importa este archivo por sus efectos.
export const pila = backend.createStack("AutobRecursos");

// Un sandbox personal debe poder llevarse sus propios recursos al borrarse; los de una rama
// compartida nunca se destruyen por un despliegue.
const esSandbox =
  pila.node.tryGetContext(CDKContextKey.DEPLOYMENT_TYPE) === "sandbox";

const tabla = new TablaAutob(pila, "Tabla", { esSandbox });
const almacenamiento = new AlmacenamientoAutob(pila, "Almacenamiento", {
  esSandbox,
});

const recursos = {
  tabla: tabla.tabla,
  bucket: almacenamiento.bucket,
};

const rolSsr = new RolComputoSsr(pila, "RolComputoSsr", {
  ...recursos,
  esSandbox,
});

// El barrido toca la bitacora igual que la aplicacion, asi que recibe exactamente los mismos
// permisos y los mismos `Deny`. Que compartan la funcion es deliberado: dos listas separadas
// se desincronizan, y la que se olvide seria justamente la que deja escribir la bitacora.
const funcionBarrido = backend.barrido.resources.lambda;
const rolBarrido = backend.barrido.resources.cfnResources.cfnFunction.role;
if (!funcionBarrido.role) {
  throw new Error(
    `La funcion de barrido no expone un rol de ejecucion (${String(rolBarrido)}).`,
  );
}
aplicarPermisosAutob(funcionBarrido, funcionBarrido.role, recursos);
backend.barrido.addEnvironment("AUTOB_TABLE_NAME", tabla.tabla.tableName);

/**
 * El grupo de logs que Amplify crea para el barrido.
 *
 * `FunctionResources` solo expone `lambda: IFunction` y `cfnFunction`, y ni
 * `IFunction` ni `defineFunction` dan acceso al grupo: Amplify lo construye
 * como hermano de la funcion con el id `<id>-log-group` cuando —y solo
 * cuando— se declara `logging.retention` (`backend-function/lib/factory.js`).
 * Se busca en el arbol de constructos porque es el unico camino que hay.
 *
 * **No se recurre al nombre convencional `/aws/lambda/<funcion>`.** Ese grupo
 * no existe aqui: al declarar uno propio, Amplify se lo pasa a la funcion por
 * `LoggingConfig` y Lambda escribe en el, no en el de la convencion. Un filtro
 * sobre el nombre convencional se desplegaria sin error y no coincidiria nunca.
 *
 * Si Amplify cambia ese id, **esto lanza al sintetizar** en vez de dejar
 * alarmas mudas: `backend.test.ts` sintetiza la pila en la compuerta, asi que
 * el fallo aparece en CI y no en produccion (regla 15, sin fallback
 * silencioso).
 */
function grupoDeLogsDelBarrido(): ILogGroup {
  const hermanos = funcionBarrido.node.scope?.node.children ?? [];
  const grupo = hermanos.find(
    (hijo): hijo is LogGroup => hijo instanceof LogGroup,
  );

  if (!grupo) {
    throw new Error(
      "No se encontro el grupo de logs del barrido junto a la funcion." +
        " Amplify solo lo crea si `logging.retention` esta declarado en" +
        " amplify/barrido/resource.ts; comprobar tambien que la version de" +
        " @aws-amplify/backend-function sigue creandolo como hermano.",
    );
  }

  return grupo;
}

// CES (Church Email Service) — el procesador del outbox de la Etapa 10.
//
// **`secret()` referencia un parametro de SSM Parameter Store, no de Secrets
// Manager.** Lo implementa `@aws-amplify/backend-secret`, cuyos modulos son
// literalmente `ssm_secret.js`; la ruta la arma `ParameterPathConversions` como
// `/amplify/<parte-del-backend>/<NOMBRE>` — con `<appId>/<rama>-branch-<hash>`
// para una rama y `<proyecto>/<usuario>-sandbox-<hash>` para un sandbox. Aqui
// solo va el nombre corto; el prefijo lo pone Amplify segun a que backend se
// despliega.
//
// El **valor** no lo pone este archivo:
//   - sandbox: `npx ampx sandbox secret set CES_URL` (tambien `list`/`get`/`remove`)
//   - rama de Amplify Hosting: desde la consola, o escribiendo el `SecureString`
//     en SSM. **No hay un `ampx secret set` para ramas**: el CLI solo expone
//     `ampx sandbox secret`.
//
// Declarar la referencia aqui no exige que el valor ya exista: CES sigue sin
// aprobar (riesgo R17, `plan-ejecucion.md`) y el backend despliega igual. Con
// `APP_ENV=pruebas` el procesador **cancela** el mensaje y deja la notificacion
// en el registro; en produccion falla de forma explicita (regla 15, D-6).
backend.barrido.addEnvironment("CES_URL", secret("CES_URL"));
backend.barrido.addEnvironment("CES_USER", secret("CES_USER"));
backend.barrido.addEnvironment("CES_PASSWORD", secret("CES_PASSWORD"));
backend.barrido.addEnvironment("CES_FROM_ADDRESS", secret("CES_FROM_ADDRESS"));
backend.barrido.addEnvironment(
  "APP_BASE_URL",
  process.env.APP_BASE_URL ?? "http://localhost:3000",
);

// **El entorno tambien viaja al Lambda, y sin esto el barrido se cae.** El
// despachador del outbox lee `APP_ENV` en ejecucion para decidir que hacer
// cuando falta configuracion de CES: con `pruebas` cancela el mensaje y lo
// registra; sin ella —o con `produccion`— lanza, porque no se descarta correo
// con datos reales (D-18). Las variables de la consola de Amplify llegan al
// build y al computo SSR de Next, **no** a una funcion de `defineFunction`: hay
// que pasarsela aqui explicitamente.
//
// Se resuelve en sintesis desde el entorno del build. El respaldo es
// `produccion` y no `pruebas`: la omision tiene que cerrar, no abrir.
backend.barrido.addEnvironment("APP_ENV", process.env.APP_ENV ?? "produccion");

// Alarmas de la Etapa 12 — `arquitectura-tecnica-aws.md` 7. Se crean tambien en
// un sandbox y no solo en las ramas compartidas: seis alarmas cuestan centavos
// al mes, y el paso "cada runbook ejecutado al menos una vez" de la Etapa 12
// exige poder disparar una de verdad en algun sitio antes de produccion.
//
// `ALARMAS_CORREO` queda vacia por omision. Sin ella las alarmas se crean y
// cambian de estado igual —se ven en la consola—, pero no avisan a nadie: es la
// diferencia entre un sandbox personal y un entorno vigilado, y la decide quien
// despliega, no este archivo.
//
// **Pila propia, y no `pila`.** Es una restriccion de CloudFormation, no una
// preferencia de organizacion. Las alarmas del barrido apuntan a metricas
// dimensionadas por `FunctionName`, asi que la pila que las contenga
// **referencia** la pila de la funcion; y la pila de la funcion ya referencia
// `pila`, porque de ahi toma `AUTOB_TABLE_NAME`. Meter las alarmas en `pila`
// cierra el ciclo `funcion -> recursos -> funcion` y `ampx` falla al
// sintetizar, sin desplegar nada.
//
// Con una tercera pila las dependencias van en un solo sentido:
//
//   AutobAlarmas -> function (metricas y grupo de logs del barrido)
//   AutobAlarmas -> AutobRecursos (metricas de la tabla)
//   function     -> AutobRecursos (nombre de la tabla)
export const pilaDeAlarmas = backend.createStack("AutobAlarmas");

/**
 * Prefijo de los nombres de alarma, derivado de la identidad del backend.
 *
 * **Los nombres de alarma de CloudWatch son unicos por cuenta y region.** Con
 * un prefijo constante, el segundo entorno que se despliegue en la misma cuenta
 * falla al crear la pila de alarmas —"Validation failed with 6 error(s)", una
 * por alarma— y ninguna sintesis puede anticiparlo, porque lo que colisiona no
 * es la plantilla sino el estado de la cuenta.
 *
 * Los tres valores vienen del contexto que inyecta `ampx` y son deterministas:
 * `<namespace>-<nombre>-<tipo>` da `d2i0gloex3vqjp-main-branch` para una rama y
 * `icsmxautobwebapp-CesarLima-sandbox` para un sandbox personal. Deterministas
 * importa: un nombre con parte aleatoria cambiaria en cada recreacion y dejaria
 * los runbooks apuntando a alarmas que ya no existen.
 *
 * El respaldo `autob` solo aplica fuera de `ampx` —una sintesis suelta— y no
 * relaja nada: cualquier despliegue real trae los tres valores.
 */
const identidadDelBackend = [
  pila.node.tryGetContext(CDKContextKey.BACKEND_NAMESPACE),
  pila.node.tryGetContext(CDKContextKey.BACKEND_NAME),
  pila.node.tryGetContext(CDKContextKey.DEPLOYMENT_TYPE),
]
  .filter((parte): parte is string => typeof parte === "string" && parte !== "")
  .join("-");

const alarmas = new AlarmasAutob(pilaDeAlarmas, "Alarmas", {
  tabla: tabla.tabla,
  prefijoDeNombres: identidadDelBackend || "autob",
  logsDelBarrido: grupoDeLogsDelBarrido(),
  invocacionesDelBarrido: funcionBarrido.metricInvocations({
    period: Duration.minutes(15),
  }),
  erroresDelBarrido: funcionBarrido.metricErrors({
    period: Duration.minutes(15),
  }),
  ...(process.env.ALARMAS_CORREO
    ? { correoDeAvisos: process.env.ALARMAS_CORREO }
    : {}),
});

backend.addOutput({
  custom: {
    autob: {
      tabla: tabla.tabla.tableName,
      bucket: almacenamiento.bucket.bucketName,
      distribucion: almacenamiento.distribucion.distributionDomainName,
      grupoDeLlavesCloudFront: almacenamiento.grupoDeLlaves.keyGroupId,
      // El que hace falta para **firmar** es este, no el del grupo: el
      // `keyPairId` de una URL firmada es el identificador de la llave publica.
      // Sin exponerlo aqui, el operador tendria que buscarlo en la consola para
      // llenar `CLOUDFRONT_KEY_PAIR_ID`, y equivocarse de identificador produce
      // un 403 de CloudFront que no dice cual de los dos se puso.
      llavePublicaCloudFront: almacenamiento.llavePublica.publicKeyId,
      // Se adjunta a mano en la consola de Amplify: App settings > IAM roles > Compute role.
      // Amplify Hosting no forma parte de `defineBackend`, asi que el rol se crea aqui pero
      // la asociacion es un paso de consola. Ver `runbooks.md`.
      rolComputoSsr: rolSsr.rol.roleArn,
      // Para confirmar la suscripcion de correo, o para agregar mas
      // destinatarios sin volver a desplegar (`runbooks.md` R-13).
      temaDeAvisos: alarmas.tema.topicArn,
    },
  },
});
