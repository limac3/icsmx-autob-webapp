// Etapa 10. Las dos tareas de `arquitectura-tecnica-aws.md` 2.6: aplicar T5 a
// las adjudicaciones vencidas y despachar el outbox de correo. La logica vive
// en `src/lib`, no aqui — este archivo solo es el punto de entrada que
// `defineFunction` empaqueta (`amplify/barrido/resource.ts`).
//
// **Rutas relativas y no el alias `@/`.** `amplify/tsconfig.json` no comparte
// los `paths` del `tsconfig.json` raiz (esta fuera de su `include`), y el
// empaquetado con `esbuild` de `defineFunction` resuelve contra el archivo de
// entrada, no contra el proyecto de Next. El alias solo funcionaria por
// casualidad si algun dia coincide la resolucion; las rutas relativas no
// dependen de esa coincidencia.
import { barridoDeVencimientos } from "../../src/lib/fila/barridoDeVencimientos.ts";
import { procesarOutbox } from "../../src/lib/correo/procesarOutbox.ts";

export const handler = async (): Promise<void> => {
  const nombreTabla = process.env.AUTOB_TABLE_NAME;

  // Sin fallback silencioso (regla 15): si la variable no llego, el despliegue esta mal y
  // hay que verlo ahora, no cuando el barrido tenga que vencer una adjudicacion real.
  if (!nombreTabla) {
    throw new Error(
      "Falta AUTOB_TABLE_NAME en el entorno de la funcion de barrido.",
    );
  }

  const vencimientos = await barridoDeVencimientos();
  const correo = await procesarOutbox();

  console.info(
    JSON.stringify({
      mensaje: "barrido ejecutado",
      tabla: nombreTabla,
      vencimientos,
      correo,
    }),
  );
};
