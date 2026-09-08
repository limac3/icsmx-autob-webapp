"use client";

import { useState, useTransition } from "react";
import {
  Error as AlertaError,
  Success,
  Warn,
} from "@churchofjesuschrist/eden-alert";
import { Danger, Primary, Secondary } from "@churchofjesuschrist/eden-buttons";
import { DialogModal } from "@churchofjesuschrist/eden-dialog-modal";
import { Row } from "@churchofjesuschrist/eden-row";
import { FormField, TextArea } from "@churchofjesuschrist/eden-form-parts";
import { Text2 } from "@churchofjesuschrist/eden-text";
import {
  aprobarConvocatoria,
  concluirConvocatoria,
  enviarAAprobacion,
  ocultarConvocatoria,
  publicarConvocatoria,
  reactivarConvocatoria,
  rechazarConvocatoria,
} from "@/app/actions/convocatorias";
import type { Diccionario } from "@/dictionaries";
import {
  eventosDisponibles,
  type EventoConvocatoria,
} from "@/lib/domain/transiciones";
import type { EstatusConvocatoria } from "@/types/convocatoria";
import type { CodigoError } from "@/types/resultado";
import "./AccionesDeConvocatoria.css";

/**
 * Las acciones del ciclo de una convocatoria — pantallas 4.3 y 5.
 *
 * **Los botones salen de la maquina de estados, no de una lista escrita a
 * mano.** `eventosDisponibles` decide que se ofrece desde el estatus actual, asi
 * que agregar una transicion en `transiciones.ts` la hace aparecer aqui y
 * quitarla la retira, sin que nadie tenga que acordarse de esta pantalla.
 *
 * Eso es comodidad, no seguridad: **el servidor rechaza toda transicion
 * invalida** aunque la interfaz la ofrezca. Ocultar un boton nunca es un
 * control de acceso.
 *
 * El permiso tambien se decide en el servidor. Aqui solo se ocultan las
 * acciones que quien mira no puede ejecutar, para no ofrecer un boton que
 * responderia `forbidden`.
 */

type Ejecutor = (motivo: string) => Promise<{ ok: boolean; error?: string }>;

type DefinicionDeAccion = {
  /** Permiso que exige, para no ofrecer lo que respondera `forbidden`. */
  permiso: "Autob_Administrar_Convocatorias" | "Autob_Aprobar_Convocatorias";
  /** `true` si el evento esta marcado con **M** en el catalogo de bitacora. */
  exigeMotivo: boolean;
  /**
   * Clave del texto de confirmacion, o ausente si la accion no la pide.
   *
   * Es la clave y no un booleano para que el texto exista en el diccionario por
   * construccion: con un booleano habria que buscarlo con un indice calculado, y
   * las tres acciones que no confirman acabarian con una entrada vacia que el
   * diccionario arrastraria sin que nadie la lea.
   */
  confirma?:
    | "confirmar_ENVIAR_A_APROBACION"
    | "confirmar_APROBAR"
    | "confirmar_PUBLICAR"
    | "confirmar_CONCLUIR";
  tono: "primaria" | "secundaria" | "peligro";
  ejecutar: (convocatoriaId: string) => Ejecutor;
};

