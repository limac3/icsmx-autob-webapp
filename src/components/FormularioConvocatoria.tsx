"use client";

import { Fragment, useActionState, useEffect, useRef } from "react";
import { Error as AlertaError, Success } from "@churchofjesuschrist/eden-alert";
import { Primary, Secondary } from "@churchofjesuschrist/eden-buttons";
import { Card } from "@churchofjesuschrist/eden-card";
import {
  DateInput,
  FieldSet,
  Form,
  FormField,
  Input,
  Label,
  Radio,
  TimeInput,
} from "@churchofjesuschrist/eden-form-parts";
import { RichTextEditor } from "@churchofjesuschrist/eden-rich-text-editor";
import { H4 } from "@churchofjesuschrist/eden-headings";
import { Stack } from "@churchofjesuschrist/eden-stack";
import { Text2, Text4 } from "@churchofjesuschrist/eden-text";
import { guardarConvocatoriaDesdeFormulario } from "@/app/actions/convocatorias";
import type { Diccionario } from "@/dictionaries";
import { LIMITES_CONVOCATORIA } from "@/lib/domain/convocatorias";
import {
  ESTADO_CONVOCATORIA_INICIAL,
  type EstadoFormularioConvocatoria,
} from "@/types/formularioConvocatoria";
import { TIPOS_CONVOCATORIA } from "@/types/convocatoria";
import "./FormularioConvocatoria.css";

/**
 * Alta y edicion de convocatoria — pantalla 4.4.
 *
 * **Cada instante son dos controles, `DateInput` y `TimeInput`.** Eden no tiene
 * un campo combinado de fecha y hora: su propio tipo de `Input` remite a esos
 * dos. El adaptador de la action los une antes de convertir.
 *
 * **Y estan etiquetados en hora de Ciudad de Mexico.** Ninguno de los dos lleva
 * zona: entregan la hora de pared que se teclea, y el adaptador la interpreta en
 * hora de negocio. Decirlo en la pantalla no es cortesia — sin esa etiqueta,
 * quien captura desde otra zona supone que escribe en la suya, para un dato que
 * decide cuando abre una venta.
 *
 * **El tipo va con `Radio` dentro de un `FieldSet`**, que es el unico uso para
 * el que Eden escribio ese componente: agrupar `Radio` o `Checkbox` con su
 * `Legend`. Las secciones del formulario, en cambio, son `Card renderAs="fieldset"`
 * — ver `desafios-implementacion.md` seccion 25.
 */

export type FormularioConvocatoriaProps = {
  diccionario: Diccionario;
  /** Ausente en el alta. */
  convocatoriaId?: string;
  /** Valores ya convertidos a hora de pared de negocio, listos para el campo. */
  valores?: {
    tipo?: string;
    descripcionParticipacion?: string;
    publicadaEn?: { fecha: string; hora: string };
    inicioVenta?: { fecha: string; hora: string };
    finVenta?: { fecha: string; hora: string };
    horasLiquidacion?: number;
  };
  /** Con `false` se muestra sin permitir guardar. */
  editable?: boolean;
  onCancelar?: string;
};

/**
 * Controles que se le habilitan al editor.
 *
 * **Tiene que coincidir con `ETIQUETAS_PERMITIDAS`** de
 * `htmlDeDescripcion.ts`: si aqui se habilita uno mas, el servidor rechazara lo
 * que el editor acaba de producir. Quedan fuera `image` —el marcado permitido
 * no admite `<img>`— y `heading1`, porque la pagina ya tiene su H1 y un
 * segundo encabezado de nivel uno rompe la jerarquia del documento.
 *
 * Va a nivel de modulo y no en el render porque Lexical solo lo lee al montar y
 * un arreglo nuevo en cada pintado seria trabajo tirado.
 */
const CONTROLES_DEL_EDITOR = [
  "paragraph",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "blockquote",
  "preformatted",
  "bold",
  "italic",
  "underline",
  "link",
  "bulletedList",
  "numberedList",
] as const;

/** Los tres campos que el formulario parte en fecha y hora. */
const CAMPOS_DE_INSTANTE = ["publicadaEn", "inicioVenta", "finVenta"] as const;

