"use client";

import {
  CardView,
  Col,
  ColGroup,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@churchofjesuschrist/eden-table";
import { Text2 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import "./BitacoraDeEventos.css";

/**
 * Bitacora de eventos — `ui-ux-requerimientos.md` seccion 7.
 *
 * Recibe filas ya traducidas: la pagina resuelve `tipo` y `actor` contra el
 * diccionario (regla 11) antes de pasarlas aqui, igual que
 * `BandejaDeVerificacion` recibe fechas ya formateadas.
 *
 * Componente cliente por la misma razon que `BandejaDeVerificacion`: `Table`
 * compara la identidad de `ColGroup`/`THead` para armar la vista movil, y esa
 * identidad no sobrevive la frontera de RSC (desafios-implementacion.md 23).
 */
export type FilaDeBitacora = {
  eventoId: string;
  fecha: string;
  tipo: string;
  actor: string;
  motivo?: string;
  /**
   * Comparten `correlacionId` los eventos de una misma transaccion
   * (trazabilidad-auditoria.md 2.2) — visible aqui para que la causalidad se
   * pueda rastrear sin depender de que dos filas queden visualmente juntas.
   */
  correlacionId: string;
  /**
   * De que registro es historia este evento, ya legible.
   *
   * Presente solo cuando la busqueda fue global: ahi los eventos vienen de todo
   * el sistema mezclados y sin esta columna no se puede saber de que habla cada
   * renglon. Cuando se consulta un identificador concreto es redundante — todos
   * los eventos son de el— y se omite.
   */
  registro?: string;
};

export type BitacoraDeEventosProps = {
  eventos: readonly FilaDeBitacora[];
  diccionario: Diccionario;
};

const BitacoraDeEventos = ({
  eventos,
  diccionario,
}: BitacoraDeEventosProps) => {
  const etiquetas = diccionario.auditoria;

  if (eventos.length === 0) {
    return <Text2 renderAs="p">{etiquetas.sinEventos}</Text2>;
  }

  // La columna de registro solo aparece si algun evento la trae: agregarla
  // vacia en la consulta de un identificador concreto gastaria ancho en una
  // columna que repetiria lo mismo en todos los renglones.
  const conRegistro = eventos.some((evento) => evento.registro !== undefined);

  return (
    <CardView>
      <Table className="bitacora-eventos">
        <ColGroup>
          <Col id="col-bitacora-fecha" />
          {conRegistro ? <Col id="col-bitacora-registro" /> : null}
          <Col id="col-bitacora-tipo" />
          <Col id="col-bitacora-actor" />
          <Col id="col-bitacora-motivo" />
          <Col id="col-bitacora-correlacion" />
          <Col id="col-bitacora-evento" />
        </ColGroup>
        <THead>
          <TR>
            <TH scope="col">{etiquetas.columnaFecha}</TH>
            {conRegistro ? (
              <TH scope="col">{etiquetas.columnaRegistro}</TH>
            ) : null}
            <TH scope="col">{etiquetas.columnaTipo}</TH>
            <TH scope="col">{etiquetas.columnaActor}</TH>
            <TH scope="col">{etiquetas.columnaMotivo}</TH>
            <TH scope="col">{etiquetas.columnaCorrelacion}</TH>
            {/* El desempate real de dos eventos del mismo milisegundo: es la
                segunda mitad de la `SK` de la bitacora, no un dato decorativo. */}
            <TH scope="col">{etiquetas.columnaEvento}</TH>
          </TR>
        </THead>
        <TBody>
          {eventos.map((evento) => (
            <TR key={evento.eventoId}>
              <TD>{evento.fecha}</TD>
              {conRegistro ? <TD>{evento.registro ?? ""}</TD> : null}
              <TD>{evento.tipo}</TD>
              <TD>{evento.actor}</TD>
              <TD>{evento.motivo ?? ""}</TD>
              <TD>{evento.correlacionId}</TD>
              <TD>{evento.eventoId}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </CardView>
  );
};

export default BitacoraDeEventos;
