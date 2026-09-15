import "server-only";

// Cancelacion voluntaria del participante.
//
// Dos cancelaciones distintas viven aqui, y la diferencia es todo:
//
//  - Desde `EN_FILA` o `CONGELADA` solo se retira de la fila. Nadie mas se ve
//    afectado.
//  - Desde `ADJUDICADA` **libera el lote**: se devuelve la unidad de cupo
//    (R-09), el lote vuelve a `EN_OFERTA`, el vehiculo a `EN_CONVOCATORIA`, y
//    el siguiente turno vivo recibe el vehiculo.
//
// **La liberacion y la reasignacion no van en la misma transaccion**, a
// diferencia de T5. Es deliberado: T5 tiene que ser atomico porque el barrido
// actua sobre un plazo vencido y no puede dejar el lote libre sin dueno si se
// cae a la mitad; aqui, en cambio, la reasignacion es exactamente el mismo acto
// que dispara cualquier solicitud nueva, y reutilizar `adjudicarLote` —con su
// abstencion por reservas, su manejo del cupo por R-09 y sus reintentos— vale
// mas que replicar esa logica dentro de una transaccion. La ventana que abre
// —lote libre con fila viva— ya existe en el diseno: T1 tampoco puede adjudicar
// dentro de su propia transaccion.

import { clave, identificadorDeSolicitud } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  ejecutarTransaccion,
  type ItemDeTransaccion,
} from "@/lib/data/transacciones";
import { transicion } from "@/lib/domain/transiciones";
import type { ActorUsuario } from "@/types/auditoria";
import type { Solicitud } from "@/types/fila";
import type { Lote } from "@/types/lote";
import type { EstatusSolicitud } from "@/types/solicitud";
import { exito, fallo, type Resultado } from "@/types/resultado";
import { adjudicarLote, type ResultadoDeAdjudicacion } from "./adjudicarLote";
import { itemDeLiberacionDeCupo } from "./cupo";

export type EntradaCancelarSolicitud = {
  /** El lote ya leido por quien invoca, el mismo que evaluo el permiso. */
  lote: Lote;
  /** La solicitud propia, leida desde el centinela: no puede ser de otro. */
  solicitud: Solicitud;
  actor: ActorUsuario;
  motivo?: string;
};

export type ResultadoDeCancelacion = {
  estatus: EstatusSolicitud;
  /** `true` si la cancelacion devolvio el lote a la oferta. */
  liberoElLote: boolean;
  /** Presente solo si libero el lote: que paso al reasignarlo. */
  reasignacion?: ResultadoDeAdjudicacion;
};

export const cancelarSolicitud = async (
  entrada: EntradaCancelarSolicitud,
  deps: DepsDeServicio = {},
): Promise<Resultado<ResultadoDeCancelacion>> => {
  const { ahora } = resolver(deps);
  const { lote, solicitud } = entrada;

  // El destino sale de la maquina de estados, no de una constante local: si
  // `CANCELAR` no existe desde este estatus, la operacion no aplica. Asi la
  // lista de estados cancelables vive en un solo sitio (proyecto.md 5.4).
  const destino = transicion("solicitud", solicitud.estatus, "CANCELAR");
  if (!destino) return fallo("invalid_state");

  const liberaElLote = solicitud.estatus === "ADJUDICADA";
  const tabla = nombreDeTabla();
  const solicitudId = identificadorDeSolicitud(lote.loteId, solicitud.turno);
  const correlacionId = nuevaCorrelacion(ahora);

  const items: ItemDeTransaccion[] = [
    {
      item: {
        Update: {
          TableName: tabla,
          Key: clave.solicitud(lote.loteId, solicitud.turno),
          // `REMOVE` de las claves de GSI4 detiene el reloj del vencimiento:
          // el indice del trabajo pendiente es disperso y contiene exactamente
          // lo que vence (modelo-datos 3). Sobre una solicitud que nunca estuvo
          // adjudicada no hace nada, asi que no hace falta ramificar.
          UpdateExpression:
            "SET #estatus = :destino, canceladaEn = :ahora REMOVE GSI4PK, GSI4SK",
          ConditionExpression: "#estatus = :esperado",
          ExpressionAttributeNames: { "#estatus": "estatus" },
          ExpressionAttributeValues: {
            ":destino": destino,
            ":esperado": solicitud.estatus,
            ":ahora": ahora.toISOString(),
          },
        },
      },
      siFalla: "invalid_state",
      descripcion: `solicitud turno ${String(solicitud.turno)} sigue ${solicitud.estatus}`,
    },
    {
      item: {
        Delete: {
          TableName: tabla,
          // Retirar el centinela es lo que le permite volver a formarse con un
          // turno nuevo (R-07). Jamas recupera el anterior.
          Key: clave.centinelaFila(lote.loteId, solicitud.participanteId),
          ConditionExpression: "attribute_exists(SK)",
        },
      },
      siFalla: "conflicto_concurrencia",
      descripcion: "centinela de fila (R-07)",
    },
  ];

  if (liberaElLote) {
    items.push(...itemsDeLiberacion({ lote, solicitud, solicitudId, ahora }));
  }

  items.push(
    eventoParaTransaccion({
      tipo: "SOLICITUD_CANCELADA_POR_PARTICIPANTE",
      agregado: "LOTE",
      agregadoId: lote.loteId,
      actor: entrada.actor,
      ocurridoEn: ahora,
      correlacionId,
      convocatoriaId: lote.convocatoriaId,
      loteId: lote.loteId,
      solicitudId,
      vehiculoId: lote.vehiculoId,
      estadoAnterior: solicitud.estatus,
      estadoNuevo: destino,
      ...(entrada.motivo?.trim() ? { motivo: entrada.motivo } : {}),
      datos: { turno: solicitud.turno, liberoElLote: liberaElLote },
    }),
  );

  const resultado = await ejecutarTransaccion(items, deps);
  if (!resultado.ok) return fallo(resultado.error);

  if (!liberaElLote) {
    return exito({ estatus: destino, liberoElLote: false });
  }

  // Aqui iba `descongelarSolicitudes`. Ya no hace falta: con el cupo por
  // convocatoria nada se congelo nunca, y el decremento del item de cupo —que
  // viajo dentro de la transaccion de arriba— ya devolvio la unidad. Sus demas
  // solicitudes siguen `EN_FILA` y vuelven a ser candidatas con su turno
  // original en la reasignacion que sigue.
  const reasignacion = await adjudicarLote(
    {
      // El lote acaba de volver a `EN_OFERTA` y sin adjudicacion; se refleja en
      // la copia en memoria para que la condicion de T2 se evalue contra el
      // mismo estado que se acaba de escribir.
      lote: liberado(lote),
      motivo: "REASIGNACION_POR_CANCELACION",
    },
    deps,
  );

  return exito({ estatus: destino, liberoElLote: true, reasignacion });
};

