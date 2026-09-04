import { H1 } from "@churchofjesuschrist/eden-headings";
import EstadoServicio from "@/components/EstadoServicio";
import { obtenerDiccionario } from "@/dictionaries";
import { obtenerEstadoAplicacion } from "@/lib/estadoAplicacion";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";

// Pagina minima de la Etapa 1 (scaffold y toolchain). El catalogo real de
// convocatorias llega en la Etapa 7; ver agent_files/plan-ejecucion.md.
//
// force-dynamic: obtenerEstadoAplicacion() incluye la hora de la consulta.
// Sin este flag, Next prerenderiza la pagina en el build y ese timestamp
// queda congelado para siempre (regla 14 de CLAUDE.md, aplicada aqui aunque
// todavia no haya convocatorias: nada que dependa del momento de la
// peticion entra a cache estatica).
export const dynamic = "force-dynamic";

const InicioPagina = async () => {
  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const estado = obtenerEstadoAplicacion();

  return (
    <main>
      <H1>{diccionario.comun.nombreAplicacion}</H1>
      <EstadoServicio estado={estado} diccionario={diccionario} />
    </main>
  );
};

export default InicioPagina;
