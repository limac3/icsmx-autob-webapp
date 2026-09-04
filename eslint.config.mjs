import { festackEslintConfig } from "@churchofjesuschrist/festack-scripts";

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  ...festackEslintConfig,
  {
    // typescript-eslint marca como error una interface vacia que solo hace
    // `extends` de otro tipo, pero es exactamente el patron que requiere la
    // augmentacion de modulos de TypeScript (declare module "vitest" { ... }
    // en src/types/testing.d.ts). La opcion with-single-extends es la
    // excepcion que la propia regla ofrece para este caso.
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "with-single-extends" },
      ],
    },
  },
];

export default eslintConfig;
