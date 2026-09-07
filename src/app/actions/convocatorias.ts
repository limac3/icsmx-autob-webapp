"use server";

// Server Actions de convocatorias — contrato en `api-contracts.md` seccion 3.
//
// Cada una es **delgada**: sesion, lectura, permiso, delegacion, invalidacion de
// cache. Sin logica de negocio ni acceso directo a DynamoDB (estrategia 4.1).
//
// El actor sale siempre de la sesion, nunca del input: aceptar un identificador
// del cliente permitiria actuar en nombre de otro, y ademas escribiria en la
// bitacora una autoria falsa.

import { updateTag } from "next/cache";

import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import type { Accion, Contexto } from "@/lib/auth/permisos";
import { getSession } from "@/lib/auth/session";
import { etiqueta } from "@/lib/cache";
import { aprobarConvocatoria as aprobarServicio } from "@/lib/convocatorias/aprobarConvocatoria";
import { concluirConvocatoria as concluirServicio } from "@/lib/convocatorias/concluirConvocatoria";
import { crearConvocatoria as crearServicio } from "@/lib/convocatorias/crearConvocatoria";
import { editarConvocatoria as editarServicio } from "@/lib/convocatorias/editarConvocatoria";
import { enviarAAprobacion as enviarAAprobacionServicio } from "@/lib/convocatorias/enviarAAprobacion";
import { incluirVehiculo as incluirVehiculoServicio } from "@/lib/convocatorias/incluirVehiculo";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { ocultarConvocatoria as ocultarServicio } from "@/lib/convocatorias/ocultarConvocatoria";
import { publicarConvocatoria as publicarServicio } from "@/lib/convocatorias/publicarConvocatoria";
import { reactivarConvocatoria as reactivarServicio } from "@/lib/convocatorias/reactivarConvocatoria";
import { rechazarConvocatoria as rechazarServicio } from "@/lib/convocatorias/rechazarConvocatoria";
import { retirarVehiculoDeConvocatoria as retirarVehiculoServicio } from "@/lib/convocatorias/retirarVehiculoDeConvocatoria";
import { desdeCampoLocal, desdeIso } from "@/lib/domain/fechas";
import { fechasCoherentes, ventaFinalizada } from "@/lib/domain/ventanas";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import type { ActorUsuario } from "@/types/auditoria";
import type {
  ConvocatoriaConLotes,
  DatosConvocatoria,
  EstatusConvocatoria,
} from "@/types/convocatoria";
import type { EstadoFormularioConvocatoria } from "@/types/formularioConvocatoria";
import { fallo, type Resultado } from "@/types/resultado";

/**
 * Contexto derivado de la convocatoria y sus lotes.
 *
 * **Sobre las solicitudes.** Tres guardas preguntan por ellas, y aqui la
 * respuesta se deduce de `contadorTurnos`: si ningun lote repartio un turno,
 * nadie se formo nunca. Es **mas restrictivo** que la pregunta exacta —un turno
 * cancelado sigue contando— y esa es la direccion correcta para una regla de
 * proteccion: prefiere impedir ocultar de mas que dejar a alguien en una fila
 * invisible. Cuando la Etapa 8 traiga el motor de fila habra como preguntarlo
 * de verdad, y este sitio es el unico que hay que cambiar.
 */
const contextoDe = (
  convocatoria: ConvocatoriaConLotes,
  ahora: Date,
): Omit<Contexto, "participanteId"> => {
  const lotesVivos = convocatoria.lotes.filter(
    (lote) => lote.estatus !== "RETIRADO",
  );
  const alguienSeFormo = lotesVivos.some((lote) => lote.contadorTurnos > 0);

  const publicadaEn = desdeIso(convocatoria.publicadaEn);
  const inicioVenta = desdeIso(convocatoria.inicioVenta);
  const finVenta = desdeIso(convocatoria.finVenta);

  return {
    estatusConvocatoria: convocatoria.estatus,
    creadoPor: convocatoria.creadoPor,
    // Una fecha que no parsea deja la coherencia en `false`, no en `undefined`:
    // un item corrupto no debe abrir la puerta a editar ni a publicar.
    fechasCoherentes:
      publicadaEn !== undefined &&
      inicioVenta !== undefined &&
      finVenta !== undefined &&
      fechasCoherentes(
        { publicadaEn, inicioVenta, finVenta },
        convocatoria.horasLiquidacion,
      ),
    tieneAlMenosUnLote: lotesVivos.length > 0,
    existeAlgunaSolicitud: alguienSeFormo,
    sinSolicitudesVivas: !alguienSeFormo,
    ventaFinalizada: finVenta !== undefined && ventaFinalizada(finVenta, ahora),
  };
};

