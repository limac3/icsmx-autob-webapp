"use client";

import Link from "next/link";
import { Badge } from "@churchofjesuschrist/eden-badge";
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
import CuentaRegresiva from "@/components/CuentaRegresiva";
import type { Diccionario } from "@/dictionaries";
import type { EstadoDeVentaUi } from "@/lib/domain/ventanas";
import type { TipoConvocatoria } from "@/types/convocatoria";
import "./CatalogoConvocatorias.css";

/**
 * Catalogo de convocatorias para el participante — pantalla 3.1.
 *
 * **Componente cliente en un solo archivo**, igual que `TablaConvocatorias`:
 * `Table` compara sus hijos por identidad y esa identidad no sobrevive la
 * frontera de RSC (`desafios-implementacion.md` 23), asi que `ColGroup` y
 * `THead` tienen que nacer en el mismo modulo cliente que `Table`.
 *
 * El dato temporal mas relevante ya llego resuelto del servidor: la fase de
 * venta y, segun la fase, los segundos restantes para abrir o la fecha de
 * cierre ya formateada en hora de negocio. Este componente no calcula
 * ninguna fecha, solo elige cual de las tres mostrar.
 */

export type ConvocatoriaEnCatalogo = {
  convocatoriaId: string;
  tipo: TipoConvocatoria;
  resumenDescripcion: string;
  cantidadDeLotes: number;
  estadoDeVenta: EstadoDeVentaUi;
};

export type CatalogoConvocatoriasProps = {
  convocatorias: readonly ConvocatoriaEnCatalogo[];
  diccionario: Diccionario;
  idioma: string;
};

/**
 * Traduce una fase de venta ya resuelta a lo que se muestra. Se exporta
 * porque el detalle de convocatoria (pantalla 3.2) usa el mismo aviso.
 */
export const EstadoDeVenta = ({
  estado,
  diccionario,
  idioma,
}: {
  estado: EstadoDeVentaUi;
  diccionario: Diccionario;
  idioma: string;
}) => {
  const etiquetas = diccionario.catalogo;

  if (estado.fase === "PUBLICADA_SIN_ABRIR") {
    return (
      <Text2 renderAs="p">
        {`${etiquetas.abreEn} `}
        <CuentaRegresiva
          segundosIniciales={estado.segundosParaAbrir}
          idioma={idioma}
        />
      </Text2>
    );
  }

  if (estado.fase === "VENTA_ABIERTA") {
    return (
      <Text2 renderAs="p">
        <Badge color="success">{etiquetas.abierta}</Badge>
        {` · ${etiquetas.cierraEl} ${estado.cierraFormateado}`}
      </Text2>
    );
  }

  return (
    <Text2 renderAs="p" className="catalogo-convocatorias__cerrada">
      <Badge color="greySoft">{etiquetas.cerrada}</Badge>
    </Text2>
  );
};

const CatalogoConvocatorias = ({
  convocatorias,
  diccionario,
  idioma,
}: CatalogoConvocatoriasProps) => {
  const etiquetas = diccionario.catalogo;

  if (convocatorias.length === 0) {
    return <Text2 renderAs="p">{etiquetas.sinResultados}</Text2>;
  }

  return (
    <CardView>
      <Table className="catalogo-convocatorias__tabla">
        <ColGroup>
          <Col id="col-convocatoria" />
          <Col id="col-vehiculos" />
          <Col id="col-estado-venta" />
        </ColGroup>
        <THead>
          <TR>
            <TH scope="col">{etiquetas.columnaConvocatoria}</TH>
            <TH scope="col">{etiquetas.columnaVehiculos}</TH>
            <TH scope="col">{etiquetas.columnaEstadoVenta}</TH>
          </TR>
        </THead>
        <TBody>
          {convocatorias.map((convocatoria) => (
            <TR key={convocatoria.convocatoriaId}>
              <TD>
                <Link href={`/convocatorias/${convocatoria.convocatoriaId}`}>
                  {diccionario.tiposConvocatoria[convocatoria.tipo]}
                </Link>
                <Text4 renderAs="p">{convocatoria.resumenDescripcion}</Text4>
              </TD>
              <TD>{`${String(convocatoria.cantidadDeLotes)} ${etiquetas.cantidadDeVehiculos}`}</TD>
              <TD>
                <EstadoDeVenta
                  estado={convocatoria.estadoDeVenta}
                  diccionario={diccionario}
                  idioma={idioma}
                />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </CardView>
  );
};

export default CatalogoConvocatorias;
