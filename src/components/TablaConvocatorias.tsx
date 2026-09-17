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
                    <Col id="col-tipo" />
                    <Col id="col-periodo" />
                    <Col id="col-estatus" />
                  </ColGroup>
                  <THead>
                    <TR>
                      <TH scope="col">{etiquetas.columnaConvocatoria}</TH>
                      <TH scope="col">{etiquetas.columnaTipo}</TH>
                      <TH scope="col">{etiquetas.columnaPeriodo}</TH>
                      <TH scope="col">{etiquetas.columnaEstatus}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {grupo.map((convocatoria) => (
                      <TR key={convocatoria.convocatoriaId}>
                        {/* Nombre y folio, **lo mismo que el listado
                            publico**. Antes esta celda mostraba el tipo y un
                            resumen de la descripcion: el tipo no distingue una
                            venta de la siguiente —todas las de empleados se
                            llamaban igual— y el resumen ocupaba tres renglones
                            de texto que se repite convocatoria a convocatoria.
                            El folio es el dato con el que se pregunta por una,
                            y quien administra necesita reconocerla por el mismo
                            nombre con el que la ve el participante. */}
                        <TD>
                          <Link
                            href={`/admin/convocatorias/${convocatoria.convocatoriaId}`}
                          >
                            {convocatoria.nombre}
                          </Link>
                          <Text4 renderAs="p">
                            {`${etiquetas.campoFolio}: ${convocatoria.folio}`}
                          </Text4>
                        </TD>
                        {/* Tipo y modalidad en la misma celda: quien puede
                            participar y como se decide al ganador son las dos
                            preguntas que se hacen a la vez sobre una
                            convocatoria, y separarlas en dos columnas costaria
                            ancho sin agrupar nada. La modalidad va debajo, con
                            el mismo `Text4` que el folio y la hora de negocio.

                            Usa la etiqueta **breve**, no la del formulario: ahi
                            "Automatica: gana el turno mas bajo" explica una
                            decision que se esta tomando; aqui se repetiria en
                            cada renglon de una lista que se recorre con la
                            vista. */}
                        <TD>
                          {diccionario.tiposConvocatoria[convocatoria.tipo]}
                          <Text4 renderAs="p">
                            {
                              diccionario.modalidadesAdjudicacionBreve[
                                convocatoria.modalidadAdjudicacion
                              ]
                            }
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
