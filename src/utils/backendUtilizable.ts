/**
 * Si las pruebas de integracion pueden correr contra el backend real.
 *
 * **No basta con que exista `amplify_outputs.json`**, que es lo que
 * comprobaban. Esas pruebas asumen el **rol de computo SSR** con STS —a
 * proposito: lo que se verifica es la politica que corre en produccion, no los
 * permisos de quien ejecuta— y eso exige credenciales autorizadas a asumirlo.
 * La sesion SSO de quien desarrolla lo esta; el rol del contenedor de build de
 * Amplify **no**, y es correcto que no lo este: poder asumir el rol de la
 * aplicacion desde el build seria una escalada de privilegios.
 *
 * El defecto concreto: la fase `backend` del despliegue ejecuta
 * `ampx pipeline-deploy`, que **genera `amplify_outputs.json` en el espacio de
 * trabajo**. Asi que en la fase siguiente la condicion se cumplia, tres suites
 * de integracion se activaban y fallaban con
 * `AccessDenied ... not authorized to perform: sts:AssumeRole`. En local nunca
 * se veia, porque el archivo lo escribe `ampx sandbox` junto con credenciales
 * que si sirven (`desafios-implementacion.md` 70).
 *
 * **Se descarta gatear por `CI`.** `verify:rapido` define `CI=1` para omitir el
 * chequeo de desactualizados, asi que gatear ahi apagaria estas pruebas en la
 * compuerta local — y la regresion de concurrencia de la regla 16 vive
 * precisamente en ella. Lo que hay que detectar no es "hay automatizacion",
 * es "este proceso no puede asumir el rol".
 */

/**
 * `AWS_APP_ID` la define el contenedor de build de Amplify Hosting —es la que
 * `amplify.yml` le pasa a `ampx pipeline-deploy`— y no existe en ninguna
 * maquina de desarrollo.
 */
export const enBuildDeAmplify = (): boolean =>
  typeof process.env.AWS_APP_ID === "string" && process.env.AWS_APP_ID !== "";

/** Las salidas que toda prueba de integracion necesita de `custom.autob`. */
export type SalidasMinimas = {
  tabla?: string;
  rolComputoSsr?: string;
};

export const puedeUsarBackendReal = (salidas: SalidasMinimas | null): boolean =>
  Boolean(salidas?.tabla && salidas?.rolComputoSsr) && !enBuildDeAmplify();
