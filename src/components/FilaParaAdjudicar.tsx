"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  Error as AlertaError,
  Success,
  Warn,
} from "@churchofjesuschrist/eden-alert";
import { Primary, Secondary } from "@churchofjesuschrist/eden-buttons";
import { DialogModal } from "@churchofjesuschrist/eden-dialog-modal";
import { FormField, TextArea } from "@churchofjesuschrist/eden-form-parts";
import { Row } from "@churchofjesuschrist/eden-row";
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
import { adjudicarManualmente } from "@/app/actions/adjudicacion";
import type { Diccionario } from "@/dictionaries";
import type { CodigoError } from "@/types/resultado";
import "./FilaParaAdjudicar.css";

/**
 * La fila identificada y la decision del adjudicador (R-23).
 *
 * **Esta pantalla expone identidades de terceros a proposito**, y es la unica
 * fuera de auditoria que lo hace. Es el requerimiento entero: quien decide no
 * puede hacerlo a ciegas. R-12 no se relaja para nadie mas — el participante
 * sigue viendo solo `miTurno`, `miPosicion` y `tamanoFila`.
 *
 * **Se advierte cuando la venta sigue abierta.** Se decidio que el adjudicador
 * puede dictaminar en cualquier momento, incluso con la fila creciendo; eso lo
 * hace legitimo, no inocuo, y quien decide merece saber que la fila que tiene
 * delante puede no ser la ultima.
 *
 * **El motivo es obligatorio.** Una decision humana sin razon escrita es tan
 * opaca para el auditor como un salto de turno sin evento.
 *
 * **A quien ya no le queda cupo se le marca, pero no se le esconde.** La
 * autoridad sobre el cupo es la condicion de la transaccion, no esta lectura
 * (regla 6): entre pintar la tabla y decidir, el cupo puede liberarse. Ocultar
 * al candidato le quitaria al adjudicador una opcion que quiza si existe;
 * marcarlo le dice lo que necesita sin decidir por el.
 */

export type OtraParticipacionVista = {
  loteId: string;
  turno: number;
  estatus: string;
  ordenEnConvocatoria?: number;
  /** Como se nombra ese otro vehiculo: marca, version y modelo. */
  vehiculo: string;
};

export type CandidatoVista = {
  turno: number;
  participanteId: string;
  correoTitular?: string;
  /** Hora exacta de llegada, ya formateada en hora de negocio. */
  solicitadoEn: string;
  ordenEnConvocatoria?: number;
  adjudicacionesEnConvocatoria: number;
  sinCupo: boolean;
  otrasParticipaciones: readonly OtraParticipacionVista[];
};

export type FilaParaAdjudicarProps = {
  convocatoriaId: string;
  loteId: string;
  candidatos: readonly CandidatoVista[];
  /** `false` para quien solo tiene `Autob_Auditar`: ve la fila, no los botones. */
  puedeAdjudicar: boolean;
  /** La venta sigue abierta: la fila puede crecer despues de decidir. */
  ventaAbierta: boolean;
  diccionario: Diccionario;
};

