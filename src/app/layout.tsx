import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { Fonts } from "@churchofjesuschrist/eden-fonts";
import { Normalize } from "@churchofjesuschrist/eden-normalize";
import EncabezadoAplicacion from "@/components/EncabezadoAplicacion";
import PanelDeIdentidadSimulada from "@/components/PanelDeIdentidadSimulada";
import PieAplicacion from "@/components/PieAplicacion";
import { obtenerDiccionario } from "@/dictionaries";
import { impersonacionHabilitada } from "@/lib/auth/impersonacion";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "./globals.css";
import "./layout.css";

export const generateMetadata = async (): Promise<Metadata> => {
  const idioma = await obtenerIdiomaDePeticion();
  return { title: obtenerDiccionario(idioma).comun.nombreAplicacion };
};

const RaizAplicacion = async ({ children }: { children: ReactNode }) => {
  const idioma = await obtenerIdiomaDePeticion();

  return (
    <html lang={idioma}>
      <body>
        <Fonts lang={idioma} />
        <Normalize />

        {/* Rejilla `auto 1fr auto`: el pie queda abajo aunque la pantalla
            tenga poco contenido. Mismo armado que `icsmx-camp-webapp`. */}
        <div className="envoltura">
          {/* Encabezado y pie van en `<Suspense>` propios porque los dos leen
              datos de la peticion —el encabezado la sesion, el pie el idioma—
              y ninguno debe retrasar el contenido, que es lo que la persona
              vino a ver. */}
          <Suspense fallback={<div className="envoltura__hueco-encabezado" />}>
            <EncabezadoAplicacion />
          </Suspense>

          {/* Un `<div>`, no un `<main>`: cada pantalla monta el suyo, con su
              propia clase. Anidar landmarks `main` seria HTML invalido. */}
          <div className="envoltura__contenido">{children}</div>

          <Suspense fallback={null}>
            <PieAplicacion />
          </Suspense>
        </div>

        {/* Conmutador de identidad simulada — solo con ENABLE_DEV_TOOLS=FULL.
            La condicion se resuelve leyendo unicamente el entorno, asi que en
            produccion el arbol es identico al de antes: ni el componente ni la
            action entran en el grafo de renderizado.

            Dentro de un `<Suspense>` porque el panel lee la sesion, y esa
            lectura no debe retrasar el resto del cuerpo ni tumbarlo si falla. */}
        {impersonacionHabilitada() ? (
          <Suspense fallback={null}>
            <PanelDeIdentidadSimulada />
          </Suspense>
        ) : null}
      </body>
    </html>
  );
};

export default RaizAplicacion;
