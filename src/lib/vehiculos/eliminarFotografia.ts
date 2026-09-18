import "server-only";

// Baja de una fotografia de la galeria.

import { clave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import { ejecutarTransaccion } from "@/lib/data/transacciones";
import { clavesDeLaFotografia } from "@/lib/domain/vehiculos";
import {
  borrarObjetos,
  type DepsDeAlmacenamiento,
} from "@/lib/media/almacenamiento";
import { exito, fallo, type Resultado } from "@/types/resultado";
import type { Fotografia, VehiculoConFotografias } from "@/types/vehiculo";
import { resolver, type ActorUsuario, type DepsDeVehiculos } from "./deps";

export type EntradaEliminarFotografia = {
  actual: VehiculoConFotografias;
  fotoId: string;
  actor: ActorUsuario;
};

export type DepsEliminarFotografia = DepsDeVehiculos & {
  s3?: DepsDeAlmacenamiento["cliente"];
};

/**
 * Quien hereda la condicion de principal cuando se borra la que la tenia.
 *
 * La de menor orden: es la que el administrador ya coloco primero, asi que
 * promoverla no altera la galeria que compuso.
 */
export const sucesoraPrincipal = (
  fotografias: readonly Fotografia[],
  eliminada: string,
): Fotografia | undefined =>
  fotografias
    .filter((foto) => foto.fotoId !== eliminada)
    .reduce<Fotografia | undefined>(
      (mejor, foto) => (!mejor || foto.orden < mejor.orden ? foto : mejor),
      undefined,
    );

export const eliminarFotografia = async (
  entrada: EntradaEliminarFotografia,
  deps: DepsEliminarFotografia = {},
): Promise<Resultado<{ fotoId: string }>> => {
  const { cliente, ahora } = resolver(deps);
  const { actual, fotoId } = entrada;

  const foto = actual.fotografias.find((una) => una.fotoId === fotoId);
  if (!foto) return fallo("not_found");

  // `api-contracts.md`: rechaza si dejaria al vehiculo sin fotografia
  // principal. Borrar la principal teniendo otras **no** lo deja sin ella,
  // porque abajo se promueve la siguiente; el unico caso que si lo dejaria es
  // borrar la ultima que queda. Es tambien lo que describe la pantalla: "no se
  // puede eliminar la ultima".
  if (actual.fotografias.length === 1) {
    return fallo("invalid_state", { fotografias: "es_la_ultima" });
  }

  const eraPrincipal = actual.fotografiaPrincipalId === fotoId;
  const sucesora = eraPrincipal
    ? sucesoraPrincipal(actual.fotografias, fotoId)
    : undefined;
  const momento = ahora.toISOString();

  const resultado = await ejecutarTransaccion(
    [
      {
        item: {
          Delete: {
            TableName: nombreDeTabla(),
            Key: clave.fotografia(actual.vehiculoId, foto.orden, fotoId),
            // Si ya no esta, otro la borro: la transaccion se cancela en vez de
            // escribir un evento de una baja que no ocurrio.
            ConditionExpression: "attribute_exists(SK)",
          },
        },
        siFalla: "not_found",
        descripcion: `fotografia ${fotoId}`,
      },
      {
        item: {
          Update: {
            TableName: nombreDeTabla(),
            Key: clave.vehiculo(actual.vehiculoId),
            UpdateExpression: sucesora
              ? "SET #principal = :sucesora, #actualizadoEn = :momento, #actualizadoPor = :actor"
              : "SET #actualizadoEn = :momento, #actualizadoPor = :actor",
            ConditionExpression:
              "attribute_exists(PK) AND #estatus = :estatusEsperado",
            ExpressionAttributeNames: {
              "#estatus": "estatus",
              "#actualizadoEn": "actualizadoEn",
              "#actualizadoPor": "actualizadoPor",
              ...(sucesora ? { "#principal": "fotografiaPrincipalId" } : {}),
            },
            ExpressionAttributeValues: {
              ":estatusEsperado": actual.estatus,
              ":momento": momento,
              ":actor": entrada.actor.id,
              ...(sucesora ? { ":sucesora": sucesora.fotoId } : {}),
            },
          },
        },
        siFalla: "invalid_state",
        descripcion: `vehiculo ${actual.vehiculoId} en ${actual.estatus}`,
      },
      eventoParaTransaccion({
        tipo: "VEHICULO_FOTOGRAFIA_ELIMINADA",
        agregado: "VEHICULO",
        agregadoId: actual.vehiculoId,
        actor: entrada.actor,
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        vehiculoId: actual.vehiculoId,
        datos: {
          fotoId,
          eraPrincipal,
          nuevaPrincipal: sucesora?.fotoId ?? null,
          claveS3: foto.claveS3,
          // Las tres claves, no solo la principal: si el borrado de S3 de abajo
          // falla, este evento es lo unico que queda diciendo que objetos
          // habia que borrar. Sin ellas, recuperarlo exigiria reconstruir las
          // claves a mano desde el `fotoId`.
          clavesDeVariantes: clavesDeLaFotografia(foto),
        },
      }),
    ],
    { cliente },
  );

  if (!resultado.ok) return fallo(resultado.error);

  // DynamoDB primero, S3 despues: al reves, un fallo de la transaccion dejaria
  // un item apuntando a un objeto ya borrado y la galeria mostraria una imagen
  // rota. Asi, lo peor que queda es un objeto sin referencia, que nadie puede
  // alcanzar porque su URL nunca se vuelve a firmar.
  //
  // Se borran las **tres variantes**: una fotografia es un item y tres objetos.
  await borrarObjetos(clavesDeLaFotografia(foto), { cliente: deps.s3 });

  return exito({ fotoId });
};
