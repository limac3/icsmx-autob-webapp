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
import { Tab, Tabs } from "@churchofjesuschrist/eden-tabs";
import { Text2, Text4 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import { textoPlanoDeDescripcion } from "@/lib/domain/htmlDeDescripcion";
import {
  ESTATUS_CONVOCATORIA,
  type Convocatoria,
  type EstatusConvocatoria,
} from "@/types/convocatoria";
import "./TablaConvocatorias.css";

/**
 * Listado administrativo de convocatorias — pantalla 4.3.
 *
 * **Pestañas y no filtro en la URL**, al reves que el catalogo de vehiculos.
 * Alli el filtro es un `<form method="get">` porque los estatus son muchos menos
 * relevantes y la busqueda por texto necesita el servidor; aqui los seis grupos
 * son la estructura misma de la pantalla y `Tabs` es lo que Eden describe para
 * eso: "vistas alternables en la misma pantalla".
 *
 * La consecuencia es que este componente es cliente. La pagina lee en el
 * servidor —una `Query` por estatus, en paralelo— y le pasa los seis grupos ya
 * resueltos; aqui no se consulta nada.
 *
 * **El avance del ciclo se muestra con `Badge`, no con un stepper.** El
 * `ProgressStepper` de Eden es un asistente por pasos y el `ProgressList` un
 * indice de tareas en otras paginas; ninguno describe "en que estado esta esta
 * entidad". Ver `ui-ux-requerimientos.md` 4.3.
 */

const COLOR_POR_ESTATUS: Record<
  EstatusConvocatoria,
  "success" | "info" | "warn" | "greySoft" | "default"
> = {
  BORRADOR: "greySoft",
  EN_APROBACION: "warn",
  APROBADA: "info",
  PUBLICADA: "success",
  CONCLUIDA: "default",
  OCULTA: "greySoft",
};

export type TablaConvocatoriasProps = {
  convocatorias: readonly Convocatoria[];
  diccionario: Diccionario;
  /** Fechas ya formateadas en hora de negocio, por convocatoria. */
  periodos: Readonly<Record<string, string>>;
};

const TablaConvocatorias = ({
  convocatorias,
  diccionario,
  periodos,
}: TablaConvocatoriasProps) => {
  const etiquetas = diccionario.convocatorias;

  const porEstatus = (estatus: EstatusConvocatoria) =>
    convocatorias.filter((una) => una.estatus === estatus);

  return (
    <Tabs label={etiquetas.pestanas} renderMode="conditional">
      {ESTATUS_CONVOCATORIA.map((estatus) => {
        const grupo = porEstatus(estatus);
        return (
          <Tab
            key={estatus}
            id={estatus.toLowerCase()}
            label={`${diccionario.estatusConvocatoria[estatus]} (${String(grupo.length)})`}
          >
            {grupo.length === 0 ? (
              <Text2 renderAs="p">{etiquetas.sinResultados}</Text2>
            ) : (
              <CardView>
                <Table className="tabla-convocatorias">
                  <ColGroup>
                    <Col id="col-convocatoria" />
                    <Col id="col-periodo" />
                    <Col id="col-estatus" />
                  </ColGroup>
                  <THead>
                    <TR>
                      <TH scope="col">{etiquetas.columnaTipo}</TH>
                      <TH scope="col">{etiquetas.columnaPeriodo}</TH>
                      <TH scope="col">{etiquetas.columnaEstatus}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {grupo.map((convocatoria) => (
                      <TR key={convocatoria.convocatoriaId}>
                        <TD>
                          <Link
                            href={`/admin/convocatorias/${convocatoria.convocatoriaId}`}
                          >
                            {diccionario.tiposConvocatoria[convocatoria.tipo]}
                          </Link>
                          {/* La descripcion es HTML del editor enriquecido.
                              Pintarla tal cual dejaria las etiquetas a la vista
                              —React las escapa, asi que no es un agujero, pero
                              si un listado ilegible—. */}
                          <Text4 renderAs="p">
                            {textoPlanoDeDescripcion(
                              convocatoria.descripcionParticipacion,
                              120,
                            )}
                          </Text4>
                        </TD>
                        <TD>
                          {periodos[convocatoria.convocatoriaId] ?? ""}
                          <Text4 renderAs="p">{etiquetas.horaDeNegocio}</Text4>
                        </TD>
                        <TD>
                          <Badge
                            color={COLOR_POR_ESTATUS[convocatoria.estatus]}
                          >
                            {
                              diccionario.estatusConvocatoria[
                                convocatoria.estatus
                              ]
                            }
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardView>
            )}
          </Tab>
        );
      })}
    </Tabs>
  );
};

export default TablaConvocatorias;
