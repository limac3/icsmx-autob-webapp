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
import { Text2 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import "./BandejaDeVerificacion.css";

/**
 * Bandeja de tesoreria — `ui-ux-requerimientos.md` seccion 6.
 *
 * **Las mas antiguas primero**, igual que la bandeja del aprobador: la
 * solicitud que lleva mas tiempo esperando dictamen es la que mas urge.
 *
 * Componente cliente por la misma razon que `BandejaDeAprobacion`: `Table`
 * compara la identidad de `ColGroup`/`THead` para armar la vista movil, y esa
 * identidad no sobrevive la frontera de RSC (desafios-implementacion.md 23).
 */

export type PendienteDeVerificacion = {
  solicitudId: string;
  vehiculo: string;
  convocatoria: string;
  correoTitular: string;
  /** Ya formateado en hora de negocio. */
  adjudicadoEn: string;
  /** Ya formateado en hora de negocio. */
  comprobanteSubidoEn: string;
};

export type BandejaDeVerificacionProps = {
  pendientes: readonly PendienteDeVerificacion[];
  diccionario: Diccionario;
};

const BandejaDeVerificacion = ({
  pendientes,
  diccionario,
}: BandejaDeVerificacionProps) => {
  const etiquetas = diccionario.tesoreria;

  if (pendientes.length === 0) {
    return <Text2 renderAs="p">{etiquetas.sinPendientes}</Text2>;
  }

  return (
    <CardView>
      <Table className="bandeja-verificacion">
        <ColGroup>
          <Col id="col-verificacion-vehiculo" />
          <Col id="col-verificacion-convocatoria" />
          <Col id="col-verificacion-correo" />
          <Col id="col-verificacion-adjudicado" />
          <Col id="col-verificacion-comprobante" />
        </ColGroup>
        <THead>
          <TR>
            <TH scope="col">{etiquetas.columnaVehiculo}</TH>
            <TH scope="col">{etiquetas.columnaConvocatoria}</TH>
            <TH scope="col">{etiquetas.columnaCorreo}</TH>
            <TH scope="col">{etiquetas.columnaAdjudicadoEn}</TH>
            <TH scope="col">{etiquetas.columnaComprobante}</TH>
          </TR>
        </THead>
        <TBody>
          {pendientes.map((pendiente) => (
            <TR key={pendiente.solicitudId}>
              <TD>
                <Link href={`/tesoreria/verificacion/${pendiente.solicitudId}`}>
                  {pendiente.vehiculo}
                </Link>
              </TD>
              <TD>{pendiente.convocatoria}</TD>
              <TD>{pendiente.correoTitular}</TD>
              <TD>{pendiente.adjudicadoEn}</TD>
              <TD>{pendiente.comprobanteSubidoEn}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </CardView>
  );
};

export default BandejaDeVerificacion;
