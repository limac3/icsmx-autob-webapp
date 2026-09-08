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
import type { TipoConvocatoria } from "@/types/convocatoria";
import "./BandejaDeAprobacion.css";

/**
 * Bandeja del aprobador — pantalla 5.
 *
 * **Las mas antiguas primero.** Es lo contrario del listado administrativo, que
 * pone arriba lo recien creado: alli se trabaja sobre lo ultimo que uno hizo, y
 * aqui sobre lo que lleva mas tiempo esperando a que alguien lo mire. Una
 * convocatoria olvidada al final de la lista retrasa una venta entera.
 *
 * **La espera se calcula en el servidor.** Depende de la hora, y dejarsela al
 * navegador mostraria "hace 3 dias" o "hace 4" segun el reloj de cada quien.
 *
 * Componente cliente por la identidad de `ColGroup` y `THead`, que `Table`
 * compara para armar las etiquetas de la vista movil y no sobrevive la frontera
 * de RSC (desafios-implementacion.md 23). No tiene estado propio.
 */

/** Una convocatoria por dictaminar, con todo ya resuelto en el servidor. */
export type PendienteDeAprobacion = {
  convocatoriaId: string;
  tipo: TipoConvocatoria;
  /** Descripcion en texto plano; la almacenada es HTML del editor. */
  resumen: string;
  creadoPor: string;
  /** Tiempo en espera, ya formateado en el idioma de la peticion. */
  espera: string;
  /** Periodo de venta, ya formateado en hora de negocio. */
  periodo: string;
};

export type BandejaDeAprobacionProps = {
  pendientes: readonly PendienteDeAprobacion[];
  diccionario: Diccionario;
};

const BandejaDeAprobacion = ({
  pendientes,
  diccionario,
}: BandejaDeAprobacionProps) => {
  const etiquetas = diccionario.aprobaciones;

  if (pendientes.length === 0) {
    return <Text2 renderAs="p">{etiquetas.sinPendientes}</Text2>;
  }

  return (
    <CardView>
      <Table className="bandeja-aprobacion">
        <ColGroup>
          <Col id="col-aprobacion-convocatoria" />
          <Col id="col-aprobacion-creador" />
          <Col id="col-aprobacion-espera" />
          <Col id="col-aprobacion-periodo" />
        </ColGroup>
        <THead>
          <TR>
            <TH scope="col">{etiquetas.columnaConvocatoria}</TH>
            <TH scope="col">{etiquetas.columnaCreadaPor}</TH>
            <TH scope="col">{etiquetas.columnaEnviada}</TH>
            <TH scope="col">{etiquetas.columnaPeriodo}</TH>
          </TR>
        </THead>
        <TBody>
          {pendientes.map((pendiente) => (
            <TR key={pendiente.convocatoriaId}>
              <TD>
                {/* El dictamen ocurre en la pantalla de detalle, que ya muestra
                    los datos, los lotes y las dos acciones. Duplicarla aqui
                    daria dos vistas de lo mismo que se separarian con el
                    primer cambio. Ver ui-ux-requerimientos.md 5. */}
                <Link href={`/admin/convocatorias/${pendiente.convocatoriaId}`}>
                  {diccionario.tiposConvocatoria[pendiente.tipo]}
                </Link>
                <Text4 renderAs="p">{pendiente.resumen}</Text4>
              </TD>
              <TD>{pendiente.creadoPor}</TD>
              <TD>{pendiente.espera}</TD>
              <TD>
                {pendiente.periodo}
                <Text4 renderAs="p">
                  {diccionario.convocatorias.horaDeNegocio}
                </Text4>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </CardView>
  );
};

export default BandejaDeAprobacion;
