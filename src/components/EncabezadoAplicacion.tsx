import Link from "next/link";
import { WorkforceHeader } from "@churchofjesuschrist/eden-workforce-header";
import MenuDeUsuario, { type EnlaceDeMenu } from "@/components/MenuDeUsuario";
import { obtenerDiccionario } from "@/dictionaries";
import { getSession } from "@/lib/auth/session";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import { entradasVisibles } from "@/lib/navegacion";

/**
 * Encabezado estandarizado de aplicacion de fuerza laboral.
 *
 * **Aqui se resuelve el menu, y por eso es Server Component.** `entradasVisibles`
 * necesita los permisos de la sesion, que solo existen en el servidor; lo que
 * cruza al cliente es una lista de enlaces ya filtrada — nunca el conjunto de
 * permisos.
 *
 * Sin sesion no lanza ni redirige: el encabezado se dibuja igual, con un
 * enlace de entrada. Vive en el layout raiz, asi que se renderiza tambien en
 * las pantallas publicas y en las de error, donde no hay sesion que leer.
 *
 * Si `getSession()` falla —EAS caido— el encabezado degrada al estado sin
 * sesion en vez de tumbar la pagina. El fallo real lo reporta la pantalla, que
 * es quien depende de los permisos para decidir algo (regla 15); repetirlo aqui
 * solo cambiaria un error util por un error del encabezado.
 */
const EncabezadoAplicacion = async () => {
  const [sesion, idioma] = await Promise.all([
    getSession().catch(() => null),
    obtenerIdiomaDePeticion(),
  ]);
  const diccionario = obtenerDiccionario(idioma);

  const enlaces: EnlaceDeMenu[] = sesion
    ? entradasVisibles(sesion.permisos).map((entrada) => ({
        href: entrada.href,
        etiqueta: diccionario.navegacion[entrada.id],
      }))
    : [];

  return (
    <WorkforceHeader
      name={<Link href="/">{diccionario.comun.nombreAplicacion}</Link>}
      tools={
        <MenuDeUsuario
          nombre={sesion?.nombre ?? null}
          enlaces={enlaces}
          diccionario={diccionario}
        />
      }
    />
  );
};

export default EncabezadoAplicacion;
