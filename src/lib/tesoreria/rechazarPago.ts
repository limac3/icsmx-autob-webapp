import "server-only";

// T6 — rechazar pago (R-16). `modelo-datos-dynamodb.md` seccion 6: "identica a
// T5 cambiando el estado a RECHAZADA_POR_TESORERIA, con motivoRechazo
// obligatorio y condicion estatus = EN_VERIFICACION".
//
// Pero "identica a T5" describe la forma de la escritura, no la estrategia de
// reasignacion, y ahi este archivo sigue el precedente de
// `cancelarSolicitud.ts` y no el de `adjudicarLote`/T5: **libera en una
// transaccion y reasigna despues**, llamando a `adjudicarLote` como cualquier
// solicitud nueva. La razon es la misma que alli — quien dispara esto es una
// persona mirando una pantalla, no un barrido sobre un plazo vencido que no
// puede dejar el lote sin dueno si el proceso se cae a la mitad — asi que
// replicar la abstencion por reservas, el manejo del cupo de R-09 y los
// reintentos de `adjudicarLote` dentro de una sola transaccion no compra nada.
//
// **No retira el centinela de fila.** A diferencia de la cancelacion
// voluntaria, quien pierde por rechazo de tesoreria no recupera su lugar en
// esta fila con un turno nuevo (R-07 no lo exige para este caso): el
// centinela sigue vivo para que `consultarMiLugar` pueda seguir mostrandole
// `RECHAZADA_POR_TESORERIA` con el motivo (ui-ux-requerimientos.md 3.4), igual
// que T5 deja el suyo para `CANCELADA_POR_VENCIMIENTO`.
//
// **Tambien retira las claves de GSI2** de la solicitud, por la misma razon
// que `avalarPago`: una solicitud ya resuelta no puede seguir apareciendo en
// la bandeja de tesoreria (PA-11).

import { clave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  ejecutarTransaccion,
  type ItemDeTransaccion,
} from "@/lib/data/transacciones";
import { transicion } from "@/lib/domain/transiciones";
import { itemDeLiberacionDeCupo } from "@/lib/fila/cupo";
import {
  adjudicarLote,
  type ResultadoDeAdjudicacion,
} from "@/lib/fila/adjudicarLote";
import type { ActorUsuario } from "@/types/auditoria";
import type { Solicitud } from "@/types/fila";
import type { Lote } from "@/types/lote";
import type { EstatusSolicitud } from "@/types/solicitud";
import { exito, fallo, type Resultado } from "@/types/resultado";

export type EntradaRechazarPago = {
  /** El lote ya leido por quien invoca, el mismo que evaluo el permiso. */
  lote: Lote;
  /** La solicitud, en `EN_VERIFICACION`. */
  solicitud: Solicitud;
  /** Obligatorio (R-16). La guarda de `pago:rechazar` ya lo exige antes de
   * llegar aqui; se vuelve a comprobar porque este servicio es invocable
   * directamente. */
  motivo: string;
  actor: ActorUsuario;
};

export type ResultadoDeRechazo = {
  estatus: EstatusSolicitud;
  reasignacion: ResultadoDeAdjudicacion;
};

export const rechazarPago = async (
  entrada: EntradaRechazarPago,
  deps: DepsDeServicio = {},
): Promise<Resultado<ResultadoDeRechazo>> => {
  const { ahora } = resolver(deps);
  const { lote, solicitud } = entrada;

  if (!entrada.motivo.trim()) return fallo("validation_failed");

  // El origen sale de `solicitud.estatus`: si ya no esta `EN_VERIFICACION`,
  // la transicion no existe y es un estado del negocio, no un defecto de la
  // maquina — se comprueba antes de escribir nada.
  const destino = transicion("solicitud", solicitud.estatus, "RECHAZAR_PAGO");
  if (!destino) return fallo("invalid_state");

  const items = itemsDeRechazo({
    lote,
    solicitud,
    motivo: entrada.motivo,
    ahora,
    destino,
  });
  items.push(
    eventoParaTransaccion({
      tipo: "PAGO_RECHAZADO",
      agregado: "LOTE",
      agregadoId: lote.loteId,
      actor: entrada.actor,
      ocurridoEn: ahora,
      correlacionId: nuevaCorrelacion(ahora),
      convocatoriaId: lote.convocatoriaId,
      loteId: lote.loteId,
      solicitudId: solicitud.solicitudId,
      vehiculoId: lote.vehiculoId,
      estadoAnterior: "EN_VERIFICACION",
      estadoNuevo: destino,
      motivo: entrada.motivo,
    }),
  );

  const resultado = await ejecutarTransaccion(items, deps);
  if (!resultado.ok) return fallo(resultado.error);

  // Aqui iba `descongelarSolicitudes`. Con el cupo por convocatoria nada se
  // congelo, y el decremento del item de cupo viajo dentro de la transaccion de
  // arriba: sus demas solicitudes siguen `EN_FILA` y ya tienen cupo otra vez
  // cuando `adjudicarLote` recorre los turnos.
  const reasignacion = await adjudicarLote(
    { lote: liberado(lote), motivo: "REASIGNACION_POR_RECHAZO" },
    deps,
  );

  return exito({ estatus: destino, reasignacion });
};

