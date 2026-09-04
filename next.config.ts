import type { NextConfig } from "next";

// turbopack.root evita que Next infiera mal la raiz del proyecto: hay un
// lockfile en el directorio padre c:/Apps/node/ (riesgo R13 del plan de
// ejecucion). La CSP con nonce por peticion vive en src/proxy.ts (Etapa 2).
const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // Habilita forbidden()/unauthorized() de next/navigation (Etapa 2: la
    // pagina protegida de prueba usa forbidden() para el rol insuficiente).
    authInterrupts: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