type ContextoDeAccion =
  | { ok: true; convocatoria: ConvocatoriaConLotes; actor: ActorUsuario }
  | { ok: false; error: Resultado<never> };

/**
 * Sesion, lectura de la convocatoria y permiso, en ese orden y por esa razon.
 *
 * El permiso va **despues** de la lectura porque casi todas las guardas de
 * convocatoria dependen del estatus y de quien la creo, y `puedeEjecutar` es
 * puro: no consulta datos, los recibe. La sesion va antes de todo para que una
 * peticion sin autenticar no llegue siquiera a leer.
 *
 * Devuelve la misma convocatoria que evaluo el permiso, y los servicios la
 * reciben: releerla abriria una ventana entre la decision y la escritura.
 */
const conConvocatoria = async (
  accion: Accion,
  convocatoriaId: string,
  extra: Omit<Contexto, "participanteId"> = {},
): Promise<ContextoDeAccion> => {
  if (!(await getSession())) {
    return { ok: false, error: fallo("unauthorized") };
  }

  const lectura = await obtenerConvocatoria(convocatoriaId);
  if (!lectura.ok) return { ok: false, error: lectura };

  const permiso = await exigirPermiso(accion, {
    ...contextoDe(lectura.data, new Date()),
    ...extra,
  });
  if (!permiso.ok) return { ok: false, error: fallo(permiso.error) };

  return { ok: true, convocatoria: lectura.data, actor: permiso.actor };
};

/** Invalida lo que la mutacion acaba de cambiar. */
const invalidar = (convocatoriaId: string): void => {
  updateTag(etiqueta.convocatoria(convocatoriaId));
  updateTag(etiqueta.catalogoConvocatorias);
};

/** Lo anterior, mas lo que ve un participante. Solo para publicar y concluir. */
const invalidarTambienLoVisible = (convocatoriaId: string): void => {
  invalidar(convocatoriaId);
  updateTag(etiqueta.convocatoriasVisibles);
};

export const crearConvocatoria = async (
  datos: DatosConvocatoria,
): Promise<Resultado<{ convocatoriaId: string }>> => {
  const permiso = await exigirPermiso("convocatoria:crear");
  if (!permiso.ok) return fallo(permiso.error);

  const resultado = await crearServicio({ datos, actor: permiso.actor });
  if (resultado.ok) invalidar(resultado.data.convocatoriaId);
  return resultado;
};

export const editarConvocatoria = async (
  convocatoriaId: string,
  cambios: Partial<DatosConvocatoria>,
): Promise<Resultado<{ convocatoriaId: string }>> => {
  const contexto = await conConvocatoria("convocatoria:editar", convocatoriaId);
  if (!contexto.ok) return contexto.error;

  const resultado = await editarServicio({
    actual: contexto.convocatoria,
    cambios,
    actor: contexto.actor,
  });
  if (resultado.ok) invalidar(convocatoriaId);
  return resultado;
};

export const incluirVehiculo = async (entrada: {
  convocatoriaId: string;
  vehiculoId: string;
  precio: number;
}): Promise<Resultado<{ loteId: string }>> => {
  // El vehiculo se lee antes del permiso porque la guarda exige su estatus.
  if (!(await getSession())) return fallo("unauthorized");

  const vehiculo = await obtenerVehiculo(entrada.vehiculoId);
  if (!vehiculo.ok) return vehiculo;

  const contexto = await conConvocatoria(
    "convocatoria:incluir-vehiculo",
    entrada.convocatoriaId,
    { estatusVehiculo: vehiculo.data.estatus },
  );
  if (!contexto.ok) return contexto.error;

  const resultado = await incluirVehiculoServicio({
    convocatoria: contexto.convocatoria,
    vehiculo: vehiculo.data,
    precio: entrada.precio,
    actor: contexto.actor,
  });
  if (resultado.ok) {
    invalidar(entrada.convocatoriaId);
    // El vehiculo cambio de estatus: su ficha y el catalogo tambien caducan.
    updateTag(etiqueta.vehiculo(entrada.vehiculoId));
    updateTag(etiqueta.catalogoVehiculos);
  }
  return resultado;
};

