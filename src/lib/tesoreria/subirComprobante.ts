import "server-only";

// T3 — subir comprobante. `modelo-datos-dynamodb.md` seccion 6.
//
// "Una vez en verificacion, el plazo deja de correr" (proyecto.md 5.4): esta
// es la unica escritura que lo detiene, retirando las claves de GSI4 en la
// misma transaccion que cambia el estatus. Tesoreria ya no puede vencer al
// participante por su propia demora.
//
// **S3 primero, DynamoDB despues** — mismo criterio que `agregarFotografia`—,
// pero con una asimetria deliberada: **no hay compensacion.** La politica IAM
// del rol de la aplicacion niega `s3:DeleteObject` sobre `comprobantes/*`
// (`amplify/permisos.ts`, sid `NegarBorradoDeComprobantes`): un comprobante de
// pago es evidencia, y que la aplicacion ni siquiera pueda intentar borrarlo
// es la garantia, no un descuido. Si la transaccion de DynamoDB falla despues
// de subir el archivo, el objeto queda huerfano en S3 — el peor caso
// aceptable, y el mismo que documenta `agregarFotografia` para su propia
// compensacion de mejor esfuerzo.

import { clave, gsi2 } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import { ejecutarTransaccion } from "@/lib/data/transacciones";
import { desdeIso } from "@/lib/domain/fechas";
import { dentroDePlazo } from "@/lib/domain/plazos";
import {
  claveDeComprobante,
  esTipoDeComprobante,
  guardarObjeto,
  MAXIMO_BYTES_COMPROBANTE,
  type DepsDeAlmacenamiento,
} from "@/lib/media/almacenamiento";
import type { ActorUsuario } from "@/types/auditoria";
import type { Solicitud } from "@/types/fila";
import {
  exito,
  fallo,
  type CodigoError,
  type Resultado,
} from "@/types/resultado";

export type ArchivoDeComprobante = { bytes: Uint8Array; contentType: string };

export type EntradaSubirComprobante = {
  /** La solicitud propia, ya leida por quien invoca al evaluar el permiso. */
  solicitud: Solicitud;
  archivo: ArchivoDeComprobante;
  actor: ActorUsuario;
};

export type DepsSubirComprobante = DepsDeServicio & {
  s3?: DepsDeAlmacenamiento["cliente"];
};

/**
 * Por que fallaria la condicion del paso 1, con lo que ya se sabe de la
 * solicitud.
 *
 * Mismo criterio que `motivoDelRechazo` de `solicitarCompra.ts`: no es una
 * decision —la unica autoridad es la condicion de la transaccion—, es la
 * explicacion que se le puede dar a quien pregunta sin releer nada. Distinguir
 * `plazo_vencido` de `invalid_state` importa porque son historias distintas
 * para el participante (api-contracts.md 5), y un `ConditionalCheckFailed`
 * compuesto no dice por si solo cual de las dos patas fallo.
 */
const motivoDelRechazo = (solicitud: Solicitud, ahora: Date): CodigoError => {
  if (solicitud.estatus !== "ADJUDICADA") return "invalid_state";
  const venceEn = solicitud.venceEn ? desdeIso(solicitud.venceEn) : undefined;
  if (!venceEn || !dentroDePlazo(venceEn, ahora)) return "plazo_vencido";
  return "conflicto_concurrencia";
};

export const subirComprobante = async (
  entrada: EntradaSubirComprobante,
  deps: DepsSubirComprobante = {},
): Promise<Resultado<{ estatus: "EN_VERIFICACION" }>> => {
  const { ahora, nuevoId } = resolver(deps);
  const { solicitud, archivo } = entrada;

  if (!esTipoDeComprobante(archivo.contentType)) {
    return fallo("validation_failed", { archivo: "tipo_no_admitido" });
  }
  if (archivo.bytes.byteLength === 0) {
    return fallo("validation_failed", { archivo: "vacio" });
  }
  if (archivo.bytes.byteLength > MAXIMO_BYTES_COMPROBANTE) {
    return fallo("validation_failed", { archivo: "muy_grande" });
  }

  const archivoId = nuevoId();
  const claveS3 = claveDeComprobante(
    solicitud.solicitudId,
    archivoId,
    archivo.contentType,
  );
  const subidaEn = ahora.toISOString();
  // GSI2 — PA-11, la bandeja de tesoreria. La fecha es cuando entro en
  // verificacion: es lo que la ordena, mas antiguas primero
  // (ui-ux-requerimientos.md seccion 6).
  const clavesGsi2 = gsi2.porEstatus(
    "SOL",
    "EN_VERIFICACION",
    subidaEn,
    solicitud.solicitudId,
  );

  await guardarObjeto(
    { clave: claveS3, cuerpo: archivo.bytes, contentType: archivo.contentType },
    { cliente: deps.s3 },
  );

  const resultado = await ejecutarTransaccion(
    [
      {
        item: {
          Update: {
            TableName: nombreDeTabla(),
            Key: clave.solicitud(solicitud.loteId, solicitud.turno),
            UpdateExpression:
              "SET #estatus = :enVerificacion, comprobanteClaveS3 = :claveS3," +
              " comprobanteSubidoEn = :subidaEn, GSI2PK = :gsi2pk, GSI2SK = :gsi2sk" +
              " REMOVE GSI4PK, GSI4SK",
            ConditionExpression: "#estatus = :adjudicada AND venceEn > :ahora",
            ExpressionAttributeNames: { "#estatus": "estatus" },
            ExpressionAttributeValues: {
              ":enVerificacion": "EN_VERIFICACION",
              ":adjudicada": "ADJUDICADA",
              ":claveS3": claveS3,
              ":subidaEn": subidaEn,
              ":ahora": subidaEn,
              ":gsi2pk": clavesGsi2.GSI2PK,
              ":gsi2sk": clavesGsi2.GSI2SK,
            },
          },
        },
        siFalla: motivoDelRechazo(solicitud, ahora),
        descripcion: `solicitud ${solicitud.solicitudId} sigue ADJUDICADA y en plazo`,
      },
      eventoParaTransaccion({
        tipo: "COMPROBANTE_CARGADO",
        agregado: "LOTE",
        agregadoId: solicitud.loteId,
        actor: entrada.actor,
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        loteId: solicitud.loteId,
        solicitudId: solicitud.solicitudId,
        estadoAnterior: "ADJUDICADA",
        estadoNuevo: "EN_VERIFICACION",
        datos: { claveS3, subidaEn },
      }),
    ],
    deps,
  );

  if (!resultado.ok) return fallo(resultado.error);
  return exito({ estatus: "EN_VERIFICACION" });
};

export const __test__ = { motivoDelRechazo };
