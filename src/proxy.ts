import { NextResponse, type NextRequest } from "next/server";
import { idiomaPorDefecto, type Idioma } from "@/dictionaries";
import { auth } from "@/lib/auth/auth0";

// Next.js 16 renombro `middleware` a `proxy` (AGENTS.md). Este archivo NO
// autoriza: distingue publico de autenticado y prepara idioma/CSP. Las
// decisiones por permiso viven en el Server Component o la Server Action, con la
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

// Origen del Font Foundry de la Iglesia. `<Fonts>` de @churchofjesuschrist/eden-fonts
// monta un `<link rel="stylesheet">` hacia aqui y desde ahi se descargan los
// woff2, asi que el origen tiene que estar autorizado en **style-src y
// font-src**. Sin esto la aplicacion se dibuja con tipografia de respaldo y la
// consola del navegador se llena de violaciones de CSP: ni `next build` ni
// jsdom lo detectan, porque ninguno de los dos aplica CSP.
const FOUNDRY = "https://foundry.churchofjesuschrist.org";

// Nonce estricto para script-src: es la superficie que de verdad importa
// contra XSS.
//
// **style-src conserva 'unsafe-inline', y en la Etapa 12 se comprobo que no se
// puede quitar.** La decision del 2026-09-04 lo dejo pendiente por falta de
// evidencia; la evidencia esta en los paquetes instalados y son dos hechos
// independientes, cada uno suficiente por si solo:
//
//   1. Eden no publica **ningun** archivo .css. Cada componente lleva su hoja
//      como cadena y la monta con `<style href="..." precedence="eden">` —el
//      izado de hojas de estilo de React 19—, que produce un elemento `<style>`
//      en linea. Eden no acepta un nonce que pasarle, asi que `style-src-elem`
//      exige 'unsafe-inline'. Se ve, por ejemplo, en
//      `eden-table/lib/es/components/Table/Table.js`.
//   2. Ademas hay atributos `style={{...}}` en componentes que esta aplicacion
//      usa en casi toda pantalla: `TD`, `TH`, `TR` y `SortButton` de
//      eden-table; `Hint`, `Select`, `FieldSet` y `SharedInput` de
//      eden-form-parts; `Item` de eden-grid. Eso exige 'unsafe-inline' tambien
//      en `style-src-attr`.
//
// Partir la directiva en `style-src-elem` y `style-src-attr` no gana nada:
// ambas necesitarian el mismo permiso. Endurecerla romperia visualmente la
// aplicacion sin que `next build` ni jsdom lo detecten, porque ninguno de los
// dos aplica CSP. Queda como riesgo aceptado y documentado.
const construirCsp = (nonce: string) => {
  const enDesarrollo = process.env.NODE_ENV === "development";
  const dominioCloudfront = process.env.CLOUDFRONT_DOMAIN;
  const origenImagenes = dominioCloudfront
    ? ` https://${dominioCloudfront}`
    : "";

  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${enDesarrollo ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline' ${FOUNDRY}`,
    `img-src 'self' data: blob:${origenImagenes}`,
    `font-src 'self' ${FOUNDRY}`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
};

// Ninguna ruta de esta aplicacion es publica/anonima: hasta el catalogo de
// convocatorias publicadas exige sesion (permission-matrix.md seccion 4), asi
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
