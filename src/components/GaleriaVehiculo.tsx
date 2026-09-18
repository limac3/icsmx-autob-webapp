"use client";

import { useEffect, useState, useTransition } from "react";
import { Badge } from "@churchofjesuschrist/eden-badge";
import { Error as AlertaError, Warn } from "@churchofjesuschrist/eden-alert";
import {
  Danger,
  Ghost,
  Secondary,
  Primary,
} from "@churchofjesuschrist/eden-buttons";
import { DialogModal } from "@churchofjesuschrist/eden-dialog-modal";
import {
  FileInput,
  FormField,
  Select,
  TextArea,
} from "@churchofjesuschrist/eden-form-parts";
import { H2 } from "@churchofjesuschrist/eden-headings";
import { Row } from "@churchofjesuschrist/eden-row";
import { Stack } from "@churchofjesuschrist/eden-stack";
import { Text2, Text4 } from "@churchofjesuschrist/eden-text";
import { ToolModal } from "@churchofjesuschrist/eden-tool-modal";
import {
  agregarFotografia,
  editarDescripcionFotografia,
  eliminarFotografia,
  reordenarFotografias,
} from "@/app/actions/vehiculos";
import type { Diccionario } from "@/dictionaries";
import {
  ACEPTA_IMAGENES,
  esTipoDeImagen,
  LIMITES,
} from "@/lib/domain/vehiculos";
import type { FuentesDeImagen } from "@/types/media";
import type { CodigoError, Resultado } from "@/types/resultado";
import "./GaleriaVehiculo.css";

/**
 * Galeria de un vehiculo — pantalla 4.2 de `ui-ux-requerimientos.md`.
 *
 * Las URLs llegan **ya firmadas desde el servidor** y no se guardan en ningun
 * lado: son credenciales con vencimiento corto (regla 13). Este componente solo
 * las pinta.
 *
 * **La rejilla no tiene controles; solo fotografias.** Todas del mismo tamano,
 * la principal con su distintivo encima de la imagen, la descripcion completa
 * debajo y un boton de editar. Todo lo demas —cambiar el pie, mover de
 * posicion, eliminar— vive en el modal de edicion.
 *
 * La version anterior repartia cinco controles bajo cada fotografia (subir,
 * bajar, marcar principal, editar, eliminar) mas un campo con el pie recortado.
 * Con veinte fotografias eso es un tablero de cien botones donde lo que se
 * viene a hacer —mirar las fotos y leer que dicen— queda enterrado.
 *
 * **La posicion 1 es la principal.** No hay "marcar como principal": designar
 * es mover al frente, y lo hace el mismo campo de orden. El servidor mantiene el
 * invariante en la transaccion del reordenamiento, asi que la interfaz no puede
 * dejar el puntero apuntando a otra parte.
 */

export type FotografiaEnGaleria = {
  fotoId: string;
  orden: number;
  descripcion?: string;
  /** Fuentes ya firmadas. Nunca se persisten (regla 13). */
  fuentes: FuentesDeImagen;
  esPrincipal: boolean;
};

/**
 * Cuanto mide la celda de esta rejilla.
 *
 * `repeat(auto-fill, minmax(14rem, 1fr))` con 1rem de hueco dentro de
 * `.envoltura__contenido`: la columna vive entre 224 px y unos 464 px. Se
 * declaran 28rem (448) y no el maximo, para que una pantalla de densidad 1 se
 * quede en la variante de 480 en vez de saltar a la de 1280.
 */
const TAMANOS_DE_CELDA = "(min-width: 600px) 28rem, calc(100vw - 32px)";

/**
 * Tope de la descripcion, traido del dominio para que no pueda divergir.
 *
 * Se aplica en **tres** lugares y los tres hacen falta: `maxLength` frena el
 * teclado, la comprobacion antes de enviar evita perder lo escrito, y el
 * servidor es la unica frontera que cuenta.
 *
 * **`maxLength` va en `TextArea` y no en `Input`.** El tipo de `Input` de Eden
 * declara `maxLength?: string` y se intersecta con el `number` de React, asi que
 * la propiedad queda inusable; `TextArea` lo declara `number` y funciona
 * (`desafios-implementacion.md` 19).
 */
