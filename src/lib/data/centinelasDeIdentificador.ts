import "server-only";

// Items de transaccion para los centinelas de unicidad de los identificadores
// de negocio (folio, numero economico, numero de serie).
//
// Existe por la misma razon que `putDeEvento`: que nadie pueda olvidar la
// condicion. Un centinela sin `attribute_not_exists` no garantiza nada — dos
// altas simultaneas con el mismo folio pasarian las dos y la unicidad seria una
// creencia, no una propiedad.
//
// **Los centinelas van primero en la transaccion**, y no es cosmetico:
// `ejecutarTransaccion` devuelve el **indice** del item que cancelo, y es la
// unica forma de saber *cual* de los dos numeros de un vehiculo estaba
// duplicado. Con los centinelas al frente, ese indice es estable y no se mueve
// al agregar items despues.

import type { AmbitoDeIdentificador } from "./claves";
import { clave } from "./claves";
import { nombreDeTabla } from "./cliente";
import {
  CONDICION_CENTINELA_NUEVO,
  type ItemDeTransaccion,
} from "./transacciones";

/**
 * Reserva el valor. Falla si ya estaba tomado.
 *
 * `siFalla` es `validation_failed` y no `conflicto_concurrencia`: un folio
 * repetido **es** un dato mal capturado, y quien lo escribio tiene que
 * corregirlo, no reintentar. Quien llama traduce el indice al campo concreto.
 *
 * El centinela guarda de que entidad es (`atributos`), lo que lo vuelve tambien
 * el indice de busqueda: encontrar un vehiculo por su numero economico es un
 * `GetItem`, no un recorrido.
 */
export const putDeCentinelaDeIdentificador = (
  ambito: AmbitoDeIdentificador,
  valorNormalizado: string,
  atributos: Record<string, unknown>,
): ItemDeTransaccion => ({
  item: {
    Put: {
      TableName: nombreDeTabla(),
      Item: {
        ...clave.centinelaDeIdentificador(ambito, valorNormalizado),
        ...atributos,
      },
      ConditionExpression: CONDICION_CENTINELA_NUEVO,
    },
  },
  siFalla: "validation_failed",
  descripcion: `centinela ${ambito}#${valorNormalizado}`,
});

/**
 * Libera el valor. Exige que exista (`attribute_exists`).
 *
 * Se usa solo al renombrar, junto al `Put` del valor nuevo en la **misma**
 * transaccion. La condicion no es paranoia: si el centinela viejo ya no
 * estuviera, significaria que alguien mas lo libero o que el atributo de la
 * entidad y su centinela se habian desincronizado, y en los dos casos borrar a
 * ciegas dejaria un valor reservado que nadie puede volver a usar.
 */
export const deleteDeCentinelaDeIdentificador = (
  ambito: AmbitoDeIdentificador,
  valorNormalizado: string,
): ItemDeTransaccion => ({
  item: {
    Delete: {
      TableName: nombreDeTabla(),
      Key: clave.centinelaDeIdentificador(ambito, valorNormalizado),
      ConditionExpression: "attribute_exists(SK)",
    },
  },
  siFalla: "conflicto_concurrencia",
  descripcion: `liberar ${ambito}#${valorNormalizado}`,
});
