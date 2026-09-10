import "server-only";

// Como se nombra en pantalla lo que la bitacora identifica con una clave.
//
// Vive aparte porque **dos consumidores tienen que nombrar igual**: las opciones
// de los dos selects y la columna «Registro» de la tabla de resultados. Si cada
// uno compusiera su etiqueta, la misma convocatoria se llamaria de dos maneras
// en la misma pantalla, y el auditor tendria que deducir que son la misma.
//
// Lo que hace legible una etiqueta son los identificadores de negocio que la
// Etapa 11.2 agrego: el `folio` y el `nombre` corto de la convocatoria, el
// `numeroEconomico` del vehiculo. Antes solo habia marca y modelo, o el tipo y
// la fecha de venta — datos que no distinguen dos registros parecidos y que
// obligaban a terminar la etiqueta en un identificador generado.
//
// Las lecturas van por lote (`lecturaPorLotes`) y en dos fases, porque hay una
// dependencia real: el lote y la solicitud son los que dicen **cual** vehiculo
// hay que nombrar.

import type { Diccionario } from "@/dictionaries";
import {
  clave,
  loteYTurnoDesdeIdentificador,
  type TipoDeAgregado,
} from "@/lib/data/claves";
import type { DepsDeServicio } from "@/lib/data/deps";
import { leerPorClaves } from "@/lib/data/lecturaPorLotes";
import { leerPerfiles } from "@/lib/participantes/leerPerfiles";
import { exito, type Resultado } from "@/types/resultado";

/**
 * Un agregado a nombrar, con lo que el evento sabia de el.
 *
 * `convocatoriaId` no es decorativo: la clave de un lote cuelga de su
 * convocatoria, asi que sin el no se puede ni leer el lote. Los cinco indices
 * de la bitacora proyectan `ALL`, asi que quien tiene el evento ya lo tiene.
 */
export type ReferenciaDeAgregado = {
  agregado: TipoDeAgregado;
  agregadoId: string;
  convocatoriaId?: string;
  loteId?: string;
};

export type Etiquetador = {
  /** Etiqueta legible de un agregado, o su identificador si no se pudo leer. */
  deAgregado: (agregado: TipoDeAgregado, agregadoId: string) => string;
  /** Nombre, correo e identificador de una persona. */
  deParticipante: (participanteId: string) => string;
  /**
   * `participanteId` -> nombre y correo, sin el identificador.
   *
   * Es lo que la columna de actor de la tabla necesita, y sale de la **misma**
   * lectura de perfiles que las opciones.
   */
  nombresDeActor: ReadonlyMap<string, string>;
};

const texto = (valor: unknown): string | undefined =>
  typeof valor === "string" && valor.length > 0 ? valor : undefined;

const entero = (valor: unknown): number | undefined =>
  typeof valor === "number" && Number.isInteger(valor) ? valor : undefined;

/** Une las partes que si existen, sin dejar separadores huerfanos. */
export const unir = (...partes: (string | undefined)[]): string =>
  partes.filter((parte) => parte && parte.length > 0).join(" · ");

/**
 * Resuelve las etiquetas de un conjunto de referencias, con dos rondas de
 * lectura por lote.
 *
 * Recibe tambien los `actorIds` porque los perfiles se leen una sola vez: los
 * de las personas que actuaron y los de los participantes de las solicitudes
 * que hay que nombrar salen del mismo `BatchGetItem`.
 */
