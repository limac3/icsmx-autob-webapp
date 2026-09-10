"use client";

import { useActionState, useEffect, useRef } from "react";
import { Primary, Secondary } from "@churchofjesuschrist/eden-buttons";
import { Card } from "@churchofjesuschrist/eden-card";
import { Grid, Item } from "@churchofjesuschrist/eden-grid";
import { H4 } from "@churchofjesuschrist/eden-headings";
import { Stack } from "@churchofjesuschrist/eden-stack";
import { Error as AlertaError, Success } from "@churchofjesuschrist/eden-alert";
import {
  Form,
  FormField,
  Input,
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
import { CAMPOS_VEHICULO, type DatosVehiculo } from "@/types/vehiculo";
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
 * **Cada seccion es `Card renderAs="fieldset"` con un `Stack` dentro**, y no el
 * `FieldSet` de Eden. Ese componente esta documentado para agrupar `Radio` y
 * `Checkbox`: su CSS solo estira a hijos `legend`, `label` e `input` —los
 * `FormField` quedaban en fila en vez de apilados— y su validacion de grupo
 * repite al pie de cada seccion el error del primer campo invalido. Medido:
 * seis mensajes para cuatro campos.
 *
 * `renderAs` es lo que permite quedarse con las dos cosas: `Card` pone el marco
 * que separa a la vista, y el elemento sigue siendo un `<fieldset>` con su
 * `<legend>`, que es lo que hace que un lector de pantalla anuncie la seccion
 * como contexto de cada campo. `Stack` apila; el `<legend>` no entra en el
 * porque el navegador lo recorta sobre el borde superior. Ver
 * desafios-implementacion.md seccion 25.
 *
 * El titulo de seccion es `H4 renderAs="legend"` por lo mismo: el `Legend` de
 * `eden-form-parts` renderiza `Text4`, que en la escala de Unity es tamano de
 * **descripcion**, y dejaba los titulos como etiquetas grises indistinguibles
 * de las de los campos. `H4` da tipografia de encabezado sin tocar el elemento.
 *
 * El reparto en columnas es `Grid` de Eden y no una media query propia: mide el
 * **contenedor** y no la ventana, asi que la pantalla se comporta igual si
 * manana el formulario se mete en un panel. `Condicion` abarca el ancho
 * completo para no dejar media fila vacia. Los cuatro breakpoints van
 * explicitos porque el tipo enviado los exige todos, aunque la documentacion y
 * la tabla de props los declaren opcionales con herencia entre ellos.
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

  const formularioRef = useRef<HTMLFormElement>(null);

  /**
   * Errores que devolvio el servidor, por campo y ya traducidos.
   *
   * Van en un `ref` y no en estado porque Eden invoca `onValidate` desde un
   * `requestAnimationFrame`: tiene que leer el valor de ese instante, no el que
   * hubiera cuando se creo el closure.
   */
  const erroresDelServidor = useRef<Record<string, string>>({});

  useEffect(() => {
    erroresDelServidor.current =
      estado.estado === "error" && estado.detalles
        ? Object.fromEntries(
            Object.entries(estado.detalles).map(([campo, motivo]) => [
              campo,
              // Nunca el codigo crudo (regla 11).
              validacionVehiculo[motivo as keyof typeof validacionVehiculo] ??
                motivo,
            ]),
          )
        : {};

    // Eden solo reevalua un control cuando ocurre un evento sobre el, y al
    // volver del servidor no ocurre ninguno: sin este disparo el error se
    // quedaria invisible hasta que el usuario tecleara. `validate` es el evento
    // que `useValidation` escucha justamente para esto.
    const formulario = formularioRef.current;
    if (!formulario) return;
    for (const campo of CAMPOS_VEHICULO) {
      const control = formulario.elements.namedItem(campo);
      if (control instanceof HTMLElement) {
        control.dispatchEvent(new Event("validate", { bubbles: true }));
      }
    }
  }, [estado, validacionVehiculo]);

  /**
   * Traslada el error del servidor a la validacion nativa del control.
   *
   * Es el camino que documenta Eden para mensajes propios. Con `description` el
   * texto salia como ayuda: se leia, pero el campo no quedaba invalido —sin
   * marco rojo, sin icono y sin `aria-invalid`—, porque el estado de validez de
   * Eden solo lo mueve `validationMessage`.
   */
  const validarConElServidor = (control: HTMLInputElement): void => {
    // El campo sale del propio control y no de un closure por campo: una
    // fabrica que devuelve funciones leyendo el ref hace saltar la regla del
    // compilador de React sobre refs en render, y ademas sobra — el control
    // conoce su nombre.
    //
    // La cadena vacia es lo que limpia; cualquier otra deja el control invalido.
    control.setCustomValidity(erroresDelServidor.current[control.name] ?? "");
  };

  /**
   * El error del servidor deja de aplicar en cuanto el usuario toca el campo.
   *
   * Sin esto se quedaria pegado: `setCustomValidity` persiste hasta que se
   * limpia, y el campo seguiria rojo con el mensaje viejo aunque ya tuviera un
   * valor bueno. Funciona por el orden de los eventos: Eden escucha `input` en
   * el propio control y reevalua dentro de un `requestAnimationFrame`, asi que
   * este manejador —que corre al burbujear hasta el formulario— ya borro la
   * entrada cuando se vuelve a llamar a `onValidate`.
   */
  const olvidarErrorDelServidor = (destino: EventTarget | null): void => {
    if (!(destino instanceof HTMLElement)) return;
    const nombre = destino.getAttribute("name");
    if (nombre) delete erroresDelServidor.current[nombre];
  };

  /**
   * Valor inicial de un control.
   *
   * **React 19 reinicia el formulario cuando la action termina**, y lo reinicia
   * a `defaultValue`: sin esto, un rechazo del servidor dejaba todos los campos
   * vacios con el mensaje de error debajo. El caso peor es el unico que el
   * navegador no puede detectar por su cuenta —un numero duplicado, que decide
   * el centinela dentro de la transaccion—: corregir un caracter obligaba a
   * teclear el vehiculo entero otra vez.
   */
  const inicial = (campo: keyof DatosVehiculo): string =>
    (estado.estado === "error" ? estado.capturado?.[campo] : undefined) ??
    valores[campo]?.toString() ??
    "";

  return (
    <Form
      action={enviar}
      className="formulario-vehiculo"
      ref={formularioRef}
      onInput={(evento) => {
        olvidarErrorDelServidor(evento.target);
      }}
    >
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

      <Grid>
        <Item xlarge={6} large={6} medium={4} small={4}>
          <Card renderAs="fieldset" className="formulario-vehiculo__seccion">
            <H4 renderAs="legend">{etiquetas.seccionIdentificacion}</H4>

            <Stack gapSize="16">
              {/* Los dos identificadores que teclea el operador van **primero**
                  y en esta seccion: son con lo que la organizacion nombra al
                  vehiculo, y el `vehiculoId` interno nunca se captura. Los dos
                  son unicos, pero eso no lo puede saber el navegador: quien lo
                  decide es el centinela en la transaccion, y el motivo
                  `duplicado` vuelve marcado en el campo que repitio. */}
              <FormField
                label={campos.numeroEconomico}
                description={etiquetas.identificadorAyuda}
                onValidate={validarConElServidor}
              >
                <Input
                  name="numeroEconomico"
                  required
                  defaultValue={inicial("numeroEconomico")}
                  disabled={soloLectura}
                />
              </FormField>

              <FormField
                label={campos.numeroDeSerie}
                description={etiquetas.identificadorAyuda}
                onValidate={validarConElServidor}
              >
                <Input
                  name="numeroDeSerie"
                  required
                  defaultValue={inicial("numeroDeSerie")}
                  disabled={soloLectura}
                />
              </FormField>

              <FormField label={campos.marca} onValidate={validarConElServidor}>
                <Input
                  name="marca"
                  required
                  defaultValue={inicial("marca")}
                  disabled={soloLectura}
                />
              </FormField>

              <FormField
                label={campos.version}
                onValidate={validarConElServidor}
              >
                <Input
                  name="version"
                  required
                  defaultValue={inicial("version")}
                  disabled={soloLectura}
                />
              </FormField>

              <FormField
                label={campos.modelo}
                onValidate={validarConElServidor}
              >
                <Input
                  name="modelo"
                  type="number"
                  required
                  min={String(LIMITES.modeloMinimo)}
                  max={String(modeloMaximo)}
                  step="1"
                  defaultValue={inicial("modelo")}
                  disabled={soloLectura}
                />
              </FormField>
            </Stack>
          </Card>
        </Item>

        <Item xlarge={6} large={6} medium={4} small={4}>
          <Card renderAs="fieldset" className="formulario-vehiculo__seccion">
            <H4 renderAs="legend">{etiquetas.seccionEspecificacion}</H4>

            <Stack gapSize="16">
              <FormField
                label={campos.kilometraje}
                onValidate={validarConElServidor}
              >
                <Input
                  name="kilometraje"
                  type="number"
                  required
                  min="0"
                  max={String(LIMITES.kilometrajeMaximo)}
                  step="1"
                  defaultValue={inicial("kilometraje")}
                  disabled={soloLectura}
                />
              </FormField>

              <FormField
                label={campos.nivelEquipamiento}
                onValidate={validarConElServidor}
              >
                <Input
                  name="nivelEquipamiento"
                  defaultValue={inicial("nivelEquipamiento")}
                  disabled={soloLectura}
                />
              </FormField>

              <FormField
                label={campos.especificacionMecanica}
                onValidate={validarConElServidor}
              >
                <TextArea
                  name="especificacionMecanica"
                  maxLength={LIMITES.especificacionMecanica}
                  defaultValue={inicial("especificacionMecanica")}
                  disabled={soloLectura}
                />
              </FormField>
            </Stack>
          </Card>
        </Item>

        <Item xlarge={12} large={12} medium={8} small={4}>
          <Card renderAs="fieldset" className="formulario-vehiculo__seccion">
            <H4 renderAs="legend">{etiquetas.seccionCondicion}</H4>

            <Stack gapSize="16">
              <FormField
                label={campos.condicionesMecanicas}
                onValidate={validarConElServidor}
              >
                <TextArea
                  name="condicionesMecanicas"
                  maxLength={LIMITES.condicionesMecanicas}
                  defaultValue={inicial("condicionesMecanicas")}
                  disabled={soloLectura}
                />
              </FormField>

              <FormField
                label={campos.detallesEsteticos}
                onValidate={validarConElServidor}
              >
                <TextArea
                  name="detallesEsteticos"
                  maxLength={LIMITES.detallesEsteticos}
                  defaultValue={inicial("detallesEsteticos")}
                  disabled={soloLectura}
                />
              </FormField>
            </Stack>
          </Card>
        </Item>
      </Grid>

      <div className="formulario-vehiculo__acciones">
        <Primary type="submit" disabled={soloLectura || enProceso}>
          {etiquetas.guardar}
        </Primary>
        <Secondary renderAs="a" href={onCancelar}>
          {etiquetas.cancelar}
        </Secondary>
      </div>
    </Form>
  );
};

export default FormularioVehiculo;
