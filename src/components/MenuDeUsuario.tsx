"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ContextualMenu } from "@churchofjesuschrist/eden-contextual-menu";
import { Ghost } from "@churchofjesuschrist/eden-buttons";
import { Text2 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import "./MenuDeUsuario.css";

/**
 * Menu de cuenta, en el slot `tools` del `WorkforceHeader`, junto a
 * `NavegacionPrincipal`.
 *
 * **Solo los accesos fijos de la cuenta** — "Mi sesion" y "Cerrar sesion".
 * Los enlaces que dependen de permisos viven en `NavegacionPrincipal` y no
 * aqui: antes compartian este menu y quedaban escondidos detras de un clic
 * sobre el nombre, cuando el requerimiento es que se vean siempre, junto al
 * nombre.
 *
 * Patron de **divulgacion** (boton `aria-expanded` + panel), no `role="menu"`:
 * el contenido son enlaces de navegacion, y un menu ARIA obligaria a
 * implementar navegacion por flechas para cumplir su contrato.
 *
 * Cliente porque abre y cierra con estado, y porque `ContextualMenu` necesita
 * una `ref` al elemento que lo ancla.
 */

export type MenuDeUsuarioProps = {
  /** `null` sin sesion: el menu se reduce a un enlace de entrada. */
  nombre: string | null;
  diccionario: Diccionario;
};

const MenuDeUsuario = ({ nombre, diccionario }: MenuDeUsuarioProps) => {
  const etiquetas = diccionario.navegacion;
  const [abierto, setAbierto] = useState(false);
  const ancla = useRef<HTMLSpanElement>(null);

  if (nombre === null) {
    return (
      <a className="menu-usuario__entrar" href="/auth/login">
        {etiquetas.entrar}
      </a>
    );
  }

  const cerrar = () => setAbierto(false);

  return (
    <div className="menu-usuario">
      {/* El `span` existe solo para anclar el `ContextualMenu`: le hace falta
          una `ref` a un elemento del DOM, y envolver es mas fiable que confiar
          en que un componente de Eden reenvie la suya. */}
      <span ref={ancla} className="menu-usuario__ancla">
        <Ghost
          type="button"
          small
          aria-expanded={abierto}
          onClick={() => setAbierto((valor) => !valor)}
          // Escape en el propio boton, no en un contenedor: un `<div>` con
          // manejador de teclado es un elemento interactivo no nativo, y
          // `jsx-a11y/no-static-element-interactions` lo rechaza con razon.
          // Al abrir, el foco se queda aqui, que es donde se pulsa Escape.
          onKeyDown={(evento) => {
            if (evento.key === "Escape") cerrar();
          }}
        >
          <span className="menu-usuario__disparador">
            <Text2 renderAs="span">{nombre}</Text2>
            <span aria-hidden="true">▾</span>
          </span>
        </Ghost>
      </span>

      <ContextualMenu open={abierto} forRef={ancla} onClickOutside={cerrar}>
        {/* Etiqueta propia, distinta de la de `NavegacionPrincipal`: desde que
            son dos menus, dos landmarks de navegacion con el mismo nombre
            accesible no se distinguirian con un lector de pantalla. */}
        <nav aria-label={etiquetas.menuCuenta} className="menu-usuario__panel">
          <ul className="menu-usuario__lista">
            <li>
              <Link
                className="menu-usuario__enlace"
                href="/sesion"
                onClick={cerrar}
              >
                {etiquetas.miSesion}
              </Link>
            </li>
            <li>
              {/* `<a>` y no `<Link>`: /auth/logout lo atiende el SDK de Auth0
                  fuera del enrutador de la aplicacion. */}
              <a className="menu-usuario__enlace" href="/auth/logout">
                {etiquetas.salir}
              </a>
            </li>
          </ul>
        </nav>
      </ContextualMenu>
    </div>
  );
};

export default MenuDeUsuario;