export const construirEtiquetador = async (
  entrada: {
    referencias: readonly ReferenciaDeAgregado[];
    actorIds: readonly string[];
    diccionario: Diccionario;
  },
  deps: DepsDeServicio = {},
): Promise<Resultado<Etiquetador>> => {
  const vehiculos = new Set<string>();
  const convocatorias = new Set<string>();
  /** `loteId` -> `convocatoriaId`, que es lo que completa su clave. */
  const convocatoriaDeLote = new Map<string, string>();
  const solicitudes = new Set<string>();

  for (const referencia of entrada.referencias) {
    if (referencia.loteId && referencia.convocatoriaId) {
      convocatoriaDeLote.set(referencia.loteId, referencia.convocatoriaId);
    }
    switch (referencia.agregado) {
      case "VEHICULO":
        vehiculos.add(referencia.agregadoId);
        break;
      case "CONVOCATORIA":
        convocatorias.add(referencia.agregadoId);
        break;
      case "LOTE":
        if (referencia.convocatoriaId) {
          convocatoriaDeLote.set(
            referencia.agregadoId,
            referencia.convocatoriaId,
          );
        }
        break;
      case "SOLICITUD":
        solicitudes.add(referencia.agregadoId);
        break;
    }
  }

  // Las convocatorias a leer se conocen **antes** de leer los lotes: las que
  // hay que nombrar, mas las de los lotes que hay que nombrar. Sin eso haria
  // falta una tercera ronda solo para el nombre de la convocatoria de un lote.
  const convocatoriasAResolver = new Set([
    ...convocatorias,
    ...convocatoriaDeLote.values(),
  ]);

  const clavesDeSolicitud = [...solicitudes].flatMap((solicitudId) => {
    const partes = loteYTurnoDesdeIdentificador(solicitudId);
    return partes ? [clave.solicitud(partes.loteId, partes.turno)] : [];
  });

  const [itemsDeLote, itemsDeSolicitud, itemsDeConvocatoria] =
    await Promise.all([
      leerPorClaves(
        [...convocatoriaDeLote.entries()].map(([loteId, convocatoriaId]) =>
          clave.lote(convocatoriaId, loteId),
        ),
        deps,
      ),
      leerPorClaves(clavesDeSolicitud, deps),
      leerPorClaves(
        [...convocatoriasAResolver].map((id) => clave.convocatoria(id)),
        deps,
      ),
    ]);

  const vehiculoDeLote = new Map<string, string>();
  for (const item of itemsDeLote) {
    const loteId = texto(item.loteId);
    const vehiculoId = texto(item.vehiculoId);
    if (loteId && vehiculoId) {
      vehiculoDeLote.set(loteId, vehiculoId);
      vehiculos.add(vehiculoId);
    }
  }

  const participanteDeSolicitud = new Map<string, string>();
  const loteDeSolicitud = new Map<string, string>();
  for (const item of itemsDeSolicitud) {
    const solicitudId = texto(item.solicitudId);
    const loteId = texto(item.loteId);
    const participanteId = texto(item.participanteId);
    if (solicitudId && loteId) loteDeSolicitud.set(solicitudId, loteId);
    if (solicitudId && participanteId) {
      participanteDeSolicitud.set(solicitudId, participanteId);
    }
  }

  // Los lotes de las solicitudes tambien aportan su vehiculo, y su clave no se
  // conocia en la primera ronda: la solicitud es quien dice de que lote es.
  const lotesDeSolicitudPorLeer = [...loteDeSolicitud.values()].filter(
    (loteId) => !vehiculoDeLote.has(loteId) && convocatoriaDeLote.has(loteId),
  );

  const [itemsDeLoteDeSolicitud, perfiles] = await Promise.all([
    leerPorClaves(
      lotesDeSolicitudPorLeer.flatMap((loteId) => {
        const convocatoriaId = convocatoriaDeLote.get(loteId);
        return convocatoriaId ? [clave.lote(convocatoriaId, loteId)] : [];
      }),
      deps,
    ),
    leerPerfiles(
      [...entrada.actorIds, ...participanteDeSolicitud.values()],
      deps,
    ),
  ]);
  if (!perfiles.ok) return perfiles;

  for (const item of itemsDeLoteDeSolicitud) {
    const loteId = texto(item.loteId);
    const vehiculoId = texto(item.vehiculoId);
    if (loteId && vehiculoId) {
      vehiculoDeLote.set(loteId, vehiculoId);
      vehiculos.add(vehiculoId);
    }
  }

  const itemsDeVehiculo = await leerPorClaves(
    [...vehiculos].map((id) => clave.vehiculo(id)),
    deps,
  );

  const vehiculoLegiblePorId = new Map<string, string>();
  for (const item of itemsDeVehiculo) {
    const vehiculoId = texto(item.vehiculoId);
    if (!vehiculoId) continue;
    vehiculoLegiblePorId.set(
      vehiculoId,
      unir(
        texto(item.marca),
        texto(item.version),
        entero(item.modelo) === undefined ? undefined : String(item.modelo),
        texto(item.numeroEconomico),
      ),
    );
  }

  const convocatoriaLegiblePorId = new Map<string, string>();
  for (const item of itemsDeConvocatoria) {
    const convocatoriaId = texto(item.convocatoriaId);
    if (!convocatoriaId) continue;
    convocatoriaLegiblePorId.set(
      convocatoriaId,
      unir(texto(item.nombre), texto(item.folio)),
    );
  }

  /**
   * Nombre, o correo si no hay nombre, o el identificador crudo si no hay
   * perfil. Lo ultimo es normal y no es un fallo: el perfil se escribe al
   * iniciar sesion, y la bitacora tiene eventos anteriores a que eso
   * existiera. Mostrar el identificador es mostrar el dato que hay.
   */
  const deParticipante = (participanteId: string): string => {
    const perfil = perfiles.data.get(participanteId);
    if (!perfil) return participanteId;
    // Con el identificador al final: es lo que la bitacora guardo y lo que hay
    // que poder citar; el nombre solo lo hace reconocible.
    return unir(perfil.nombre, perfil.correo, participanteId);
  };

  const deAgregado = (agregado: TipoDeAgregado, agregadoId: string): string => {
    switch (agregado) {
      case "VEHICULO":
        return unir(vehiculoLegiblePorId.get(agregadoId), agregadoId);
      case "CONVOCATORIA":
        return unir(convocatoriaLegiblePorId.get(agregadoId), agregadoId);
      case "LOTE": {
        const convocatoriaId = convocatoriaDeLote.get(agregadoId);
        const vehiculoId = vehiculoDeLote.get(agregadoId);
        return unir(
          vehiculoId ? vehiculoLegiblePorId.get(vehiculoId) : undefined,
          convocatoriaId
            ? convocatoriaLegiblePorId.get(convocatoriaId)
            : undefined,
          agregadoId,
        );
      }
      case "SOLICITUD": {
        const loteId = loteDeSolicitud.get(agregadoId);
        const vehiculoId = loteId ? vehiculoDeLote.get(loteId) : undefined;
        const participanteId = participanteDeSolicitud.get(agregadoId);
        const turno = loteYTurnoDesdeIdentificador(agregadoId)?.turno;
        return unir(
          vehiculoId ? vehiculoLegiblePorId.get(vehiculoId) : undefined,
          turno === undefined
            ? undefined
            : `${entrada.diccionario.auditoria.columnaTurno} ${turno}`,
          participanteId ? deParticipante(participanteId) : undefined,
        );
      }
    }
  };

  const nombresDeActor = new Map<string, string>();
  for (const actorId of entrada.actorIds) {
    const perfil = perfiles.data.get(actorId);
    const nombre = perfil ? unir(perfil.nombre, perfil.correo) : "";
    if (nombre.length > 0) nombresDeActor.set(actorId, nombre);
  }

  return exito({ deAgregado, deParticipante, nombresDeActor });
};
