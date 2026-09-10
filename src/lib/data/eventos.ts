import "server-only";

// Construccion de los eventos de la bitacora — regla 4 y 5 de CLAUDE.md.
//
// Existe por la misma razon que `claves.ts`: que la forma de un evento sea una
// propiedad del sistema y no una convencion que hay que recordar en cada
// servicio. Un evento al que se le olvida el `correlacionId`, o que no escribe
// las claves de sus indices, no falla — simplemente deja un hueco en la bitacora que
// nadie nota hasta que un auditor pregunta.
//
// Y como los eventos son **append-only**, un evento mal formado no se puede
// corregir: se queda asi para siempre.

import { bitacora, clave, type TipoDeAgregado } from "./claves";
import { nuevoId } from "./identificadores";
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
  nuevoId(ahora);

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
  const eventoId = nuevoId(entrada.ocurridoEn);
  const actorTipo: TipoDeActor = entrada.actor.tipo;
  const actorId =
    entrada.actor.tipo === "USUARIO" ? entrada.actor.id : ACTOR_SISTEMA;

  // El dia se calcula en hora de negocio y el mes se recorta de el, no se
  // calcula aparte: recortarlo garantiza que los dos hablen del mismo
  // calendario. Calcular el mes por su cuenta abriria la posibilidad de que un
  // evento del 31 de diciembre a las 20:00 de Mexico cayera en el dia de
  // diciembre y en el mes de enero.
  const dia = diaDeNegocio(entrada.ocurridoEn);
  const mes = dia.slice(0, 7);

  return {
    eventoId,
    tipo: entrada.tipo,
    ocurridoEn,
    actorTipo,
    actorId,
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

    // Las siete claves de los cinco indices de la bitacora (GSI5 a GSI9).
    //
    // **Se escriben todas desde el primer evento**, y la razon es que aqui lo
    // irreversible son los atributos y no los indices: a un evento append-only
    // no se le pueden anadir despues —`UpdateItem` lo deniega IAM y un `Put` de
    // reemplazo lo rechaza `attribute_not_exists(PK)`—, asi que un atributo que
    // hoy no se escribe es una pregunta que nunca se podra responder sobre los
    // eventos de hoy. Un indice, en cambio, si se puede crear mas tarde y su
    // relleno vera los atributos que ya estan.
    ...bitacora.cronologico(mes, ocurridoEn, eventoId),
    ...bitacora.porTipoDeEvento(entrada.tipo, mes),
    ...bitacora.porAgregadoDelDia(
      dia,
      entrada.agregado,
      entrada.agregadoId,
      ocurridoEn,
      eventoId,
    ),
    ...bitacora.porActorDelDia(dia, actorId, ocurridoEn, eventoId),
    ...bitacora.porActor(actorId, mes),
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
