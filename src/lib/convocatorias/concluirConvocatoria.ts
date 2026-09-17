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
//
// **Y lo que sobrevive queda inscrito como trabajo pendiente (R-11b).** Un lote
// `ADJUDICADO` conserva su plazo, asi que en este momento no se puede saber
// como termina: si se paga, se vende y no hay nada mas que hacer; si el plazo
// vence, tesoreria rechaza o el participante cancela, el lote vuelve a
// `EN_OFERTA` dentro de una convocatoria que ya nadie puede comprar y su
// vehiculo se queda sin camino de vuelta al catalogo. Ese desenlace no lo puede
// resolver la conclusion —depende de algo que aun no ocurre—, asi que lo unico
// que hace aqui es dejarlo anotado en GSI4 para que el barrido lo cierre cuando
// pase (`cerrarLoteTrasConclusion.ts`).

import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, resolver, type DepsDeServicio } from "@/lib/data/deps";
import { MAXIMO_ITEMS_POR_TRANSACCION } from "@/lib/data/transacciones";
import { cerrarFilaDelLote } from "@/lib/fila/cerrarFilaDelLote";
import type { ActorUsuario } from "@/types/auditoria";
import type {
  ConvocatoriaConLotes,
  EstatusConvocatoria,
} from "@/types/convocatoria";
import { exito, fallo, type Resultado } from "@/types/resultado";
import { itemParaMarcarComprometido, itemsParaCerrar } from "./cierreDeLote";
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
  /**
   * Lotes que sobreviven `ADJUDICADO` y quedan inscritos como trabajo
   * pendiente. Cada uno terminara en venta o, si el compromiso se cae, en un
   * cierre tardio del barrido (R-11b).
   */
  comprometidos: number;
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

/** Marcar un lote comprometido cuesta **un** item, asi que caben muchos mas. */
export const MARCAS_POR_TANDA = MAXIMO_ITEMS_POR_TRANSACCION - 5;

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
  const comprometidos = actual.lotes.filter(
    (lote) => lote.estatus === "ADJUDICADO",
  );

  const cliente = clienteDe(deps);
  const tabla = nombreDeTabla();
  const momento = ahora.toISOString();

  for (let inicio = 0; inicio < sinVender.length; inicio += LOTES_POR_TANDA) {
    const tanda = sinVender.slice(inicio, inicio + LOTES_POR_TANDA);
    const items = tanda.flatMap((lote) =>
      itemsParaCerrar({
        lote,
        convocatoriaId: actual.convocatoriaId,
        momento,
        tabla,
      }),
    );

    if (items.length === 0) continue;

    try {
      await cliente.send(
        new TransactWriteCommand({
          TransactItems: items.map(({ item }) => item),
        }),
      );
    } catch {
      // Se corta sin marcar la convocatoria. El estado a medias son lotes ya
      // cerrados bajo una convocatoria todavia publicada: no comprables, que es
      // el lado seguro. Repetir la operacion reanuda desde donde quedo.
      return fallo("conflicto_concurrencia");
    }
  }

  // Los que sobreviven se inscriben como trabajo pendiente (R-11b). Va en su
  // propia tanda —un item por lote, no tres— y **despues** de cerrar los que no
  // se vendieron, para conservar el orden que hace inofensiva una interrupcion:
  // lo que queda a medias son lotes cerrados o marcados bajo una convocatoria
  // todavia publicada, nunca al reves.
  for (
    let inicio = 0;
    inicio < comprometidos.length;
    inicio += MARCAS_POR_TANDA
  ) {
    const tanda = comprometidos.slice(inicio, inicio + MARCAS_POR_TANDA);
    try {
      await cliente.send(
        new TransactWriteCommand({
          TransactItems: tanda.map(
            (lote) =>
              itemParaMarcarComprometido({
                lote,
                convocatoriaId: actual.convocatoriaId,
                momento,
                tabla,
              }).item,
          ),
        }),
      );
    } catch {
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
      datos: {
        vendidos,
        noVendidos: sinVender.length,
        filasCerradas,
        comprometidos: comprometidos.length,
      },
    },
    deps,
  );
  if (!transicionDeLaConvocatoria.ok) return transicionDeLaConvocatoria;

  return exito({
    estatus: transicionDeLaConvocatoria.data.estatus,
    vendidos,
    noVendidos: sinVender.length,
    filasCerradas,
    comprometidos: comprometidos.length,
  });
};
