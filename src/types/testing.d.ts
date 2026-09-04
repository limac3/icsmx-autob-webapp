// Tipos ambientales para el arnes de pruebas de festack-scripts.
//
// `globalThis.axe` y el matcher `toHaveNoViolations` los registra en tiempo de
// ejecucion vitest-javascript.setup.mjs (dentro de @churchofjesuschrist/festack-scripts);
// ese paquete no publica tipos, asi que se declaran aqui para que
// src/utils/testHelpers.tsx compile bajo TypeScript strict.
import "vitest";
import type { AxeResults } from "axe-core";

interface MatchersDeAccesibilidad<R = unknown> {
  toHaveNoViolations(): R;
}

declare module "vitest" {
  interface Assertion<T = unknown> extends MatchersDeAccesibilidad<T> {}
  interface AsymmetricMatchersContaining extends MatchersDeAccesibilidad {}
}

declare global {
  var axe: (element: Element | Document) => Promise<AxeResults>;
}

export {};
