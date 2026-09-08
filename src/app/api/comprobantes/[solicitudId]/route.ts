import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";

import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import { ejecutarTransaccion } from "@/lib/data/transacciones";
import { leerSolicitudPorId } from "@/lib/fila/leerSolicitud";
import { nombreDeBucket, obtenerClienteS3 } from "@/lib/media/almacenamiento";

// Route Handler de descarga del comprobante — una de las tres excepciones a
// "todas las mutaciones por Server Action" (regla 2), porque devuelve un
// flujo binario con cabeceras propias (`api-contracts.md` seccion 7).
//
// **No hereda ninguna proteccion.** Verifica sesion y permiso por su cuenta,
// exactamente como cualquier action lo haria — sin esa guarda,
// `titularId === participanteId`, cualquier participante autenticado podria
// descargar el comprobante de otro cambiando el identificador de la URL.
//
// **Nunca por CloudFront.** La distribucion tiene `originPath: /vehiculos`
// (`cloudfrontSigner.ts`), asi que `comprobantes/` es inalcanzable desde ahi
// por construccion. Este handler lee el objeto de S3 y lo entrega el mismo:
// a 10 MB como maximo (`MAXIMO_BYTES_COMPROBANTE`), cargarlo completo en
// memoria es mas simple que un flujo y esta muy por debajo del limite de un
// Route Handler.
//
// **404, nunca 403.** Que no exista y que exista pero no le corresponda a
// quien pregunta se ven igual desde afuera: un 403 confirmaria que hay algo
// ahi.

export const GET = async (
  _request: Request,
  { params }: { params: Promise<{ solicitudId: string }> },
): Promise<Response> => {
  const { solicitudId } = await params;

  // 401 se decide antes de tocar la solicitud: sin sesion, la respuesta es la
  // misma exista o no exista lo que se pide.
  const sesion = await getSession();
  if (!sesion) return new NextResponse(null, { status: 401 });

  const lectura = await leerSolicitudPorId(solicitudId);
  if (!lectura.ok) return new NextResponse(null, { status: 404 });

  const solicitud = lectura.data;
  if (!solicitud.comprobanteClaveS3) {
    return new NextResponse(null, { status: 404 });
  }

  // `forbidden` se convierte en 404, nunca en 403: un 403 confirmaria que la
  // solicitud existe, que es justo lo que la guarda `titularId` evita filtrar.
  const permiso = await exigirPermiso("comprobante:descargar", {
    titularId: solicitud.participanteId,
  });
  if (!permiso.ok) return new NextResponse(null, { status: 404 });

  const objeto = await obtenerClienteS3().send(
    new GetObjectCommand({
      Bucket: nombreDeBucket(),
      Key: solicitud.comprobanteClaveS3,
    }),
  );
  const cuerpo = await objeto.Body?.transformToByteArray();
  if (!cuerpo) return new NextResponse(null, { status: 404 });

  // El acceso queda auditado antes de responder: sin fallback silencioso
  // (regla 15), un fallo aqui tiene que impedir la descarga, no perderse.
  const ahora = new Date();
  const auditoria = await ejecutarTransaccion([
    eventoParaTransaccion({
      tipo: "COMPROBANTE_DESCARGADO",
      agregado: "LOTE",
      agregadoId: solicitud.loteId,
      actor: permiso.actor,
      ocurridoEn: ahora,
      correlacionId: nuevaCorrelacion(ahora),
      loteId: solicitud.loteId,
      solicitudId: solicitud.solicitudId,
    }),
  ]);
  if (!auditoria.ok) {
    throw new Error(
      `No se pudo registrar la descarga del comprobante ${solicitud.solicitudId}`,
    );
  }

  const extension = solicitud.comprobanteClaveS3.split(".").pop() ?? "bin";

  // `Buffer.from` y no el `Uint8Array` crudo: el tipo `BodyInit` del DOM no lo
  // acepta directamente, aunque el runtime de Node lo serialice igual.
  return new NextResponse(Buffer.from(cuerpo), {
    status: 200,
    headers: {
      "Content-Type": objeto.ContentType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="comprobante-${solicitud.solicitudId}.${extension}"`,
      "Cache-Control": "no-store",
    },
  });
};
