import "server-only";

// Cambio de estatus de una convocatoria: la parte que es identica en las cinco
// transiciones simples —enviar a aprobacion, aprobar, rechazar, ocultar y
// reactivar— y que si se escribiera cinco veces se desincronizaria.
//
// Publicar y concluir **no** pasan por aqui: tocan los lotes por tandas y
// tienen su propio archivo.
//
// Lo que no vive aqui es la guarda de cada operacion. Cada servicio comprueba
// lo suyo antes de llamar: la maquina de estados decide a donde se puede ir,
// pero solo `aprobarConvocatoria` sabe de R-05.

import { clave, gsi2 } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  ejecutarTransaccion,
  type ItemDeTransaccion,
} from "@/lib/data/transacciones";
import { transicion, type EventoConvocatoria } from "@/lib/domain/transiciones";
import type { ActorUsuario, TipoDeEvento } from "@/types/auditoria";
import type { Convocatoria, EstatusConvocatoria } from "@/types/convocatoria";
import { exito, fallo, type Resultado } from "@/types/resultado";

export type EntradaDeTransicion = {
  actual: Convocatoria;
  /** Evento de la maquina de estados, que decide el destino. */
  evento: EventoConvocatoria;
  /** Tipo de evento de bitacora que corresponde a esta transicion. */
  tipoDeEvento: TipoDeEvento;
  actor: ActorUsuario;
  /** Obligatorio en los eventos marcados con **M** en el catalogo. */
  motivo?: string;
  /** Atributos extra a escribir, por nombre. */
  extras?: Record<string, unknown>;
  /** Atributos a eliminar del item. */
  eliminar?: readonly string[];
  /** Datos adicionales para el evento de bitacora, no para el item. */
  datos?: Record<string, unknown>;
};

export const aplicarTransicion = async (
  entrada: EntradaDeTransicion,
  deps: DepsDeServicio = {},
): Promise<Resultado<{ estatus: EstatusConvocatoria }>> => {
  const { cliente, ahora } = resolver(deps);
  const { actual } = entrada;

  const destino = transicion("convocatoria", actual.estatus, entrada.evento);
  if (!destino) return fallo("invalid_state");

  const momento = ahora.toISOString();
  const claves = gsi2.porEstatus(
    "CONV",
    destino,
    actual.creadoEn,
    actual.convocatoriaId,
  );

  const nombres: Record<string, string> = {
    "#estatus": "estatus",
    "#actualizadoEn": "actualizadoEn",
    "#actualizadoPor": "actualizadoPor",
    "#gsi2pk": "GSI2PK",
    "#gsi2sk": "GSI2SK",
  };
  const valores: Record<string, unknown> = {
    ":destino": destino,
    ":estatusEsperado": actual.estatus,
    ":momento": momento,
    ":actor": entrada.actor.id,
    // El cambio de estatus mueve el item de particion en GSI2: sin reescribir
    // estas claves, la convocatoria seguiria en la bandeja del estatus anterior
    // (PA-05) para siempre.
    ":gsi2pk": claves.GSI2PK,
    ":gsi2sk": claves.GSI2SK,
  };
  const asignaciones = [
    "#estatus = :destino",
    "#actualizadoEn = :momento",
    "#actualizadoPor = :actor",
    "#gsi2pk = :gsi2pk",
    "#gsi2sk = :gsi2sk",
  ];

  for (const [campo, valor] of Object.entries(entrada.extras ?? {})) {
    nombres[`#${campo}`] = campo;
    valores[`:${campo}`] = valor;
    asignaciones.push(`#${campo} = :${campo}`);
  }

  const eliminaciones = (entrada.eliminar ?? []).map((campo) => {
    nombres[`#${campo}`] = campo;
    return `#${campo}`;
  });

  const expresion =
    `SET ${asignaciones.join(", ")}` +
    (eliminaciones.length > 0 ? ` REMOVE ${eliminaciones.join(", ")}` : "");

  const items: ItemDeTransaccion[] = [
    {
      item: {
        Update: {
          TableName: nombreDeTabla(),
          Key: clave.convocatoria(actual.convocatoriaId),
          UpdateExpression: expresion,
          // El estatus esperado va en la condicion, no solo en la lectura
          // previa: es lo que impide que dos aprobadores actuando a la vez
          // apliquen dos transiciones sobre el mismo origen.
          ConditionExpression:
            "attribute_exists(PK) AND #estatus = :estatusEsperado",
          ExpressionAttributeNames: nombres,
          ExpressionAttributeValues: valores,
        },
      },
      siFalla: "invalid_state",
      descripcion: `convocatoria ${actual.convocatoriaId} en ${actual.estatus}`,
    },
    eventoParaTransaccion({
      tipo: entrada.tipoDeEvento,
      agregado: "CONVOCATORIA",
      agregadoId: actual.convocatoriaId,
      actor: entrada.actor,
      ocurridoEn: ahora,
      correlacionId: nuevaCorrelacion(ahora),
      convocatoriaId: actual.convocatoriaId,
      estadoAnterior: actual.estatus,
      estadoNuevo: destino,
      ...(entrada.motivo ? { motivo: entrada.motivo } : {}),
      ...(entrada.datos ? { datos: entrada.datos } : {}),
    }),
  ];

  const resultado = await ejecutarTransaccion(items, { cliente });
  if (!resultado.ok) return fallo(resultado.error);
  return exito({ estatus: destino });
};