/**
 * Copia del lote tal como queda tras liberarlo — misma razon que en
 * `cancelarSolicitud.ts`: `attribute_not_exists(adjudicacionActual)` es toda
 * la exclusion mutua del sistema, y `adjudicarLote` evalua su condicion contra
 * esta copia en memoria.
 */
const liberado = (lote: Lote): Lote => {
  const copia: Lote = { ...lote, estatus: "EN_OFERTA" };
  delete copia.adjudicacionActual;
  delete copia.adjudicadoEn;
  delete copia.venceEn;
  delete copia.turnoAdjudicado;
  return copia;
};

const itemsDeRechazo = (entrada: {
  lote: Lote;
  solicitud: Solicitud;
  motivo: string;
  ahora: Date;
  destino: EstatusSolicitud;
}): ItemDeTransaccion[] => {
  const { lote, solicitud, motivo, ahora, destino } = entrada;
  const tabla = nombreDeTabla();
  const momento = ahora.toISOString();

  const destinoLote = transicion("lote", "ADJUDICADO", "LIBERAR");
  const destinoVehiculo = transicion("vehiculo", "RESERVADO", "LIBERAR");
  if (!destinoLote || !destinoVehiculo) {
    throw new Error("La maquina de estados ya no admite LIBERAR");
  }

  return [
    {
      item: {
        Update: {
          TableName: tabla,
          Key: clave.solicitud(lote.loteId, solicitud.turno),
          UpdateExpression:
            "SET #estatus = :destino, motivoRechazo = :motivo, rechazadaEn = :momento" +
            " REMOVE GSI2PK, GSI2SK",
          ConditionExpression: "#estatus = :enVerificacion",
          ExpressionAttributeNames: { "#estatus": "estatus" },
          ExpressionAttributeValues: {
            ":destino": destino,
            ":motivo": motivo.trim(),
            ":enVerificacion": "EN_VERIFICACION",
            ":momento": momento,
          },
        },
      },
      siFalla: "invalid_state",
      descripcion: `solicitud ${solicitud.solicitudId} sigue EN_VERIFICACION`,
    },
    itemDeLiberacionDeCupo({
      participanteId: solicitud.participanteId,
      convocatoriaId: lote.convocatoriaId,
    }),
    {
      item: {
        Update: {
          TableName: tabla,
          Key: clave.lote(lote.convocatoriaId, lote.loteId),
          UpdateExpression:
            "SET #estatus = :enOferta, actualizadoEn = :momento" +
            " REMOVE adjudicacionActual, adjudicadoEn, venceEn, turnoAdjudicado",
          ConditionExpression: "adjudicacionActual = :solicitudId",
          ExpressionAttributeNames: { "#estatus": "estatus" },
          ExpressionAttributeValues: {
            ":enOferta": destinoLote,
            ":solicitudId": solicitud.solicitudId,
            ":momento": momento,
          },
        },
      },
      siFalla: "conflicto_concurrencia",
      descripcion: "el lote sigue adjudicado a esta solicitud",
    },
    {
      item: {
        Update: {
          TableName: tabla,
          Key: clave.vehiculo(lote.vehiculoId),
          UpdateExpression:
            "SET #estatus = :enConvocatoria, actualizadoEn = :momento",
          ConditionExpression: "#estatus = :reservado",
          ExpressionAttributeNames: { "#estatus": "estatus" },
          ExpressionAttributeValues: {
            ":enConvocatoria": destinoVehiculo,
            ":reservado": "RESERVADO",
            ":momento": momento,
          },
        },
      },
      siFalla: "invalid_state",
      descripcion: "vehiculo RESERVADO vuelve a EN_CONVOCATORIA",
    },
  ];
};

export const __test__ = { liberado, itemsDeRechazo };
