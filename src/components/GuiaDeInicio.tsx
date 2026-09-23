import Link from "next/link";
import { Drawer, Summary } from "@churchofjesuschrist/eden-accordion";
import { Secondary } from "@churchofjesuschrist/eden-buttons";
import { H2 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import type { IdDeBloqueDeGuia } from "@/lib/guiaDeInicio";
import "./GuiaDeInicio.css";

/**
 * La guia del home: que puede hacer aqui quien esta mirando.
 *
 * **Panel, no ventana modal.** La alternativa era un `ToolModal` de bienvenida
 * con "no volver a mostrar", y se descarto por dos razones de este producto:
 * el participante tipico entra desde el telefono **en el instante exacto de la
 * apertura de venta**, y un modal que hay que cerrar en ese momento compite con
 * lo unico que vino a hacer; ademas el "no volver a mostrar" vive en
 * `localStorage`, que se pierde entre dispositivos y en incognito, asi que
 * reaparece a quien ya lo cerro.
 *
 * **Quien decide que bloques llegan aqui es `src/lib/guiaDeInicio.ts`**, por
 * capacidad. Este componente no sabe de permisos y no debe: recibe una lista
 * ya filtrada, igual que `NavegacionPrincipal` recibe enlaces ya filtrados.
 *
 * **Server Component.** `Drawer` y `Summary` no comparan sus hijos por
 * identidad —a diferencia de `Table` o `Select`—, asi que sobreviven la
 * frontera de RSC (`desafios-implementacion.md` 23).
 */

export type BloqueEnGuia = {
  readonly id: IdDeBloqueDeGuia;
  /** A donde se va a hacer lo que el bloque explica. */
  readonly href: string;
};

export type GuiaDeInicioProps = {
  /** Ya filtrados por capacidad. Vacio significa sesion sin ningun permiso. */
  bloques: readonly BloqueEnGuia[];
  diccionario: Diccionario;
};

const GuiaDeInicio = ({ bloques, diccionario }: GuiaDeInicioProps) => {
  const etiquetas = diccionario.inicio;

  // Sin un solo bloque no hay guia que encabezar. El aviso de "sin accesos" lo
  // pone la pagina, que es quien sabe distinguir una sesion sin permisos de
  // una visita sin sesion.
  if (bloques.length === 0) return null;

  return (
    <section className="guia-inicio" aria-label={etiquetas.guiaTitulo}>
      <H2>{etiquetas.guiaTitulo}</H2>

      {bloques.map((bloque, indice) => {
        const texto = etiquetas.bloques[bloque.id];

        return (
          // El primero abierto y el resto cerrados: con todos abiertos la
          // pantalla se vuelve un muro de texto y deja de leerse, y con todos
          // cerrados nadie sabe que hay dentro. `open` sobre un `<details>` es
          // el estado inicial; a partir de ahi lo maneja el navegador, sin
          // estado de React y sin mandar el componente al cliente.
          <Drawer key={bloque.id} open={indice === 0}>
            <Summary>{texto.titulo}</Summary>

            {/* `ol` y no `ul`: son pasos en orden, y ese orden es el
                contenido. Un lector de pantalla anuncia "1 de 4". */}
            <ol className="guia-inicio__pasos">
              {texto.pasos.map((paso) => (
                <li key={paso}>
                  <Text2 renderAs="span">{paso}</Text2>
                </li>
              ))}
            </ol>

            <div className="guia-inicio__accion">
              <Secondary renderAs={Link} href={bloque.href} small>
                {texto.enlace}
              </Secondary>
            </div>
          </Drawer>
        );
      })}
    </section>
  );
};

export default GuiaDeInicio;
