import es from "./es.json";
import en from "./en.json";

// Idioma por defecto "es" (regla 11 de CLAUDE.md). La resolucion del idioma
// del visitante se conecta en la Etapa 2 desde src/proxy.ts; por ahora este
// modulo solo resuelve un diccionario dado un idioma explicito.
export type Idioma = "es" | "en";

const diccionarios = { es, en } satisfies Record<Idioma, unknown>;

export type Diccionario = (typeof diccionarios)[Idioma];

export const idiomaPorDefecto: Idioma = "es";

export const obtenerDiccionario = (
  idioma: Idioma = idiomaPorDefecto,
): Diccionario => diccionarios[idioma] ?? diccionarios[idiomaPorDefecto];
