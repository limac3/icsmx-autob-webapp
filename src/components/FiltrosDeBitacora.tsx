"use client";

import { Primary } from "@churchofjesuschrist/eden-buttons";
import {
  DateInput,
  FormField,
  Select,
} from "@churchofjesuschrist/eden-form-parts";
import { Text4 } from "@churchofjesuschrist/eden-text";
import "./FiltrosDeBitacora.css";

/**
 * Filtros de la bitacora — `ui-ux-requerimientos.md` seccion 7.
 *
 * **Componente cliente, y es la primera excepcion de esta pantalla.** El resto
 * de `/auditoria` sigue siendo un `<form method="get">` sin JavaScript: el
 * filtro queda en la URL, se comparte y se navega hacia atras. Eso no cambia
 * aqui — sigue siendo el mismo formulario GET— y lo unico que agrega el cliente
 * es reenviarlo solo cuando cambia algo que **altera las opciones de los otros
 * campos**: el tipo de registro y las dos fechas deciden que identificadores y
 * que participantes existen para elegir.
 *
 * Sin esto haria falta un clic intermedio ("actualizar opciones") antes de
 * poder elegir un identificador, que es justo la friccion que la pantalla viene
 * a quitar. Y si el JavaScript no carga, el formulario sigue funcionando con el
 * boton: nada de lo que decide la busqueda depende del cliente.
 *
 * **`Select` y `DateInput` de Eden, con `<option>` nativos.** Los controles
 * crudos no sirven aqui, y no por estilo: `FormField` asocia su `<label>` por
 * `htmlFor` contra un identificador que reparte por contexto, y solo los
 * componentes de Eden lo consumen. Un `<select>` nativo dentro de un
 * `FormField` queda **sin nombre accesible** — la etiqueta apunta a un
 * elemento que no existe—, y eso es lo que detecta la prueba de axe de este
 * archivo. El `<option>` si es nativo, que es la receta ya probada de
 * `/admin/vehiculos` (`desafios-implementacion.md` 23: lo que no sobrevive la
 * frontera de RSC es el `Option` de Eden, no el `Select`).
 */
export type OpcionDeFiltro = { valor: string; etiqueta: string };

export type FiltrosDeBitacoraProps = {
  valores: {
    agregado: string;
    agregadoId: string;
    tipo: string;
    participanteId: string;
    desde: string;
    hasta: string;
  };
  tiposDeAgregado: readonly OpcionDeFiltro[];
  tiposDeEvento: readonly OpcionDeFiltro[];
  identificadores: readonly OpcionDeFiltro[];
  participantes: readonly OpcionDeFiltro[];
  etiquetas: {
    campoDesde: string;
    campoHasta: string;
    campoAgregado: string;
    campoAgregadoId: string;
    campoTipo: string;
    campoParticipante: string;
    todosLosTipos: string;
    sinOpciones: string;
    eligeTipoDeRegistro: string;
    eligeIdentificador: string;
    buscar: string;
  };
  /** Ya traducidos por la pagina (regla 11). */
  avisos?: readonly string[];
};

const FiltrosDeBitacora = ({
  valores,
  tiposDeAgregado,
  tiposDeEvento,
  identificadores,
  participantes,
  etiquetas,
  avisos = [],
}: FiltrosDeBitacoraProps) => {
  /**
   * El formulario se toma del evento y no de una `ref`: asi no hay que
   * suponer que Eden monte un control concreto en un lugar concreto, y
   * `elements.namedItem` encuentra el campo por el mismo `name` con el que
   * viaja en la URL.
   */
  const reenviar = (evento: {
    currentTarget: { form: HTMLFormElement | null };
  }) => {
    evento.currentTarget.form?.requestSubmit();
  };

  /**
   * Al cambiar de tipo de registro, el identificador elegido deja de tener
   * sentido: pertenece a otro catalogo. Se limpia **antes** de reenviar para
   * que la busqueda no salga con un par tipo/identificador imposible, que
   * devolveria una tabla vacia sin explicar por que.
   */
  const cambiarAgregado = (evento: {
    currentTarget: { form: HTMLFormElement | null };
  }) => {
    const formulario = evento.currentTarget.form;
    const identificador = formulario?.elements.namedItem("agregadoId");
    if (identificador instanceof HTMLSelectElement) identificador.value = "";
    formulario?.requestSubmit();
  };

  return (
    <form method="get" className="filtros-bitacora">
      {/* Las fechas van primero: en la busqueda global **son la llave** de la
          consulta, no un filtro que se afina al final. */}
      <FormField label={etiquetas.campoDesde}>
        <DateInput
          name="desde"
          required
          defaultValue={valores.desde}
          onChange={reenviar}
        />
      </FormField>
      <FormField label={etiquetas.campoHasta}>
        <DateInput
          name="hasta"
          required
          defaultValue={valores.hasta}
          onChange={reenviar}
        />
      </FormField>

      <FormField label={etiquetas.campoAgregado}>
        <Select
          name="agregado"
          defaultValue={valores.agregado}
          onChange={cambiarAgregado}
        >
          <option value="" />
          {tiposDeAgregado.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.etiqueta}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label={etiquetas.campoAgregadoId}>
        <Select
          name="agregadoId"
          defaultValue={valores.agregadoId}
          disabled={valores.agregado === "" || identificadores.length === 0}
        >
          {/* La opcion vacia siempre lleva texto. Sin el, con el tipo ya
              elegido el select se dibujaba **en blanco** y no se distinguia de
              uno roto o vacio. */}
          <option value="">
            {valores.agregado === ""
              ? etiquetas.eligeTipoDeRegistro
              : identificadores.length === 0
                ? etiquetas.sinOpciones
                : etiquetas.eligeIdentificador}
          </option>
          {identificadores.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.etiqueta}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label={etiquetas.campoTipo}>
        <Select name="tipo" defaultValue={valores.tipo}>
          <option value="">{etiquetas.todosLosTipos}</option>
          {tiposDeEvento.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.etiqueta}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label={etiquetas.campoParticipante}>
        <Select
          name="participanteId"
          defaultValue={valores.participanteId}
          disabled={participantes.length === 0}
        >
          <option value="">
            {participantes.length === 0
              ? etiquetas.sinOpciones
              : etiquetas.todosLosTipos}
          </option>
          {participantes.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.etiqueta}
            </option>
          ))}
        </Select>
      </FormField>

      {/* El bloque de acciones ocupa su propio renglon: intercalado entre los
          campos, el boton quedaba en medio del formulario. */}
      <div className="filtros-bitacora__acciones">
        <Primary type="submit">{etiquetas.buscar}</Primary>
        {/* Sin texto de ayuda permanente: decia lo mismo que el aviso de
            `sin_criterio`, que aparece exactamente cuando falta un criterio
            —incluida la primera carga—, asi que se veia dos veces; y cuando la
            busqueda ya era valida seguia ahi, pidiendo algo ya hecho. */}
        {avisos.map((aviso) => (
          <Text4 renderAs="p" key={aviso} role="alert">
            {aviso}
          </Text4>
        ))}
      </div>
    </form>
  );
};

export default FiltrosDeBitacora;
