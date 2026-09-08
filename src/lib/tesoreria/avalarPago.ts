import "server-only";

// T4 — avalar pago. `modelo-datos-dynamodb.md` seccion 6.
//
// Cierra la venta: la solicitud queda `VENDIDA`, el lote y el vehiculo pasan a
// `VENDIDO`, y los dos centinelas que sostenian la exclusion mutua de R-09 y
// R-10 se retiran porque ya cumplieron su proposito.
//
// **Corrige el documento en un punto, igual que T2 lo hizo con `RESERVADO`.**
// El documento no menciona retirar las claves de GSI2 de la solicitud. Sin
// eso, una solicitud `VENDIDA` seguiria apareciendo en la particion
// `SOL_ESTATUS#EN_VERIFICACION` de PA-11 — la bandeja de tesoreria mostraria
// trabajo ya resuelto. GSI2 aqui es disperso por la misma razon que GSI4
// (modelo-datos 3): sus claves solo existen mientras la solicitud espera
// dictamen.

import { clave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import { ejecutarTransaccion } from "@/lib/data/transacciones";
import { transicion } from "@/lib/domain/transiciones";
import { cerrarFilaDelLote } from "@/lib/fila/cerrarFilaDelLote";
import type { ActorUsuario } from "@/types/auditoria";
import type { Solicitud } from "@/types/fila";
import type { Lote } from "@/types/lote";
import type { EstatusSolicitud } from "@/types/solicitud";
import { exito, fallo, type Resultado } from "@/types/resultado";

export type EntradaAvalarPago = {
  /** El lote ya leido por quien invoca, el mismo que evaluo el permiso. */
  lote: Lote;
  /** La solicitud, en `EN_VERIFICACION`. */
  solicitud: Solicitud;
  nota?: string;
  actor: ActorUsuario;
};

export type ResultadoDeAval = {
  /** El destino sale de `transicion(...)`, no de una constante local. */
  estatus: EstatusSolicitud;
  /** Cuantas solicitudes `EN_FILA`/`CONGELADA` del lote pasaron a `NO_ADJUDICADA`. */
  cerradas: number;
};

export const avalarPago = async (
  entrada: EntradaAvalarPago,
  deps: DepsDeServicio = {},
): Promise<Resultado<ResultadoDeAval>> => {
  const { ahora } = resolver(deps);
  const { lote, solicitud } = entrada;
  const tabla = nombreDeTabla();
  const momento = ahora.toISOString();

  // El origen sale de `solicitud.estatus`, no de una constante: si la
  // solicitud ya no esta `EN_VERIFICACION`, la transicion no existe y es un
  // estado del negocio (`invalid_state`), no un defecto de la maquina. Se
  // comprueba **antes** de escribir nada, igual que `cancelarSolicitud`.
  const destinoSolicitud = transicion(
    "solicitud",
    solicitud.estatus,
    "AVALAR_PAGO",
  );
  if (!destinoSolicitud) return fallo("invalid_state");

  const destinoLote = transicion("lote", "ADJUDICADO", "AVALAR_PAGO");
  const destinoVehiculo = transicion("vehiculo", "RESERVADO", "AVALAR_PAGO");
  if (!destinoLote || !destinoVehiculo) {
    // Las dos transiciones existen en proyecto.md 5.2 y 5.3. Que falte
    // alguna es un defecto del codigo, no un estado del negocio.
    throw new Error("La maquina de estados ya no admite AVALAR_PAGO");
  }

  const resultado = await ejecutarTransaccion(
    [
      {
        item: {
          Update: {
            TableName: tabla,
            Key: clave.solicitud(lote.loteId, solicitud.turno),
            UpdateExpression:
              "SET #estatus = :vendida, vendidaEn = :momento" +
              " REMOVE GSI2PK, GSI2SK",
            ConditionExpression: "#estatus = :enVerificacion",
            ExpressionAttributeNames: { "#estatus": "estatus" },
            ExpressionAttributeValues: {
              ":vendida": destinoSolicitud,
              ":enVerificacion": "EN_VERIFICACION",
              ":momento": momento,
            },
          },
        },
        siFalla: "invalid_state",
        descripcion: `solicitud ${solicitud.solicitudId} sigue EN_VERIFICACION`,
      },
      {
        item: {
          Update: {
            TableName: tabla,
            Key: clave.lote(lote.convocatoriaId, lote.loteId),
            UpdateExpression:
              "SET #estatus = :vendido, actualizadoEn = :momento",
            ConditionExpression:
              "#estatus = :adjudicado AND adjudicacionActual = :solicitudId",
            ExpressionAttributeNames: { "#estatus": "estatus" },
            ExpressionAttributeValues: {
              ":vendido": destinoLote,
              ":adjudicado": "ADJUDICADO",
              ":solicitudId": solicitud.solicitudId,
              ":momento": momento,
            },
          },
        },
        siFalla: "invalid_state",
        descripcion: "el lote sigue adjudicado a esta solicitud",
      },
      {
        item: {
          Update: {
            TableName: tabla,
            Key: clave.vehiculo(lote.vehiculoId),
            UpdateExpression:
              "SET #estatus = :vendido, actualizadoEn = :momento",
            ConditionExpression: "#estatus = :reservado",
            ExpressionAttributeNames: { "#estatus": "estatus" },
            ExpressionAttributeValues: {
              ":vendido": destinoVehiculo,
              ":reservado": "RESERVADO",
              ":momento": momento,
            },
          },
        },
        siFalla: "invalid_state",
        descripcion: "vehiculo RESERVADO pasa a VENDIDO",
      },
      {
        item: {
          Delete: {
            TableName: tabla,
            Key: clave.centinelaAdjudicacion(solicitud.participanteId),
            ConditionExpression: "attribute_exists(SK)",
          },
        },
        siFalla: "conflicto_concurrencia",
        descripcion: "centinela de adjudicacion activa (R-09)",
      },
      {
        item: {
          Delete: {
            TableName: tabla,
            Key: clave.centinelaVehiculoActivo(lote.vehiculoId),
            ConditionExpression: "attribute_exists(SK)",
          },
        },
        siFalla: "conflicto_concurrencia",
        descripcion: "centinela de vehiculo activo (R-10)",
      },
      eventoParaTransaccion({
        tipo: "PAGO_AVALADO",
        agregado: "LOTE",
        agregadoId: lote.loteId,
        actor: entrada.actor,
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        convocatoriaId: lote.convocatoriaId,
        loteId: lote.loteId,
        solicitudId: solicitud.solicitudId,
        vehiculoId: lote.vehiculoId,
        estadoAnterior: "EN_VERIFICACION",
        estadoNuevo: "VENDIDA",
        ...(entrada.nota?.trim()
          ? { datos: { nota: entrada.nota.trim() } }
          : {}),
      }),
    ],
    deps,
  );

  if (!resultado.ok) return fallo(resultado.error);

  // Fuera de la transaccion: son una cantidad no acotada
  // (modelo-datos-dynamodb.md T4). El lote ya quedo VENDIDO; se refleja en la
  // copia en memoria que recibe `cerrarFilaDelLote`, aunque esa funcion no
  // mira el estatus del lote para decidir que cerrar.
  const cierre = await cerrarFilaDelLote(
    { lote: { ...lote, estatus: destinoLote }, actor: entrada.actor },
    deps,
  );

  return exito({
    estatus: destinoSolicitud,
    cerradas: cierre.ok ? cierre.data : 0,
  });
};
