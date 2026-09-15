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
import {
  MODALIDADES_ADJUDICACION,
  TIPOS_CONVOCATORIA,
} from "@/types/convocatoria";
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
    folio?: string;
    nombre?: string;
    tipo?: string;
    descripcionParticipacion?: string;
    publicadaEn?: { fecha: string; hora: string };
    inicioVenta?: { fecha: string; hora: string };
    finVenta?: { fecha: string; hora: string };
    horasLiquidacion?: number;
    modalidadAdjudicacion?: string;
    limiteAdjudicaciones?: number;
    limiteSolicitudes?: number;
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

    // **La descripcion necesita su propio aviso**, y es el unico campo que lo
    // necesita. Eden valida el editor enriquecido con un `textarea` propio que
    // **no lleva `name`** —el `name` va en otro, el que serializa el contenido
    // para el `FormData`— y esos dos son **hermanos**. Un evento despachado
    // sobre el que se encuentra por nombre burbujea hacia los ancestros y nunca
    // alcanza al hermano, asi que el bucle de arriba no lo reevalua nunca.
    //
    // Se busca por forma y no por la clase de Eden: `textarea[required]` sin
    // `name` es exactamente "el control que valida un campo cuyo valor vive en
    // otro sitio". Si Eden algun dia le pone nombre, la prueba de este archivo
    // lo delata en vez de que el mensaje desaparezca en silencio.
    if (porControl.descripcionParticipacion !== undefined) {
      formulario
        .querySelector<HTMLTextAreaElement>("textarea[required]:not([name])")
        ?.dispatchEvent(new Event("validate", { bubbles: true }));
    }
  }, [estado, validacion]);

  /** Copia al control el error que el servidor devolvio para su campo. */
  const validarConElServidor = (control: HTMLInputElement): void => {
    control.setCustomValidity(erroresDelServidor.current[control.name] ?? "");
  };

  /**
   * Lo mismo para la descripcion, con el campo nombrado aqui.
   *
   * **Hace falta porque su control no tiene `name`.** Eden pone el `name` en el
   * `textarea` que serializa el editor y deja sin nombre el que marca
   * `required`, que es justo el que llega a este callback. Con la busqueda por
   * `control.name`, la descripcion era el unico campo del formulario cuyo error
   * del servidor **nunca** podia mostrarse: el motivo viajaba en `detalles` y se
   * perdia aqui, y en su lugar el navegador escribia su propio "Please fill out
   * this field" en ingles, sobre un campo lleno y por una razon que no era la
   * real. Costo un reporte de defecto descubrir que el problema era un enlace
   * `mailto:` (`desafios-implementacion.md` 58).
   *
   * Son dos funciones planas y no una currificada porque `react-hooks/refs`
   * rechaza que una funcion creada en render **devuelva** otra que lee un ref:
   * no puede probar que la devuelta no se invoque durante el render.
   */
  const validarDescripcionConElServidor = (control: HTMLInputElement): void => {
    control.setCustomValidity(
      erroresDelServidor.current.descripcionParticipacion ?? "",
    );
  };

  const olvidarErrorDelServidor = (destino: EventTarget | null): void => {
    if (!(destino instanceof HTMLElement)) return;
    const nombre = destino.getAttribute("name");
    if (nombre) delete erroresDelServidor.current[nombre];
  };

  /**
   * Valor inicial de un control, por su **nombre**.
   *
   * React 19 reinicia el formulario a `defaultValue` cuando la action termina.
   * Sin esto, un folio duplicado —que solo el centinela puede detectar— dejaba
   * la descripcion y las seis mitades de fecha y hora en blanco, con el error
   * senalado sobre campos vacios.
   */
  const capturado = (control: string): string | undefined =>
    estado.estado === "error" ? estado.capturado?.[control] : undefined;

  const inicial = (control: string, previo?: string): string =>
    capturado(control) ?? previo ?? "";

  /**
   * Numero de rechazo, que es la `key` del editor enriquecido.
   *
   * Con los `Input` basta devolver lo capturado en `defaultValue`, porque el
   * reinicio de React deja el campo justo en ese valor. Con el editor no
   * alcanza: se vacia en **cada** rechazo —Eden atiende el evento `reset` que
   * dispara el reinicio— y **Lexical solo lee `initialContent` al montar**, asi
   * que una prop nueva sobre el mismo componente se ignora en silencio. Solo
   * remontarlo lo repuebla, y para eso la `key` tiene que cambiar siempre, no
   * solo cuando cambia el contenido.
   *
   * Lo cuenta el adaptador desde el estado anterior porque aqui no se puede:
   * `useActionState` entrega un objeto nuevo con el mismo contenido si se
   * reenvia sin cambios, y contarlo con `setState` en un efecto encadena
   * renders.
   *
   * Es lo mas caro de retomar del formulario, y el rechazo mas probable —un
   * folio duplicado— llega justo cuando ya esta escrito.
   */
  const intento = estado.estado === "error" ? estado.intento : 0;

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
        <H4 renderAs="legend">{etiquetas.seccionIdentificacion}</H4>

        <Stack gapSize="16">
          {/* Folio y nombre corto son lo que hace reconocible la convocatoria
              en las listas y en la bitacora. Solo el folio es unico, y quien
              lo decide es su centinela en la transaccion: si vuelve el motivo
              `duplicado`, se marca en este campo. El nombre puede repetirse a
              proposito —dos ventas recurrentes se llaman igual— y el folio es
              lo que las distingue. */}
          <FormField
            label={etiquetas.campoFolio}
            description={etiquetas.folioAyuda}
            onValidate={validarConElServidor}
          >
            <Input
              name="folio"
              required
              defaultValue={inicial("folio", valores.folio)}
              disabled={!editable}
            />
          </FormField>

          <FormField
            label={etiquetas.campoNombre}
            description={etiquetas.nombreAyuda}
            onValidate={validarConElServidor}
          >
            <Input
              name="nombre"
              required
              defaultValue={inicial("nombre", valores.nombre)}
              disabled={!editable}
            />
          </FormField>
        </Stack>
      </Card>

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
                    (capturado("tipo") ??
                      valores.tipo ??
                      TIPOS_CONVOCATORIA[0]) === tipo
                  }
                  disabled={!editable}
                />
                <Label htmlFor={`tipo-${tipo}`}>
                  {diccionario.tiposConvocatoria[tipo]}
                </Label>
              </Fragment>
            ))}
          </FieldSet>

          {/* Modalidad de adjudicacion (R-23). Va junto al tipo porque es la
              otra decision estructural de la convocatoria, y como el tipo
              **queda congelada al publicar**: cambiarla con la fila formada
              alteraria retroactivamente las reglas bajo las que la gente se
              formo. */}
          <FieldSet legend={etiquetas.campoModalidad}>
            {MODALIDADES_ADJUDICACION.map((modalidad) => (
              <Fragment key={modalidad}>
                <Radio
                  id={`modalidad-${modalidad}`}
                  name="modalidadAdjudicacion"
                  value={modalidad}
                  required
                  defaultChecked={
                    (capturado("modalidadAdjudicacion") ??
                      valores.modalidadAdjudicacion ??
                      MODALIDADES_ADJUDICACION[0]) === modalidad
                  }
                  disabled={!editable}
                />
                <Label htmlFor={`modalidad-${modalidad}`}>
                  {diccionario.modalidadesAdjudicacion[modalidad]}
                </Label>
              </Fragment>
            ))}
          </FieldSet>

          <FormField
            label={etiquetas.campoDescripcion}
            onValidate={validarDescripcionConElServidor}
          >
            <RichTextEditor
              key={intento}
              name="descripcionParticipacion"
              type="html"
              required
              maxLength={String(LIMITES_CONVOCATORIA.descripcionParticipacion)}
              availableControls={[...CONTROLES_DEL_EDITOR]}
              initialContent={inicial(
                "descripcionParticipacion",
                valores.descripcionParticipacion,
              )}
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
                defaultValue={inicial(
                  "publicadaEnFecha",
                  valores.publicadaEn?.fecha,
                )}
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
                defaultValue={inicial(
                  "publicadaEnHora",
                  valores.publicadaEn?.hora,
                )}
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
                defaultValue={inicial(
                  "inicioVentaFecha",
                  valores.inicioVenta?.fecha,
                )}
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
                defaultValue={inicial(
                  "inicioVentaHora",
                  valores.inicioVenta?.hora,
                )}
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
                defaultValue={inicial("finVentaFecha", valores.finVenta?.fecha)}
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
                defaultValue={inicial("finVentaHora", valores.finVenta?.hora)}
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
              defaultValue={inicial(
                "horasLiquidacion",
                valores.horasLiquidacion?.toString() ?? "48",
              )}
              disabled={!editable}
            />
          </FormField>

          {/* Los dos cupos de participacion (R-09 y R-22). Van juntos y al
              final porque se leen como un par, aunque se comporten al reves:
              el de adjudicaciones se recupera al perder un vehiculo, el de
              solicitudes cuenta intentos y jamas decrece. Las ayudas lo dicen,
              porque es la clase de asimetria que nadie deduce del nombre. */}
          <FormField
            label={etiquetas.campoLimiteAdjudicaciones}
            description={etiquetas.limiteAdjudicacionesAyuda}
            onValidate={validarConElServidor}
          >
            <Input
              name="limiteAdjudicaciones"
              type="number"
              required
              min={String(LIMITES_CONVOCATORIA.limiteMinimo)}
              max={String(LIMITES_CONVOCATORIA.limiteMaximo)}
              step="1"
              defaultValue={inicial(
                "limiteAdjudicaciones",
                valores.limiteAdjudicaciones?.toString() ?? "1",
              )}
              disabled={!editable}
            />
          </FormField>

          <FormField
            label={etiquetas.campoLimiteSolicitudes}
            description={etiquetas.limiteSolicitudesAyuda}
            onValidate={validarConElServidor}
          >
            <Input
              name="limiteSolicitudes"
              type="number"
              required
              min={String(LIMITES_CONVOCATORIA.limiteMinimo)}
              max={String(LIMITES_CONVOCATORIA.limiteMaximo)}
              step="1"
              defaultValue={inicial(
                "limiteSolicitudes",
                valores.limiteSolicitudes?.toString() ?? "3",
              )}
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
