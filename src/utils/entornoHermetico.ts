// Aisla las pruebas del entorno de la maquina y del contenedor de build.
//
// **Una prueba que afirma "sin la variable X pasa Y" no puede confiar en que X
// no este puesta.** Esta en `.env.local` de quien desarrolla, o en las
// variables de la app de Amplify, y en los dos casos llega al proceso de
// Vitest. La suite pasaba en local —donde estas variables no estan en el
// shell— y **fallaba en el despliegue**, donde `APP_ENV=pruebas` y
// `ENABLE_DEV_TOOLS=FULL` si estan: nueve pruebas de golpe, todas afirmando un
// `throw` que ya no ocurria (`desafios-implementacion.md` 70).
//
// La consecuencia mas grave no era el build rojo: era que las guardas de
// seguridad —las que comprueban que el modo simulado **no** se active— pasaban
// en local por la razon equivocada. Una prueba que depende del entorno no
// prueba lo que dice probar.
//
// Se borran, no se fijan a un valor: la ausencia es el estado por omision que
// las guardas tienen que tratar bien (regla 18), y cada prueba que necesite un
// valor lo declara con `vi.stubEnv`.

/**
 * Variables que **deciden** comportamiento y cuyo valor ambiente falsearia una
 * prueba.
 *
 * No es "todas las del proyecto": es la lista de las que alguna prueba
 * interpreta. `AUTOB_TABLE_NAME` y las de CES no estan porque toda prueba que
 * las necesita las declara, y las de integracion las leen de
 * `amplify_outputs.json` y no del entorno.
 */
export const VARIABLES_QUE_DECIDEN = [
  // Compuerta de las herramientas de desarrollo (D-18). Las dos juntas deciden
  // si la autorizacion es real o simulada: es la matriz de
  // `identidad-autorizacion.md` 4.1.2, y con ellas puestas la mitad de sus
  // casillas se vuelve inalcanzable.
  "APP_ENV",
  "ENABLE_DEV_TOOLS",
  "DEV_TOOLS_MOCK_ROLES",
  "DEV_TOOLS_MOCK_PERMISOS",
  // Configuracion de firma de CloudFront. `cloudfrontSigner` tiene pruebas que
  // afirman **que nombra lo que falta**; con las tres puestas no falta nada.
  "CLOUDFRONT_DOMAIN",
  "CLOUDFRONT_KEY_PAIR_ID",
  "CLOUDFRONT_PRIVATE_KEY",
  "CLOUDFRONT_PUBLIC_KEY_PATH",
  // La lee `amplify/backend.ts` al sintetizar y decide si el tema de SNS tiene
  // suscriptor; `backend.test.ts` prueba los dos casos y declara el que quiere.
  "ALARMAS_CORREO",
] as const;

for (const variable of VARIABLES_QUE_DECIDEN) {
  delete process.env[variable];
}
