import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import { obtenerDiccionario } from "@/dictionaries";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";

// Limite global de forbidden() (Next.js, experimental.authInterrupts). Se
// activa cuando una sesion valida no tiene ningun rol reconocido — ver
// src/app/sesion/page.tsx y agent_files/plan-ejecucion.md Etapa 2.
const ForbiddenPagina = async () => {
  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);

  return (
    <main>
      <H1>{diccionario.prohibido.titulo}</H1>
      <Text2 renderAs="p">{diccionario.prohibido.descripcion}</Text2>
    </main>
  );
};

export default ForbiddenPagina;
