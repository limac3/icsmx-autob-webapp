"use client";

import { useState, useTransition } from "react";
import { Error as AlertaError, Warn } from "@churchofjesuschrist/eden-alert";
import { Danger, Secondary } from "@churchofjesuschrist/eden-buttons";
import { FormField, TextArea } from "@churchofjesuschrist/eden-form-parts";
import { Row } from "@churchofjesuschrist/eden-row";
import { Stack } from "@churchofjesuschrist/eden-stack";
import { Text2 } from "@churchofjesuschrist/eden-text";
import { ToolModal } from "@churchofjesuschrist/eden-tool-modal";
import { retirarVehiculo } from "@/app/actions/vehiculos";
import type { Diccionario } from "@/dictionaries";
import type { CodigoError } from "@/types/resultado";
import "./RetirarVehiculo.css";

/**
 * Retiro del catalogo.
 *
 * Se separa del formulario principal a proposito: es una transicion **terminal**
 * —de `RETIRADO` no hay vuelta en la maquina de estados— y mezclarla con los
 * campos editables invita a dispararla sin querer.
 *
 * El motivo es obligatorio y queda en la bitacora: `VEHICULO_RETIRADO` esta
 * marcado con **M** en el catalogo de eventos. Sin el, la bitacora no podria
 * responder por que salio del catalogo un vehiculo.
 *
 * **En la pantalla solo hay un boton; el motivo se captura dentro del modal.**
 * Antes el campo del motivo estaba suelto sobre la pantalla de edicion, con el
 * boton de retirar debajo: un campo obligatorio a la vista, sin nada que dijera
 * a que pertenecia, y un boton terminal a un clic de distancia. Es el mismo
 * defecto que `AccionesDeConvocatoria` ya habia corregido para las
 * convocatorias, y esta pantalla se habia quedado atras.
 *
 * Lo que se paga: **el retiro deja de funcionar sin JavaScript.** Un modal es
 * un control del cliente, asi que no hay forma de conservar el envio por
 * `<form>` puro y a la vez exigir una confirmacion. El servidor sigue validando
 * permiso, estado y motivo, asi que lo que se pierde es el camino degradado, no
 * ninguna garantia.
 */

export type RetirarVehiculoProps = {
  vehiculoId: string;
  diccionario: Diccionario;
};

const RetirarVehiculo = ({ vehiculoId, diccionario }: RetirarVehiculoProps) => {
  const [enProceso, iniciar] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<CodigoError | undefined>(undefined);
  const [retirado, setRetirado] = useState(false);

  const etiquetas = diccionario.vehiculos;
  const faltaMotivo = motivo.trim() === "";

  const cerrar = () => {
    setAbierto(false);
  };

  const confirmar = () => {
    // Comprobado otra vez aqui: un boton deshabilitado no es una validacion.
    if (faltaMotivo) return;
    const razon = motivo;
    setAbierto(false);
    setError(undefined);
    iniciar(async () => {
      const resultado = await retirarVehiculo(vehiculoId, razon);
      if (resultado.ok) {
        setRetirado(true);
        setMotivo("");
      } else {
        setError(resultado.error);
      }
    });
  };

  return (
    <section className="retirar-vehiculo" aria-busy={enProceso}>
      {error ? (
        <AlertaError>
          <Text2 renderAs="p">{diccionario.errores[error]}</Text2>
        </AlertaError>
      ) : null}

      {retirado ? (
        <Warn>
          <Text2 renderAs="p">{etiquetas.retirado}</Text2>
        </Warn>
      ) : null}

      <Danger
        type="button"
        disabled={enProceso || retirado}
        onClick={() => {
          setAbierto(true);
        }}
      >
        {etiquetas.retirarVehiculo}
      </Danger>

      {/* `ToolModal` y no `DialogModal` porque hay algo que capturar —el motivo
          es un formulario—, con encabezado y pie propios. Mismo reparto que en
          `AccionesDeConvocatoria`.

          Montado solo cuando esta abierto: un `<dialog>` cerrado conserva sus
          hijos en el DOM, asi que dejarlo puesto mantendria un campo de motivo
          en el arbol de la pantalla — que es justo lo que este cambio quita. */}
      {abierto ? (
        <ToolModal
          open
          header={etiquetas.retirar}
          onClose={cerrar}
          closeLabel={etiquetas.cancelar}
          footer={
            <Row gapSize="8">
              <Danger
                type="button"
                disabled={faltaMotivo || enProceso}
                onClick={confirmar}
              >
                {etiquetas.confirmarRetiro}
              </Danger>
              <Secondary type="button" onClick={cerrar}>
                {etiquetas.cancelar}
              </Secondary>
            </Row>
          }
        >
          <Stack gapSize="16">
            {/* El aviso va **dentro** del modal y no junto al boton: es lo ultimo
              que se lee antes de confirmar, que es cuando importa. */}
            <Warn>
              <Text2 renderAs="p">{etiquetas.retiroAviso}</Text2>
            </Warn>

            {/* `TextArea` y no `Input`: el motivo va a la bitacora y lo lee quien
              audite meses despues, asi que hay que poder escribir una frase
              entera y verla completa antes de enviar. */}
            <FormField
              label={etiquetas.motivoRetiro}
              description={etiquetas.motivoRetiroAyuda}
            >
              <TextArea
                name="motivo"
                required
                value={motivo}
                onChange={(cambio) => {
                  setMotivo(cambio.target.value);
                }}
              />
            </FormField>
          </Stack>
        </ToolModal>
      ) : null}
    </section>
  );
};

export default RetirarVehiculo;
