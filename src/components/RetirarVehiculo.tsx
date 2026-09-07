"use client";

import { useActionState } from "react";
import { Error as AlertaError, Warn } from "@churchofjesuschrist/eden-alert";
import { Danger } from "@churchofjesuschrist/eden-buttons";
import { Form, FormField, Input } from "@churchofjesuschrist/eden-form-parts";
import { Text2 } from "@churchofjesuschrist/eden-text";
import { retirarVehiculoDesdeFormulario } from "@/app/actions/vehiculos";
import type { Diccionario } from "@/dictionaries";
import {
  ESTADO_FORMULARIO_INICIAL,
  type EstadoFormularioVehiculo,
} from "@/types/formularioVehiculo";
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
 */

export type RetirarVehiculoProps = {
  vehiculoId: string;
  diccionario: Diccionario;
};

const RetirarVehiculo = ({ vehiculoId, diccionario }: RetirarVehiculoProps) => {
  const [estado, enviar, enProceso] = useActionState<
    EstadoFormularioVehiculo,
    FormData
  >(retirarVehiculoDesdeFormulario, ESTADO_FORMULARIO_INICIAL);

  const etiquetas = diccionario.vehiculos;

  return (
    <Form action={enviar} className="retirar-vehiculo">
      <input type="hidden" name="vehiculoId" value={vehiculoId} />

      {estado.estado === "error" ? (
        <AlertaError>
          <Text2 renderAs="p">
            {estado.detalles?.motivo
              ? diccionario.validacionVehiculo.requerido
              : diccionario.errores[estado.error]}
          </Text2>
        </AlertaError>
      ) : null}

      {estado.estado === "guardado" ? (
        <Warn>
          <Text2 renderAs="p">{etiquetas.retirado}</Text2>
        </Warn>
      ) : null}

      <FormField
        label={etiquetas.motivoRetiro}
        description={etiquetas.motivoRetiroAyuda}
      >
        <Input name="motivo" required />
      </FormField>

      <Danger type="submit" disabled={enProceso}>
        {etiquetas.retirar}
      </Danger>
    </Form>
  );
};

export default RetirarVehiculo;
