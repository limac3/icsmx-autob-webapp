import "server-only";

// Retiro de un vehiculo de una convocatoria en borrador. Es el inverso de
// `incluirVehiculo`, con la misma exigencia de atomicidad.
//
// **El lote no se borra: pasa a `RETIRADO`.** Borrarlo dejaria al auditor sin
// rastro de que ese vehiculo llego a estar incluido y a que precio, que es
// justo lo que la bitacora tiene que poder responder.

import { clave, gsi2 } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import { ejecutarTransaccion } from "@/lib/data/transacciones";
import { transicion } from "@/lib/domain/transiciones";
import type { ActorUsuario } from "@/types/auditoria";
import type { Convocatoria } from "@/types/convocatoria";
import type { Lote } from "@/types/lote";
import { exito, fallo, type Resultado } from "@/types/resultado";
import type { Vehiculo } from "@/types/vehiculo";

export type EntradaRetirarVehiculoDeConvocatoria = {
  convocatoria: Convocatoria;
  lote: Lote;
  vehiculo: Vehiculo;
  motivo: string;
  actor: ActorUsuario;
};

export const retirarVehiculoDeConvocatoria = async (
  entrada: EntradaRetirarVehiculoDeConvocatoria,
  deps: DepsDeServicio = {},
): Promise<Resultado<{ loteId: string }>> => {
  const { cliente, ahora } = resolver(deps);
  const { convocatoria, lote, vehiculo } = entrada;

  const motivo = entrada.motivo.trim();
  if (motivo.length === 0) {
    return fallo("validation_failed", { motivo: "requerido" });
  }

  const estatusDelLote = transicion("lote", lote.estatus, "RETIRAR");
  if (!estatusDelLote) return fallo("invalid_state");

  const estatusDelVehiculo = transicion(
    "vehiculo",
    vehiculo.estatus,
    "RETIRAR_DE_CONVOCATORIA",
  );
  if (!estatusDelVehiculo) return fallo("invalid_state");

  const momento = ahora.toISOString();

  const resultado = await ejecutarTransaccion(
    [
      {
        item: {
          // Liberar el centinela es lo que devuelve el vehiculo al mercado. Con
          // `attribute_exists` para que un doble retiro falle en vez de dejar
          // pasar en silencio una operacion que no tenia nada que deshacer.
          Delete: {
            TableName: nombreDeTabla(),
            Key: clave.centinelaVehiculoActivo(vehiculo.vehiculoId),
            ConditionExpression: "attribute_exists(SK)",
          },
        },
        siFalla: "invalid_state",
        descripcion: `centinela de ${vehiculo.vehiculoId}`,
      },
      {
        item: {
          Update: {
            TableName: nombreDeTabla(),
            Key: clave.lote(convocatoria.convocatoriaId, lote.loteId),
            UpdateExpression:
              "SET #estatus = :destino, #motivoRetiro = :motivo," +
              " #actualizadoEn = :momento, #actualizadoPor = :actor",
            ConditionExpression:
              "attribute_exists(SK) AND #estatus = :estatusEsperado",
            ExpressionAttributeNames: {
              "#estatus": "estatus",
              "#motivoRetiro": "motivoRetiro",
              "#actualizadoEn": "actualizadoEn",
              "#actualizadoPor": "actualizadoPor",
            },
            ExpressionAttributeValues: {
              ":destino": estatusDelLote,
              ":estatusEsperado": lote.estatus,
              ":motivo": motivo,
              ":momento": momento,
              ":actor": entrada.actor.id,
            },
          },
        },
        siFalla: "invalid_state",
        descripcion: `lote ${lote.loteId} en ${lote.estatus}`,
      },
      {
        item: {
          ConditionCheck: {
            TableName: nombreDeTabla(),
            Key: clave.convocatoria(convocatoria.convocatoriaId),
            ConditionExpression: "#estatus = :borrador",
            ExpressionAttributeNames: { "#estatus": "estatus" },
            ExpressionAttributeValues: { ":borrador": "BORRADOR" },
          },
        },
        siFalla: "invalid_state",
        descripcion: `convocatoria ${convocatoria.convocatoriaId} en BORRADOR`,
      },
      {
        item: {
          Update: {
            TableName: nombreDeTabla(),
            Key: clave.vehiculo(vehiculo.vehiculoId),
            // `convocatoriaId` se **elimina**, no se deja en blanco: el atributo
            // solo tiene sentido mientras el vehiculo esta en una convocatoria,
            // y una cadena vacia haria pensar que sigue en una sin nombre.
            UpdateExpression:
              "SET #estatus = :destino, #actualizadoEn = :momento," +
              " #actualizadoPor = :actor, #gsi2pk = :gsi2pk, #gsi2sk = :gsi2sk" +
              " REMOVE #convocatoriaId",
            ConditionExpression:
              "attribute_exists(PK) AND #estatus = :estatusEsperado",
            ExpressionAttributeNames: {
              "#estatus": "estatus",
              "#convocatoriaId": "convocatoriaId",
              "#actualizadoEn": "actualizadoEn",
              "#actualizadoPor": "actualizadoPor",
              "#gsi2pk": "GSI2PK",
              "#gsi2sk": "GSI2SK",
            },
            ExpressionAttributeValues: {
              ":destino": estatusDelVehiculo,
              ":estatusEsperado": vehiculo.estatus,
              ":momento": momento,
              ":actor": entrada.actor.id,
              ...(() => {
                const claves = gsi2.porEstatus(
                  "VEH",
                  estatusDelVehiculo,
                  vehiculo.creadoEn,
                  vehiculo.vehiculoId,
                );
                return { ":gsi2pk": claves.GSI2PK, ":gsi2sk": claves.GSI2SK };
              })(),
            },
          },
        },
        siFalla: "invalid_state",
        descripcion: `vehiculo ${vehiculo.vehiculoId} en ${vehiculo.estatus}`,
      },
      eventoParaTransaccion({
        tipo: "VEHICULO_RETIRADO_DE_CONVOCATORIA",
        agregado: "CONVOCATORIA",
        agregadoId: convocatoria.convocatoriaId,
        actor: entrada.actor,
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        convocatoriaId: convocatoria.convocatoriaId,
        vehiculoId: vehiculo.vehiculoId,
        loteId: lote.loteId,
        estadoAnterior: lote.estatus,
        estadoNuevo: estatusDelLote,
        motivo,
      }),
    ],
    { cliente },
  );

  if (!resultado.ok) return fallo(resultado.error);
  return exito({ loteId: lote.loteId });
};
