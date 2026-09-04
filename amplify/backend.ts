import { existsSync } from "node:fs";
import { defineBackend } from "@aws-amplify/backend";
import { CDKContextKey } from "@aws-amplify/platform-core";
import { AlmacenamientoAutob } from "./almacenamiento";
import { barrido } from "./barrido/resource";
import { CorreoAutob } from "./correo";
import { aplicarPermisosAutob, RolComputoSsr } from "./permisos";
import { TablaAutob } from "./tabla";

/**
 * Backend de icsmx-autob-webapp.
 *
 * No se declaran `defineAuth` ni `defineData`: la identidad la da Okta directamente
 * (`identidad-autorizacion.md`) y el modelo es una tabla unica propia, no un esquema de
 * AppSync. Todo lo demas son constructos CDK dentro de una pila propia.
 */
export const backend = defineBackend({ barrido });

// `ampx` no lee `.env.local` por su cuenta. Cargarlo aqui es lo que permite que la misma
// configuracion que documenta `.env.local.example` sirva para el sandbox, sin pedirle a nadie
// que exporte variables a mano. En CI el archivo no existe y mandan las del entorno.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const identidadCorreo = process.env.SES_IDENTIDAD;
if (!identidadCorreo) {
  throw new Error(
    [
      "Falta SES_IDENTIDAD: el dominio o el correo verificado desde el que sale el correo",
      "transaccional. Un dominio (ejemplo.org) habilita DKIM y es lo correcto en entornos",
      "compartidos; un correo concreto se verifica solo y basta para un sandbox personal.",
      "Ver `.env.local.example`.",
    ].join("\n"),
  );
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
const correo = new CorreoAutob(pila, "Correo", { identidad: identidadCorreo });

const recursos = {
  tabla: tabla.tabla,
  bucket: almacenamiento.bucket,
  identidadCorreo: correo.identidad,
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

backend.addOutput({
  custom: {
    autob: {
      tabla: tabla.tabla.tableName,
      bucket: almacenamiento.bucket.bucketName,
      distribucion: almacenamiento.distribucion.distributionDomainName,
      grupoDeLlavesCloudFront: almacenamiento.grupoDeLlaves.keyGroupId,
      identidadCorreo,
      // Se adjunta a mano en la consola de Amplify: App settings > IAM roles > Compute role.
      // Amplify Hosting no forma parte de `defineBackend`, asi que el rol se crea aqui pero
      // la asociacion es un paso de consola. Ver `runbooks.md`.
      rolComputoSsr: rolSsr.rol.roleArn,
    },
  },
});
