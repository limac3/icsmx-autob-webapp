import Link from "next/link";
import { Text3 } from "@churchofjesuschrist/eden-text";
import MenuDeSecciones from "@/components/MenuDeSecciones";
import type { Diccionario } from "@/dictionaries";
import type { EnlaceDeMenu } from "@/types/navegacion";
import "./NavegacionPrincipal.css";

/**
 * Los enlaces de navegacion que dependen de permisos (`entradasVisibles`),
 * junto al nombre de usuario en el encabezado — no escondidos en su menu
 * (ese es `MenuDeUsuario`, que solo lleva los accesos fijos de la cuenta).
 *
 * **Dos variantes siempre renderizadas y el CSS decide cual se ve**, el mismo
 * patron mobile-first que ya usan `Table`/`CardView` (regla 12):
 *
 *   - **Ancha**: una fila horizontal en blanco, alineada a la derecha. Server
 *     Component: son enlaces, no necesitan JavaScript.
 *   - **Angosta**: `MenuDeSecciones`, que las colapsa en un desplegable
 *     vertical. Ahi si hace falta cliente, por el estado de apertura.
 *
 * El caso de **una sola seccion** lo resuelve `MenuDeSecciones`: la muestra
 * suelta, sin nada que expandir.
 */

export type NavegacionPrincipalProps = {
  /** Ya filtrados por permiso en el servidor. Puede venir vacio. */
  enlaces: readonly EnlaceDeMenu[];
  diccionario: Diccionario;
};

const NavegacionPrincipal = ({
  enlaces,
  diccionario,
}: NavegacionPrincipalProps) => {
  const etiquetas = diccionario.navegacion;

  if (enlaces.length === 0) {
    return (
      <Text3 renderAs="p" className="navegacion-principal__vacio">
        {etiquetas.sinAccesos}
      </Text3>
    );
  }

  return (
    <>
      <nav aria-label={etiquetas.menu} className="navegacion-principal__ancha">
        <ul className="navegacion-principal__lista">
          {enlaces.map((enlace) => (
            <li key={enlace.href}>
              <Link className="navegacion-principal__enlace" href={enlace.href}>
                {enlace.etiqueta}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="navegacion-principal__angosta">
        <MenuDeSecciones enlaces={enlaces} diccionario={diccionario} />
      </div>
    </>
  );
};

export default NavegacionPrincipal;
