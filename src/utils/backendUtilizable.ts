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

/**
 * Lo mismo, pero para las suites que son **regresion de una invariante** y no
 * un arnes bajo demanda: la fila (regla 16), el vencimiento, tesoreria, los
 * identificadores unicos y la inmutabilidad de la bitacora (regla 5).
 *
 * **El problema que resuelve es el silencio, no la omision.** Omitirlas sin
 * backend es correcto y se queda: la compuerta tiene que poder correr en una
 * maquina sin AWS. Lo que no es correcto es que entonces `verify:rapido`
 * reporte verde sin distinguirse del verde que si ejercito la concurrencia —
 * ese verde se lee como "regla 16 verificada" cuando nadie la verifico. Es el
 * mismo modo de fallo que la Etapa 12 combatio en la alarma del barrido: no
 * publicar nada es indistinguible de que todo este bien.
 *
 * Con `EXIGIR_INTEGRACION=1` la omision pasa a ser un **fallo ruidoso**. Esa es
 * la compuerta previa al despliegue (`npm run verify:despliegue`), no la de
 * cada iteracion.
 *
 * **No se pone en `amplify.yml`, y conviene que quede dicho por que.** Ahi
 * `puedeUsarBackendReal` devuelve `false` a proposito —el rol del contenedor de
 * build no puede asumir el rol de computo SSR, y que no pueda es correcto:
 * poder asumirlo seria una escalada de privilegios
 * (`desafios-implementacion.md` 70)—. Exigirlo alli no correria las pruebas:
 * rompería el despliegue.
 */
export const backendParaRegresion = (
  salidas: SalidasMinimas | null,
  suite: string,
): boolean => {
  const utilizable = puedeUsarBackendReal(salidas);

  if (!utilizable && process.env.EXIGIR_INTEGRACION === "1") {
    throw new Error(
      `EXIGIR_INTEGRACION=1 y "${suite}" no puede correr: ` +
        (enBuildDeAmplify()
          ? "se esta ejecutando en el contenedor de build de Amplify, que no " +
            "puede asumir el rol de computo SSR. Esta variable no va en " +
            "amplify.yml; la compuerta de integracion se corre antes, contra " +
            "un sandbox."
          : "falta `amplify_outputs.json` o las credenciales para asumir el " +
            "rol de computo SSR. Levantar `npx ampx sandbox` y reintentar."),
    );
  }

  return utilizable;
};
