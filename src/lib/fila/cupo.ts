// El item de cupo de participacion — R-09 y R-22
// (`modelo-datos-dynamodb.md` seccion 4.3).
//
// Un item por participante y convocatoria, `PART#<id> / CUPO#<convId>`, con dos
// contadores que **se comportan al reves a proposito**:
//
//   solicitudesCreadas   monotonico, solo crece. Su valor nuevo es el
//                        `ordenEnConvocatoria` de esa solicitud (R-22)
//   cupoConsumido        sube al adjudicar, baja al perder la adjudicacion,
//                        **no baja al vender** (R-09)
//
// Miden cosas distintas —cuantas veces intento, y cuantos vehiculos tiene en
// firme— y de ahi la asimetria: **el cupo de adjudicaciones se recupera, el de
// solicitudes no.**
//
// Este modulo solo arma items de transaccion. El `ADD solicitudesCreadas`, que
// necesita `ReturnValues` y por tanto no puede vivir en una transaccion, esta
// en `solicitarCompra.ts` junto al contador de turnos, que tiene el mismo
// problema y la misma forma.

import { clave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import type { ItemDeTransaccion } from "@/lib/data/transacciones";

/**
 * Consume una unidad de cupo, **fallando si ya no queda** (R-09).
 *
 * La condicion se evalua contra el valor **previo** al `ADD`, en el mismo item
 * y la misma operacion atomica: no hay ventana entre comprobar y sumar, que es
 * justo lo que exige la regla 6. Con un cupo de K, N intentos simultaneos
 * producen exactamente K exitos.
 *
 * `attribute_not_exists(cupoConsumido)` cubre la primera adjudicacion del
 * participante en esa convocatoria: el item puede existir ya —lo crea el
 * ordinal de R-22 en cada solicitud— pero sin este contador.
 *
 * **El limite no es opcional**, y por eso este helper no tiene una rama para su
 * ausencia. La unica lectura sensata de un limite ausente seria "sin tope", que
 * es la direccion mas permisiva; `aLote` prefiere rechazar el lote. Ver
 * `Lote.limiteAdjudicaciones`.
 */
export const itemDeConsumoDeCupo = (entrada: {
  participanteId: string;
  convocatoriaId: string;
  limite: number;
}): ItemDeTransaccion => {
  const { participanteId, convocatoriaId, limite } = entrada;

  return {
    item: {
      Update: {
        TableName: nombreDeTabla(),
        Key: clave.cupoDeParticipante(participanteId, convocatoriaId),
        UpdateExpression: "ADD cupoConsumido :uno",
        ConditionExpression:
          "attribute_not_exists(cupoConsumido) OR cupoConsumido < :limite",
        ExpressionAttributeValues: { ":uno": 1, ":limite": limite },
      },
    },
    siFalla: "limite_alcanzado",
    descripcion: `cupo de adjudicaciones de ${participanteId} en ${convocatoriaId}`,
  };
};

/**
 * Devuelve una unidad de cupo: la adjudicacion se perdio por vencimiento,
 * rechazo de tesoreria o cancelacion del titular.
 *
 * **No la devuelve la venta.** `avalarPago` no llama a esta funcion: un
 * vehiculo comprado gasta cupo para siempre, que es lo que hace que el limite
 * signifique algo. Es lo contrario de lo que hacia el centinela de R-09, que se
 * borraba al avalar y dejaba al comprador libre para ganar otro lote.
 *
 * **Va sin condicion, y la proteccion contra el doble decremento es de sus
 * hermanos.** Este item siempre viaja dentro de una transaccion que ademas
 * cierra la solicitud adjudicada, con condiciones que fallan al repetirse
 * —`#estatus = :adjudicada`, `adjudicacionActual = :vencida`—, asi que un
 * reintento posterior al exito no escribe nada.
 *
 * Condicionar aqui `cupoConsumido > 0` pareceria mas seguro y seria peor: una
 * adjudicacion anterior a la Etapa 14 no tiene item de cupo, y esa condicion la
 * dejaria **imposible de vencer**. Un contador que se va a -1 concede cupo de
 * mas a una sola persona; una solicitud que no puede vencer inmoviliza un
 * vehiculo para siempre.
 */
export const itemDeLiberacionDeCupo = (entrada: {
  participanteId: string;
  convocatoriaId: string;
}): ItemDeTransaccion => ({
  item: {
    Update: {
      TableName: nombreDeTabla(),
      Key: clave.cupoDeParticipante(
        entrada.participanteId,
        entrada.convocatoriaId,
      ),
      UpdateExpression: "ADD cupoConsumido :menosUno",
      ExpressionAttributeValues: { ":menosUno": -1 },
    },
  },
  siFalla: "conflicto_concurrencia",
  descripcion: `liberacion de cupo de ${entrada.participanteId} en ${entrada.convocatoriaId}`,
});
