import "server-only";

// R-18 — concluir cierra las filas.
//
// "Al concluir la convocatoria, las solicitudes `EN_FILA` y `CONGELADA` pasan a
// `NO_ADJUDICADA`. Una adjudicacion `ADJUDICADA` o `EN_VERIFICACION` vigente
// **sobrevive a la conclusion** y conserva su plazo: quien gano antes del
// cierre tiene derecho a terminar de pagar."
//
// La asimetria es el punto entero de la regla. Cerrar tambien las adjudicadas
// seria quitarle el vehiculo a quien ya lo gano y esta pagando; dejar abiertas
// las que esperan seria peor: participantes formados en una fila que ya no va a
// avanzar nunca, sin que nada se lo diga.
//
// Se ejecuta **despues** de cerrar los lotes, no antes. Un lote ya
// `NO_VENDIDO` no admite solicitudes nuevas —la condicion del paso 1 de T1
// exige `EN_OFERTA` o `ADJUDICADO`— ni adjudicaciones, asi que cerrar primero
// el lote garantiza que la fila que se cierra despues es la definitiva. Al
// reves quedaria una ventana en la que alguien se forma en una fila recien
// cerrada.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { clave, PREFIJO } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { resolver, type DepsDeServicio } from "@/lib/data/deps";
import { itemsDeQuery } from "@/lib/data/paginacion";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  ejecutarTransaccion,
  MAXIMO_ITEMS_POR_TRANSACCION,
  type ItemDeTransaccion,
} from "@/lib/data/transacciones";
import { transicion } from "@/lib/domain/transiciones";
// `ActorDeEvento` y no `ActorUsuario`: el cierre lo dispara una persona
// (`avalarPago`, `concluirConvocatoria`) pero tambien el barrido cuando
// reconcilia una fila que quedo viva en un lote ya cerrado, y ese acto lo firma
// `SISTEMA`. La funcion solo reenvia el actor a su evento, y el evento ya
// admitia los dos.
import type { ActorDeEvento } from "@/types/auditoria";
import type { Solicitud } from "@/types/fila";
import type { Lote } from "@/types/lote";
import { exito, fallo, type Resultado } from "@/types/resultado";
import { aSolicitud } from "./mapeo";

/**
 * Cada solicitud cerrada cuesta tres items: cambiarle el estatus, retirar su
 * centinela de fila y escribir su evento (regla 4).
 *
 * Se deja margen sobre el limite duro porque el tope de `TransactWriteItems`
 * tambien cuenta el tamano agregado, no solo la cantidad.
 */
export const ITEMS_POR_SOLICITUD = 3;
export const SOLICITUDES_POR_TANDA = Math.floor(
  (MAXIMO_ITEMS_POR_TRANSACCION - 4) / ITEMS_POR_SOLICITUD,
);

/** Las que se cierran. Las demas o ya terminaron, o sobreviven al cierre. */
const CERRABLES = ["EN_FILA", "CONGELADA"] as const;

/**
 * Cierra la fila de un lote y devuelve cuantas solicitudes cerro.
 *
 * Lee la fila completa —no un `COUNT`— porque necesita el turno de cada una
 * para construir su clave. Es la unica lectura del sistema que trae solicitudes
 * de terceros a memoria, y esta bien que lo sea: corre en el servidor, dentro
 * de una operacion administrativa, y nada de lo que lee sale hacia un
 * participante.
 */
export const cerrarFilaDelLote = async (
  entrada: { lote: Lote; actor: ActorDeEvento },
  deps: DepsDeServicio = {},
): Promise<Resultado<number>> => {
  const { ahora } = resolver(deps);
  const { lote } = entrada;

  const porCerrar = await leerCerrables(lote.loteId, deps);
  if (porCerrar.length === 0) return exito(0);

  for (
    let inicio = 0;
    inicio < porCerrar.length;
    inicio += SOLICITUDES_POR_TANDA
  ) {
    const tanda = porCerrar.slice(inicio, inicio + SOLICITUDES_POR_TANDA);
    const items = tanda.flatMap((solicitud) =>
      itemsParaCerrar({ solicitud, lote, actor: entrada.actor, ahora }),
    );

    const resultado = await ejecutarTransaccion(items, deps);
    if (!resultado.ok) {
      // Se corta sin marcar la convocatoria. Lo que queda a medias son
      // solicitudes ya cerradas en un lote ya cerrado —el lado seguro— y
      // repetir la conclusion reanuda desde donde quedo.
      return fallo(resultado.error);
    }
  }

  return exito(porCerrar.length);
};