const FormularioConvocatoria = ({
  diccionario,
  convocatoriaId,
  valores = {},
  editable = true,
  onCancelar = "/admin/convocatorias",
}: FormularioConvocatoriaProps) => {
  const [estado, enviar, enProceso] = useActionState<
    EstadoFormularioConvocatoria,
    FormData
  >(guardarConvocatoriaDesdeFormulario, ESTADO_CONVOCATORIA_INICIAL);

  const etiquetas = diccionario.convocatorias;
  const validacion = diccionario.validacionConvocatoria;

  const formularioRef = useRef<HTMLFormElement>(null);
  const erroresDelServidor = useRef<Record<string, string>>({});

  useEffect(() => {
    // El dominio informa el error por **instante** (`publicadaEn`), pero Eden
    // separa fecha y hora en dos controles. El motivo se copia a los dos para
    // que el par entero se marque invalido: senalar solo uno dejaria al otro en
    // verde junto a un dato que tampoco sirve.
    const porControl: Record<string, string> = {};
    if (estado.estado === "error" && estado.detalles) {
      for (const [campo, motivo] of Object.entries(estado.detalles)) {
        const texto = validacion[motivo as keyof typeof validacion] ?? motivo;
        porControl[campo] = texto;
        if ((CAMPOS_DE_INSTANTE as readonly string[]).includes(campo)) {
          porControl[`${campo}Fecha`] = texto;
          porControl[`${campo}Hora`] = texto;
        }
      }
    }
    erroresDelServidor.current = porControl;

    // Eden solo reevalua un control cuando ocurre un evento sobre el, y al
    // volver del servidor no ocurre ninguno. Ver desafios-implementacion.md 26.
    const formulario = formularioRef.current;
    if (!formulario) return;
    for (const nombre of Object.keys(porControl)) {
      const control = formulario.elements.namedItem(nombre);
      if (control instanceof HTMLElement) {
        control.dispatchEvent(new Event("validate", { bubbles: true }));
      }
    }
  }, [estado, validacion]);

  const validarConElServidor = (control: HTMLInputElement): void => {
    control.setCustomValidity(erroresDelServidor.current[control.name] ?? "");
  };

  const olvidarErrorDelServidor = (destino: EventTarget | null): void => {
    if (!(destino instanceof HTMLElement)) return;
    const nombre = destino.getAttribute("name");
    if (nombre) delete erroresDelServidor.current[nombre];
  };

  return (
    <Form
      action={enviar}
      className="formulario-convocatoria"
      ref={formularioRef}
      onInput={(evento) => {
        olvidarErrorDelServidor(evento.target);
      }}
    >
      {convocatoriaId ? (
        <input type="hidden" name="convocatoriaId" value={convocatoriaId} />
      ) : null}

      {estado.estado === "error" ? (
        <AlertaError>
          <Text2 renderAs="p">{diccionario.errores[estado.error]}</Text2>
        </AlertaError>
      ) : null}

      {estado.estado === "guardado" ? (
        <Success>
          <Text2 renderAs="p">{etiquetas.guardada}</Text2>
        </Success>
      ) : null}

      {editable ? null : (
        <AlertaError>
          <Text2 renderAs="p">{etiquetas.soloLectura}</Text2>
        </AlertaError>
      )}

      <Card renderAs="fieldset" className="formulario-convocatoria__seccion">
        <H4 renderAs="legend">{etiquetas.seccionParticipacion}</H4>

        <Stack gapSize="16">
          {/* `Radio` es un `<input>` pelado: la etiqueta va como `Label`
              hermano inmediato, que es lo que su CSS espera
              (`.eden-form-part-input--radio + .eden-form-part-label`). Pasarle
              el texto como hijo falla en tiempo de render — un `input` es un
              elemento vacio. El `Fragment` no crea nodo, asi que la adyacencia
              se conserva. */}
          <FieldSet legend={etiquetas.campoTipo}>
            {TIPOS_CONVOCATORIA.map((tipo) => (
              <Fragment key={tipo}>
                <Radio
                  id={`tipo-${tipo}`}
                  name="tipo"
                  value={tipo}
                  required
                  defaultChecked={
                    (valores.tipo ?? TIPOS_CONVOCATORIA[0]) === tipo
                  }
                  disabled={!editable}
                />
                <Label htmlFor={`tipo-${tipo}`}>
                  {diccionario.tiposConvocatoria[tipo]}
                </Label>
              </Fragment>
            ))}
          </FieldSet>

          <FormField
            label={etiquetas.campoDescripcion}
            onValidate={validarConElServidor}
          >
            <RichTextEditor
              name="descripcionParticipacion"
              type="html"
              required
              maxLength={String(LIMITES_CONVOCATORIA.descripcionParticipacion)}
              availableControls={[...CONTROLES_DEL_EDITOR]}
              initialContent={valores.descripcionParticipacion ?? ""}
              disabled={!editable}
            />
          </FormField>
        </Stack>
      </Card>

      <Card renderAs="fieldset" className="formulario-convocatoria__seccion">
        <H4 renderAs="legend">{etiquetas.seccionCalendario}</H4>
        <Text4 renderAs="p">{etiquetas.horaDeNegocio}</Text4>

        <Stack gapSize="16">
          <FieldSet legend={etiquetas.campoPublicadaEn}>
            <FormField
              label={etiquetas.subcampoFecha}
              onValidate={validarConElServidor}
            >
              <DateInput
                name="publicadaEnFecha"
                required
                defaultValue={valores.publicadaEn?.fecha ?? ""}
                disabled={!editable}
              />
            </FormField>
            <FormField
              label={etiquetas.subcampoHora}
              onValidate={validarConElServidor}
            >
              <TimeInput
                name="publicadaEnHora"
                required
                defaultValue={valores.publicadaEn?.hora ?? ""}
                disabled={!editable}
              />
            </FormField>
          </FieldSet>

          <FieldSet legend={etiquetas.campoInicioVenta}>
            <FormField
              label={etiquetas.subcampoFecha}
              onValidate={validarConElServidor}
            >
              <DateInput
                name="inicioVentaFecha"
                required
                defaultValue={valores.inicioVenta?.fecha ?? ""}
                disabled={!editable}
              />
            </FormField>
            <FormField
              label={etiquetas.subcampoHora}
              onValidate={validarConElServidor}
            >
              <TimeInput
                name="inicioVentaHora"
                required
                defaultValue={valores.inicioVenta?.hora ?? ""}
                disabled={!editable}
              />
            </FormField>
          </FieldSet>

          <FieldSet legend={etiquetas.campoFinVenta}>
            <FormField
              label={etiquetas.subcampoFecha}
              onValidate={validarConElServidor}
            >
              <DateInput
                name="finVentaFecha"
                required
                defaultValue={valores.finVenta?.fecha ?? ""}
                disabled={!editable}
              />
            </FormField>
            <FormField
              label={etiquetas.subcampoHora}
              onValidate={validarConElServidor}
            >
              <TimeInput
                name="finVentaHora"
                required
                defaultValue={valores.finVenta?.hora ?? ""}
                disabled={!editable}
              />
            </FormField>
          </FieldSet>

          <FormField
            label={etiquetas.campoHorasLiquidacion}
            description={etiquetas.horasLiquidacionAyuda}
            onValidate={validarConElServidor}
          >
            <Input
              name="horasLiquidacion"
              type="number"
              required
              min={String(LIMITES_CONVOCATORIA.horasLiquidacionMinimo)}
              max={String(LIMITES_CONVOCATORIA.horasLiquidacionMaximo)}
              step="1"
              defaultValue={valores.horasLiquidacion?.toString() ?? "48"}
              disabled={!editable}
            />
          </FormField>
        </Stack>
      </Card>

      <div className="formulario-convocatoria__acciones">
        <Primary type="submit" disabled={!editable || enProceso}>
          {diccionario.vehiculos.guardar}
        </Primary>
        <Secondary renderAs="a" href={onCancelar}>
          {diccionario.vehiculos.cancelar}
        </Secondary>
      </div>
    </Form>
  );
};

export default FormularioConvocatoria;