const ACCIONES: Record<EventoConvocatoria, DefinicionDeAccion> = {
  ENVIAR_A_APROBACION: {
    permiso: "Autob_Administrar_Convocatorias",
    exigeMotivo: false,
    // Deja de ser editable hasta que alguien dictamine. Se confirma.
    confirma: "confirmar_ENVIAR_A_APROBACION",
    tono: "primaria",
    ejecutar: (id) => () => enviarAAprobacion(id),
  },
  APROBAR: {
    permiso: "Autob_Aprobar_Convocatorias",
    exigeMotivo: false,
    confirma: "confirmar_APROBAR",
    tono: "primaria",
    ejecutar: (id) => () => aprobarConvocatoria(id),
  },
  RECHAZAR: {
    permiso: "Autob_Aprobar_Convocatorias",
    exigeMotivo: true,
    tono: "peligro",
    ejecutar: (id) => (motivo) => rechazarConvocatoria(id, motivo),
  },
  PUBLICAR: {
    permiso: "Autob_Administrar_Convocatorias",
    exigeMotivo: false,
    confirma: "confirmar_PUBLICAR",
    tono: "primaria",
    ejecutar: (id) => () => publicarConvocatoria(id),
  },
  OCULTAR: {
    permiso: "Autob_Administrar_Convocatorias",
    exigeMotivo: true,
    tono: "peligro",
    ejecutar: (id) => (motivo) => ocultarConvocatoria(id, motivo),
  },
  REACTIVAR: {
    permiso: "Autob_Administrar_Convocatorias",
    exigeMotivo: false,
    tono: "secundaria",
    ejecutar: (id) => () => reactivarConvocatoria(id),
  },
  CONCLUIR: {
    permiso: "Autob_Administrar_Convocatorias",
    exigeMotivo: false,
    // Terminal: de CONCLUIDA no sale ninguna transicion.
    confirma: "confirmar_CONCLUIR",
    tono: "peligro",
    ejecutar: (id) => () => concluirConvocatoria(id),
  },
};

/**
 * Las dos acciones que exigen que dictamine alguien distinto de quien creo la
 * convocatoria (R-05).
 *
 * Se listan aqui y no se deducen del permiso porque la separacion de funciones
 * no es una cuestion de capacidad: quien aprueba **tiene** el permiso: lo que no
 * puede es usarlo sobre lo suyo.
 */
const EXIGEN_OTRO_DICTAMINADOR: readonly EventoConvocatoria[] = [
  "APROBAR",
  "RECHAZAR",
];

export type AccionesDeConvocatoriaProps = {
  convocatoriaId: string;
  estatus: EstatusConvocatoria;
  diccionario: Diccionario;
  /** Permisos de quien mira, para no ofrecer lo que no puede ejecutar. */
  permisos: readonly string[];
  /** `true` si quien mira creo esta convocatoria. R-05 le cierra el dictamen. */
  esCreador?: boolean;
};

