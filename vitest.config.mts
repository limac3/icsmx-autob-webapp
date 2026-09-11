import path from "node:path";
import { defineProject, mergeConfig } from "vitest/config";
import { festackVitestConfig } from "@churchofjesuschrist/festack-scripts";

const customConfig = mergeConfig(
  festackVitestConfig,
  defineProject({
    test: {
      alias: { "@": path.resolve(import.meta.dirname, "src") },
      // Se **suma** a los tres `setupFiles` de festack (`mergeConfig` concatena
      // arreglos), no los reemplaza. Borra del entorno las variables que
      // deciden comportamiento, para que ninguna prueba dependa de lo que haya
      // en el shell de quien desarrolla ni en el contenedor de build: la suite
      // pasaba en local y fallaba en el despliegue, donde `APP_ENV` y
      // `ENABLE_DEV_TOOLS` si estan puestas. Ver `entornoHermetico.ts`.
      setupFiles: [
        path.resolve(import.meta.dirname, "src/utils/entornoHermetico.ts"),
      ],
    },
  }),
);

export default customConfig;
