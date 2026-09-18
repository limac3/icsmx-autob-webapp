import Link from "next/link";
import { Drawer, Summary } from "@churchofjesuschrist/eden-accordion";
import { Text3 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import "./NavegacionPrincipal.css";

/**
 * Los enlaces de navegacion que dependen de permisos (`entradasVisibles`),
 * junto al nombre de usuario en el encabezado — no escondidos en su menu
 * (ese es `MenuDeUsuario`, que solo lleva los accesos fijos de la cuenta).
 *
 * **Server Component.** El colapso en pantalla angosta es un `<details>`
 * nativo (`Drawer` de `eden-accordion`), asi que abrirlo y cerrarlo no
 * necesita JavaScript de cliente.
 *
 * **Dos variantes, la misma lista, y el CSS decide cual se ve** — el mismo
 * patron mobile-first que ya usan `Table`/`CardView` (regla 12): ancha,
 * siempre una fila horizontal; angosta, el enlace suelto si solo hay uno
 * —envolverlo en un colapsable no ahorra nada, solo agrega un clic— o un
 * `<details>` si hay mas de uno, cuyo resumen es solo vista previa: hay que
 * expandirlo para navegar a cualquier opcion, incluida la primera.
 */

export type EnlaceDeMenu = {
  readonly href: string;
  readonly etiqueta: string;
};

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

  const lista = (
    <ul className="navegacion-principal__lista">
      {enlaces.map((enlace) => (
        <li key={enlace.href}>
          <Link className="navegacion-principal__enlace" href={enlace.href}>
            {enlace.etiqueta}
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <nav aria-label={etiquetas.menu} className="navegacion-principal">
      <div className="navegacion-principal__ancha">{lista}</div>

      <div className="navegacion-principal__angosta">
        {enlaces.length === 1 ? (
          lista
        ) : (
          <Drawer>
            <Summary>{enlaces[0]?.etiqueta}</Summary>
            {lista}
          </Drawer>
        )}
      </div>
    </nav>
  );
};

export default NavegacionPrincipal;
