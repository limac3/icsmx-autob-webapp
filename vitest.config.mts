import path from "node:path";
import { defineProject, mergeConfig } from "vitest/config";
import { festackVitestConfig } from "@churchofjesuschrist/festack-scripts";

const customConfig = mergeConfig(
  festackVitestConfig,
  defineProject({
    test: {
      alias: { "@": path.resolve(import.meta.dirname, "src") },
    },
  }),
);

export default customConfig;
