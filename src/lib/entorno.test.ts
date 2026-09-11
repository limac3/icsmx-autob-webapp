// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { urlBaseDeLaApp } from "./entorno";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("urlBaseDeLaApp", () => {
  // Los dos consumidores concatenan una ruta que ya empieza con `/`: la
  // plantilla del correo y el `appBaseUrl` del SDK de Auth0. Una barra final
  // —como queda al pegar la URL desde el navegador— produce `host//auth/callback`,
  // que no coincide con la URL registrada en Okta y rompe el login con un error
  // que no menciona la barra.
  it("quita la barra final", () => {
    vi.stubEnv("APP_BASE_URL", "https://main.ejemplo.amplifyapp.com/");
    expect(urlBaseDeLaApp()).toBe("https://main.ejemplo.amplifyapp.com");
  });

  it("quita varias barras finales", () => {
    vi.stubEnv("APP_BASE_URL", "https://ejemplo.com///");
    expect(urlBaseDeLaApp()).toBe("https://ejemplo.com");
  });

  it("deja intacta una URL sin barra final", () => {
    vi.stubEnv("APP_BASE_URL", "https://ejemplo.com");
    expect(urlBaseDeLaApp()).toBe("https://ejemplo.com");
  });

  it("no toca las barras de una ruta base", () => {
    // Un despliegue bajo subruta es legitimo; solo sobra la del final.
    vi.stubEnv("APP_BASE_URL", "https://ejemplo.com/autob/");
    expect(urlBaseDeLaApp()).toBe("https://ejemplo.com/autob");
  });

  it("sin la variable cae a localhost, que es visible de inmediato", () => {
    // No se inventa un valor de produccion: un enlace a localhost en un correo
    // se nota, y eso es preferible a adivinar el dominio.
    vi.stubEnv("APP_BASE_URL", "");
    expect(urlBaseDeLaApp()).toBe("http://localhost:3000");
  });
});