export const retirarVehiculoDeConvocatoria = async (entrada: {
  convocatoriaId: string;
  loteId: string;
  motivo: string;
}): Promise<Resultado<{ loteId: string }>> => {
  if (!(await getSession())) return fallo("unauthorized");

  const lectura = await obtenerConvocatoria(entrada.convocatoriaId);
  if (!lectura.ok) return lectura;

  const lote = lectura.data.lotes.find((uno) => uno.loteId === entrada.loteId);
  if (!lote) return fallo("not_found");

  const contexto = await conConvocatoria(
    "convocatoria:retirar-vehiculo",
    entrada.convocatoriaId,
    { loteSinSolicitudesVivas: lote.contadorTurnos === 0 },
  );
  if (!contexto.ok) return contexto.error;

  const vehiculo = await obtenerVehiculo(lote.vehiculoId);
  if (!vehiculo.ok) return vehiculo;

  const resultado = await retirarVehiculoServicio({
    convocatoria: contexto.convocatoria,
    lote,
    vehiculo: vehiculo.data,
    motivo: entrada.motivo,
    actor: contexto.actor,
  });
  if (resultado.ok) {
    invalidar(entrada.convocatoriaId);
    updateTag(etiqueta.vehiculo(lote.vehiculoId));
    updateTag(etiqueta.catalogoVehiculos);
  }
  return resultado;
};

export const enviarAAprobacion = async (
  convocatoriaId: string,
): Promise<Resultado<{ estatus: EstatusConvocatoria }>> => {
  const contexto = await conConvocatoria(
    "convocatoria:enviar-a-aprobacion",
    convocatoriaId,
  );
  if (!contexto.ok) return contexto.error;

  const resultado = await enviarAAprobacionServicio({
    actual: contexto.convocatoria,
    actor: contexto.actor,
  });
  if (resultado.ok) invalidar(convocatoriaId);
  return resultado;
};

export const aprobarConvocatoria = async (
  convocatoriaId: string,
): Promise<Resultado<{ estatus: EstatusConvocatoria }>> => {
  const contexto = await conConvocatoria(
    "convocatoria:aprobar",
    convocatoriaId,
  );
  if (!contexto.ok) return contexto.error;

  const resultado = await aprobarServicio({
    actual: contexto.convocatoria,
    actor: contexto.actor,
  });
  if (resultado.ok) invalidar(convocatoriaId);
  return resultado;
};

export const rechazarConvocatoria = async (
  convocatoriaId: string,
  motivo: string,
): Promise<Resultado<{ estatus: EstatusConvocatoria }>> => {
  const contexto = await conConvocatoria(
    "convocatoria:rechazar",
    convocatoriaId,
    { motivoProvisto: motivo.trim().length > 0 },
  );
  if (!contexto.ok) return contexto.error;

  const resultado = await rechazarServicio({
    actual: contexto.convocatoria,
    motivo,
    actor: contexto.actor,
  });
  if (resultado.ok) invalidar(convocatoriaId);
  return resultado;
};

export const publicarConvocatoria = async (
  convocatoriaId: string,
): Promise<
  Resultado<{
    estatus: EstatusConvocatoria;
    lotesPropagados: number;
    propagacionCompleta: boolean;
  }>
> => {
  const contexto = await conConvocatoria(
    "convocatoria:publicar",
    convocatoriaId,
  );
  if (!contexto.ok) return contexto.error;

  const resultado = await publicarServicio({
    actual: contexto.convocatoria,
    actor: contexto.actor,
  });
  if (resultado.ok) invalidarTambienLoVisible(convocatoriaId);
  return resultado;
};

export const ocultarConvocatoria = async (
  convocatoriaId: string,
  motivo: string,
): Promise<Resultado<{ estatus: EstatusConvocatoria }>> => {
  const contexto = await conConvocatoria(
    "convocatoria:ocultar",
    convocatoriaId,
  );
  if (!contexto.ok) return contexto.error;

  const resultado = await ocultarServicio({
    actual: contexto.convocatoria,
    motivo,
    // El servicio vuelve a exigirlo por su cuenta, cerrado por omision. Se le
    // pasa lo mismo que evaluo el permiso para que no haya dos verdades.
    existeAlgunaSolicitud: contexto.convocatoria.lotes.some(
      (lote) => lote.estatus !== "RETIRADO" && lote.contadorTurnos > 0,
    ),
    actor: contexto.actor,
  });
  if (resultado.ok) invalidarTambienLoVisible(convocatoriaId);
  return resultado;
};

export const reactivarConvocatoria = async (
  convocatoriaId: string,
): Promise<Resultado<{ estatus: EstatusConvocatoria }>> => {
  const contexto = await conConvocatoria(
    "convocatoria:reactivar",
    convocatoriaId,
  );
  if (!contexto.ok) return contexto.error;

  const resultado = await reactivarServicio({
    actual: contexto.convocatoria,
    actor: contexto.actor,
  });
  if (resultado.ok) invalidar(convocatoriaId);
  return resultado;
};

