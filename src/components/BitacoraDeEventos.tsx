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

  return (
    <CardView>
      <Table className="bitacora-eventos">
        <ColGroup>
          <Col id="col-bitacora-fecha" />
          <Col id="col-bitacora-tipo" />
          <Col id="col-bitacora-actor" />
          <Col id="col-bitacora-motivo" />
          <Col id="col-bitacora-correlacion" />
        </ColGroup>
        <THead>
          <TR>
            <TH scope="col">{etiquetas.columnaFecha}</TH>
            <TH scope="col">{etiquetas.columnaTipo}</TH>
            <TH scope="col">{etiquetas.columnaActor}</TH>
            <TH scope="col">{etiquetas.columnaMotivo}</TH>
            <TH scope="col">{etiquetas.columnaCorrelacion}</TH>
          </TR>
        </THead>
        <TBody>
          {eventos.map((evento) => (
            <TR key={evento.eventoId}>
              <TD>{evento.fecha}</TD>
              <TD>{evento.tipo}</TD>
              <TD>{evento.actor}</TD>
              <TD>{evento.motivo ?? ""}</TD>
              <TD>{evento.correlacionId}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </CardView>
  );
};

export default BitacoraDeEventos;
