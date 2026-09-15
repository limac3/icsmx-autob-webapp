"use client";

import Link from "next/link";
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
import { Text2, Text4 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import "./BandejaDeAdjudicacion.css";

/**
 * Bandeja del adjudicador — modalidad manual (R-23).
 *
 * **La bandeja no dictamina**, igual que la del aprobador y por la misma razon:
 * cada fila lleva al detalle del lote, donde ya viven la fila identificada, el
 * historial de cada participante y el boton. Dos vistas del mismo dictamen se
 * separan al primer cambio.
 *
 * **Los que llevan mas esperando, primero.** Un lote sin decidir es una venta
 * detenida, no una tarea que pueda envejecer al final de la lista.
 *
 * Componente cliente por la identidad de `ColGroup` y `THead`, que `Table`
 * compara para armar las etiquetas de la vista movil y no sobrevive la frontera
 * de RSC (desafios-implementacion.md 23). No tiene estado propio.
 */

/** Un lote por decidir, con todo ya resuelto en el servidor. */
export type LotePorDecidir = {
  convocatoriaId: string;
  loteId: string;
  /** Como se nombra el vehiculo en pantalla. */
  vehiculo: string;
  /** Nombre corto de la convocatoria, no su identificador. */
  convocatoria: string;
  /** Cuantas solicitudes vivas tiene la fila. Una cantidad, no identidades. */
  tamanoFila: number;
  /** Tiempo desde que abrio la venta, ya formateado en el idioma. */
  espera: string;
  /** `true` si la venta sigue abierta y la fila puede crecer. */
  ventaAbierta: boolean;
};

export type BandejaDeAdjudicacionProps = {
  lotes: readonly LotePorDecidir[];
  diccionario: Diccionario;
};

const BandejaDeAdjudicacion = ({
  lotes,
  diccionario,
}: BandejaDeAdjudicacionProps) => {
  const etiquetas = diccionario.adjudicacion;

  if (lotes.length === 0) {
    return <Text2 renderAs="p">{etiquetas.sinPendientes}</Text2>;
  }

  return (
    <CardView>
      <Table className="bandeja-adjudicacion">
        <ColGroup>
          <Col id="col-adjudicacion-lote" />
          <Col id="col-adjudicacion-convocatoria" />
          <Col id="col-adjudicacion-fila" />
          <Col id="col-adjudicacion-espera" />
        </ColGroup>
        <THead>
          <TR>
            <TH scope="col">{etiquetas.columnaLote}</TH>
            <TH scope="col">{etiquetas.columnaConvocatoria}</TH>
            <TH scope="col">{etiquetas.columnaTamanoFila}</TH>
            <TH scope="col">{etiquetas.columnaEspera}</TH>
          </TR>
        </THead>
        <TBody>
          {lotes.map((lote) => (
            <TR key={lote.loteId}>
              <TD>
                <Link
                  href={`/adjudicacion/${lote.convocatoriaId}/${lote.loteId}`}
                >
                  {lote.vehiculo}
                </Link>
              </TD>
              <TD>
                {lote.convocatoria}
                {lote.ventaAbierta ? (
                  <Text4 renderAs="p">{etiquetas.ventaAbiertaAviso}</Text4>
                ) : null}
              </TD>
              <TD>{lote.tamanoFila}</TD>
              <TD>{lote.espera}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </CardView>
  );
};

export default BandejaDeAdjudicacion;