const FilaParaAdjudicar = ({
  convocatoriaId,
  loteId,
  candidatos,
  puedeAdjudicar,
  ventaAbierta,
  diccionario,
}: FilaParaAdjudicarProps) => {
  const [enProceso, iniciar] = useTransition();
  const [error, setError] = useState<CodigoError | undefined>(undefined);
  const [ganador, setGanador] = useState<number | undefined>(undefined);
  const [motivo, setMotivo] = useState("");
  const [confirmando, setConfirmando] = useState<number | undefined>(undefined);

  const etiquetas = diccionario.adjudicacion;

  const adjudicar = (turno: number) => {
    setConfirmando(undefined);
    setError(undefined);
    iniciar(async () => {
      const resultado = await adjudicarManualmente({
        convocatoriaId,
        loteId,
        turno,
        motivo,
      });
      if (resultado.ok) setGanador(turno);
      else setError(resultado.error as CodigoError);
    });
  };

  if (ganador !== undefined) {
    return (
      <Success>
        <Text2 renderAs="p">{etiquetas.hechoAdjudicar}</Text2>
      </Success>
    );
  }

  if (candidatos.length === 0) {
    return <Text2 renderAs="p">{etiquetas.filaVacia}</Text2>;
  }

  const faltaMotivo = motivo.trim().length === 0;

  return (
    <section className="fila-adjudicar" aria-busy={enProceso}>
      {ventaAbierta ? (
        <Warn>
          <Text2 renderAs="p">{etiquetas.ventaAbiertaDetalle}</Text2>
        </Warn>
      ) : null}

      {error ? (
        <AlertaError>
          <Text2 renderAs="p">{diccionario.errores[error]}</Text2>
        </AlertaError>
      ) : null}

      <CardView>
        <Table>
          <ColGroup>
            <Col id="col-adj-turno" />
            <Col id="col-adj-participante" />
            <Col id="col-adj-hora" />
            <Col id="col-adj-participacion" />
            <Col id="col-adj-otras" />
            {puedeAdjudicar ? <Col id="col-adj-accion" /> : null}
          </ColGroup>
          <THead>
            <TR>
              <TH scope="col">{etiquetas.columnaTurno}</TH>
              <TH scope="col">{etiquetas.columnaParticipante}</TH>
              <TH scope="col">{etiquetas.columnaSolicitadoEn}</TH>
              <TH scope="col">{etiquetas.columnaParticipacion}</TH>
              <TH scope="col">{etiquetas.columnaOtrasSolicitudes}</TH>
              {puedeAdjudicar ? (
                <TH scope="col">{etiquetas.columnaAccion}</TH>
              ) : null}
            </TR>
          </THead>
          <TBody>
            {candidatos.map((candidato) => (
              <TR key={candidato.turno}>
                <TD>{candidato.turno}</TD>
                <TD>
                  {candidato.correoTitular ?? candidato.participanteId}
                  {candidato.correoTitular ? (
                    <Text4 renderAs="p">{candidato.participanteId}</Text4>
                  ) : null}
                </TD>
                <TD>
                  {candidato.solicitadoEn}
                  <Text4 renderAs="p">
                    {diccionario.convocatorias.horaDeNegocio}
                  </Text4>
                </TD>
                <TD>
                  {etiquetas.adjudicacionesQueLleva}{" "}
                  {candidato.adjudicacionesEnConvocatoria}
                  {candidato.ordenEnConvocatoria === undefined ? null : (
                    <Text4 renderAs="p">
                      {etiquetas.ordenEnConvocatoria}{" "}
                      {candidato.ordenEnConvocatoria}
                    </Text4>
                  )}
                  {candidato.sinCupo ? (
                    <Text4 renderAs="p">{etiquetas.sinCupo}</Text4>
                  ) : null}
                </TD>
                <TD>
                  {candidato.otrasParticipaciones.length === 0 ? (
                    <Text4 renderAs="p">{etiquetas.sinOtrasSolicitudes}</Text4>
                  ) : (
                    <ul className="fila-adjudicar__otras">
                      {candidato.otrasParticipaciones.map((otra) => (
                        <li key={`${otra.loteId}-${String(otra.turno)}`}>
                          <Link
                            href={`/adjudicacion/${convocatoriaId}/${otra.loteId}`}
                          >
                            {otra.vehiculo}
                          </Link>
                          <Text4 renderAs="p">
                            {otra.ordenEnConvocatoria === undefined
                              ? ""
                              : `${etiquetas.ordenEnConvocatoria} ${String(otra.ordenEnConvocatoria)} · `}
                            {etiquetas.turnoAbreviado} {otra.turno} ·{" "}
                            {diccionario.estatusSolicitud[
                              otra.estatus as keyof typeof diccionario.estatusSolicitud
                            ] ?? otra.estatus}
                          </Text4>
                        </li>
                      ))}
                    </ul>
                  )}
                </TD>
                {puedeAdjudicar ? (
                  <TD>
                    <Primary
                      type="button"
                      disabled={enProceso || faltaMotivo}
                      onClick={() => {
                        setConfirmando(candidato.turno);
                      }}
                    >
                      {etiquetas.adjudicar}
                    </Primary>
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
      </CardView>

      {puedeAdjudicar ? (
        <div className="fila-adjudicar__decision">
          <FormField
            label={etiquetas.motivo}
            description={etiquetas.motivoAyuda}
          >
            <TextArea
              name="motivo"
              value={motivo}
              onChange={(cambio) => {
                setMotivo(cambio.target.value);
              }}
            />
          </FormField>
        </div>
      ) : null}

      <DialogModal
        open={confirmando !== undefined}
        header={etiquetas.adjudicar}
        onClose={() => {
          setConfirmando(undefined);
        }}
        closeLabel={etiquetas.cancelarDecision}
        footer={
          <Row gapSize="8">
            <Primary
              type="button"
              onClick={() => {
                if (confirmando !== undefined) adjudicar(confirmando);
              }}
            >
              {etiquetas.continuarDecision}
            </Primary>
            <Secondary
              type="button"
              onClick={() => {
                setConfirmando(undefined);
              }}
            >
              {etiquetas.cancelarDecision}
            </Secondary>
          </Row>
        }
      >
        <Text2 renderAs="p">{etiquetas.confirmarAdjudicar}</Text2>
      </DialogModal>
    </section>
  );
};

export default FilaParaAdjudicar;
