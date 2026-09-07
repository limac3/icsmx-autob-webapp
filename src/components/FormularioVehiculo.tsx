"use client";

import { useActionState } from "react";
import { Primary, Secondary } from "@churchofjesuschrist/eden-buttons";
import { Error as AlertaError, Success } from "@churchofjesuschrist/eden-alert";
import {
  FormField,
  Input,
  Legend,
  TextArea,
} from "@churchofjesuschrist/eden-form-parts";
import { Text2 } from "@churchofjesuschrist/eden-text";
import { guardarVehiculoDesdeFormulario } from "@/app/actions/vehiculos";
import type { Diccionario } from "@/dictionaries";
import { LIMITES } from "@/lib/domain/vehiculos";
import {
  ESTADO_FORMULARIO_INICIAL,
  type EstadoFormularioVehiculo,
} from "@/types/formularioVehiculo";
import type { DatosVehiculo } from "@/types/vehiculo";
import "./FormularioVehiculo.css";

/**
 * Alta y edicion — pantallas 4.2 de `ui-ux-requerimientos.md`.
 *
 * Cliente solo por `useActionState`, que es lo que permite mostrar los errores
 * por campo sin recargar. **El formulario funciona igual sin JavaScript**: la
 * action tiene la firma `(estadoPrevio, formData)`, asi que el navegador puede
 * enviar el `<form>` por su cuenta.
 *
 * Las validaciones nativas (`required`, `min`, `max`) son cortesia para quien
 * captura. La comprobacion de verdad la hace el servidor, con las mismas cotas
 * de `LIMITES` — importadas de ahi para que no puedan divergir.
 *
 * **Las secciones son `<fieldset>` nativo, no el `FieldSet` de Eden.** Ese
 * componente esta documentado para agrupar `Radio` y `Checkbox`: su CSS solo
 * estira a hijos `legend`, `label` e `input` —los `FormField` quedaban en fila en
 * vez de apilados— y su validacion de grupo repite al pie de cada seccion el
 * error del primer campo invalido. Medido: seis mensajes para cuatro campos. El
 * `<legend>` sigue siendo el de Eden, que solo aporta tipografia. Ver
 * desafios-implementacion.md seccion 25.
 *
 * **Los `Input` no llevan `maxLength`.** El tipo de Eden lo declara `string` y
 * el de React `number`; la interseccion de ambos no admite ningun valor. Se
 * documenta en desafios-implementacion.md seccion 19. El limite lo aplica el
 * servidor igual, y devuelve el motivo por campo; lo que se pierde es que el
 * navegador deje de aceptar teclas, no la validacion.
 */

export type FormularioVehiculoProps = {
  diccionario: Diccionario;
  /** Anio maximo aceptable, calculado en el servidor en hora de negocio. */
  modeloMaximo: number;
  /** Ausente en el alta. */
  vehiculoId?: string;
  valores?: Partial<DatosVehiculo>;
  /** En solo lectura se muestran los datos sin permitir guardarlos. */
  soloLectura?: boolean;
  onCancelar?: string;
};

