import "server-only";

// Cambia el pie de una fotografia de la galeria.
//
// **La fotografia no es editable; su pie si.** Los bytes de una fotografia son
// inmutables —se borra y se sube otra, con identificador nuevo, nunca se
// sobrescribe una clave— y eso no es una eleccion de interfaz: es lo que hace
// correctas las claves estables de S3 y el `CACHE_DE_FOTOGRAFIA` con el que se
// sirven (`almacenamiento.ts`). La descripcion no es parte de los bytes: vive en
// el item de DynamoDB, asi que editarla **no toca S3**.
//
// No estaba en `api-contracts.md`: el contrato solo permitia fijar el pie **al
// subir**. Sin esta operacion, corregir una errata exigia borrar la fotografia
// y volver a subirla, que ademas le cambia el `fotoId` y la manda al final de
// la galeria.

import { clave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import { ejecutarTransaccion } from "@/lib/data/transacciones";
import { LIMITES } from "@/lib/domain/vehiculos";
import { exito, fallo, type Resultado } from "@/types/resultado";
import type { VehiculoConFotografias } from "@/types/vehiculo";
import { resolver, type ActorUsuario, type DepsDeVehiculos } from "./deps";

export type EntradaEditarDescripcion = {
  actual: VehiculoConFotografias;
  fotoId: string;
  /** Vacio o solo espacios significa **quitar** el pie. */
  descripcion?: string;
  actor: ActorUsuario;
};

export const editarDescripcionFotografia = async (
  entrada: EntradaEditarDescripcion,
  deps: DepsDeVehiculos = {},
): Promise<Resultado<{ fotoId: string }>> => {
  const { cliente, ahora } = resolver(deps);
  const { actual, fotoId } = entrada;

  // El item del vehiculo **no** se toca: `actualizadoEn` describe el registro
  // del vehiculo y el pie de una fotografia no lo cambia. Meterlo en esta
  // transaccion no daria nada y la haria competir con otras escrituras del
  // mismo vehiculo.

  // Contra la galeria leida y no solo contra la clave, igual que en
  // `marcarFotografiaPrincipal`: hace falta el `orden` para armar la `SK`, y
  // ademas responde `not_found` a un `fotoId` de otro vehiculo.
  const foto = actual.fotografias.find((una) => una.fotoId === fotoId);
  if (!foto) return fallo("not_found");

  const recortada = entrada.descripcion?.trim();
  if (recortada && recortada.length > LIMITES.descripcionFotografia) {
    return fallo("validation_failed", { descripcion: "muy_largo" });
  }

  // Cadena vacia y ausente son lo mismo: quitar el pie.
  const nueva = recortada && recortada.length > 0 ? recortada : undefined;
  const anterior = foto.descripcion;

  if (nueva === anterior) {
    // Sin evento: una bitacora que registra actos sin efecto entrena a quien la
    // lee a ignorarla. Mismo criterio que `marcarFotografiaPrincipal`.
    return exito({ fotoId });
  }

  // **`REMOVE` al vaciar, no `SET` a cadena vacia.** `descripcion` es opcional
  // en el tipo, y guardar `""` deja un dato que se comporta como ausente sin
  // serlo: `aFotografia` lo mapearia a `undefined` de todas formas, pero el item
  // quedaria con basura que alguien tendria que explicar. Son dos expresiones
  // distintas segun el valor, no una con truco.
  const actualizacion = nueva
    ? {
        UpdateExpression: "SET #descripcion = :descripcion",
        ExpressionAttributeValues: { ":descripcion": nueva },
      }
    : { UpdateExpression: "REMOVE #descripcion" };

  const resultado = await ejecutarTransaccion(
    [
      {
        item: {
          Update: {
            TableName: nombreDeTabla(),
            Key: clave.fotografia(actual.vehiculoId, foto.orden, fotoId),
            ...actualizacion,
            ConditionExpression: "attribute_exists(SK)",
            ExpressionAttributeNames: { "#descripcion": "descripcion" },
          },
        },
        siFalla: "conflicto_concurrencia",
        descripcion: `fotografia ${fotoId}`,
      },
      eventoParaTransaccion({
        // Sin tipo de evento nuevo: `marcarFotografiaPrincipal` ya establecio
        // que un cambio de campo sobre la galeria es un `VEHICULO_EDITADO` con
        // el campo, el valor anterior y el nuevo. Se agrega el `fotoId` para
        // que la bitacora diga de que fotografia se habla.
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
          campos: ["fotografia.descripcion"],
          fotoId,
          anterior: anterior ?? null,
          nueva: nueva ?? null,
        },
      }),
    ],
    { cliente },
  );

  if (!resultado.ok) return fallo(resultado.error);

  return exito({ fotoId });
};
