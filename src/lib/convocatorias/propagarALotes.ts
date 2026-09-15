import "server-only";

// Propagacion de los atributos desnormalizados de la convocatoria a sus lotes
// — la mitad cara de T8 (modelo-datos-dynamodb.md seccion 6).
//
// **Por que existe la copia.** El paso 1 de T1 condiciona sobre un solo item,
// el lote, para no retener la convocatoria con N solicitudes simultaneas. Esa
// baratura se paga aqui: al cambiar la convocatoria hay que reescribir cada
// lote.
//
// **Por que va por tandas y no en una transaccion.** Con mas de ~95 lotes se
// supera el limite de `TransactWriteItems`. Una convocatoria grande no cabe, y
// fingir que si dejaria la operacion rota justo cuando mas importa.
//
// **Por que una interrupcion es inofensiva.** No lo es por si sola: lo es por
// el **orden** en que la llaman quienes la usan. Al publicar se marca primero
// la convocatoria y despues los lotes, asi que una interrupcion deja lotes que
// todavia dicen `BORRADOR` —no comprables, el lado seguro—. Al ocultar el orden
// se invierte. El atributo del lote puede quedarse atras de la convocatoria,
// nunca adelantarse, y "atras" siempre significa menos permisivo.

import { clave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { MAXIMO_ITEMS_POR_TRANSACCION } from "@/lib/data/transacciones";
import type { Convocatoria } from "@/types/convocatoria";
import type { Lote } from "@/types/lote";
import { exito, fallo, type Resultado } from "@/types/resultado";

/**
 * Lotes por tanda.
 *
 * Cada lote es **un** item de la transaccion, asi que cabrian
 * `MAXIMO_ITEMS_POR_TRANSACCION`. Se deja margen a proposito: el limite de
 * DynamoDB tambien cuenta el tamano agregado, y quedarse en el borde exacto
 * convierte un item que crece en un fallo en produccion.
 */
export const LOTES_POR_TANDA = MAXIMO_ITEMS_POR_TRANSACCION - 5;

export type EntradaDePropagacion = {
  convocatoria: Convocatoria;
  lotes: readonly Lote[];
  /**
   * Estatus a grabar en los lotes. Se pasa aparte y no se toma de
   * `convocatoria.estatus` porque al publicar la convocatoria ya cambio y al
   * ocultar todavia no: quien llama sabe cual de los dos momentos es.
   */
  estatusConvocatoria: string;
};

/**
 * Reescribe los desnormalizados en cada lote. **Es idempotente**: repetir una
 * tanda ya aplicada no cambia nada, que es lo que permite reanudar sin llevar
 * cuenta de por donde iba.
 */
export const propagarALotes = async (
  entrada: EntradaDePropagacion,
  deps: DepsDeServicio = {},
): Promise<Resultado<{ lotesPropagados: number }>> => {
  const { convocatoria, lotes, estatusConvocatoria } = entrada;

  // Los retirados quedan fuera: ya no participan de la venta y reescribirlos
  // solo gastaria capacidad.
  const vigentes = lotes.filter((lote) => lote.estatus !== "RETIRADO");
  if (vigentes.length === 0) return exito({ lotesPropagados: 0 });

  const cliente = clienteDe(deps);
  const tabla = nombreDeTabla();

  for (let inicio = 0; inicio < vigentes.length; inicio += LOTES_POR_TANDA) {
    const tanda = vigentes.slice(inicio, inicio + LOTES_POR_TANDA);

    try {
      await cliente.send(
        new TransactWriteCommand({
          TransactItems: tanda.map((lote) => ({
            Update: {
              TableName: tabla,
              Key: clave.lote(convocatoria.convocatoriaId, lote.loteId),
              // El `SET` enumera los desnormalizados **a mano**, asi que un
              // atributo nuevo en la convocatoria que no se agregue aqui se
              // guarda pero nunca llega a los lotes ya creados — en silencio, y
              // sin que el compilador diga nada.
              UpdateExpression:
                "SET #estatusConvocatoria = :estatusConvocatoria," +
                " #inicioVenta = :inicioVenta, #finVenta = :finVenta," +
                " #tipoConvocatoria = :tipoConvocatoria," +
                " #horasLiquidacion = :horasLiquidacion," +
                " #limiteAdjudicaciones = :limiteAdjudicaciones," +
                " #limiteSolicitudes = :limiteSolicitudes," +
                " #modalidadAdjudicacion = :modalidadAdjudicacion",
              // Sin condicion de estatus a proposito: la propagacion tiene que
              // poder reanudarse sobre lotes que ya la recibieron. Solo se
              // exige que el lote exista, para no resucitar uno borrado.
              ConditionExpression: "attribute_exists(SK)",
              ExpressionAttributeNames: {
                "#estatusConvocatoria": "estatusConvocatoria",
                "#inicioVenta": "inicioVenta",
                "#finVenta": "finVenta",
                "#tipoConvocatoria": "tipoConvocatoria",
                "#horasLiquidacion": "horasLiquidacion",
                "#limiteAdjudicaciones": "limiteAdjudicaciones",
                "#limiteSolicitudes": "limiteSolicitudes",
                "#modalidadAdjudicacion": "modalidadAdjudicacion",
              },
              ExpressionAttributeValues: {
                ":estatusConvocatoria": estatusConvocatoria,
                ":inicioVenta": convocatoria.inicioVenta,
                ":finVenta": convocatoria.finVenta,
                ":tipoConvocatoria": convocatoria.tipo,
                ":horasLiquidacion": convocatoria.horasLiquidacion,
                ":limiteAdjudicaciones": convocatoria.limiteAdjudicaciones,
                ":limiteSolicitudes": convocatoria.limiteSolicitudes,
                ":modalidadAdjudicacion": convocatoria.modalidadAdjudicacion,
              },
            },
          })),
        }),
      );
    } catch {
      // Se devuelve cuantos lotes alcanzo a propagar y no solo el fallo: quien
      // reanude necesita saber que la operacion fue parcial, y el orden de
      // llamada garantiza que el estado a medias es el restrictivo.
      return fallo("conflicto_concurrencia");
    }
  }

  return exito({ lotesPropagados: vigentes.length });
};
