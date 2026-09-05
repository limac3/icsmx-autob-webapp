import { forbidden, redirect } from "next/navigation";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import { getSession } from "@/lib/auth/session";
import { obtenerDiccionario } from "@/dictionaries";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";

// Pagina protegida de prueba de la Etapa 2: prueba, de punta a punta, que
// "sin sesion" redirige a login y que "sesion sin permisos" da 403 (no 500)
// — ver agent_files/plan-ejecucion.md. No es una pantalla de negocio.
export const dynamic = "force-dynamic";

const SesionPagina = async () => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");
  if (sesion.permisos.size === 0) forbidden();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const {
    sesion: etiquetas,
    permisos: etiquetasPermisos,
    tiposConvocatoria,
  } = diccionario;

  return (
    <main>
      <H1>{etiquetas.titulo}</H1>
      <dl>
        <dt>
          <Text2 renderAs="span">{etiquetas.etiquetaNombre}</Text2>
        </dt>
        <dd>
          <Text2 renderAs="span">{sesion.nombre}</Text2>
        </dd>
        <dt>
          <Text2 renderAs="span">{etiquetas.etiquetaCorreo}</Text2>
        </dt>
        <dd>
          <Text2 renderAs="span">{sesion.correo}</Text2>
        </dd>
        <dt>
          <Text2 renderAs="span">{etiquetas.etiquetaPermisos}</Text2>
        </dt>
        <dd>
          <Text2 renderAs="span">
            {[...sesion.permisos]
              .map((permiso) => etiquetasPermisos[permiso])
              .join(", ")}
          </Text2>
        </dd>
        <dt>
          <Text2 renderAs="span">{etiquetas.etiquetaTiposDeConvocatoria}</Text2>
        </dt>
        <dd>
          <Text2 renderAs="span">
            {sesion.tiposDeConvocatoriaPermitidos
              .map((tipo) => tiposConvocatoria[tipo])
              .join(", ")}
          </Text2>
        </dd>
      </dl>
    </main>
  );
};

export default SesionPagina;
