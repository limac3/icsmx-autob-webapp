"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ContextualMenu } from "@churchofjesuschrist/eden-contextual-menu";
import { Ghost } from "@churchofjesuschrist/eden-buttons";
import { Text2, Text3 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import "./MenuDeUsuario.css";

/**
 * Menu de la aplicacion, en el slot `tools` del `WorkforceHeader`.
 *
 * **No recibe permisos, recibe enlaces.** El filtrado ya ocurrio en el
 * servidor (`EncabezadoAplicacion.tsx` con `entradasVisibles`), asi que este
 * componente no puede equivocarse al decidir quien ve que: no tiene con que
 * decidirlo. De paso, la lista de permisos de la sesion no cruza al cliente.
 *
 * Patron de **divulgacion** (boton `aria-expanded` + panel), no `role="menu"`:
 * el contenido son enlaces de navegacion, y un menu ARIA obligaria a
 * implementar navegacion por flechas para cumplir su contrato.
 *
 * Cliente porque abre y cierra con estado, y porque `ContextualMenu` necesita
 * una `ref` al elemento que lo ancla.
 */

export type EnlaceDeMenu = {
  readonly href: string;
  readonly etiqueta: string;
};

export type MenuDeUsuarioProps = {
  /** `null` sin sesion: el menu se reduce a un enlace de entrada. */
  nombre: string | null;
  /** Ya filtrados por permiso en el servidor. Puede venir vacio. */
  enlaces: readonly EnlaceDeMenu[];
  diccionario: Diccionario;
};

const MenuDeUsuario = ({
  nombre,
  enlaces,
  diccionario,
}: MenuDeUsuarioProps) => {
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
        <nav aria-label={etiquetas.menu} className="menu-usuario__panel">
          {enlaces.length === 0 ? (
            <Text3 renderAs="p" className="menu-usuario__vacio">
              {etiquetas.sinAccesos}
            </Text3>
          ) : (
            <ul className="menu-usuario__lista">
              {enlaces.map((enlace) => (
                <li key={enlace.href}>
                  <Link
                    className="menu-usuario__enlace"
                    href={enlace.href}
                    onClick={cerrar}
                  >
                    {enlace.etiqueta}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <ul className="menu-usuario__lista menu-usuario__lista--cuenta">
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