const LIMITE_DESCRIPCION = LIMITES.descripcionFotografia;

/**
 * El archivo que eligio el `FileInput`, leido de donde de verdad viaja.
 *
 * **El `onChange` de `FileInput` no reenvia el evento nativo, y su tipo no lo
 * dice.** La prop se declara `(event: React.ChangeEvent<HTMLInputElement>) =>
 * void`, pero el componente llama `onChange({ target: { value, name } })` con
 * el `File` en `value` —o un arreglo de `File`, si fuera `multiple`—. En un
 * `<input>` nativo `target.value` es la ruta como cadena y los archivos viven
 * en `target.files`, asi que el tipo declarado describe algo distinto de lo que
 * llega: leer `target.files` devuelve `undefined` y la vista previa nunca
 * aparece, sin ningun error.
 *
 * De ahi la comprobacion en ejecucion en vez de un cast: `instanceof File` es
 * lo unico que de verdad sabe que llego (`desafios-implementacion.md` 86).
 *
 * Con `multiple` llega un arreglo y **se acumula**: elegir otra vez no
 * reemplaza, agrega. Comprobado ejecutandolo, igual que todo lo demas de este
 * componente.
 */
const archivosElegidos = (valor: unknown): File[] => {
  if (valor instanceof File) return [valor];
  if (Array.isArray(valor)) return valor.filter((uno) => uno instanceof File);
  return [];
};

/**
 * Inserta un bloque de identificadores nuevos en una lista, en `indice`.
 *
 * Es lo que traduce "la primera va en la posicion 3" al orden completo que
 * espera `reordenarFotografias`: el bloque entra entero y en su orden, y las que
 * estaban se corren detras. Se hace de un tiro y no con varios `moverEnLista`
 * porque mover una por una desplaza el destino de las siguientes, y esa cuenta
 * es justo donde se cometeria el error de un puesto.
 */
export const insertarBloque = <T,>(
  existentes: readonly T[],
  nuevos: readonly T[],
  indice: number,
): T[] => {
  const donde = Math.max(0, Math.min(indice, existentes.length));
  return [...existentes.slice(0, donde), ...nuevos, ...existentes.slice(donde)];
};

/** Suma de bytes de lo elegido. El tope es agregado, no por archivo. */
const bytesDe = (archivos: readonly File[]): number =>
  archivos.reduce((suma, archivo) => suma + archivo.size, 0);

/**
 * Mueve un elemento de `desde` a `hasta`, recorriendo a los demas.
 *
 * Es lo que traduce "ponla en la posicion 3" al orden completo que espera
 * `reordenarFotografias`, y lo usan los dos modales: el de agregar la coloca
 * desde el final, el de editar desde donde estaba. Con la cuenta escrita dos
 * veces, que ambos dieran el mismo resultado seria una coincidencia.
 *
 * Los indices fuera de rango devuelven la lista intacta en vez de lanzar:
 * quedarse quieto es la respuesta correcta a una posicion imposible.
 */
export const moverEnLista = <T,>(
  lista: readonly T[],
  desde: number,
  hasta: number,
): T[] => {
  const copia = [...lista];
  const enRango = (indice: number) => indice >= 0 && indice < copia.length;
  if (desde === hasta || !enRango(desde) || !enRango(hasta)) return copia;

  const [movido] = copia.splice(desde, 1);
  if (movido === undefined) return [...lista];
  copia.splice(hasta, 0, movido);
  return copia;
};

export type GaleriaVehiculoProps = {
  vehiculoId: string;
  fotografias: readonly FotografiaEnGaleria[];
  diccionario: Diccionario;
  /** Con `false` la galeria se ve pero no se toca. */
  puedeEditar: boolean;
  /** Para formatear los megabytes de la tanda con el separador que toca. */
  idioma: string;
};

/** Una fotografia elegida y todavia no subida. */
type Elegida = {
  archivo: File;
  /** URL local, revocada en cuanto deja de usarse. */
  url: string;
};

/** En que modal estamos, si en alguno. */
type Modal =
  | { tipo: "ninguno" }
  | { tipo: "agregar" }
  | { tipo: "editar"; fotoId: string }
  | { tipo: "confirmarBorrado"; fotoId: string };