/**
 * PA-07 restringido a lo que R-18 cierra.
 *
 * **Recorre todas las paginas.** Una primera pagina truncada dejaria
 * solicitudes `EN_FILA` o `CONGELADA` vivas en un lote ya cerrado, y
 * `cerrarFilaDelLote` devolveria exito con el conteo de lo que alcanzo a ver —
 * el peor de los dos lados segun R-18.
 */
const leerCerrables = async (
  loteId: string,
  deps: DepsDeServicio,
): Promise<Solicitud[]> => {
  const items = await itemsDeQuery(
    (desde) =>
      new QueryCommand({
        TableName: nombreDeTabla(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefijo)",
        ExpressionAttributeValues: {
          ":pk": clave.solicitud(loteId, 0).PK,
          ":prefijo": PREFIJO.solicitud,
        },
        ScanIndexForward: true,
        ConsistentRead: true,
        ExclusiveStartKey: desde,
      }),
    deps,
  );

  const cerrables: Solicitud[] = [];
  for (const item of items) {
    const solicitud = aSolicitud(item);
    if (!solicitud) continue;
    if (!(CERRABLES as readonly string[]).includes(solicitud.estatus)) continue;
    cerrables.push(solicitud);
  }
  return cerrables;
};

const itemsParaCerrar = (entrada: {
  solicitud: Solicitud;
  lote: Lote;
  actor: ActorDeEvento;
  ahora: Date;
}): ItemDeTransaccion[] => {
  const { solicitud, lote, ahora } = entrada;
  const tabla = nombreDeTabla();

  const destino = transicion("solicitud", solicitud.estatus, "NO_ADJUDICAR");
  if (!destino) {
    // `CERRABLES` ya filtro los dos estatus que admiten `NO_ADJUDICAR`. Que
    // falte la transicion significa que la maquina cambio sin mirar aqui.
    throw new Error(
      `La maquina de estados no admite NO_ADJUDICAR desde ${solicitud.estatus}`,
    );
  }

  return [
    {
      item: {
        Update: {
          TableName: tabla,
          Key: clave.solicitud(lote.loteId, solicitud.turno),
          UpdateExpression: "SET #estatus = :destino, cerradaEn = :ahora",
          ConditionExpression: "#estatus = :esperado",
          ExpressionAttributeNames: { "#estatus": "estatus" },
          ExpressionAttributeValues: {
            ":destino": destino,
            ":esperado": solicitud.estatus,
            ":ahora": ahora.toISOString(),
          },
        },
      },
      siFalla: "conflicto_concurrencia",
      descripcion: `cerrar turno ${String(solicitud.turno)}`,
    },
    {
      item: {
        Delete: {
          TableName: tabla,
          Key: clave.centinelaFila(lote.loteId, solicitud.participanteId),
          ConditionExpression: "attribute_exists(SK)",
        },
      },
      siFalla: "conflicto_concurrencia",
      descripcion: "centinela de fila (R-07)",
    },
    eventoParaTransaccion({
      tipo: "SOLICITUD_NO_ADJUDICADA",
      agregado: "LOTE",
      agregadoId: lote.loteId,
      actor: entrada.actor,
      ocurridoEn: ahora,
      correlacionId: nuevaCorrelacion(ahora),
      convocatoriaId: lote.convocatoriaId,
      loteId: lote.loteId,
      solicitudId: solicitud.solicitudId,
      estadoAnterior: solicitud.estatus,
      estadoNuevo: destino,
      datos: { turno: solicitud.turno },
    }),
  ];
};

export const __test__ = { leerCerrables, itemsParaCerrar, CERRABLES };
