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
//
// **Ninguno de los 17 archivos que este handler alcanza lleva `import
// "server-only"`.** Ese paquete decide entre un no-op y un `throw` segun la
// condicion de exportacion con la que se resuelva; Next activa
// `"react-server"` en su build y aqui el empaquetado es `esbuild` puro via
// `NodejsFunction`, que no la activa y cae siempre en el `throw` — el barrido
// fallaba en el 100% de sus invocaciones desde que Etapa 10 empezo a llamar
// codigo marcado asi, sin que ninguna prueba lo viera (Vitest no pasa por
// este mismo empaquetado). `defineFunction` no expone forma de pasarle
// `--conditions` a su esbuild, así que la guarda se quito de estos 17 —
// motor de fila, capa de datos y observabilidad— y se dejo en los otros 63
// archivos de `src/lib` que la llevan. Ver `desafios-implementacion.md`
// seccion 53.
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

  // Sin linea propia del handler. Cada una de las dos tareas ya deja la suya
  // —`conTraza` en `barridoDeVencimientos` y en `procesarOutbox`—, y son esas
  // las que los filtros de metrica de `amplify/alarmas.ts` leen. Una tercera
  // linea que repitiera los mismos contadores con otros nombres duplicaria el
  // volumen y obligaria a mantener dos formatos que tienen que coincidir.
  await barridoDeVencimientos();
  await procesarOutbox();
};
