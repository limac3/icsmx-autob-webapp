import "server-only";

// Alta de una fotografia en la galeria de un vehiculo.

import { clave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  ejecutarTransaccion,
  type ItemDeTransaccion,
} from "@/lib/data/transacciones";
import {
  borrarObjeto,
  claveDeFotografia,
  esTipoDeImagen,
  guardarObjeto,
  MAXIMO_BYTES_FOTOGRAFIA,
  type DepsDeAlmacenamiento,
} from "@/lib/media/almacenamiento";
import { exito, fallo, type Resultado } from "@/types/resultado";
import type { VehiculoConFotografias } from "@/types/vehiculo";
import { resolver, type ActorUsuario, type DepsDeVehiculos } from "./deps";

/** Tope de fotografias por vehiculo. */
export const MAXIMO_FOTOGRAFIAS = 20;
export const LIMITE_DESCRIPCION = 200;

export type EntradaAgregarFotografia = {
  /** El vehiculo con su galeria, tal como se leyo para decidir el permiso. */
  actual: VehiculoConFotografias;
  archivo: { bytes: Uint8Array; contentType: string };
  esPrincipal?: boolean;
  descripcion?: string;
  actor: ActorUsuario;
};

/**
 * `cliente` es el de DynamoDB y `s3` el de S3.
 *
 * Se nombran distinto en vez de heredar dos veces un campo `cliente`: dos
 * dependencias con el mismo nombre y tipos incompatibles es justo la clase de
 * confusion que un dia inyecta el cliente equivocado.
 */
export type DepsAgregarFotografia = DepsDeVehiculos & {
  s3?: DepsDeAlmacenamiento["cliente"];
};

export const agregarFotografia = async (
  entrada: EntradaAgregarFotografia,
  deps: DepsAgregarFotografia = {},
): Promise<Resultado<{ fotoId: string }>> => {
  const { cliente, ahora, nuevoId } = resolver(deps);
  const { actual, archivo } = entrada;

  if (!esTipoDeImagen(archivo.contentType)) {
    return fallo("validation_failed", { archivo: "tipo_no_admitido" });
  }
  if (archivo.bytes.byteLength === 0) {
    return fallo("validation_failed", { archivo: "vacio" });
  }
  if (archivo.bytes.byteLength > MAXIMO_BYTES_FOTOGRAFIA) {
    return fallo("validation_failed", { archivo: "muy_grande" });
  }
  if (actual.fotografias.length >= MAXIMO_FOTOGRAFIAS) {
    return fallo("validation_failed", { fotografias: "demasiadas" });
  }
  const descripcion = entrada.descripcion?.trim();
  if (descripcion && descripcion.length > LIMITE_DESCRIPCION) {
    return fallo("validation_failed", { descripcion: "muy_largo" });
  }

  const fotoId = nuevoId();
  const claveS3 = claveDeFotografia(
    actual.vehiculoId,
    fotoId,
    archivo.contentType,
  );

  // La primera fotografia es la principal aunque nadie lo pida: un vehiculo con
  // galeria y sin principal no se puede representar en el listado, y dejar esa
  // decision para despues produce tarjetas sin imagen.
  const seraPrincipal =
    entrada.esPrincipal === true || actual.fotografias.length === 0;

  // El orden es de presentacion, no una garantia: dos subidas simultaneas
  // pueden reclamar el mismo numero y quedar empatadas —el `fotoId` desempata
  // la clave, asi que no se pierde ninguna— y `reordenarFotografias` lo
  // resuelve. No confundir con el turno de la fila, donde el orden **es** la
  // regla y por eso viene de un contador atomico.
  const orden =
    actual.fotografias.reduce((mayor, foto) => Math.max(mayor, foto.orden), 0) +
    1;

  const momento = ahora.toISOString();

  // S3 primero, DynamoDB despues. El criterio es no dejar nunca una
  // **referencia colgante**: al reves, un fallo de S3 dejaria un item de
  // fotografia apuntando a un objeto inexistente y la galeria mostraria una
  // imagen rota. Un objeto huerfano en S3 es invisible —nadie firmara jamas su
  // URL— y ademas se compensa abajo.
  await guardarObjeto(
    { clave: claveS3, cuerpo: archivo.bytes, contentType: archivo.contentType },
    { cliente: deps.s3 },
  );

  const items: ItemDeTransaccion[] = [
    {
      item: {
        Put: {
          TableName: nombreDeTabla(),
          Item: {
            ...clave.fotografia(actual.vehiculoId, orden, fotoId),
            fotoId,
            vehiculoId: actual.vehiculoId,
            orden,
            claveS3,
            contentType: archivo.contentType,
            bytes: archivo.bytes.byteLength,
            descripcion,
            subidaEn: momento,
            subidaPor: entrada.actor.id,
          },
          ConditionExpression: "attribute_not_exists(SK)",
        },
      },
      siFalla: "conflicto_concurrencia",
      descripcion: `fotografia ${fotoId}`,
    },
    {
      item: {
        Update: {
          TableName: nombreDeTabla(),
          Key: clave.vehiculo(actual.vehiculoId),
          UpdateExpression: seraPrincipal
            ? "SET #principal = :fotoId, #actualizadoEn = :momento, #actualizadoPor = :actor"
            : "SET #actualizadoEn = :momento, #actualizadoPor = :actor",
          ConditionExpression:
            "attribute_exists(PK) AND #estatus = :estatusEsperado",
          ExpressionAttributeNames: {
            "#estatus": "estatus",
            "#actualizadoEn": "actualizadoEn",
            "#actualizadoPor": "actualizadoPor",
            ...(seraPrincipal ? { "#principal": "fotografiaPrincipalId" } : {}),
          },
          ExpressionAttributeValues: {
            ":estatusEsperado": actual.estatus,
            ":momento": momento,
            ":actor": entrada.actor.id,
            ...(seraPrincipal ? { ":fotoId": fotoId } : {}),
          },
        },
      },
      siFalla: "invalid_state",
      descripcion: `vehiculo ${actual.vehiculoId} en ${actual.estatus}`,
    },
    eventoParaTransaccion({
      tipo: "VEHICULO_FOTOGRAFIA_AGREGADA",
      agregado: "VEHICULO",
      agregadoId: actual.vehiculoId,
      actor: entrada.actor,
      ocurridoEn: ahora,
      correlacionId: nuevaCorrelacion(ahora),
      vehiculoId: actual.vehiculoId,
      datos: { fotoId, orden, esPrincipal: seraPrincipal, claveS3 },
    }),
  ];

  const resultado = await ejecutarTransaccion(items, { cliente });

  if (!resultado.ok) {
    // Compensacion de mejor esfuerzo. Si tambien falla, queda un objeto
    // inalcanzable en un bucket versionado, que es el peor caso aceptable.
    await borrarObjeto(claveS3, { cliente: deps.s3 }).catch(() => undefined);
    return fallo(resultado.error);
  }

  return exito({ fotoId });
};
