import "server-only";

// Retiro de un vehiculo del catalogo. `RETIRADO` es terminal en la maquina de
// `proyecto.md` 5.2: no hay evento que lo devuelva a `DISPONIBLE`.

import { clave, gsi2 } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import { ejecutarTransaccion } from "@/lib/data/transacciones";
import { transicion } from "@/lib/domain/transiciones";
import { exito, fallo, type Resultado } from "@/types/resultado";
import type { Vehiculo } from "@/types/vehiculo";
import { resolver, type ActorUsuario, type DepsDeVehiculos } from "./deps";

export type EntradaRetirarVehiculo = {
  actual: Vehiculo;
  motivo: string;
  actor: ActorUsuario;
};

export const retirarVehiculo = async (
  entrada: EntradaRetirarVehiculo,
  deps: DepsDeVehiculos = {},
): Promise<Resultado<{ vehiculoId: string }>> => {
  const { cliente, ahora } = resolver(deps);
  const { actual } = entrada;

  const motivo = entrada.motivo.trim();
  if (motivo.length === 0) {
    // `VEHICULO_RETIRADO` esta marcado con **M** en el catalogo. Se rechaza aqui
    // como error de negocio —la interfaz puede pedirlo de nuevo— en vez de dejar
    // que `atributosDeEvento` lance, que es una red de seguridad para defectos
    // del codigo, no para capturas incompletas.
    return fallo("validation_failed", { motivo: "requerido" });
  }

  // La transicion valida es la unica autoridad sobre a donde se puede ir. Que la
  // guarda de `vehiculo:retirar` ya exija `DISPONIBLE` no la hace redundante:
  // una es politica de permisos y esta es la maquina de estados.
  const destino = transicion(
    "vehiculo",
    actual.estatus,
    "RETIRAR_DEL_CATALOGO",
  );
  if (!destino) return fallo("invalid_state");

  const momento = ahora.toISOString();

  const resultado = await ejecutarTransaccion(
    [
      {
        item: {
          Update: {
            TableName: nombreDeTabla(),
            Key: clave.vehiculo(actual.vehiculoId),
            UpdateExpression:
              "SET #estatus = :destino, #motivoRetiro = :motivo," +
              " #actualizadoEn = :momento, #actualizadoPor = :actor," +
              " #gsi2pk = :gsi2pk, #gsi2sk = :gsi2sk",
            ConditionExpression:
              "attribute_exists(PK) AND #estatus = :estatusEsperado",
            ExpressionAttributeNames: {
              "#estatus": "estatus",
              "#motivoRetiro": "motivoRetiro",
              "#actualizadoEn": "actualizadoEn",
              "#actualizadoPor": "actualizadoPor",
              "#gsi2pk": "GSI2PK",
              "#gsi2sk": "GSI2SK",
            },
            ExpressionAttributeValues: {
              ":destino": destino,
              ":estatusEsperado": actual.estatus,
              ":motivo": motivo,
              ":momento": momento,
              ":actor": entrada.actor.id,
              // El cambio de estatus mueve el item de particion en GSI2: si no
              // se reescribieran estas claves, el vehiculo seguiria apareciendo
              // en el listado de `DISPONIBLE` (PA-03) para siempre.
              ...(() => {
                const claves = gsi2.porEstatus(
                  "VEH",
                  destino,
                  actual.creadoEn,
                  actual.vehiculoId,
                );
                return { ":gsi2pk": claves.GSI2PK, ":gsi2sk": claves.GSI2SK };
              })(),
            },
          },
        },
        siFalla: "invalid_state",
        descripcion: `vehiculo ${actual.vehiculoId} en ${actual.estatus}`,
      },
      eventoParaTransaccion({
        tipo: "VEHICULO_RETIRADO",
        agregado: "VEHICULO",
        agregadoId: actual.vehiculoId,
        actor: entrada.actor,
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        vehiculoId: actual.vehiculoId,
        estadoAnterior: actual.estatus,
        estadoNuevo: destino,
        motivo,
      }),
    ],
    { cliente },
  );

  if (!resultado.ok) return fallo(resultado.error);
  return exito({ vehiculoId: actual.vehiculoId });
};
