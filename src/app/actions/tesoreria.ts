"use server";

// Server Actions de tesoreria — contrato en `api-contracts.md` seccion 5.
//
// Delgadas, como toda action (AGENTS.md): sesion, lectura, permiso,
// delegacion, invalidacion. **Sin logica de negocio ni acceso a DynamoDB.**
//
// A diferencia de `fila.ts`, aqui no hay gating triple que ocultar: quien
// pregunta por `comprobante:subir` o `pago:avalar` ya conoce el `solicitudId`
// —salio de su propia pantalla o de la bandeja de tesoreria—, asi que un
// `forbidden` no revela nada que no supiera. No se remapea a `not_found`.

import { updateTag } from "next/cache";

import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import type { Accion, Contexto } from "@/lib/auth/permisos";
import { getSession } from "@/lib/auth/session";
import { etiqueta } from "@/lib/cache";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { desdeIso } from "@/lib/domain/fechas";
import { dentroDePlazo } from "@/lib/domain/plazos";
import { leerSolicitudPorId } from "@/lib/fila/leerSolicitud";
import { avalarPago as avalarPagoServicio } from "@/lib/tesoreria/avalarPago";
import { listarPendientesVerificacion as listarPendientesServicio } from "@/lib/tesoreria/listarPendientesVerificacion";
import { rechazarPago as rechazarPagoServicio } from "@/lib/tesoreria/rechazarPago";
import { subirComprobante as subirComprobanteServicio } from "@/lib/tesoreria/subirComprobante";
import type { ActorUsuario } from "@/types/auditoria";
import type { PendienteDTO, Solicitud } from "@/types/fila";
import type { Lote } from "@/types/lote";
import type { EstatusSolicitud } from "@/types/solicitud";
import { exito, fallo, type Resultado } from "@/types/resultado";

type ContextoDeTesoreria = {
  lote: Lote;
  solicitud: Solicitud;
  actor: ActorUsuario;
};

/**
 * Lectura, gating de propiedad/estado y permiso — en ese orden.
 *
 * Resuelve `loteId` a partir del `solicitudId` (`leerSolicitudPorId`), y el
 * lote leyendo la convocatoria que la solicitud ya tiene desnormalizada
 * (`solicitud.convocatoriaId`): no hay ningun patron de acceso que lea un
 * lote sin conocer antes su convocatoria (PA-04).
 */
const conSolicitud = async (
  accion: Accion,
  solicitudId: string,
  extra: Omit<Contexto, "participanteId"> = {},
): Promise<Resultado<ContextoDeTesoreria>> => {
  const sesion = await getSession();
  if (!sesion) return fallo("unauthorized");

  const lectura = await leerSolicitudPorId(solicitudId);
  if (!lectura.ok) return lectura;

  const solicitud = lectura.data;
  if (!solicitud.convocatoriaId) return fallo("not_found");

  const convocatoria = await obtenerConvocatoria(solicitud.convocatoriaId);
  if (!convocatoria.ok) return fallo("not_found");

  const lote = convocatoria.data.lotes.find(
    (uno) => uno.loteId === solicitud.loteId,
  );
  if (!lote) return fallo("not_found");

  const venceEn = solicitud.venceEn ? desdeIso(solicitud.venceEn) : undefined;

  const permiso = await exigirPermiso(accion, {
    titularId: solicitud.participanteId,
    estatusSolicitud: solicitud.estatus,
    // Solo `comprobante:subir` mira este campo, pero se calcula siempre: es
    // barato, y asi la guarda falla cerrada si algun dia la usa otra accion.
    dentroDePlazo: venceEn ? dentroDePlazo(venceEn, new Date()) : false,
    ...extra,
  });
  if (!permiso.ok) return fallo(permiso.error);

  return exito({ lote, solicitud, actor: permiso.actor });
};

/** Lo que cambia una mutacion de tesoreria: el lote y su convocatoria. */
const invalidar = (lote: Lote): void => {
  updateTag(etiqueta.lote(lote.loteId));
  updateTag(etiqueta.convocatoria(lote.convocatoriaId));
};

export const subirComprobante = async (entrada: {
  solicitudId: string;
  archivo: File;
}): Promise<Resultado<{ estatus: EstatusSolicitud }>> => {
  const contexto = await conSolicitud("comprobante:subir", entrada.solicitudId);
  if (!contexto.ok) return contexto;

  const resultado = await subirComprobanteServicio({
    solicitud: contexto.data.solicitud,
    archivo: {
      bytes: new Uint8Array(await entrada.archivo.arrayBuffer()),
      // El tipo lo declara el navegador y el servicio lo valida contra la
      // lista admitida (regla 15). El nombre del archivo no se usa para nada.
      contentType: entrada.archivo.type,
    },
    actor: contexto.data.actor,
  });

  if (resultado.ok) invalidar(contexto.data.lote);
  return resultado;
};

export const avalarPago = async (entrada: {
  solicitudId: string;
  nota?: string;
}): Promise<Resultado<{ estatus: EstatusSolicitud }>> => {
  const contexto = await conSolicitud("pago:avalar", entrada.solicitudId);
  if (!contexto.ok) return contexto;

  const resultado = await avalarPagoServicio({
    lote: contexto.data.lote,
    solicitud: contexto.data.solicitud,
    actor: contexto.data.actor,
    ...(entrada.nota === undefined ? {} : { nota: entrada.nota }),
  });
  if (!resultado.ok) return resultado;

  invalidar(contexto.data.lote);
  return exito({ estatus: resultado.data.estatus });
};

export const rechazarPago = async (entrada: {
  solicitudId: string;
  motivo: string;
}): Promise<Resultado<{ estatus: EstatusSolicitud }>> => {
  // R-16: el motivo es obligatorio, y la guarda de `pago:rechazar` lo exige
  // como precondicion del contexto — no puede saberlo sola, hay que decirselo.
  const contexto = await conSolicitud("pago:rechazar", entrada.solicitudId, {
    motivoProvisto: entrada.motivo.trim().length > 0,
  });
  if (!contexto.ok) return contexto;

  const resultado = await rechazarPagoServicio({
    lote: contexto.data.lote,
    solicitud: contexto.data.solicitud,
    motivo: entrada.motivo,
    actor: contexto.data.actor,
  });
  if (!resultado.ok) return resultado;

  invalidar(contexto.data.lote);
  return exito({ estatus: resultado.data.estatus });
};

// Sin parametro de `cursor` todavia: al volumen de hoy —decenas de
// solicitudes en verificacion a la vez— PA-11 lee la particion entera, igual
// que la bandeja del aprobador lee la suya completa. Se agrega cuando haga
// falta paginar, no antes.
export const listarPendientesVerificacion = async (): Promise<
  Resultado<PendienteDTO[]>
> => {
  const permiso = await exigirPermiso("tesoreria:ver-bandeja");
  if (!permiso.ok) return fallo(permiso.error);

  return listarPendientesServicio();
};
