// Patron outbox (D-6, riesgo R8): el correo se encola en la **misma**
// transaccion que adjudica, y el envio real ocurre despues, aparte, en el
// procesador del barrido (`procesarOutbox.ts`). `arquitectura-tecnica-aws.md`
// seccion 4.5:
//
//   T2 / T5 encolan mensaje en OUTBOX (misma transaccion, evento CORREO_ENCOLADO)
//   Barrido -> Query GSI4 OUTBOX_PENDIENTE -> CES -> ...
//
// **Por que en la misma transaccion y no despues.** Un `Put` suelto tras el
// `TransactWriteItems` de T2/T5 dejaria una ventana: si el proceso muere entre
// las dos escrituras, la adjudicacion existe y el aviso nunca se encola, y solo
// el barrido de vencimientos —no el de correo, que nunca corre sobre algo que
// no esta en el outbox— lo notaria. Metiendolo en la transaccion, el correo
// queda tan garantizado como el propio evento `LOTE_ADJUDICADO` (regla 4).
//
// **Por que no bloquea si no hay `correoTitular`.** T1 lo copia de la sesion
// (Etapa 9), pero es opcional: un dato viejo o una sesion sin correo no debe
// impedir la adjudicacion. Sin destinatario no hay nada que encolar, y
// `itemsDeEncoladoAdjudicacion` devuelve una lista vacia en vez de fallar.

import { clave, gsi4 } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  CONDICION_APPEND_ONLY,
  type ItemDeTransaccion,
} from "@/lib/data/transacciones";
import type { ActorDeEvento } from "@/types/auditoria";
import type { DatosCorreoAdjudicacion } from "@/types/correo";

export type EntradaDeEncolado = {
  mensajeId: string;
  destinatario: string | undefined;
  datos: DatosCorreoAdjudicacion;
  actor: ActorDeEvento;
  ahora: Date;
  /** Comparte `correlacionId` con los demas eventos de la transaccion de T2/T5. */
  correlacionId?: string;
};

/**
 * Los dos items que encolan el correo de adjudicacion: el mensaje y su evento.
 *
 * Lista vacia si no hay `destinatario` — nada que encolar, y no es un error:
 * la adjudicacion no depende del correo (D-6).
 */
export const itemsDeEncoladoAdjudicacion = (
  entrada: EntradaDeEncolado,
): ItemDeTransaccion[] => {
  if (!entrada.destinatario) return [];

  const { mensajeId, destinatario, datos, ahora } = entrada;
  const creadoEn = ahora.toISOString();
  const correlacionId = entrada.correlacionId ?? nuevaCorrelacion(ahora);

  return [
    {
      item: {
        Put: {
          TableName: nombreDeTabla(),
          Item: {
            ...clave.mensaje(mensajeId),
            mensajeId,
            tipo: "ADJUDICACION",
            destinatario,
            creadoEn,
            estatus: "PENDIENTE",
            intentos: 0,
            datos,
            // GSI4 disperso, igual que VENCE#<dia>: solo mientras el mensaje
            // espera envio. Se retira al marcarlo ENVIADO o FALLIDO.
            ...gsi4.outboxPendiente(creadoEn),
          },
          ConditionExpression: CONDICION_APPEND_ONLY,
        },
      },
      siFalla: "conflicto_concurrencia",
      descripcion: `mensaje de correo ${mensajeId}`,
    },
    eventoParaTransaccion({
      tipo: "CORREO_ENCOLADO",
      agregado: "LOTE",
      agregadoId: datos.loteId,
      actor: entrada.actor,
      ocurridoEn: ahora,
      correlacionId,
      convocatoriaId: datos.convocatoriaId,
      loteId: datos.loteId,
      solicitudId: datos.solicitudId,
      vehiculoId: datos.vehiculoId,
      datos: { mensajeId, destinatario },
    }),
  ];
};
