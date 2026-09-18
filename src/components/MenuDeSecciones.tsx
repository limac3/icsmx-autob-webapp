"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Ghost } from "@churchofjesuschrist/eden-buttons";
import { ContextualMenu } from "@churchofjesuschrist/eden-contextual-menu";
import { Text2 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import type { EnlaceDeMenu } from "@/types/navegacion";
import "./MenuDeSecciones.css";

/**
 * Variante angosta de `NavegacionPrincipal`: las mismas secciones, colapsadas
 * en un desplegable que se abre **hacia abajo**.
 *
 * **Misma forma que `MenuDeUsuario`, y a proposito.** El primer intento
 * colapso la fila horizontal en un `<details>`, y al expandirse la lista
 * seguia siendo una fila: se salia de la pantalla por el costado y empujaba el
 * nombre de usuario fuera de vista. Un desplegable vertical es lo que la
 * aplicacion ya usa para exactamente esto —el menu de la cuenta— y no hay
 * razon para que las secciones se vean distintas.
 *
 * **Con un solo enlace no hay nada que colapsar**: se muestra suelto y
 * navegable, porque envolverlo solo agregaria un clic.
 *
 * Cliente porque abre y cierra con estado, y porque `ContextualMenu` necesita
 * una `ref` al elemento que lo ancla.
 */

export type MenuDeSeccionesProps = {
  /** Ya filtrados por permiso en el servidor. */
  enlaces: readonly EnlaceDeMenu[];
  diccionario: Diccionario;
};

const MenuDeSecciones = ({ enlaces, diccionario }: MenuDeSeccionesProps) => {
  const etiquetas = diccionario.navegacion;
  const [abierto, setAbierto] = useState(false);
  const ancla = useRef<HTMLSpanElement>(null);

  const primero = enlaces[0];
  if (primero === undefined) return null;

  if (enlaces.length === 1) {
    return (
      <Link className="menu-secciones__suelto" href={primero.href}>
        {primero.etiqueta}
      </Link>
    );
  }

  const cerrar = () => setAbierto(false);

  return (
    <div className="menu-secciones">
      {/* El `span` existe solo para anclar el `ContextualMenu`: le hace falta
          una `ref` a un elemento del DOM, igual que en `MenuDeUsuario`. */}
      <span ref={ancla} className="menu-secciones__ancla">
        <Ghost
          type="button"
          small
          aria-expanded={abierto}
          onClick={() => setAbierto((valor) => !valor)}
          onKeyDown={(evento) => {
            if (evento.key === "Escape") cerrar();
          }}
        >
          <span className="menu-secciones__disparador">
            {/* La primera opcion como vista previa, no como enlace: el clic
                abre el menu. Para navegar —incluso a esta— hay que
                expandirlo. */}
            <Text2 renderAs="span">{primero.etiqueta}</Text2>
            <span aria-hidden="true">▾</span>
          </span>
        </Ghost>
      </span>

      <ContextualMenu open={abierto} forRef={ancla} onClickOutside={cerrar}>
        <nav aria-label={etiquetas.menu} className="menu-secciones__panel">
          <ul className="menu-secciones__lista">
            {enlaces.map((enlace) => (
              <li key={enlace.href}>
                <Link
                  className="menu-secciones__enlace"
                  href={enlace.href}
                  onClick={cerrar}
                >
                  {enlace.etiqueta}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </ContextualMenu>
    </div>
  );
};

export default MenuDeSecciones;
