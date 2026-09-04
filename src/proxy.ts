import { NextResponse, type NextRequest } from "next/server";
import { idiomaPorDefecto, type Idioma } from "@/dictionaries";
import { auth } from "@/lib/auth/auth0";

// Next.js 16 renombro `middleware` a `proxy` (AGENTS.md). Este archivo NO
// autoriza: distingue publico de autenticado y prepara idioma/CSP. Las
// decisiones por rol viven en el Server Component o la Server Action, con la
// sesion completa y el contexto del recurso a la vista (ver
// agent_files/identidad-autorizacion.md seccion 2.3).

const IDIOMAS_SOPORTADOS: readonly Idioma[] = ["es", "en"];

const resolverIdioma = (request: NextRequest): Idioma => {
  const encabezado = request.headers.get("accept-language") ?? "";
  const preferido = encabezado.split(",")[0]?.split("-")[0]?.toLowerCase();
  const soportado = IDIOMAS_SOPORTADOS.find((idioma) => idioma === preferido);
  return soportado ?? idiomaPorDefecto;
};

const esRutaDeAutenticacion = (pathname: string) =>
  pathname.startsWith("/auth/");

const esRedireccion = (response: NextResponse) =>
  response.status >= 300 && response.status < 400;

const generarNonce = () => Buffer.from(crypto.randomUUID()).toString("base64");

// Nonce estricto para script-src: es la superficie que de verdad importa
// contra XSS. style-src se deja con 'unsafe-inline' a proposito: Eden es una
// libreria externa cuyo uso de estilos en linea no esta verificado todavia
// (no hay acceso al MCP de Eden en este entorno); endurecerlo sin poder
// revisar visualmente cada componente es mas riesgo que beneficio. Revisar
// en la Etapa 12 — ver agent_files/desafios-implementacion.md.
const construirCsp = (nonce: string) => {
  const enDesarrollo = process.env.NODE_ENV === "development";
  const dominioCloudfront = process.env.CLOUDFRONT_DOMAIN;
  const origenImagenes = dominioCloudfront
    ? ` https://${dominioCloudfront}`
    : "";

  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${enDesarrollo ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:${origenImagenes}`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
};

// Ninguna ruta de esta aplicacion es publica/anonima: hasta el catalogo de
// convocatorias publicadas exige sesion (permission-matrix.md seccion 3), asi
// que "no-store" aplica a toda respuesta salvo las que maneja el propio SDK
// de autenticacion.
const CACHE_CONTROL_SIN_ALMACENAR =
  "no-store, no-cache, must-revalidate, proxy-revalidate, private";

export const proxy = async (request: NextRequest) => {
  const idioma = resolverIdioma(request);
  const authResponse = await auth.middleware(request);

  if (
    esRutaDeAutenticacion(request.nextUrl.pathname) ||
    esRedireccion(authResponse)
  ) {
    authResponse.headers.set("x-lang", idioma);
    return authResponse;
  }

  const nonce = generarNonce();
  const csp = construirCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-lang", idioma);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const cookie of authResponse.cookies.getAll()) {
    response.cookies.set(cookie);
  }
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-lang", idioma);
  response.headers.set("Cache-Control", CACHE_CONTROL_SIN_ALMACENAR);

  return response;
};

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
