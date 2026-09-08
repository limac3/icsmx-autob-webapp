import "server-only";

// Conclusion de una convocatoria: cierra los lotes que nadie compro y devuelve
// sus vehiculos al catalogo (R-11).
//
// **El orden es el mismo que al ocultar: primero los lotes, despues la
// convocatoria.** Y por la misma razon, que aqui es todavia mas visible: el
// `estatusConvocatoria` del lote es una **copia**. Marcar la convocatoria
// primero dejaria lotes cuya copia sigue diciendo `PUBLICADA` y que por tanto
// el paso 1 de T1 aceptaria comprar, bajo una convocatoria ya concluida.
//
// **Y cierra las filas (R-18), desde la Etapa 8.** Las solicitudes `EN_FILA` y
// `CONGELADA` pasan a `NO_ADJUDICADA`; una adjudicacion `ADJUDICADA` o
// `EN_VERIFICACION` sobrevive con su plazo intacto. El cierre va **despues** de
// cerrar los lotes: un lote que ya no admite solicitudes ni adjudicaciones
// garantiza que la fila que se cierra a continuacion es la definitiva.
//
// Se recorren **todos** los lotes, no solo los que se cierran aqui: detras de
// un lote `ADJUDICADO` —o de uno `VENDIDO`— puede quedar gente formada, y esa
// fila tampoco va a avanzar ya.

import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

import { clave, gsi2 } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, resolver, type DepsDeServicio } from "@/lib/data/deps";
import { MAXIMO_ITEMS_POR_TRANSACCION } from "@/lib/data/transacciones";
import { transicion } from "@/lib/domain/transiciones";
import { cerrarFilaDelLote } from "@/lib/fila/cerrarFilaDelLote";
import type { ActorUsuario } from "@/types/auditoria";
import type {
  ConvocatoriaConLotes,
  EstatusConvocatoria,
} from "@/types/convocatoria";
import type { Lote } from "@/types/lote";
import { exito, fallo, type Resultado } from "@/types/resultado";
import { aplicarTransicion } from "./transicionDeConvocatoria";

export type EntradaConcluirConvocatoria = {
  actual: ConvocatoriaConLotes;
  /** Si `finVenta` ya paso. Cerrado por omision (regla 18). */
  ventaFinalizada?: boolean;
  /** Si no queda ninguna solicitud viva. Cerrado por omision (regla 18). */
  sinSolicitudesVivas?: boolean;
  actor: ActorUsuario;
};

export type ResultadoDeConclusion = {
  estatus: EstatusConvocatoria;
  vendidos: number;
  noVendidos: number;
  /** Solicitudes que pasaron a `NO_ADJUDICADA` al cerrar las filas (R-18). */
  filasCerradas: number;
};

/**
 * Cada lote sin vender cuesta tres items: cerrar el lote, liberar el centinela y
 * devolver el vehiculo al catalogo.
 *
 * **No lleva evento por lote.** El catalogo no tiene uno para "lote cerrado al
 * concluir", y no es un olvido: `trazabilidad-auditoria.md` dice que
 * `CONVOCATORIA_CONCLUIDA` va "con el resumen de vendidos y no vendidos".
 * Un evento por lote repetiria N veces el mismo hecho.
 *
 * Se deja margen sobre el limite por la misma razon que en la propagacion: el
 * tope tambien cuenta el tamano agregado.
 */
export const ITEMS_POR_LOTE = 3;
export const LOTES_POR_TANDA = Math.floor(
  (MAXIMO_ITEMS_POR_TRANSACCION - 5) / ITEMS_POR_LOTE,
);

