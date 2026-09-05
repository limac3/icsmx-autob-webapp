import { forbidden, redirect } from "next/navigation";
import { H1 } from "@churchofjesuschrist/eden-headings";
import FormularioVehiculo from "@/components/FormularioVehiculo";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { modeloMaximo } from "@/lib/domain/vehiculos";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";

/** Alta de vehiculo — pantalla 4.2 de `ui-ux-requerimientos.md`. */
export const dynamic = "force-dynamic";

const NuevoVehiculo = async () => {
  if (!(await getSession())) redirect("/auth/login");

  const permiso = await exigirPermiso("vehiculo:crear");
  if (!permiso.ok) forbidden();

  const diccionario = obtenerDiccionario(await obtenerIdiomaDePeticion());

  return (
    <main className="pagina-vehiculo">
      <H1>{diccionario.vehiculos.nuevo}</H1>
      <FormularioVehiculo
        diccionario={diccionario}
        // El limite se calcula en el servidor, en hora de negocio: el reloj del
        // navegador puede estar en otra zona o mal puesto (regla 9).
        modeloMaximo={modeloMaximo(new Date())}
      />
    </main>
  );
};

export default NuevoVehiculo;
