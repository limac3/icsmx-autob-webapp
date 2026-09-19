// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  backendParaRegresion,
  enBuildDeAmplify,
  puedeUsarBackendReal,
} from "./backendUtilizable";

const SALIDAS = { tabla: "autob", rolComputoSsr: "arn:aws:iam::1:role/ssr" };

afterEach(() => {
  vi.unstubAllEnvs();
});

// `AWS_APP_ID` puede existir de verdad en el entorno que ejecuta esto, y
// entonces `enBuildDeAmplify()` seria cierto y todas las afirmaciones de abajo
// cambiarian de sentido. Se fija vacio salvo donde se prueba justo eso.
const fueraDelBuild = () => {
  vi.stubEnv("AWS_APP_ID", "");
};

describe("puedeUsarBackendReal", () => {
  it("exige la tabla y el rol, no solo que exista el archivo de salidas", () => {
    fueraDelBuild();
    expect(puedeUsarBackendReal(SALIDAS)).toBe(true);
    expect(puedeUsarBackendReal({ tabla: "autob" })).toBe(false);
    expect(puedeUsarBackendReal(null)).toBe(false);
  });

  it("en el contenedor de build de Amplify siempre es false", () => {
    // `pipeline-deploy` **genera** `amplify_outputs.json`, asi que sin esta
    // condicion las suites se activarian alli y fallarian con AccessDenied.
    vi.stubEnv("AWS_APP_ID", "d2i0gloex3vqjp");
    expect(enBuildDeAmplify()).toBe(true);
    expect(puedeUsarBackendReal(SALIDAS)).toBe(false);
  });
});

describe("backendParaRegresion", () => {
  it("sin la variable se comporta igual: omite en silencio", () => {
    fueraDelBuild();
    vi.stubEnv("EXIGIR_INTEGRACION", "");

    expect(backendParaRegresion(SALIDAS, "fila")).toBe(true);
    expect(backendParaRegresion(null, "fila")).toBe(false);
  });

  it("con EXIGIR_INTEGRACION=1 la omision deja de ser silenciosa", () => {
    // El defecto que cierra: un verde de `verify:rapido` sin sandbox es
    // indistinguible de uno que si ejercito la concurrencia.
    fueraDelBuild();
    vi.stubEnv("EXIGIR_INTEGRACION", "1");

    expect(() =>
      backendParaRegresion(null, "motor de fila (regla 16)"),
    ).toThrow(/motor de fila \(regla 16\)/);
    expect(() => backendParaRegresion(null, "fila")).toThrow(/ampx sandbox/);
  });

  it("no estorba cuando el backend si esta disponible", () => {
    fueraDelBuild();
    vi.stubEnv("EXIGIR_INTEGRACION", "1");

    expect(backendParaRegresion(SALIDAS, "fila")).toBe(true);
  });

  it("dentro del build de Amplify explica que la variable no va ahi", () => {
    // Sin este mensaje, el modo de fallo previsible es que alguien la ponga en
    // `amplify.yml` para "arreglarlo" y rompa el despliegue: ahi las pruebas no
    // pueden correr por diseno.
    vi.stubEnv("AWS_APP_ID", "d2i0gloex3vqjp");
    vi.stubEnv("EXIGIR_INTEGRACION", "1");

    expect(() => backendParaRegresion(SALIDAS, "fila")).toThrow(/amplify\.yml/);
  });
});
