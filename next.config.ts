import type { NextConfig } from "next";

// turbopack.root evita que Next infiera mal la raiz del proyecto: hay un
// lockfile en el directorio padre c:/Apps/node/ (riesgo R13 del plan de
// ejecucion). La CSP con nonce se agrega en la Etapa 2, cuando exista
// src/proxy.ts para generarlo por peticion.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: __dirname,
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
