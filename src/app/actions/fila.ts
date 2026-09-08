"use server";

// Server Actions de la fila — contrato en `api-contracts.md` seccion 4.
//
// **El nucleo del sistema, y por eso las mas delgadas de todas.** Aqui no vive
// ninguna decision de equidad: el orden lo asigna un contador atomico y la
// adjudicacion la gana una escritura condicional, las dos en `src/lib/fila`.
// Esta capa solo hace lo que ninguna otra puede hacer por ella: identificar a
// quien pide, comprobar que puede, y no dejar que el identificador del actor
// venga del cliente.
//
// **Solo hay dos actions, y las dos son mutaciones.** Las lecturas —el lugar en
// la fila, el tamano— las hacen los Server Components llamando al servicio
// directo, como en el resto de la aplicacion: una action de lectura seria un
// viaje de ida y vuelta para algo que el servidor ya tiene en la mano.

import { updateTag } from "next/cache";

import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import type { Accion, Contexto } from "@/lib/auth/permisos";
import { getSession } from "@/lib/auth/session";
import { etiqueta } from "@/lib/cache";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { desdeIso } from "@/lib/domain/fechas";
import { contextoDeConvocatoria } from "@/lib/domain/gating";
import { cancelarSolicitud as cancelarServicio } from "@/lib/fila/cancelarSolicitud";
import { consultarMiLugar, leerMiSolicitud } from "@/lib/fila/consultarMiLugar";
import { consultarTamanoFila } from "@/lib/fila/conteosDeFila";
import { solicitarCompra as solicitarServicio } from "@/lib/fila/solicitarCompra";
import type { ActorUsuario } from "@/types/auditoria";
import type { MiLugarDTO, Solicitud } from "@/types/fila";
import type { Lote } from "@/types/lote";
import type { EstatusSolicitud } from "@/types/solicitud";
import { exito, fallo, type Resultado } from "@/types/resultado";

type ContextoDeFila = {
  lote: Lote;
  participanteId: string;
  /** De la sesion, para que T1 se lo copie a la solicitud (ver `types/fila.ts`). */
  correo: string;
  actor: ActorUsuario;
  /** La solicitud viva propia en ese lote, si la hay. */
  miSolicitud: Solicitud | null;
};

/**
 * Sesion, lectura, gating triple y permiso — en ese orden y por esa razon.
 *
 * El gating se calcula **desde la convocatoria**, nunca desde la copia
 * desnormalizada del lote: T8 la propaga por tandas y puede quedarse atras
 * (`src/lib/domain/gating.ts`). La copia sirve para condicionar barato dentro
 * de DynamoDB; la ultima palabra sobre lo que alguien puede ver es de la
 * convocatoria.
 *
 * **Todo fallo de gating responde `not_found`**, igual que las paginas: un
 * `forbidden` confirmaria que el lote existe, que es justo lo que R-01 evita.
 * `exigirPermiso` ya traduce el `sin_permiso_de_tipo` a `forbidden`, asi que la
 * distincion se borra aqui, en un solo sitio.
 */
const conLote = async (
  accion: Accion,
  entrada: { convocatoriaId: string; loteId: string },
  extra: Omit<Contexto, "participanteId"> = {},
): Promise<Resultado<ContextoDeFila>> => {
  const sesion = await getSession();
  if (!sesion) return fallo("unauthorized");

  const lectura = await obtenerConvocatoria(entrada.convocatoriaId);
  if (!lectura.ok) return fallo("not_found");

  const convocatoria = lectura.data;
  const lote = convocatoria.lotes.find((uno) => uno.loteId === entrada.loteId);
  if (!lote) return fallo("not_found");

  const publicadaEn = desdeIso(convocatoria.publicadaEn);
  const inicioVenta = desdeIso(convocatoria.inicioVenta);
  const finVenta = desdeIso(convocatoria.finVenta);
  if (!publicadaEn || !inicioVenta || !finVenta) return fallo("not_found");

  const miSolicitud = await leerMiSolicitud({
    loteId: entrada.loteId,
    participanteId: sesion.participanteId,
  });
  if (!miSolicitud.ok) return miSolicitud;

  const permiso = await exigirPermiso(accion, {
    ...contextoDeConvocatoria(
      {
        publicadaEn,
        inicioVenta,
        finVenta,
        estatus: convocatoria.estatus,
        tipo: convocatoria.tipo,
      },
      new Date(),
    ),
    // R-07: la guarda de `solicitud:crear` exige **saber** que no hay una
    // solicitud viva. Ignorarlo permitiria formarse dos veces; por eso viaja
    // como booleano y no como ausencia (regla 18).
    tieneSolicitudViva: miSolicitud.data !== null,
    // Y `solicitud:cancelar` exige el titular y el estatus. Salen de la misma
    // lectura, que parte del centinela indexado por la sesion: `titularId` no
    // puede ser el de otro ni cuando quien invoca lo intente.
    ...(miSolicitud.data
      ? {
          titularId: miSolicitud.data.participanteId,
          estatusSolicitud: miSolicitud.data.estatus,
        }
      : {}),
    ...extra,
  });

  if (!permiso.ok) {
    // `invalid_state` describe una guarda de negocio —la venta no ha abierto,
    // ya estas en la fila— y esa si se le puede explicar a quien pregunta. Un
    // `forbidden` sobre un recurso publicado, en cambio, revelaria que existe.
    return fallo(permiso.error === "forbidden" ? "not_found" : permiso.error);
  }

  return exito({
    lote,
    participanteId: sesion.participanteId,
    correo: sesion.correo,
    actor: permiso.actor,
    miSolicitud: miSolicitud.data,
  });
};

