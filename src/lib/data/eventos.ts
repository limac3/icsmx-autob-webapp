import "server-only";

// Construccion de los eventos de la bitacora — regla 4 y 5 de CLAUDE.md.
//
// Existe por la misma razon que `claves.ts`: que la forma de un evento sea una
// propiedad del sistema y no una convencion que hay que recordar en cada
// servicio. Un evento al que se le olvida el `correlacionId`, o que no escribe
// las claves de GSI2, no falla — simplemente deja un hueco en la bitacora que
// nadie nota hasta que un auditor pregunta.
//
// Y como los eventos son **append-only**, un evento mal formado no se puede
// corregir: se queda asi para siempre.

import { clave, gsi2, type TipoDeAgregado } from "./claves";
import { nuevoUlid } from "./identificadores";
import { putDeEvento, type ItemDeTransaccion } from "./transacciones";
import { aIso, diaDeNegocio } from "@/lib/domain/fechas";
import {
  ACTOR_SISTEMA,
  exigeMotivo,
  type ActorDeEvento,
  type TipoDeActor,
  type TipoDeEvento,
} from "@/types/auditoria";

export type EntradaDeEvento = {
  tipo: TipoDeEvento;
  /** Agregado al que se ancla la historia. Ver `trazabilidad-auditoria.md` 2.1. */
  agregado: TipoDeAgregado;
  agregadoId: string;
  actor: ActorDeEvento;
  ocurridoEn: Date;
  /**
   * Compartido por todos los eventos de una misma transaccion. Sin el, el
   * auditor veria hechos sueltos y tendria que inferir la causalidad por
   * cercania temporal.
   */
  correlacionId: string;

  vehiculoId?: string;
  convocatoriaId?: string;
  loteId?: string;
  solicitudId?: string;

  estadoAnterior?: string;
  estadoNuevo?: string;
  /** Obligatorio en los eventos marcados con **M** en el catalogo. */
  motivo?: string;
  /** Campos especificos del tipo de evento. */
  datos?: Record<string, unknown>;
};

/** Un identificador nuevo para agrupar los eventos de una misma transaccion. */
export const nuevaCorrelacion = (ahora: Date = new Date()): string =>
  nuevoUlid(ahora);

/**
 * Atributos del item de evento, sin las claves.
 *
 * Se expone aparte del `Put` para que las pruebas puedan afirmar sobre el
 * contenido sin desarmar un comando del SDK.
 */
export const atributosDeEvento = (
  entrada: EntradaDeEvento,
): Record<string, unknown> => {
  if (exigeMotivo(entrada.tipo) && !entrada.motivo?.trim()) {
    // Se lanza y no se devuelve un error de dominio: que falte el motivo de un
    // rechazo es un defecto del codigo que lo escribe, no un estado del negocio
    // que la interfaz pueda explicar. Y dejarlo pasar produciria una bitacora
    // que no puede responder "por que", que es su unica razon de existir.
    throw new Error(`El evento ${entrada.tipo} exige motivo y no lo trae`);
  }

  const ocurridoEn = aIso(entrada.ocurridoEn);
  const eventoId = nuevoUlid(entrada.ocurridoEn);
  const actorTipo: TipoDeActor = entrada.actor.tipo;

  return {
    eventoId,
    tipo: entrada.tipo,
    ocurridoEn,
    actorTipo,
    actorId:
      entrada.actor.tipo === "USUARIO" ? entrada.actor.id : ACTOR_SISTEMA,
    actorPermisos:
      entrada.actor.tipo === "USUARIO"
        ? [...entrada.actor.permisos]
        : undefined,
    correlacionId: entrada.correlacionId,

    vehiculoId: entrada.vehiculoId,
    convocatoriaId: entrada.convocatoriaId,
    loteId: entrada.loteId,
    solicitudId: entrada.solicitudId,

    estadoAnterior: entrada.estadoAnterior,
    estadoNuevo: entrada.estadoNuevo,
    motivo: entrada.motivo?.trim(),
    datos: entrada.datos,

    // GSI2 en su modo bitacora: PA-13, "todo lo que paso el dia X" en orden
    // cronologico. El dia se calcula en **hora de negocio** porque quien lee
    // esa clave es una persona que piensa en dias de Mexico.
    ...gsi2.bitacoraDelDia(
      diaDeNegocio(entrada.ocurridoEn),
      ocurridoEn,
      eventoId,
    ),
  };
};

/**
 * `Put` del evento listo para viajar en la misma `TransactWriteItems` que la
 * mutacion (regla 4), con la condicion append-only ya puesta (regla 5).
 *
 * No existe una variante suelta a proposito: un evento que se escribe fuera de
 * la transaccion de su mutacion puede sobrevivir a una mutacion que no ocurrio,
 * o faltar en una que si.
 */
export const eventoParaTransaccion = (
  entrada: EntradaDeEvento,
): ItemDeTransaccion => {
  const atributos = atributosDeEvento(entrada);
  return putDeEvento(
    clave.evento(
      entrada.agregado,
      entrada.agregadoId,
      String(atributos.ocurridoEn),
      String(atributos.eventoId),
    ),
    atributos,
  );
};
