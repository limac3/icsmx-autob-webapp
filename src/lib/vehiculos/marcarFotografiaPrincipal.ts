import "server-only";

// Designa cual fotografia representa al vehiculo.
//
// No estaba en `api-contracts.md`: el contrato solo permitia fijar la principal
// **al subirla** (`agregarFotografia` con `esPrincipal`). La pantalla 4.2 de
// `ui-ux-requerimientos.md` pide "marcar principal" sobre la galeria ya
// existente, y sin esta operacion la unica forma de cambiarla seria borrar y
// volver a subir. Se agrego al contrato al implementar la Etapa 5.

import { clave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import { ejecutarTransaccion } from "@/lib/data/transacciones";
import { exito, fallo, type Resultado } from "@/types/resultado";
import type { VehiculoConFotografias } from "@/types/vehiculo";
import { resolver, type ActorUsuario, type DepsDeVehiculos } from "./deps";

export type EntradaMarcarPrincipal = {
  actual: VehiculoConFotografias;
  fotoId: string;
  actor: ActorUsuario;
};

export const marcarFotografiaPrincipal = async (
  entrada: EntradaMarcarPrincipal,
  deps: DepsDeVehiculos = {},
): Promise<Resultado<{ fotoId: string }>> => {
  const { cliente, ahora } = resolver(deps);
  const { actual, fotoId } = entrada;

  // Se comprueba contra la galeria leida y no solo contra la clave: apuntar la
  // principal a una fotografia inexistente dejaria el listado sin imagen y sin
  // error visible.
  if (!actual.fotografias.some((foto) => foto.fotoId === fotoId)) {
    return fallo("not_found");
  }

  if (actual.fotografiaPrincipalId === fotoId) {
    // Ya lo es. Sin evento: una bitacora que registra actos sin efecto entrena
    // a quien la lee a ignorarla.
    return exito({ fotoId });
  }

  const momento = ahora.toISOString();

  const resultado = await ejecutarTransaccion(
    [
      {
        item: {
          Update: {
            TableName: nombreDeTabla(),
            Key: clave.vehiculo(actual.vehiculoId),
            UpdateExpression:
              "SET #principal = :fotoId, #actualizadoEn = :momento," +
              " #actualizadoPor = :actor",
            ConditionExpression:
              "attribute_exists(PK) AND #estatus = :estatusEsperado",
            ExpressionAttributeNames: {
              "#principal": "fotografiaPrincipalId",
              "#estatus": "estatus",
              "#actualizadoEn": "actualizadoEn",
              "#actualizadoPor": "actualizadoPor",
            },
            ExpressionAttributeValues: {
              ":fotoId": fotoId,
              ":estatusEsperado": actual.estatus,
              ":momento": momento,
              ":actor": entrada.actor.id,
            },
          },
        },
        siFalla: "invalid_state",
        descripcion: `vehiculo ${actual.vehiculoId} en ${actual.estatus}`,
      },
      eventoParaTransaccion({
        tipo: "VEHICULO_EDITADO",
        agregado: "VEHICULO",
        agregadoId: actual.vehiculoId,
        actor: entrada.actor,
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        vehiculoId: actual.vehiculoId,
        estadoAnterior: actual.estatus,
        estadoNuevo: actual.estatus,
        datos: {
          campos: ["fotografiaPrincipalId"],
          anterior: actual.fotografiaPrincipalId ?? null,
          nueva: fotoId,
        },
      }),
    ],
    { cliente },
  );

  if (!resultado.ok) return fallo(resultado.error);
  return exito({ fotoId });
};