const AccionesDeConvocatoria = ({
  convocatoriaId,
  estatus,
  diccionario,
  permisos,
  esCreador = false,
}: AccionesDeConvocatoriaProps) => {
  const [enProceso, iniciar] = useTransition();
  const [error, setError] = useState<CodigoError | undefined>(undefined);
  const [hecho, setHecho] = useState<EventoConvocatoria | undefined>(undefined);
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  // Evento a la espera de confirmacion. `undefined` = el modal esta cerrado.
  const [porConfirmar, setPorConfirmar] = useState<
    EventoConvocatoria | undefined
  >(undefined);

  const etiquetas = diccionario.acciones;

  const conPermiso = eventosDisponibles("convocatoria", estatus).filter(
    (evento) => permisos.includes(ACCIONES[evento].permiso),
  );

  // R-05. Se separan en vez de filtrarse y ya: quien creo la convocatoria y
  // tiene el permiso de aprobacion necesita saber **por que** no ve el boton,
  // o supondra que le falta el permiso y lo pedira.
  const cerradasPorSerCreador = esCreador
    ? conPermiso.filter((evento) => EXIGEN_OTRO_DICTAMINADOR.includes(evento))
    : [];
  const disponibles = conPermiso.filter(
    (evento) => !cerradasPorSerCreador.includes(evento),
  );

  /** Ejecuta de verdad. Solo se llega aqui con la confirmacion ya resuelta. */
  const aplicar = (evento: EventoConvocatoria) => {
    const definicion = ACCIONES[evento];
    const motivo = motivos[evento] ?? "";

    setError(undefined);
    setHecho(undefined);
    iniciar(async () => {
      const resultado = await definicion.ejecutar(convocatoriaId)(motivo);
      if (resultado.ok) setHecho(evento);
      else setError(resultado.error as CodigoError);
    });
  };

  /**
   * Puerta de entrada de cada boton: valida el motivo y decide si hace falta
   * confirmar. Se separa de `aplicar` para que la confirmacion no tenga que
   * repetir la validacion ni al reves.
   */
  const intentar = (evento: EventoConvocatoria) => {
    if (ACCIONES[evento].exigeMotivo && (motivos[evento] ?? "").trim() === "") {
      setError("validation_failed");
      return;
    }
    if (ACCIONES[evento].confirma !== undefined) {
      setPorConfirmar(evento);
      return;
    }
    aplicar(evento);
  };

  const avisoDeCreador =
    cerradasPorSerCreador.length > 0 ? (
      <Warn>
        <Text2 renderAs="p">{etiquetas.noApruebasLoTuyo}</Text2>
      </Warn>
    ) : null;

  if (disponibles.length === 0) {
    // Con el aviso puesto, "no hay acciones" sobra: la explicacion ya esta.
    return (
      <section className="acciones-convocatoria" aria-busy={enProceso}>
        {avisoDeCreador ?? <Text2 renderAs="p">{etiquetas.sinAcciones}</Text2>}
      </section>
    );
  }

  return (
    <section className="acciones-convocatoria" aria-busy={enProceso}>
      {error ? (
        <AlertaError>
          <Text2 renderAs="p">{diccionario.errores[error]}</Text2>
        </AlertaError>
      ) : null}

      {hecho ? (
        <Success>
          <Text2 renderAs="p">{etiquetas[`hecho_${hecho}`]}</Text2>
        </Success>
      ) : null}

      {avisoDeCreador}

      {disponibles.map((evento) => {
        const definicion = ACCIONES[evento];
        const Boton =
          definicion.tono === "peligro"
            ? Danger
            : definicion.tono === "primaria"
              ? Primary
              : Secondary;

        const faltaMotivo =
          definicion.exigeMotivo && (motivos[evento] ?? "").trim() === "";

        return (
          <div key={evento} className="acciones-convocatoria__accion">
            {definicion.exigeMotivo ? (
              // `TextArea` y no `Input`: el motivo va a la bitacora y lo lee
              // quien audite meses despues, asi que hay que poder escribir una
              // frase entera y verla completa antes de enviar.
              <FormField
                label={etiquetas.motivo}
                description={etiquetas.motivoAyuda}
              >
                <TextArea
                  name={`motivo-${evento}`}
                  required
                  value={motivos[evento] ?? ""}
                  onChange={(cambio) => {
                    setMotivos((previos) => ({
                      ...previos,
                      [evento]: cambio.target.value,
                    }));
                  }}
                />
              </FormField>
            ) : null}

            {/* El boton espera al motivo en vez de aceptar y quejarse: es una
                accion irreversible, y `required` en el campo ya explica que
                falta. La guarda de `intentar` se queda igualmente, porque un
                boton deshabilitado no es una validacion. */}
            <Boton
              type="button"
              disabled={enProceso || faltaMotivo}
              onClick={() => {
                intentar(evento);
              }}
            >
              {etiquetas[`evento_${evento}`]}
            </Boton>
          </div>
        );
      })}

      {/* Un solo modal para todas las acciones que confirman: el evento
          pendiente vive en el estado. Es `<dialog>` nativo y bloquea el resto
          de la pagina, al contrario que un `confirm()`, que el navegador puede
          suprimir despues del primero. */}
      <DialogModal
        open={porConfirmar !== undefined}
        header={porConfirmar ? etiquetas[`evento_${porConfirmar}`] : ""}
        onClose={() => {
          setPorConfirmar(undefined);
        }}
        closeLabel={etiquetas.cancelar}
        footer={
          <Row gapSize="8">
            <Primary
              type="button"
              onClick={() => {
                const evento = porConfirmar;
                setPorConfirmar(undefined);
                if (evento) aplicar(evento);
              }}
            >
              {etiquetas.continuar}
            </Primary>
            <Secondary
              type="button"
              onClick={() => {
                setPorConfirmar(undefined);
              }}
            >
              {etiquetas.cancelar}
            </Secondary>
          </Row>
        }
      >
        <Text2 renderAs="p">
          {porConfirmar && ACCIONES[porConfirmar].confirma
            ? etiquetas[ACCIONES[porConfirmar].confirma]
            : ""}
        </Text2>
      </DialogModal>
    </section>
  );
};

export default AccionesDeConvocatoria;
