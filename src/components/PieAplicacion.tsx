import { WorkforceFooter } from "@churchofjesuschrist/eden-workforce-footer";
import type { Idioma } from "@/dictionaries";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";

/**
 * Pie estandarizado de aplicacion de fuerza laboral.
 *
 * **Envuelto en un componente propio por una razon concreta:** `WorkforceFooter`
 * llama a `new Date()` para el ano del aviso legal, y en Next.js 16 leer el
 * reloj durante el prerenderizado es un dato de peticion sin declarar. Leer
 * primero algo de la peticion —aqui el idioma, que sale de `headers()`— coloca
 * el renderizado en modo dinamico y lo vuelve legitimo. Es el mismo patron que
 * usa `icsmx-camp-webapp` en su layout.
 *
 * `lang` del componente son codigos de tres letras (ISO 639-2), no los de dos
 * del resto de la aplicacion.
 */
const CODIGO_DE_TRES_LETRAS: Readonly<Record<Idioma, string>> = {
  es: "spa",
  en: "eng",
};

const PieAplicacion = async () => {
  const idioma = await obtenerIdiomaDePeticion();
  return <WorkforceFooter lang={CODIGO_DE_TRES_LETRAS[idioma]} />;
};

export default PieAplicacion;
