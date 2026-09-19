import { idiomaPorDefecto, type Idioma } from "@/dictionaries";

/**
 * El idioma que el layout de servidor ya escribio en `<html lang>`.
 *
 * Existe para los **error boundaries**, que Next obliga a que sean componentes
 * cliente y por tanto no pueden leer el header `x-lang` con
 * `obtenerIdiomaDePeticion`. No es una segunda resolucion del idioma: es la
 * lectura del valor que el servidor ya resolvio, para que las dos rutas no
 * puedan discrepar.
 *
 * Cae al idioma por omision cuando no hay documento —el prerenderizado del
 * boundary en el servidor— o cuando el atributo trae algo que no es un idioma
 * soportado.
 */
export const idiomaDelDocumento = (): Idioma => {
  if (typeof document === "undefined") return idiomaPorDefecto;

  const lang = document.documentElement.lang;
  return lang === "es" || lang === "en" ? lang : idiomaPorDefecto;
};