/**
 * Copia del lote tal como quedo tras liberarlo.
 *
 * Los cuatro atributos se **eliminan**, no se ponen en `null`, por la misma
 * razon que en la escritura: `attribute_not_exists(adjudicacionActual)` es toda
 * la exclusion mutua del sistema, y un `null` es un atributo que existe.
 */
const liberado = (lote: Lote): Lote => {
  const copia: Lote = { ...lote, estatus: "EN_OFERTA" };
  delete copia.adjudicacionActual;
  delete copia.adjudicadoEn;
  delete copia.venceEn;
  delete copia.turnoAdjudicado;
  return copia;
};

/**
 * Los tres items que devuelven el lote a la oferta, y con el la unidad de cupo.
 *
 * La condicion del lote (`adjudicacionActual = :solicitudId`) es lo que hace
 * segura la operacion frente a concurrencia: si otro proceso ya reasigno el
 * lote —un vencimiento, por ejemplo— esta transaccion se cancela sin efectos y
 * la cancelacion falla entera, en vez de arrebatarle el vehiculo a quien acaba
 * de recibirlo.
 */
const itemsDeLiberacion = (entrada: {
  lote: Lote;
  solicitud: Solicitud;
  solicitudId: string;
  ahora: Date;
}): ItemDeTransaccion[] => {
  const { lote, solicitud, solicitudId, ahora } = entrada;
  const tabla = nombreDeTabla();
  const momento = ahora.toISOString();

  const destinoLote = transicion("lote", "ADJUDICADO", "LIBERAR");
  const destinoVehiculo = transicion("vehiculo", "RESERVADO", "LIBERAR");
  if (!destinoLote || !destinoVehiculo) {
    // Las dos transiciones existen en `proyecto.md` 5.2 y 5.3. Que falten
    // significa que alguien cambio la maquina de estados sin mirar aqui, y es
    // un defecto del codigo, no un estado del negocio.
    throw new Error("La maquina de estados ya no admite LIBERAR");
  }

  return [
    itemDeLiberacionDeCupo({
      participanteId: solicitud.participanteId,
      convocatoriaId: lote.convocatoriaId,
    }),
    {
      item: {
        Update: {
          TableName: tabla,
          Key: clave.lote(lote.convocatoriaId, lote.loteId),
          // `REMOVE` y nunca `= null`: toda la exclusion mutua depende de
          // `attribute_not_exists(adjudicacionActual)`, y un `null` es un
          // atributo que existe (modelo-datos 2.2).
          UpdateExpression:
            "SET #estatus = :enOferta, actualizadoEn = :momento" +
            " REMOVE adjudicacionActual, adjudicadoEn, venceEn, turnoAdjudicado",
          ConditionExpression: "adjudicacionActual = :solicitudId",
          ExpressionAttributeNames: { "#estatus": "estatus" },
          ExpressionAttributeValues: {
            ":enOferta": destinoLote,
            ":solicitudId": solicitudId,
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

export const __test__ = { liberado, itemsDeLiberacion };
