import "server-only";

// Las opciones de los dos selects de la pantalla de auditoria.
//
// El problema que resuelve: los identificadores del sistema son generados, y
// pedirle a un auditor que teclee uno para consultar una bitacora es pedirle que
// no la consulte. Peor aun con las solicitudes, cuyo identificador es derivado
// (`<loteId>-<turno>`) y no aparece en ninguna pantalla.
//
// De donde salen: de la **bitacora del rango**, no del catalogo de entidades.
// Ofrecer todas las convocatorias que existen incluiria las que no tienen un
// solo evento en el rango, y elegir una devolveria una tabla vacia; ofrecer las
// que aparecen en la bitacora garantiza que cada opcion tiene algo que mostrar.
//
// **Ya no se derivan de una lectura del rango entero.** `valoresConActividad`
// las obtiene con un sondeo por valor distinto sobre GSI7 y GSI8, asi que esta
// pantalla dejo de depender de cuantos eventos haya: antes, un tipo de registro
// con mucho volumen consumia el cupo de la lectura compartida y los demas
// aparecian como "sin actividad en este rango" siendo falso.
//
// Las etiquetas las arma `etiquetasDeBitacora`, compartido con la columna
// «Registro» de la tabla de resultados: dos consumidores que nombraran por su
// cuenta harian que la misma convocatoria se llamara de dos maneras en la misma
// pantalla.

import type { Diccionario } from "@/dictionaries";
import type { TipoDeAgregado } from "@/lib/data/claves";
import type { DepsDeServicio } from "@/lib/data/deps";
import { exito, type Resultado } from "@/types/resultado";
import { construirEtiquetador } from "./etiquetasDeBitacora";
import {
  identificadoresConActividad,
  participantesConActividad,
} from "./valoresConActividad";

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
 * Opciones de los dos selects para un rango.
 *
 * Hace sus propias lecturas y no recibe eventos: son consultas distintas de las
 * de la tabla de resultados —un sondeo por valor distinto contra una lectura
 * cronologica— y compartir una lectura entre las dos fue justamente el origen
 * del defecto que reporto el usuario.
 */
export const construirOpciones = async (
  entrada: {
    desde: string;
    hasta: string;
    /** Sin el, el select de identificadores no tiene de que tipo hablar. */
    agregado?: TipoDeAgregado;
    diccionario: Diccionario;
  },
  deps: DepsDeServicio = {},
): Promise<Resultado<OpcionesDeBusqueda>> => {
  const rango = { desde: entrada.desde, hasta: entrada.hasta };
  const agregado = entrada.agregado;

  const [lecturaDeIdentificadores, lecturaDeParticipantes] = await Promise.all([
    agregado
      ? identificadoresConActividad({ ...rango, agregado }, deps)
      : undefined,
    participantesConActividad(rango, deps),
  ]);

  if (lecturaDeIdentificadores && !lecturaDeIdentificadores.ok) {
    return lecturaDeIdentificadores;
  }
  if (!lecturaDeParticipantes.ok) return lecturaDeParticipantes;

  const identificadores = lecturaDeIdentificadores?.data ?? [];
  const participantes = lecturaDeParticipantes.data;

  const etiquetador = await construirEtiquetador(
    {
      referencias:
        agregado === undefined
          ? []
          : identificadores.map(({ valor, evento }) => ({
              agregado,
              agregadoId: valor,
              ...(evento.convocatoriaId
                ? { convocatoriaId: evento.convocatoriaId }
                : {}),
              ...(evento.loteId ? { loteId: evento.loteId } : {}),
            })),
      actorIds: participantes.map(({ valor }) => valor),
      diccionario: entrada.diccionario,
    },
    deps,
  );
  if (!etiquetador.ok) return etiquetador;

  return exito({
    identificadores:
      agregado === undefined
        ? []
        : identificadores.map(({ valor }) => ({
            valor,
            etiqueta: etiquetador.data.deAgregado(agregado, valor),
          })),
    participantes: participantes.map(({ valor }) => ({
      valor,
      etiqueta: etiquetador.data.deParticipante(valor),
    })),
    nombresDeActor: etiquetador.data.nombresDeActor,
  });
};
