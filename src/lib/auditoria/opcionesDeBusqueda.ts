import "server-only";

// Las opciones de los dos selects de la pantalla de auditoria.
//
// El problema que resuelve: los identificadores del sistema son ULIDs, y pedirle
// a un auditor que teclee `01K4Z...` para consultar una bitacora es pedirle que
// no la consulte. Peor aun con las solicitudes, cuyo identificador es derivado
// (`<loteId>-<turno>`) y no aparece en ninguna pantalla.
//
// De donde salen: de la **bitacora del rango**, no del catalogo de entidades.
// La diferencia importa. Ofrecer todas las convocatorias que existen incluiria
// las que no tienen un solo evento en el rango, y elegir una devolveria una
// tabla vacia; ofrecer las que aparecen en la bitacora garantiza que cada opcion
// tiene algo que mostrar. Y como la lectura es por particion de agregado
// (PA-12), la opcion tiene que ser un agregado con historia propia: por eso se
// toma de la clave del evento y no de sus atributos.
//
// Las etiquetas legibles si salen de las entidades, con una lectura por lote
// (`lecturaPorLotes`) de vehiculos, convocatorias, lotes, solicitudes y
// perfiles.

import type { Diccionario } from "@/dictionaries";
import {
  clave,
  loteYTurnoDesdeIdentificador,
  type TipoDeAgregado,
} from "@/lib/data/claves";
import type { DepsDeServicio } from "@/lib/data/deps";
import { leerPorClaves } from "@/lib/data/lecturaPorLotes";
import { desdeIso, formatearFecha } from "@/lib/domain/fechas";
import { leerPerfiles } from "@/lib/participantes/leerPerfiles";
import { ACTOR_SISTEMA, type EventoDTO } from "@/types/auditoria";
import { exito, type Resultado } from "@/types/resultado";

export type OpcionDeBusqueda = {
  valor: string;
  /** Ya legible y traducida: la pantalla no compone texto (regla 11). */
  etiqueta: string;
};

export type OpcionesDeBusqueda = {
  identificadores: readonly OpcionDeBusqueda[];
  participantes: readonly OpcionDeBusqueda[];
  /**
   * `participanteId` -> nombre o correo. Ausente significa que esa persona no
   * tiene perfil, que es lo normal para los eventos escritos antes de que el
   * perfil existiera.
   *
   * Se devuelve junto con las opciones porque sale de la **misma** lectura de
   * perfiles: la columna de actor de la tabla necesita exactamente lo que el
   * select de participantes ya resolvio.
   */
  nombresDeActor: ReadonlyMap<string, string>;
};

/**
 * Tope de opciones por select.
 *
 * Un `<select>` con miles de opciones no se puede usar ni con raton ni con
 * teclado, asi que mas alla de esto la lista deja de ser una ayuda. Se ordenan
 * por actividad mas reciente primero, de modo que el corte se lleva lo mas
 * viejo del rango — que es lo que menos se busca.
 */
export const MAXIMO_DE_OPCIONES = 200;

const texto = (valor: unknown): string | undefined =>
  typeof valor === "string" && valor.length > 0 ? valor : undefined;

const entero = (valor: unknown): number | undefined =>
  typeof valor === "number" && Number.isInteger(valor) ? valor : undefined;

const fechaCorta = (iso: string | undefined): string | undefined => {
  const instante = iso ? desdeIso(iso) : undefined;
  return instante ? formatearFecha(instante) : undefined;
};

/** Une las partes que si existen, sin dejar separadores huerfanos. */
const unir = (...partes: (string | undefined)[]): string =>
  partes.filter((parte) => parte && parte.length > 0).join(" · ");

/**
 * Referencias a resolver, agrupadas por lo que hay que leer.
 *
 * Se recorre la lista de eventos una sola vez y se acumula todo lo que habra
 * que consultar: los agregados que seran opcion, los actores que seran opcion,
 * y las entidades que hacen falta para etiquetarlos. Un evento de lote, por
 * ejemplo, aporta su `loteId` como opcion y su `convocatoriaId` como dato
 * necesario para poder leer ese lote — cuya clave cuelga de la convocatoria.
 */
type Referencias = {
  /** `agregadoId` -> ultimo `ocurridoEn` visto, para ordenar por actividad. */
  actividad: Map<string, string>;
  actores: Map<string, string>;
  vehiculos: Set<string>;
  convocatorias: Set<string>;
  /** `loteId` -> `convocatoriaId`, que es lo que completa su clave. */
  lotesPorConvocatoria: Map<string, string>;
  /** `solicitudId` -> `loteId`, para armar la clave de la solicitud. */
  solicitudes: Set<string>;
};

/**
 * Recorre **dos** listas de eventos, y esa separacion es la correccion de un
 * defecto real.
 *
 * `paraParticipantes` es la lectura del rango sin acotar, porque el select de
 * personas no depende del tipo de registro elegido. `paraIdentificadores` es la
 * lectura **ya filtrada a ese tipo**: si se derivaran las dos de la misma
 * lectura, un solo tipo con mucho volumen consumiria el cupo y los demas
 * apareceran como "sin actividad" siendo falso — medido en el sandbox, 3 288
 * eventos de lote en un dia contra 9 de vehiculo que quedaban fuera del corte.
 */