const FormularioVehiculo = ({
  diccionario,
  modeloMaximo,
  vehiculoId,
  valores = {},
  soloLectura = false,
  onCancelar = "/admin/vehiculos",
}: FormularioVehiculoProps) => {
  const [estado, enviar, enProceso] = useActionState<
    EstadoFormularioVehiculo,
    FormData
  >(guardarVehiculoDesdeFormulario, ESTADO_FORMULARIO_INICIAL);

  const { vehiculos: etiquetas, errores, validacionVehiculo } = diccionario;
  const campos = etiquetas.campos;

  const detalle = (campo: keyof DatosVehiculo): string | undefined => {
    if (estado.estado !== "error") return undefined;
    const motivo = estado.detalles?.[campo];
    if (!motivo) return undefined;
    // Nunca el codigo crudo (regla 11).
    return validacionVehiculo[motivo as keyof typeof validacionVehiculo];
  };

  return (
    <form action={enviar} className="formulario-vehiculo" noValidate={false}>
      {vehiculoId ? (
        <input type="hidden" name="vehiculoId" value={vehiculoId} />
      ) : null}

      {estado.estado === "error" ? (
        <AlertaError>
          <Text2 renderAs="p">{errores[estado.error]}</Text2>
        </AlertaError>
      ) : null}

      {estado.estado === "guardado" ? (
        <Success>
          <Text2 renderAs="p">
            {vehiculoId ? etiquetas.actualizado : etiquetas.creado}
          </Text2>
        </Success>
      ) : null}

      {soloLectura ? (
        <AlertaError>
          <Text2 renderAs="p">{etiquetas.soloLectura}</Text2>
        </AlertaError>
      ) : null}

      <fieldset className="formulario-vehiculo__seccion">
        <Legend>{etiquetas.seccionIdentificacion}</Legend>

        <FormField label={campos.marca} description={detalle("marca")}>
          <Input
            name="marca"
            required
            defaultValue={valores.marca ?? ""}
            disabled={soloLectura}
          />
        </FormField>

        <FormField label={campos.version} description={detalle("version")}>
          <Input
            name="version"
            required
            defaultValue={valores.version ?? ""}
            disabled={soloLectura}
          />
        </FormField>

        <FormField label={campos.modelo} description={detalle("modelo")}>
          <Input
            name="modelo"
            type="number"
            required
            min={String(LIMITES.modeloMinimo)}
            max={String(modeloMaximo)}
            step="1"
            defaultValue={valores.modelo?.toString() ?? ""}
            disabled={soloLectura}
          />
        </FormField>
      </fieldset>

      <fieldset className="formulario-vehiculo__seccion">
        <Legend>{etiquetas.seccionEspecificacion}</Legend>

        <FormField
          label={campos.kilometraje}
          description={detalle("kilometraje")}
        >
          <Input
            name="kilometraje"
            type="number"
            required
            min="0"
            max={String(LIMITES.kilometrajeMaximo)}
            step="1"
            defaultValue={valores.kilometraje?.toString() ?? ""}
            disabled={soloLectura}
          />
        </FormField>

        <FormField
          label={campos.nivelEquipamiento}
          description={detalle("nivelEquipamiento")}
        >
          <Input
            name="nivelEquipamiento"
            defaultValue={valores.nivelEquipamiento ?? ""}
            disabled={soloLectura}
          />
        </FormField>

        <FormField
          label={campos.especificacionMecanica}
          description={detalle("especificacionMecanica")}
        >
          <TextArea
            name="especificacionMecanica"
            maxLength={LIMITES.especificacionMecanica}
            defaultValue={valores.especificacionMecanica ?? ""}
            disabled={soloLectura}
          />
        </FormField>
      </fieldset>

      <fieldset className="formulario-vehiculo__seccion">
        <Legend>{etiquetas.seccionCondicion}</Legend>

        <FormField
          label={campos.condicionesMecanicas}
          description={detalle("condicionesMecanicas")}
        >
          <TextArea
            name="condicionesMecanicas"
            maxLength={LIMITES.condicionesMecanicas}
            defaultValue={valores.condicionesMecanicas ?? ""}
            disabled={soloLectura}
          />
        </FormField>

        <FormField
          label={campos.detallesEsteticos}
          description={detalle("detallesEsteticos")}
        >
          <TextArea
            name="detallesEsteticos"
            maxLength={LIMITES.detallesEsteticos}
            defaultValue={valores.detallesEsteticos ?? ""}
            disabled={soloLectura}
          />
        </FormField>
      </fieldset>

      <div className="formulario-vehiculo__acciones">
        <Primary type="submit" disabled={soloLectura || enProceso}>
          {etiquetas.guardar}
        </Primary>
        <Secondary renderAs="a" href={onCancelar}>
          {etiquetas.cancelar}
        </Secondary>
      </div>
    </form>
  );
};

export default FormularioVehiculo;
