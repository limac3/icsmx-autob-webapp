import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fonts } from "@churchofjesuschrist/eden-fonts";
import { Normalize } from "@churchofjesuschrist/eden-normalize";
import { obtenerDiccionario } from "@/dictionaries";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "./globals.css";

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
        {children}
      </body>
    </html>
  );
};

export default RaizAplicacion;
