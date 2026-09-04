import "server-only";
import { headers } from "next/headers";
import { idiomaPorDefecto, type Idioma } from "@/dictionaries";

// src/proxy.ts resuelve el idioma del visitante y lo expone como el header de
// peticion "x-lang" (Etapa 2). Los Server Components lo leen aqui en vez de
// volver a resolverlo desde Accept-Language.
export const obtenerIdiomaDePeticion = async (): Promise<Idioma> => {
  const valor = (await headers()).get("x-lang");
  return valor === "es" || valor === "en" ? valor : idiomaPorDefecto;
};