const recolectar = (
  paraParticipantes: readonly EventoDTO[],
  paraIdentificadores: readonly EventoDTO[],
  agregado: TipoDeAgregado | undefined,
): Referencias => {
  const referencias: Referencias = {
    actividad: new Map(),
    actores: new Map(),
    vehiculos: new Set(),
    convocatorias: new Set(),
    lotesPorConvocatoria: new Map(),
    solicitudes: new Set(),
  };

  // Las claves de lote y de solicitud necesitan un segundo componente, asi que
  // se recogen de **todo** evento que los traiga, de las dos listas: un evento
  // anclado a la solicitud es el que sabe su `loteId`.
  const anotarReferencias = (evento: EventoDTO) => {
    if (evento.loteId && evento.convocatoriaId) {
      referencias.lotesPorConvocatoria.set(
        evento.loteId,
        evento.convocatoriaId,
      );
    }
  };

  for (const evento of paraParticipantes) {
    if (evento.actorTipo === "USUARIO" && evento.actorId !== ACTOR_SISTEMA) {
      referencias.actores.set(evento.actorId, evento.ocurridoEn);
    }
    anotarReferencias(evento);
  }

  if (agregado === undefined) return referencias;

  for (const evento of paraIdentificadores) {
    anotarReferencias(evento);

    if (evento.agregado !== agregado || !evento.agregadoId) continue;

    referencias.actividad.set(evento.agregadoId, evento.ocurridoEn);

    if (agregado === "VEHICULO") referencias.vehiculos.add(evento.agregadoId);
    if (agregado === "CONVOCATORIA") {
      referencias.convocatorias.add(evento.agregadoId);
    }
    if (agregado === "LOTE" && evento.convocatoriaId) {
      referencias.lotesPorConvocatoria.set(
        evento.agregadoId,
        evento.convocatoriaId,
      );
    }
    if (agregado === "SOLICITUD")
      referencias.solicitudes.add(evento.agregadoId);
  }

  return referencias;
};

/** Mas reciente primero, y recortado al tope. */
const ordenadas = (
  actividad: Map<string, string>,
  etiquetar: (id: string) => string,
): OpcionDeBusqueda[] =>
  [...actividad.entries()]
    .sort(([, a], [, b]) => b.localeCompare(a))
    .slice(0, MAXIMO_DE_OPCIONES)
    .map(([valor]) => ({ valor, etiqueta: etiquetar(valor) }));

/**
 * Opciones de los dos selects para un rango ya leido.
 *
 * Recibe los eventos en vez de leerlos: la pantalla ya hizo esas lecturas y no
 * tiene por que pagarlas dos veces.
 */
