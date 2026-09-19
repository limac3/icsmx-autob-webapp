"use client";

import Link from "next/link";
import { Badge } from "@churchofjesuschrist/eden-badge";
import { H2 } from "@churchofjesuschrist/eden-headings";
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
import {
  GRUPOS_DE_MIS_SOLICITUDES,
  type GrupoDeMiSolicitud,
} from "@/lib/domain/misSolicitudes";
import type { MiSolicitudDTO } from "@/types/fila";
import type { EstatusSolicitud } from "@/types/solicitud";
import "./MisSolicitudes.css";

/**
 * Pantalla 3.5 — la vista agregada de los compromisos propios.
 *
 * **Existe porque la vista por lote dejo de bastar.** Mientras un participante
 * sostenia una sola adjudicacion activa en todo el sistema, `BloqueDeAccionDeLote`
 * ya lo decia todo. Desde que R-09 pasa a ser un cupo por convocatoria y R-22
 * reparte solicitudes, formarse en muchos lotes es la funcionalidad — y nadie
 * puede recordar en cuales se formo.
 *
 * **Componente cliente en un solo archivo**, por la misma razon que
 * `CatalogoConvocatorias`: `Table` compara sus hijos por identidad y esa
 * identidad no sobrevive la frontera de RSC
 * (`desafios-implementacion.md` 23).
 *
 * No calcula ninguna fecha. Los segundos restantes llegan resueltos del
 * servidor y `CuentaRegresiva` solo decrementa (regla 9).
 */

const COLOR_POR_ESTATUS: Record<
  EstatusSolicitud,
  "success" | "info" | "warn" | "greySoft" | "default"
> = {
  EN_FILA: "info",
  CONGELADA: "greySoft",
  ADJUDICADA: "warn",
  EN_VERIFICACION: "info",
  VENDIDA: "success",
  CANCELADA_POR_VENCIMIENTO: "greySoft",
  RECHAZADA_POR_TESORERIA: "greySoft",
  CANCELADA_POR_PARTICIPANTE: "greySoft",
  CANCELADA_POR_LIMITE: "greySoft",
  NO_ADJUDICADA: "greySoft",
};

export type SolicitudEnLista = MiSolicitudDTO & {
  /**
   * Segundos que faltan para el vencimiento, calculados **por el servidor** al
   * momento del render. Solo viene cuando el plazo sigue corriendo.
   */
  segundosParaVencer?: number;
};

export type MisSolicitudesProps = {
  solicitudes: readonly SolicitudEnLista[];
  truncada: boolean;
  diccionario: Diccionario;
  idioma: string;
};

const TITULO_DE_GRUPO: Record<
  GrupoDeMiSolicitud,
  keyof Diccionario["misSolicitudes"]
> = {
  REQUIERE_ATENCION: "grupoRequiereAtencion",
  ACTIVA: "grupoActiva",
  HISTORICA: "grupoHistorica",
};

const MisSolicitudes = ({
  solicitudes,
  truncada,
  diccionario,
  idioma,
}: MisSolicitudesProps) => {
  const etiquetas = diccionario.misSolicitudes;

  if (solicitudes.length === 0) {
    return (
      <div className="mis-solicitudes__vacio">
        <Text2 renderAs="p">{etiquetas.sinSolicitudes}</Text2>
        {/* El vacio lleva la accion que lo resuelve (seccion 8). */}
        <Link href="/convocatorias">{etiquetas.irAlCatalogo}</Link>
      </div>
    );
  }

  return (
    <>
      {GRUPOS_DE_MIS_SOLICITUDES.map((grupo) => {
        const delGrupo = solicitudes.filter((una) => una.grupo === grupo);
        if (delGrupo.length === 0) return null;

        return (
          <section className="mis-solicitudes__grupo" key={grupo}>
            <H2>{etiquetas[TITULO_DE_GRUPO[grupo]]}</H2>
            {grupo === "REQUIERE_ATENCION" ? (
              <Text2 renderAs="p">
                {etiquetas.explicacionRequiereAtencion}
              </Text2>
            ) : null}

            <CardView>
              <Table className="mis-solicitudes__tabla">
                <ColGroup>
                  <Col id={`col-vehiculo-${grupo}`} />
                  <Col id={`col-convocatoria-${grupo}`} />
                  <Col id={`col-situacion-${grupo}`} />
                </ColGroup>
                <THead>
                  <TR>
                    <TH scope="col">{etiquetas.columnaVehiculo}</TH>
                    <TH scope="col">{etiquetas.columnaConvocatoria}</TH>
                    <TH scope="col">{etiquetas.columnaSituacion}</TH>
                  </TR>
                </THead>
                <TBody>
                  {delGrupo.map((solicitud) => (
                    <TR key={solicitud.solicitudId}>
                      <TD>
                        <Link
                          href={`/convocatorias/${solicitud.convocatoriaId}/lotes/${solicitud.loteId}`}
                        >
                          {`${solicitud.marca} ${solicitud.version}`.trim() ||
                            etiquetas.verElLote}
                        </Link>
                        <Text4 renderAs="p">
                          {`${etiquetas.turno}: ${String(solicitud.miTurno)}`}
                        </Text4>
                      </TD>
                      <TD>
                        {solicitud.convocatoriaNombre}
                        <Text4 renderAs="p">
                          {`${diccionario.convocatorias.campoFolio}: ${solicitud.convocatoriaFolio}`}
                        </Text4>
                      </TD>
                      <TD>
                        {/* Nunca el ENUM crudo (regla 11). */}
                        <Badge color={COLOR_POR_ESTATUS[solicitud.estatus]}>
                          {diccionario.estatusSolicitud[solicitud.estatus]}
                        </Badge>
                        {solicitud.segundosParaVencer === undefined ? null : (
                          <Text2 renderAs="p">
                            {`${etiquetas.restante} `}
                            <CuentaRegresiva
                              segundosIniciales={solicitud.segundosParaVencer}
                              idioma={idioma}
                            />
                          </Text2>
                        )}
                        {solicitud.plazoVencido === true ? (
                          <Text4 renderAs="p">{etiquetas.plazoVencido}</Text4>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardView>
          </section>
        );
      })}

      {truncada ? (
        <Text4 renderAs="p" className="mis-solicitudes__truncada">
          {etiquetas.truncada}
        </Text4>
      ) : null}
    </>
  );
};

export default MisSolicitudes;
