import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fonts } from "@churchofjesuschrist/eden-fonts";
import { Normalize } from "@churchofjesuschrist/eden-normalize";
import { obtenerDiccionario } from "@/dictionaries";
import "./globals.css";

export const metadata: Metadata = {
  title: obtenerDiccionario().comun.nombreAplicacion,
};

const RaizAplicacion = ({ children }: { children: ReactNode }) => (
  <html lang="es">
    <body>
      <Fonts lang="es" />
      <Normalize />
      {children}
    </body>
  </html>
);

export default RaizAplicacion;