/** Lo que acaba de cambiar: la fila del lote y la vista de su convocatoria. */
const invalidar = (lote: Lote): void => {
  updateTag(etiqueta.lote(lote.loteId));
  updateTag(etiqueta.convocatoria(lote.convocatoriaId));
};

/**
 * Entra a la fila de un lote y devuelve el lugar obtenido.
 *
 * El `MiLugarDTO` se lee **despues** de que el servicio intento adjudicar, no
 * antes: quien encabeza la fila recibe su lugar ya en estado `ADJUDICADA`, sin
 * esperar a ningun proceso de fondo (api-contracts 4.2).
 */
export const solicitarCompra = async (entrada: {
  convocatoriaId: string;
  loteId: string;
}): Promise<Resultado<MiLugarDTO>> => {
  const contexto = await conLote("solicitud:crear", entrada);
  if (!contexto.ok) return contexto;

  const { lote, participanteId, correo, actor } = contexto.data;

  // Informativo para la bitacora: cuanta fila habia cuando entro. No decide
  // nada, asi que un fallo al contarlo no puede impedir la solicitud.
  const tamano = await consultarTamanoFila(lote.loteId);

  const resultado = await solicitarServicio({
    lote,
    participanteId,
    actor,
    ...(correo ? { correoTitular: correo } : {}),
    ...(tamano.ok ? { tamanoFilaAlMomento: tamano.data } : {}),
  });
  if (!resultado.ok) return resultado;

  invalidar(lote);

  const miLugar = await consultarMiLugar({
    loteId: lote.loteId,
    participanteId,
  });
  if (!miLugar.ok) return miLugar;
  if (!miLugar.data) {
    // La solicitud se escribio pero no se puede leer: no hay nada sensato que
    // mostrar y reintentar es lo correcto desde la interfaz.
    return fallo("conflicto_concurrencia");
  }

  return exito(miLugar.data);
};

/**
 * Retira la solicitud propia. Si estaba `ADJUDICADA`, libera el lote y dispara
 * la reasignacion al siguiente turno vivo.
 *
 * **No recibe ningun identificador de solicitud.** Se parte del centinela de
 * fila, que esta indexado por el `participanteId` de la sesion, asi que es
 * imposible alcanzar la solicitud de otro: la propiedad no depende de una
 * guarda que alguien pueda olvidar. La guarda de `solicitud:cancelar` se aplica
 * igual, como segunda linea.
 */
export const cancelarSolicitud = async (entrada: {
  convocatoriaId: string;
  loteId: string;
  motivo?: string;
}): Promise<Resultado<{ estatus: EstatusSolicitud }>> => {
  const contexto = await conLote("solicitud:cancelar", entrada);
  if (!contexto.ok) return contexto;

  const solicitud = contexto.data.miSolicitud;
  // Sin solicitud viva la guarda `esPropio` ya habria denegado, asi que este
  // caso no deberia llegar aqui. Se comprueba igual porque el tipo lo admite y
  // porque cancelar lo que no existe es `not_found`, no un error de programa.
  if (!solicitud) return fallo("not_found");

  const resultado = await cancelarServicio({
    lote: contexto.data.lote,
    solicitud,
    actor: contexto.data.actor,
    ...(entrada.motivo === undefined ? {} : { motivo: entrada.motivo }),
  });
  if (!resultado.ok) return resultado;

  invalidar(contexto.data.lote);
  return exito({ estatus: resultado.data.estatus });
};