export const concluirConvocatoria = async (
  entrada: EntradaConcluirConvocatoria,
  deps: DepsDeServicio = {},
): Promise<Resultado<ResultadoDeConclusion>> => {
  const { ahora } = resolver(deps);
  const { actual } = entrada;

  // Cerrado por omision: hace falta que **una** de las dos condiciones este
  // confirmada. Un `undefined` no confirma nada.
  if (
    entrada.ventaFinalizada !== true &&
    entrada.sinSolicitudesVivas !== true
  ) {
    return fallo("invalid_state");
  }

  // Solo los que siguen en oferta cambian. Un lote `ADJUDICADO` **sobrevive a
  // la conclusion** con su plazo intacto (R-18): quien gano antes del cierre
  // tiene derecho a terminar de pagar, y su vehiculo sigue comprometido.
  const sinVender = actual.lotes.filter((lote) => lote.estatus === "EN_OFERTA");
  const vendidos = actual.lotes.filter(
    (lote) => lote.estatus === "VENDIDO",
  ).length;

  const cliente = clienteDe(deps);
  const tabla = nombreDeTabla();
  const momento = ahora.toISOString();

  for (let inicio = 0; inicio < sinVender.length; inicio += LOTES_POR_TANDA) {
    const tanda = sinVender.slice(inicio, inicio + LOTES_POR_TANDA);
    const items = tanda.flatMap((lote) =>
      itemsParaCerrar({
        lote,
        convocatoriaId: actual.convocatoriaId,
        actor: entrada.actor,
        momento,
        tabla,
      }),
    );

    if (items.length === 0) continue;

    try {
      await cliente.send(new TransactWriteCommand({ TransactItems: items }));
    } catch {
      // Se corta sin marcar la convocatoria. El estado a medias son lotes ya
      // cerrados bajo una convocatoria todavia publicada: no comprables, que es
      // el lado seguro. Repetir la operacion reanuda desde donde quedo.
      return fallo("conflicto_concurrencia");
    }
  }

  // R-18: las filas se cierran con los lotes ya cerrados, para que nadie pueda
  // formarse en una fila que se acaba de cerrar.
  let filasCerradas = 0;
  for (const lote of actual.lotes) {
    const cierre = await cerrarFilaDelLote(
      { lote, actor: entrada.actor },
      deps,
    );
    if (!cierre.ok) return cierre;
    filasCerradas += cierre.data;
  }

  const transicionDeLaConvocatoria = await aplicarTransicion(
    {
      actual,
      evento: "CONCLUIR",
      tipoDeEvento: "CONVOCATORIA_CONCLUIDA",
      actor: entrada.actor,
      datos: { vendidos, noVendidos: sinVender.length, filasCerradas },
    },
    deps,
  );
  if (!transicionDeLaConvocatoria.ok) return transicionDeLaConvocatoria;

  return exito({
    estatus: transicionDeLaConvocatoria.data.estatus,
    vendidos,
    noVendidos: sinVender.length,
    filasCerradas,
  });
};

/** Las tres escrituras que cierran un lote sin vender. */
const itemsParaCerrar = (entrada: {
  lote: Lote;
  convocatoriaId: string;
  actor: ActorUsuario;
  momento: string;
  tabla: string;
}): Record<string, unknown>[] => {
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
      Update: {
        TableName: tabla,
        Key: clave.lote(convocatoriaId, lote.loteId),
        UpdateExpression: "SET #estatus = :destino, #actualizadoEn = :momento",
        ConditionExpression:
          "attribute_exists(SK) AND #estatus = :estatusEsperado",
        ExpressionAttributeNames: {
          "#estatus": "estatus",
          "#actualizadoEn": "actualizadoEn",
        },
        ExpressionAttributeValues: {
          ":destino": destinoDelLote,
          ":estatusEsperado": lote.estatus,
          ":momento": momento,
        },
      },
    },
    {
      // Liberar el centinela es lo que habilita la reoferta de R-11. Solo se
      // libera el de los lotes sin vender: el de un lote adjudicado tiene que
      // seguir puesto mientras alguien termina de pagarlo.
      Delete: {
        TableName: tabla,
        Key: clave.centinelaVehiculoActivo(lote.vehiculoId),
        ConditionExpression: "attribute_exists(SK)",
      },
    },
    {
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
  ];
};