const GaleriaVehiculo = ({
  vehiculoId,
  fotografias,
  diccionario,
  puedeEditar,
  idioma,
}: GaleriaVehiculoProps) => {
  const [enProceso, iniciar] = useTransition();
  const [error, setError] = useState<CodigoError | undefined>(undefined);
  /**
   * El motivo por campo que devolvio el servidor, si lo hubo.
   *
   * **Se guardaba solo el codigo general y eso costo una tarde de diagnostico.**
   * Con `validation_failed` a secas, la pantalla decia "Revisa los datos
   * capturados" sobre un modal donde no hay nada evidente que revisar, y ni
   * quien lo usa ni quien lo depura podia saber cual de las siete validaciones
   * habia fallado — que resulto ser `no_es_permutacion`, imposible de adivinar.
   * El codigo crudo nunca se pinta (regla 11): se traduce por diccionario.
   */
  const [detalles, setDetalles] = useState<Record<string, string> | undefined>(
    undefined,
  );
  const [modal, setModal] = useState<Modal>({ tipo: "ninguno" });
  // Borradores de los dos modales. Se comparten porque nunca hay dos abiertos.
  const [descripcion, setDescripcion] = useState("");
  const [posicion, setPosicion] = useState("1");
  const [elegidas, setElegidas] = useState<readonly Elegida[]>([]);
  // Cuantas de la tanda ya se subieron, para poder decir "3 / 7". Siete
  // fotografias no es una espera instantanea.
  const [subidas, setSubidas] = useState(0);
  const etiquetas = diccionario.vehiculos.fotografias;

  // **`createObjectURL` reserva memoria hasta que se revoca**, y el documento
  // vive mientras dure la pantalla: sin esto, elegir diez archivos seguidos deja
  // diez copias retenidas. La limpieza va atada al valor y no a un manejador,
  // asi que cubre los caminos por igual —elegir otras, guardar, y cerrar el
  // modal sin guardar—.
  useEffect(() => {
    if (elegidas.length === 0) return;
    return () => {
      for (const una of elegidas) URL.revokeObjectURL(una.url);
    };
  }, [elegidas]);

  const cerrar = () => {
    setModal({ tipo: "ninguno" });
    setElegidas([]);
    setSubidas(0);
  };

  /**
   * Corre una secuencia de mutaciones y se detiene en la primera que falle.
   *
   * Guardar el modal de edicion puede ser **dos** mutaciones —el pie y el
   * orden— y cada una tiene su propio servicio ya probado y su propio evento de
   * bitacora. Se ejecutan en serie y al primer fallo se abandona: seguir con la
   * segunda despues de que la primera fallara dejaria el estado a medias sin
   * que nadie lo sepa.
   */
  /** Recoge el rechazo completo, motivo por campo incluido. */
  const anotarFallo = (resultado: Resultado<unknown>) => {
    if (resultado.ok) return;
    setError(resultado.error);
    setDetalles(resultado.detalles);
  };

  const ejecutar = (
    pasos: readonly (() => Promise<Resultado<unknown>>)[],
    alLograr?: () => void,
  ) => {
    setError(undefined);
    setDetalles(undefined);
    iniciar(async () => {
      for (const paso of pasos) {
        const resultado = await paso();
        if (!resultado.ok) {
          anotarFallo(resultado);
          return;
        }
      }
      alLograr?.();
    });
  };

  const elegirArchivos = (evento: { target: { value?: unknown } }) => {
    // `FileInput` entrega la seleccion **completa y acumulada**, no la ultima
    // tanda, asi que se reemplaza el estado en vez de concatenarlo: concatenar
    // duplicaria todo lo anterior en cada eleccion.
    setElegidas(
      archivosElegidos(evento.target.value).map((archivo) => ({
        archivo,
        url: URL.createObjectURL(archivo),
      })),
    );
  };

  const abrirAgregar = () => {
    setModal({ tipo: "agregar" });
    setDescripcion("");
    setElegidas([]);
    setSubidas(0);
    // Por omision, al final: es donde caia antes de que el campo existiera, y
    // es lo que casi siempre se quiere al sumar fotografias.
    setPosicion(String(fotografias.length + 1));
  };

  const abrirEditar = (foto: FotografiaEnGaleria) => {
    setModal({ tipo: "editar", fotoId: foto.fotoId });
    setDescripcion(foto.descripcion ?? "");
    const indice = fotografias.findIndex((una) => una.fotoId === foto.fotoId);
    setPosicion(String(indice + 1));
  };

  /** Cuanto mide lo escrito **como lo va a medir el servidor**: recortado. */
  const largoEfectivo = descripcion.trim().length;
  const excedeElTope = largoEfectivo > LIMITE_DESCRIPCION;

  // **El tope de 10 MB se aplica a la suma de la tanda, no a cada archivo.** En
  // el servidor sigue siendo por archivo, que es la frontera real; aqui es
  // agregado porque cada fotografia viaja en su propia peticion y sin un tope
  // de conjunto nada impediria arrastrar cuarenta imagenes de 9 MB.
  const bytesElegidos = bytesDe(elegidas.map((una) => una.archivo));
  const excedeElVolumen = bytesElegidos > LIMITES.bytesDeFotografia;
  const excedeElCupo =
    fotografias.length + elegidas.length > LIMITES.fotografiasPorVehiculo;

  /**
   * Los archivos elegidos que el servidor rechazaria por su tipo.
   *
   * **El `accept` no alcanza, y por eso esta comprobacion existe.** Solo filtra
   * el dialogo del explorador: se salta eligiendo "Todos los archivos", y
   * **arrastrando no filtra nada**, que es justo la comodidad que agregamos.
   * `FileInput` sabe marcar lo que no cumple el `accept`, pero solo cuando corre
   * su maquinaria de validacion, y aqui los botones viven en el pie del modal
   * con `onClick`: nunca se dispara.
   *
   * Sin esto, un `.avif` en la sexta posicion de la tanda dejaba subidas las
   * cinco primeras, detenia el bucle y no aplicaba la posicion — con un
   * "Revisa los datos capturados" que no decia cual archivo era. Paso de
   * verdad (`desafios-implementacion.md` 89).
   */
  const noAdmitidas = elegidas.filter(
    (una) => !esTipoDeImagen(una.archivo.type),
  );
  const hayTipoNoAdmitido = noAdmitidas.length > 0;

  const megas = (bytes: number) =>
    new Intl.NumberFormat(idioma, {
      maximumFractionDigits: 1,
    }).format(bytes / 1024 / 1024);

  const noSePuedeGuardar =
    elegidas.length === 0 ||
    excedeElTope ||
    excedeElVolumen ||
    excedeElCupo ||
    hayTipoNoAdmitido;

  const guardarNuevas = () => {
    // Se comprueba otra vez aqui: un boton deshabilitado no es una validacion.
    if (noSePuedeGuardar) return;
    const destino = Number(posicion) - 1;
    const lote = elegidas.map((una) => una.archivo);
    const elPie = descripcion;
    const existentes = fotografias.map((foto) => foto.fotoId);

    setError(undefined);
    setDetalles(undefined);
    setSubidas(0);
    iniciar(async () => {
      // **Una peticion por fotografia, en serie.** No es una limitacion: es lo
      // que hace que el tope de tamano del cuerpo se aplique por archivo —para
      // lo que se dimensiono—, que cada alta tenga su transaccion y su evento
      // de bitacora (regla 4), y que un fallo a la mitad deje las anteriores
      // subidas y visibles en vez de perderlo todo.
      const nuevos: string[] = [];
      for (const archivo of lote) {
        // La descripcion, si la hay, se guarda **igual en todas**: es lo que
        // pidio el operador y lo unico coherente cuando una sola caja de texto
        // describe una tanda. Despues se corrige una por una.
        const alta = await agregarFotografia({
          vehiculoId,
          archivo,
          descripcion: elPie,
        });
        if (!alta.ok) {
          anotarFallo(alta);
          return;
        }
        nuevos.push(alta.data.fotoId);
        setSubidas(nuevos.length);
      }

      // `agregarFotografia` coloca siempre al final, asi que la posicion
      // elegida se aplica al final con **un solo** reordenamiento: el bloque
      // entero entra donde se pidio y las demas se corren detras. Es tambien lo
      // que designa la principal si el bloque queda primero.
      if (destino >= existentes.length) {
        cerrar();
        return;
      }
      const reorden = await reordenarFotografias(
        vehiculoId,
        insertarBloque(existentes, nuevos, destino),
      );
      if (!reorden.ok) {
        anotarFallo(reorden);
        return;
      }
      cerrar();
    });
  };

  const guardarEdicion = (fotoId: string) => () => {
    if (excedeElTope) return;
    const foto = fotografias.find((una) => una.fotoId === fotoId);
    if (!foto) return;

    const indiceActual = fotografias.findIndex((una) => una.fotoId === fotoId);
    const destino = Number(posicion) - 1;
    const elPie = descripcion;

    const pasos: (() => Promise<Resultado<unknown>>)[] = [];

    // Solo lo que cambio. Los dos servicios ya devuelven exito sin escribir
    // cuando no hay diferencia, asi que esto no es correccion sino ahorro de
    // dos viajes en el caso mas comun: abrir, mirar y cerrar con "Guardar".
    if (elPie.trim() !== (foto.descripcion ?? "").trim()) {
      pasos.push(() => editarDescripcionFotografia(vehiculoId, fotoId, elPie));
    }
    if (destino !== indiceActual) {
      const ids = fotografias.map((una) => una.fotoId);
      pasos.push(() =>
        reordenarFotografias(
          vehiculoId,
          moverEnLista(ids, indiceActual, destino),
        ),
      );
    }

    if (pasos.length === 0) {
      cerrar();
      return;
    }
    ejecutar(pasos, cerrar);
  };

  const eliminar = (fotoId: string) => {
    ejecutar([() => eliminarFotografia(vehiculoId, fotoId)], cerrar);
  };

  /**
   * Las posiciones que se pueden elegir, con la 1 marcada como principal.
   *
   * Un `Select` y no un campo numerico: la cota deja de ser una validacion que
   * alguien tiene que escribir —y probar— y pasa a ser imposible de violar por
   * construccion, y es donde cabe decir que la 1 es la principal sin un texto
   * de ayuda aparte.
   */
  const opcionesDePosicion = (total: number) =>
    Array.from({ length: total }, (_, indice) => {
      const numero = indice + 1;
      return {
        valor: String(numero),
        etiqueta:
          numero === 1
            ? `${String(numero)} — ${etiquetas.sufijoPrincipal}`
            : String(numero),
      };
    });

  /**
   * `true` cuando la tanda es de mas de una: cambia lo que **significan** los
   * dos campos de abajo, asi que su ayuda tiene que decirlo.
   */
  const sonVarias = modal.tipo === "agregar" && elegidas.length > 1;

  /** El campo de posicion, compartido por los dos modales. */
  const campoDePosicion = (total: number) => (
    <FormField
      label={etiquetas.orden}
      description={
        sonVarias
          ? `${etiquetas.ordenAyuda} ${etiquetas.posicionDelBloque}`
          : etiquetas.ordenAyuda
      }
    >
      <Select
        name="posicion"
        value={posicion}
        onChange={(cambio) => {
          setPosicion(cambio.target.value);
        }}
      >
        {opcionesDePosicion(total).map((opcion) => (
          <option key={opcion.valor} value={opcion.valor}>
            {opcion.etiqueta}
          </option>
        ))}
      </Select>
    </FormField>
  );

  /** El campo de descripcion con su contador, compartido por los dos modales. */
  const campoDeDescripcion = (
    <>
      <FormField
        label={etiquetas.descripcion}
        description={
          sonVarias
            ? `${etiquetas.limiteDescripcion} ${etiquetas.descripcionParaTodas}`
            : etiquetas.limiteDescripcion
        }
      >
        <TextArea
          name="descripcion"
          maxLength={LIMITE_DESCRIPCION}
          value={descripcion}
          onChange={(cambio) => {
            setDescripcion(cambio.target.value);
          }}
        />
      </FormField>

      {/* Contador sin `aria-live`: cambia en cada tecla y anunciarlo
          convertiria escribir en un zumbido. Quien no lo ve tiene el tope
          dicho en la ayuda del campo y el freno del `maxLength`. */}
      <Text4 renderAs="p" className="galeria-vehiculo__contador">
        {`${String(largoEfectivo)} / ${String(LIMITE_DESCRIPCION)}`}
      </Text4>

      {excedeElTope ? (
        <Warn>
          <Text2 renderAs="p">{etiquetas.descripcionExcedida}</Text2>
        </Warn>
      ) : null}
    </>
  );

  const enEdicion =
    modal.tipo === "editar"
      ? fotografias.find((foto) => foto.fotoId === modal.fotoId)
      : undefined;

  return (
    <section className="galeria-vehiculo" aria-busy={enProceso}>
      {/* El encabezado vive aqui y no en la pagina para que el boton de agregar
          pueda ir a su lado: es la accion de esta seccion, no de la pantalla. */}
      <div className="galeria-vehiculo__encabezado">
        <H2>{diccionario.vehiculos.seccionFotografias}</H2>
        {puedeEditar ? (
          <Secondary type="button" disabled={enProceso} onClick={abrirAgregar}>
            {etiquetas.agregar}
          </Secondary>
        ) : null}
      </div>

      {error ? (
        <AlertaError>
          <Text2 renderAs="p">{diccionario.errores[error]}</Text2>
          {/* El motivo por campo, traducido por diccionario y nunca el codigo
              crudo (regla 11). Sin esto, "Revisa los datos capturados" no dice
              que revisar — y sobre un modal de fotografias no hay nada
              evidente. */}
          {detalles
            ? Object.entries(detalles).map(([campo, motivo]) => (
                <Text2 key={campo} renderAs="p">
                  {diccionario.validacionVehiculo[
                    motivo as keyof typeof diccionario.validacionVehiculo
                  ] ?? motivo}
                </Text2>
              ))
            : null}
        </AlertaError>
      ) : null}

      {fotografias.length === 0 ? (
        <Text2 renderAs="p">{etiquetas.vacia}</Text2>
      ) : (
        <ul className="galeria-vehiculo__lista">
          {fotografias.map((foto, indice) => (
            <li key={foto.fotoId} className="galeria-vehiculo__item">
              {/* El distintivo va **encima** de la imagen y no debajo: asi se
                  lee sobre la fotografia que califica, y no se confunde con el
                  pie de la de al lado en una rejilla apretada. */}
              <div className="galeria-vehiculo__marco">
                {/* `next/image` no se usa aqui: optimizar exigiria que el
                    optimizador alcance una URL firmada que caduca, y desde que
                    las variantes se generan al subir no tendria nada que
                    aportar — la fotografia ya llega por CloudFront en el ancho
                    que toca. */}
                <img
                  className="galeria-vehiculo__imagen"
                  src={foto.fuentes.src}
                  {...(foto.fuentes.srcSet
                    ? { srcSet: foto.fuentes.srcSet, sizes: TAMANOS_DE_CELDA }
                    : {})}
                  width={foto.fuentes.ancho}
                  height={foto.fuentes.alto}
                  alt={foto.descripcion ?? ""}
                  loading="lazy"
                />
                {foto.esPrincipal ? (
                  <Badge color="success" className="galeria-vehiculo__insignia">
                    {etiquetas.principal}
                  </Badge>
                ) : null}
              </div>

              {/* La descripcion **completa**, que se ajusta en varias lineas. La
                  version anterior la metia en un campo de una linea y quedaba
                  recortada justo en lo que se venia a leer. */}
              <Text2
                renderAs="p"
                className={
                  foto.descripcion
                    ? "galeria-vehiculo__pie"
                    : "galeria-vehiculo__pie galeria-vehiculo__pie--vacio"
                }
              >
                {foto.descripcion ?? etiquetas.sinDescripcion}
              </Text2>

              {puedeEditar ? (
                <Ghost
                  type="button"
                  disabled={enProceso}
                  aria-label={`${etiquetas.editar}: ${String(indice + 1)}`}
                  onClick={() => {
                    abrirEditar(foto);
                  }}
                >
                  {etiquetas.editar}
                </Ghost>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* Los modales se montan **solo cuando estan abiertos**. Un `<dialog>`
          cerrado conserva sus hijos en el DOM —lo que los oculta es
          `dialog:not([open]) { display: none }`, que es estilo—, asi que
          dejarlos puestos mantendria sus campos y su boton de borrar en el
          arbol de la pantalla (`desafios-implementacion.md` 87). */}
      {modal.tipo === "agregar" ? (
        <ToolModal
          open
          header={etiquetas.tituloAgregar}
          onClose={cerrar}
          closeLabel={etiquetas.cancelar}
          footer={
            <Row gapSize="8">
              <Primary
                type="button"
                disabled={enProceso || noSePuedeGuardar}
                onClick={guardarNuevas}
              >
                {enProceso
                  ? `${etiquetas.subiendo} ${String(subidas)} / ${String(elegidas.length)}`
                  : etiquetas.guardar}
              </Primary>
              <Ghost type="button" onClick={cerrar}>
                {etiquetas.cancelar}
              </Ghost>
            </Row>
          }
        >
          <Stack gapSize="16">
            <FormField
              label={etiquetas.subirArchivos}
              description={etiquetas.formatosAdmitidos}
            >
              {/* `isDroppable` habilita arrastrar y soltar en el propio control
                  de Eden —no hace falta zona de caida propia— y `multiple`
                  permite varias de un tiro. Entrega la seleccion **acumulada**
                  en cada aviso, no la ultima tanda. */}
              <FileInput
                name="archivos"
                // Derivado de la lista blanca del dominio: escrito a mano,
                // agregar un formato en un lado y olvidarlo en el otro deja el
                // selector filtrando lo que el servidor si acepta.
                accept={ACEPTA_IMAGENES}
                required
                multiple
                isDroppable
                dragFilesLabel={etiquetas.arrastrarArchivos}
                removeFileLabel={etiquetas.quitarArchivo}
                onChange={elegirArchivos}
              />
            </FormField>

            {/* **Se pintan todas las elegidas, con su nombre.** No es adorno: el
                `FileInput` de Eden **deduplica por nombre de archivo**, asi que
                dos fotos distintas que se llamen `IMG_0001.jpg` —lo normal en
                una camara— dejarian caer la segunda en silencio. Viendolas, la
                que falta se nota antes de guardar. */}
            {elegidas.length > 0 ? (
              <>
                <ul className="galeria-vehiculo__elegidas">
                  {elegidas.map((una) => {
                    const admitida = esTipoDeImagen(una.archivo.type);
                    return (
                      <li
                        key={`${una.archivo.name}-${String(una.archivo.size)}`}
                        className={
                          admitida
                            ? "galeria-vehiculo__elegida"
                            : "galeria-vehiculo__elegida galeria-vehiculo__elegida--rechazada"
                        }
                        // El nombre se recorta en pantalla; completo aqui, para
                        // poder distinguir dos que se llamen parecido.
                        title={una.archivo.name}
                      >
                        <img
                          className="galeria-vehiculo__imagen"
                          src={una.url}
                          alt={`${etiquetas.previsualizacion}: ${una.archivo.name}`}
                        />
                        <Text4 renderAs="span">{una.archivo.name}</Text4>
                        {/* El motivo va **en la miniatura** y no solo en el
                            aviso de arriba: con siete archivos, saber que uno
                            sobra no dice cual. */}
                        {admitida ? null : (
                          <Text4
                            renderAs="span"
                            className="galeria-vehiculo__rechazo"
                          >
                            {diccionario.validacionVehiculo.tipo_no_admitido}
                          </Text4>
                        )}
                      </li>
                    );
                  })}
                </ul>

                <Text4 renderAs="p" className="galeria-vehiculo__contador">
                  {`${megas(bytesElegidos)} / ${megas(LIMITES.bytesDeFotografia)} MB`}
                </Text4>

                <Text4 renderAs="p">{etiquetas.previsualizacionAyuda}</Text4>
              </>
            ) : null}

            {/* El volumen **cancela la tanda entera** y no se recorta sola: cual
                dejar fuera es una decision de quien sube, no del programa. */}
            {excedeElVolumen ? (
              <Warn>
                <Text2 renderAs="p">{etiquetas.volumenExcedido}</Text2>
              </Warn>
            ) : null}

            {excedeElCupo ? (
              <Warn>
                <Text2 renderAs="p">{etiquetas.cupoExcedido}</Text2>
              </Warn>
            ) : null}

            {/* Antes de empezar, no a la mitad: el operador quita el archivo y
                sube la tanda completa de un tiro. */}
            {hayTipoNoAdmitido ? (
              <Warn>
                <Text2 renderAs="p">{etiquetas.tipoNoAdmitido}</Text2>
              </Warn>
            ) : null}

            {campoDeDescripcion}

            {/* Con la galeria vacia no hay nada que elegir: la primera es la 1
                y por tanto la principal. Un campo con una sola opcion es una
                pregunta sin respuestas.
                El tope es `length + 1` y **no depende de cuantas se suban**: es
                donde arranca el bloque, desde antes de la primera existente
                hasta despues de la ultima. */}
            {fotografias.length > 0
              ? campoDePosicion(fotografias.length + 1)
              : null}
          </Stack>
        </ToolModal>
      ) : null}

      {modal.tipo === "editar" && enEdicion ? (
        <ToolModal
          open
          header={etiquetas.tituloEditar}
          onClose={cerrar}
          closeLabel={etiquetas.cancelar}
          footer={
            <Row gapSize="8">
              <Primary
                type="button"
                disabled={enProceso || excedeElTope}
                onClick={guardarEdicion(enEdicion.fotoId)}
              >
                {etiquetas.guardar}
              </Primary>
              <Danger
                type="button"
                // La ultima no se puede eliminar; el boton lo dice antes de
                // intentarlo, y el servidor lo vuelve a comprobar.
                disabled={enProceso || fotografias.length === 1}
                title={
                  fotografias.length === 1
                    ? etiquetas.noSePuedeEliminarUltima
                    : undefined
                }
                onClick={() => {
                  setModal({
                    tipo: "confirmarBorrado",
                    fotoId: enEdicion.fotoId,
                  });
                }}
              >
                {etiquetas.eliminar}
              </Danger>
              <Ghost type="button" onClick={cerrar}>
                {etiquetas.cancelar}
              </Ghost>
            </Row>
          }
        >
          <Stack gapSize="16">
            {/* La fotografia se muestra y **no se puede cambiar**: los bytes son
                inmutables, asi que aqui no hay `FileInput`. Para cambiar la
                imagen se elimina y se sube otra. */}
            <img
              className="galeria-vehiculo__imagen galeria-vehiculo__imagen--modal"
              src={enEdicion.fuentes.src}
              {...(enEdicion.fuentes.srcSet
                ? { srcSet: enEdicion.fuentes.srcSet, sizes: "100vw" }
                : {})}
              width={enEdicion.fuentes.ancho}
              height={enEdicion.fuentes.alto}
              alt={enEdicion.descripcion ?? ""}
            />

            {campoDeDescripcion}
            {fotografias.length > 1
              ? campoDePosicion(fotografias.length)
              : null}
          </Stack>
        </ToolModal>
      ) : null}

      {/* La confirmacion es un modal **aparte** y sustituye al de edicion en vez
          de anidarse dentro: dos `<dialog>` abiertos a la vez dejan la pila del
          top layer a merced del orden de cierre. */}
      {modal.tipo === "confirmarBorrado" ? (
        <DialogModal
          open
          header={etiquetas.confirmarEliminarTitulo}
          onClose={cerrar}
          closeLabel={etiquetas.cancelar}
          footer={
            <Row gapSize="8">
              <Danger
                type="button"
                disabled={enProceso}
                onClick={() => {
                  eliminar(modal.fotoId);
                }}
              >
                {etiquetas.eliminarDefinitivo}
              </Danger>
              <Secondary type="button" onClick={cerrar}>
                {etiquetas.cancelar}
              </Secondary>
            </Row>
          }
        >
          <Text2 renderAs="p">{etiquetas.confirmarEliminarAviso}</Text2>
        </DialogModal>
      ) : null}
    </section>
  );
};

export default GaleriaVehiculo;