export const construirOpciones = async (
  entrada: {
    /** Lectura del rango sin acotar. Alimenta el select de participantes. */
    eventos: readonly EventoDTO[];
    /**
     * Lectura del rango **acotada al tipo de registro**. Alimenta el select de
     * identificadores. Si no se pasa, se usa `eventos` — que solo es correcto
     * cuando esa lectura no trunco.
     */
    eventosDelAgregado?: readonly EventoDTO[];
    agregado?: TipoDeAgregado;
    diccionario: Diccionario;
  },
  deps: DepsDeServicio = {},
): Promise<Resultado<OpcionesDeBusqueda>> => {
  const { diccionario } = entrada;
  const referencias = recolectar(
    entrada.eventos,
    entrada.eventosDelAgregado ?? entrada.eventos,
    entrada.agregado,
  );

  // Las solicitudes aportan el lote que hay que leer para nombrar su vehiculo.
  const clavesDeSolicitud = [...referencias.solicitudes].flatMap(
    (solicitudId) => {
      const partes = loteYTurnoDesdeIdentificador(solicitudId);
      return partes ? [clave.solicitud(partes.loteId, partes.turno)] : [];
    },
  );

  const clavesDeLote = [...referencias.lotesPorConvocatoria.entries()].map(
    ([loteId, convocatoriaId]) => clave.lote(convocatoriaId, loteId),
  );

  const [itemsDeLote, itemsDeSolicitud, itemsDeConvocatoria] =
    await Promise.all([
      leerPorClaves(clavesDeLote, deps),
      leerPorClaves(clavesDeSolicitud, deps),
      leerPorClaves(
        [...referencias.convocatorias].map((id) => clave.convocatoria(id)),
        deps,
      ),
    ]);

  // Los vehiculos se leen despues: los lotes y las solicitudes son los que
  // dicen **cual** vehiculo hay que nombrar.
  const vehiculosAResolver = new Set(referencias.vehiculos);
  const vehiculoDeLote = new Map<string, string>();
  for (const item of itemsDeLote) {
    const loteId = texto(item.loteId);
    const vehiculoId = texto(item.vehiculoId);
    if (loteId && vehiculoId) {
      vehiculoDeLote.set(loteId, vehiculoId);
      vehiculosAResolver.add(vehiculoId);
    }
  }

  const participantePorSolicitud = new Map<string, string>();
  const loteDeSolicitud = new Map<string, string>();
  for (const item of itemsDeSolicitud) {
    const solicitudId = texto(item.solicitudId);
    const loteId = texto(item.loteId);
    const participanteId = texto(item.participanteId);
    if (solicitudId && loteId) loteDeSolicitud.set(solicitudId, loteId);
    if (solicitudId && participanteId) {
      participantePorSolicitud.set(solicitudId, participanteId);
    }
  }

  const [itemsDeVehiculo, perfiles] = await Promise.all([
    leerPorClaves(
      [...vehiculosAResolver].map((id) => clave.vehiculo(id)),
      deps,
    ),
    leerPerfiles(
      [...referencias.actores.keys(), ...participantePorSolicitud.values()],
      deps,
    ),
  ]);
  if (!perfiles.ok) return perfiles;

  const nombreDeVehiculo = new Map<string, string>();
  for (const item of itemsDeVehiculo) {
    const vehiculoId = texto(item.vehiculoId);
    if (!vehiculoId) continue;
    nombreDeVehiculo.set(
      vehiculoId,
      unir(
        texto(item.marca),
        texto(item.version),
        entero(item.modelo) === undefined ? undefined : String(item.modelo),
      ),
    );
  }

  const fechaDeConvocatoria = new Map<string, string>();
  const tipoDeConvocatoria = new Map<string, string>();
  for (const item of itemsDeConvocatoria) {
    const convocatoriaId = texto(item.convocatoriaId);
    if (!convocatoriaId) continue;
    const fecha = fechaCorta(texto(item.inicioVenta));
    if (fecha) fechaDeConvocatoria.set(convocatoriaId, fecha);
    const tipo = texto(item.tipo);
    if (tipo && tipo in diccionario.tiposConvocatoria) {
      tipoDeConvocatoria.set(
        convocatoriaId,
        diccionario.tiposConvocatoria[
          tipo as keyof Diccionario["tiposConvocatoria"]
        ],
      );
    }
  }

  /**
   * Nombre, o correo si no hay nombre, o el identificador crudo si no hay
   * perfil. Lo ultimo es normal y no es un fallo: el perfil se escribe al
   * iniciar sesion, y la bitacora tiene eventos anteriores a que eso
   * existiera. Mostrar el identificador es mostrar el dato que hay.
   */
  const etiquetaDeParticipante = (participanteId: string): string => {
    const perfil = perfiles.data.get(participanteId);
    if (!perfil) return participanteId;
    // Con el identificador al final: es lo que la bitacora guardo y lo que hay
    // que poder citar; el nombre solo lo hace reconocible.
    return unir(perfil.nombre, perfil.correo, participanteId);
  };

  const etiquetaDeIdentificador = (agregadoId: string): string => {
    switch (entrada.agregado) {
      case "VEHICULO":
        return unir(nombreDeVehiculo.get(agregadoId), agregadoId);
      case "CONVOCATORIA":
        return unir(
          tipoDeConvocatoria.get(agregadoId),
          fechaDeConvocatoria.get(agregadoId),
          agregadoId,
        );
      case "LOTE": {
        const vehiculoId = vehiculoDeLote.get(agregadoId);
        const convocatoriaId = referencias.lotesPorConvocatoria.get(agregadoId);
        return unir(
          vehiculoId ? nombreDeVehiculo.get(vehiculoId) : undefined,
          convocatoriaId ? fechaDeConvocatoria.get(convocatoriaId) : undefined,
          agregadoId,
        );
      }
      case "SOLICITUD": {
        const loteId = loteDeSolicitud.get(agregadoId);
        const vehiculoId = loteId ? vehiculoDeLote.get(loteId) : undefined;
        const participanteId = participantePorSolicitud.get(agregadoId);
        const turno = loteYTurnoDesdeIdentificador(agregadoId)?.turno;
        return unir(
          vehiculoId ? nombreDeVehiculo.get(vehiculoId) : undefined,
          turno === undefined
            ? undefined
            : `${diccionario.auditoria.columnaTurno} ${turno}`,
          participanteId ? etiquetaDeParticipante(participanteId) : undefined,
        );
      }
      default:
        return agregadoId;
    }
  };

  const nombresDeActor = new Map<string, string>();
  for (const participanteId of referencias.actores.keys()) {
    const perfil = perfiles.data.get(participanteId);
    const nombre = perfil ? unir(perfil.nombre, perfil.correo) : "";
    if (nombre.length > 0) nombresDeActor.set(participanteId, nombre);
  }

  return exito({
    identificadores: ordenadas(referencias.actividad, etiquetaDeIdentificador),
    participantes: ordenadas(referencias.actores, etiquetaDeParticipante),
    nombresDeActor,
  });
};
