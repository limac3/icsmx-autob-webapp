// Las escrituras que cierran o marcan un lote al concluir su convocatoria.
//
// **Sin `import "server-only"`, y no es un descuido.** Este archivo lo alcanza
// el Lambda del barrido a traves de `cerrarLoteTrasConclusion.ts`, y la guarda
// lanza al importar bajo el empaquetado de `defineFunction`: bastaria para que
// la funcion fallara en el arranque, en el 100% de sus invocaciones
// (`desafios-implementacion.md` 53 y 64, y la prueba `amplify/barrido/
// alcance.test.ts` que lo vigila). Aqui ademas no hay nada que proteger: son
// constructores puros: reciben datos, devuelven descripciones de escritura y no
// tocan la red, el reloj ni ningun secreto.
//
// **Existen aparte para que la conclusion y el cierre tardio no se separen.**
// Un lote `ADJUDICADO` sobrevive a la conclusion (R-18) y puede caerse dias
// despues; cuando eso pasa hay que dejarlo exactamente como lo habria dejado la
// conclusion, y la unica forma de garantizarlo es que sea el mismo codigo. Dos
// copias se desincronizan en cuanto una de las dos cambie, y el sintoma seria
// un vehiculo mal liberado meses mas tarde.

import { clave, gsi2, gsi4 } from "@/lib/data/claves";
import { type ItemDeTransaccion } from "@/lib/data/transacciones";
import { transicion } from "@/lib/domain/transiciones";
import type { Lote } from "@/types/lote";

/**
 * Las tres escrituras que cierran un lote sin vender.
 *
 * **Se exporta porque el barrido las repite.** Un lote `ADJUDICADO` sobrevive a
 * la conclusion y puede caerse despues (`cerrarLoteTrasConclusion.ts`); ese
 * cierre tardio tiene que dejar exactamente el mismo estado que este, y la
 * unica forma de garantizarlo es que sea el mismo codigo. Escribirlo dos veces
 * lo desincronizaria en cuanto una de las dos cambie.
 */
export const itemsParaCerrar = (entrada: {
  lote: Lote;
  convocatoriaId: string;
  momento: string;
  tabla: string;
}): ItemDeTransaccion[] => {
  const { lote, convocatoriaId, tabla, momento } = entrada;

  const destinoDelLote = transicion(
    "lote",
    lote.estatus,
    "CONCLUIR_CONVOCATORIA",
  );
  // `sinVender` ya filtro por `EN_OFERTA`, asi que la transicion existe. El
  // guardado esta para que un cambio futuro en la maquina no produzca un
  // `undefined` grabado como estatus.
  if (!destinoDelLote) return [];

  return [
    {
      item: {
        Update: {
          TableName: tabla,
          Key: clave.lote(convocatoriaId, lote.loteId),
          // El `REMOVE` de las claves de GSI4 no hace nada aqui —un lote en
          // oferta nunca las tuvo— y es imprescindible en el cierre tardio:
          // saca al lote del indice de trabajo pendiente en el mismo acto que
          // lo resuelve. Un `REMOVE` de un atributo ausente es una operacion
          // valida y sin efecto, asi que el camino es uno solo.
          UpdateExpression:
            "SET #estatus = :destino, #actualizadoEn = :momento" +
            " REMOVE #gsi4pk, #gsi4sk",
          ConditionExpression:
            "attribute_exists(SK) AND #estatus = :estatusEsperado",
          ExpressionAttributeNames: {
            "#estatus": "estatus",
            "#actualizadoEn": "actualizadoEn",
            "#gsi4pk": "GSI4PK",
            "#gsi4sk": "GSI4SK",
          },
          ExpressionAttributeValues: {
            ":destino": destinoDelLote,
            ":estatusEsperado": lote.estatus,
            ":momento": momento,
          },
        },
      },
      siFalla: "invalid_state",
      descripcion: `lote ${lote.loteId} en ${lote.estatus}`,
    },
    {
      item: {
        // Liberar el centinela es lo que habilita la reoferta de R-11. Solo se
        // libera el de los lotes sin vender: el de un lote adjudicado tiene que
        // seguir puesto mientras alguien termina de pagarlo.
        Delete: {
          TableName: tabla,
          Key: clave.centinelaVehiculoActivo(lote.vehiculoId),
          ConditionExpression: "attribute_exists(SK)",
        },
      },
      siFalla: "invalid_state",
      descripcion: `centinela activo del vehiculo ${lote.vehiculoId}`,
    },
    {
      item: {
        Update: {
          TableName: tabla,
          Key: clave.vehiculo(lote.vehiculoId),
          // Solo se reescribe `GSI2PK`: la clave de orden lleva la fecha de
          // **creacion** del vehiculo, que no cambia, asi que no hace falta
          // leerlo para conocerla.
          UpdateExpression:
            "SET #estatus = :disponible, #actualizadoEn = :momento," +
            " #gsi2pk = :gsi2pk REMOVE #convocatoriaId",
          ConditionExpression:
            "attribute_exists(PK) AND #estatus = :estatusEsperado",
          ExpressionAttributeNames: {
            "#estatus": "estatus",
            "#convocatoriaId": "convocatoriaId",
            "#actualizadoEn": "actualizadoEn",
            "#gsi2pk": "GSI2PK",
          },
          ExpressionAttributeValues: {
            ":disponible": "DISPONIBLE",
            // El vehiculo de un lote en oferta esta `EN_CONVOCATORIA`; si no lo
            // esta, algo mas lo movio y la transaccion debe fallar en vez de
            // pisarlo.
            ":estatusEsperado": "EN_CONVOCATORIA",
            ":momento": momento,
            ":gsi2pk": gsi2.particionDeEstatus("VEH", "DISPONIBLE").GSI2PK,
          },
        },
      },
      siFalla: "invalid_state",
      descripcion: `vehiculo ${lote.vehiculoId} EN_CONVOCATORIA`,
    },
  ];
};

