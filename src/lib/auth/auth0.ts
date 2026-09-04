import { Auth0Client } from "@auth0/nextjs-auth0/server";

// @auth0/nextjs-auth0 funciona con cualquier proveedor OIDC; aqui apunta a
// Okta (agent_files/identidad-autorizacion.md seccion 2).
//
// Durante `next build` este modulo se importa igual que en runtime (Next
// analiza las rutas), pero no hay secretos disponibles. `requerido()` solo
// exige el valor real en produccion y fuera de la fase de build; si no,
// devuelve un relleno para que el build no falle.
const requerido = (valor: string | undefined, nombre: string): string => {
  const enFaseDeBuild =
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_PHASE === "phase-export";
  if (!enFaseDeBuild && process.env.NODE_ENV === "production" && !valor) {
    throw new Error(
      `Falta configuracion de autenticacion requerida: ${nombre}`,
    );
  }
  return valor ?? "placeholder";
};

export const auth = new Auth0Client({
  domain: requerido(process.env.AUTH0_DOMAIN, "AUTH0_DOMAIN"),
  clientId: requerido(process.env.AUTH0_CLIENT_ID, "AUTH0_CLIENT_ID"),
  clientSecret: requerido(
    process.env.AUTH0_CLIENT_SECRET,
    "AUTH0_CLIENT_SECRET",
  ),
  secret: requerido(process.env.AUTH_SECRET, "AUTH_SECRET"),
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  authorizationParameters: {
    scope: "openid profile email offline_access",
  },
});
