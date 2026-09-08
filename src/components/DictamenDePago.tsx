"use client";

import { useState, useTransition } from "react";
import { Error as AlertaError, Success } from "@churchofjesuschrist/eden-alert";
import { Danger, Primary, Secondary } from "@churchofjesuschrist/eden-buttons";
import { DialogModal } from "@churchofjesuschrist/eden-dialog-modal";
import { FormField, TextArea } from "@churchofjesuschrist/eden-form-parts";
import { Row } from "@churchofjesuschrist/eden-row";
import { Text2 } from "@churchofjesuschrist/eden-text";
import { avalarPago, rechazarPago } from "@/app/actions/tesoreria";
import type { Diccionario } from "@/dictionaries";
import type { CodigoError } from "@/types/resultado";
import "./DictamenDePago.css";

/**
 * Las dos acciones de tesoreria sobre una solicitud `EN_VERIFICACION` —
 * `ui-ux-requerimientos.md` seccion 6.
 *
 * **La consecuencia se explica antes de confirmar, no despues.** Rechazar
 * dice que el vehiculo se reasigna solo; avalar, que no hay vuelta atras. Es
 * lo que evita un rechazo por error, y `AccionesDeConvocatoria.tsx` sigue el
 * mismo principio para aprobar/rechazar una convocatoria.
 *
 * Solo dos acciones fijas, y no una tabla dirigida por
 * `eventosDisponibles("solicitud", ...)` como en `AccionesDeConvocatoria`:
 * esta pantalla solo existe para una solicitud `EN_VERIFICACION` — es lo unico
 * que lista PA-11 —, asi que no hay un segundo estado que justifique la
 * generalidad.
 */

export type DictamenDePagoProps = {
  solicitudId: string;
  /** `false` para quien solo tiene `Autob_Auditar`: ve la pantalla, no los botones. */
  puedeDictaminar: boolean;
  diccionario: Diccionario;
};

type Accion = "AVALAR" | "RECHAZAR";

const DictamenDePago = ({
  solicitudId,
  puedeDictaminar,
  diccionario,
}: DictamenDePagoProps) => {
  const [enProceso, iniciar] = useTransition();
  const [error, setError] = useState<CodigoError | undefined>(undefined);
  const [hecho, setHecho] = useState<Accion | undefined>(undefined);
  const [motivo, setMotivo] = useState("");
  const [confirmando, setConfirmando] = useState<Accion | undefined>(undefined);

  const etiquetas = diccionario.tesoreria;

  const avalar = () => {
    setConfirmando(undefined);
    setError(undefined);
    iniciar(async () => {
      const resultado = await avalarPago({ solicitudId });
      if (resultado.ok) setHecho("AVALAR");
      else setError(resultado.error as CodigoError);
    });
  };

  const rechazar = () => {
    setConfirmando(undefined);
    setError(undefined);
    iniciar(async () => {
      const resultado = await rechazarPago({ solicitudId, motivo });
      if (resultado.ok) setHecho("RECHAZAR");
      else setError(resultado.error as CodigoError);
    });
  };

  if (hecho) {
    return (
      <Success>
        <Text2 renderAs="p">
          {hecho === "AVALAR" ? etiquetas.hechoAvalar : etiquetas.hechoRechazar}
        </Text2>
      </Success>
    );
  }

  if (!puedeDictaminar) return null;

  const faltaMotivo = motivo.trim().length === 0;

  return (
    <section className="dictamen-pago" aria-busy={enProceso}>
      {error ? (
        <AlertaError>
          <Text2 renderAs="p">{diccionario.errores[error]}</Text2>
        </AlertaError>
      ) : null}

      <FormField
        label={etiquetas.motivoRechazo}
        description={etiquetas.motivoRechazoAyuda}
      >
        <TextArea
          name="motivo"
          value={motivo}
          onChange={(cambio) => {
            setMotivo(cambio.target.value);
          }}
        />
      </FormField>

      <Row gapSize="8">
        <Primary
          type="button"
          disabled={enProceso}
          onClick={() => {
            setConfirmando("AVALAR");
          }}
        >
          {etiquetas.avalar}
        </Primary>
        <Danger
          type="button"
          disabled={enProceso || faltaMotivo}
          onClick={() => {
            setConfirmando("RECHAZAR");
          }}
        >
          {etiquetas.rechazar}
        </Danger>
      </Row>

      <DialogModal
        open={confirmando !== undefined}
        header={
          confirmando === "AVALAR" ? etiquetas.avalar : etiquetas.rechazar
        }
        onClose={() => {
          setConfirmando(undefined);
        }}
        closeLabel={etiquetas.cancelarDictamen}
        footer={
          <Row gapSize="8">
            <Primary
              type="button"
              onClick={confirmando === "AVALAR" ? avalar : rechazar}
            >
              {etiquetas.continuarDictamen}
            </Primary>
            <Secondary
              type="button"
              onClick={() => {
                setConfirmando(undefined);
              }}
            >
              {etiquetas.cancelarDictamen}
            </Secondary>
          </Row>
        }
      >
        <Text2 renderAs="p">
          {confirmando === "AVALAR"
            ? etiquetas.confirmarAvalar
            : etiquetas.confirmarRechazar}
        </Text2>
      </DialogModal>
    </section>
  );
};

export default DictamenDePago;