/**
 * La unica escritura que marca un lote que **sobrevive** a la conclusion.
 *
 * Hace dos cosas en el mismo `Update`, y las dos son necesarias:
 *
 *  1. **Pone al dia el `estatusConvocatoria` desnormalizado.** Sin esto la
 *     copia del lote seguiria diciendo `PUBLICADA` para siempre —la conclusion
 *     nunca propago a los lotes que no cierra—, y en cuanto el lote volviera a
 *     `EN_OFERTA` la condicion del paso 1 de T1 lo daria por comprable. Hoy lo
 *     detiene el gating de la action, que lee la convocatoria autoritativa;
 *     esto restituye la defensa en profundidad que el resto del sistema si
 *     tiene.
 *  2. **Lo inscribe en GSI4 como trabajo pendiente.** Es lo que permite que el
 *     barrido lo encuentre mas tarde sin recorrer las convocatorias concluidas
 *     una por una — un recorrido que ademas crece sin limite y que, con el tope
 *     de `listarConvocatorias`, acabaria devolviendo las mas viejas y dejando
 *     fuera justo las recientes.
 */
export const itemParaMarcarComprometido = (entrada: {
  lote: Lote;
  convocatoriaId: string;
  momento: string;
  tabla: string;
}): ItemDeTransaccion => {
  const { lote, convocatoriaId, tabla, momento } = entrada;
  const claves = gsi4.cierrePendiente(convocatoriaId, lote.loteId);

  return {
    item: {
      Update: {
        TableName: tabla,
        Key: clave.lote(convocatoriaId, lote.loteId),
        UpdateExpression:
          "SET #estatusConvocatoria = :concluida, #actualizadoEn = :momento," +
          " #gsi4pk = :gsi4pk, #gsi4sk = :gsi4sk",
        ConditionExpression:
          "attribute_exists(SK) AND #estatus = :estatusEsperado",
        ExpressionAttributeNames: {
          "#estatus": "estatus",
          "#estatusConvocatoria": "estatusConvocatoria",
          "#actualizadoEn": "actualizadoEn",
          "#gsi4pk": "GSI4PK",
          "#gsi4sk": "GSI4SK",
        },
        ExpressionAttributeValues: {
          ":concluida": "CONCLUIDA",
          ":estatusEsperado": "ADJUDICADO",
          ":momento": momento,
          ":gsi4pk": claves.GSI4PK,
          ":gsi4sk": claves.GSI4SK,
        },
      },
    },
    siFalla: "invalid_state",
    descripcion: `lote ${lote.loteId} ADJUDICADO sobrevive a la conclusion`,
  };
};