export const concluirConvocatoria = async (
  convocatoriaId: string,
): Promise<
  Resultado<{
    estatus: EstatusConvocatoria;
    vendidos: number;
    noVendidos: number;
  }>
> => {
  const contexto = await conConvocatoria(
    "convocatoria:concluir",
    convocatoriaId,
  );
  if (!contexto.ok) return contexto.error;

  const finVenta = desdeIso(contexto.convocatoria.finVenta);
  const sinSolicitudesVivas = !contexto.convocatoria.lotes.some(
    (lote) => lote.estatus !== "RETIRADO" && lote.contadorTurnos > 0,
  );

  const resultado = await concluirServicio({
    actual: contexto.convocatoria,
    ventaFinalizada:
      finVenta !== undefined && ventaFinalizada(finVenta, new Date()),
    sinSolicitudesVivas,
    actor: contexto.actor,
  });
  if (resultado.ok) invalidarTambienLoVisible(convocatoriaId);
  return resultado;
};

// --- Adaptador de formulario -------------------------------------------------
//
// La action de arriba es el contrato documentado y recibe datos tipados. Esta la
// envuelve con la firma `(estadoPrevio, formData)` que pide `useActionState`,
// que es lo que permite que el formulario **funcione sin JavaScript**.

/**
 * Une los dos controles de un instante —fecha y hora— en el ISO que se
 * persiste.
 *
 * **Son dos y no uno porque Eden no tiene un campo combinado**: su propio tipo
 * de `Input` remite a `DateInput` y `TimeInput` para estos casos.
 *
 * Ninguno de los dos lleva zona: entregan la hora de pared que tecleo el
 * administrador, y esa se interpreta **en hora de negocio** (regla 9). Sin esto,
 * capturar "08:00" desde Tijuana y desde Ciudad de Mexico guardaria dos
 * instantes distintos para el mismo texto.
 *
 * Un valor que no convierte se deja pasar tal cual: la validacion del dominio lo
 * rechaza con `fecha_invalida`, que es un motivo por campo que el formulario
 * sabe pintar. Traducirlo aqui a un error generico perderia esa precision.
 */
const instanteDeCampo = (formData: FormData, campo: string): string => {
  const fecha = String(formData.get(`${campo}Fecha`) ?? "").trim();
  const hora = String(formData.get(`${campo}Hora`) ?? "").trim();
  // Con uno solo de los dos no hay instante que formar. Se devuelve vacio para
  // que el dominio lo marque `requerido` en vez de `fecha_invalida`: al usuario
  // le falta capturar algo, no corregirlo.
  if (fecha === "" || hora === "") return "";

  const local = `${fecha}T${hora}`;
  return desdeCampoLocal(local)?.toISOString() ?? local;
};

export const guardarConvocatoriaDesdeFormulario = async (
  _estadoPrevio: EstadoFormularioConvocatoria,
  formData: FormData,
): Promise<EstadoFormularioConvocatoria> => {
  const convocatoriaId = String(formData.get("convocatoriaId") ?? "").trim();
  const crudoHoras = String(formData.get("horasLiquidacion") ?? "").trim();

  const datos: DatosConvocatoria = {
    tipo: String(formData.get("tipo") ?? "") as DatosConvocatoria["tipo"],
    descripcionParticipacion: String(
      formData.get("descripcionParticipacion") ?? "",
    ),
    publicadaEn: instanteDeCampo(formData, "publicadaEn"),
    inicioVenta: instanteDeCampo(formData, "inicioVenta"),
    finVenta: instanteDeCampo(formData, "finVenta"),
    // Un campo numerico vacio da `NaN` y no cero: `Number("")` vale cero, y sin
    // esto unas horas sin capturar se guardarian como cero horas —un plazo que
    // vence al nacer— en vez de rechazarse.
    horasLiquidacion: crudoHoras === "" ? Number.NaN : Number(crudoHoras),
  };

  const resultado = convocatoriaId
    ? await editarConvocatoria(convocatoriaId, datos)
    : await crearConvocatoria(datos);

  if (!resultado.ok) {
    return {
      estado: "error",
      error: resultado.error,
      ...(resultado.detalles ? { detalles: resultado.detalles } : {}),
    };
  }

  return { estado: "guardado", convocatoriaId: resultado.data.convocatoriaId };
};
