import { forbidden, redirect } from "next/navigation";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import FormularioConvocatoria from "@/components/FormularioConvocatoria";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "../pagina.css";

/**
 * Alta de convocatoria — pantalla 4.4.
 *
 * `force-dynamic` porque exige sesion y permiso: nada de esto puede
 * prerenderizarse.
 */
export const dynamic = "force-dynamic";

const NuevaConvocatoriaPagina = async () => {
  if (!(await getSession())) redirect("/auth/login");

  const permiso = await exigirPermiso("convocatoria:crear");
  if (!permiso.ok) forbidden();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);

  return (
    <main className="convocatorias">
      <header className="convocatorias__encabezado">
        <div>
          <H1>{diccionario.convocatorias.nueva}</H1>
          <Text2 renderAs="p">{diccionario.convocatorias.descripcion}</Text2>
        </div>
      </header>

      <FormularioConvocatoria diccionario={diccionario} />
    </main>
  );
};

export default NuevaConvocatoriaPagina;
