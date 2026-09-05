"use server";

// Server Actions de vehiculos — contrato en `api-contracts.md` seccion 2.
//
// Cada una es **delgada**: sesion, permiso, delegacion, invalidacion de cache.
// Sin logica de negocio ni acceso directo a DynamoDB (estrategia 4.1).
//
// El actor sale siempre de la sesion, nunca del input: aceptar un identificador
// del cliente permitiria actuar en nombre de otro, y ademas escribiria en la
// bitacora una autoria falsa.

import { updateTag } from "next/cache";

import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { etiqueta } from "@/lib/cache";
import type { Accion } from "@/lib/auth/permisos";
import { agregarFotografia as agregarFotografiaServicio } from "@/lib/vehiculos/agregarFotografia";
import { crearVehiculo as crearVehiculoServicio } from "@/lib/vehiculos/crearVehiculo";
import { editarVehiculo as editarVehiculoServicio } from "@/lib/vehiculos/editarVehiculo";
import { eliminarFotografia as eliminarFotografiaServicio } from "@/lib/vehiculos/eliminarFotografia";
import { marcarFotografiaPrincipal as marcarFotografiaPrincipalServicio } from "@/lib/vehiculos/marcarFotografiaPrincipal";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import { reordenarFotografias as reordenarFotografiasServicio } from "@/lib/vehiculos/reordenarFotografias";
import { retirarVehiculo as retirarVehiculoServicio } from "@/lib/vehiculos/retirarVehiculo";
import { fallo, type CodigoError, type Resultado } from "@/types/resultado";
import type { ActorUsuario } from "@/types/auditoria";
import type { DatosVehiculo, VehiculoConFotografias } from "@/types/vehiculo";

/**
 * Sesion, lectura del vehiculo y permiso, en ese orden y por esa razon.
 *
 * El permiso va **despues** de la lectura porque las guardas de vehiculo
 * dependen del estatus (`permission-matrix.md` seccion 2), y `puedeEjecutar` es
 * puro: no consulta datos, los recibe. La sesion va antes de todo para que una
 * peticion sin autenticar no llegue siquiera a leer.
 *
 * Devuelve el mismo vehiculo que evaluo el permiso, y los servicios lo reciben:
 * releerlo abriria una ventana entre la decision y la escritura.
 */
const conVehiculo = async (
  accion: Accion,
  vehiculoId: string,
): Promise<
  | { ok: true; vehiculo: VehiculoConFotografias; actor: ActorUsuario }
  | { ok: false; error: Resultado<never> }
> => {
  if (!(await getSession())) {
    return { ok: false, error: fallo("unauthorized") };
  }

  const lectura = await obtenerVehiculo(vehiculoId);
  if (!lectura.ok) return { ok: false, error: lectura };

  const permiso = await exigirPermiso(accion, {
    estatusVehiculo: lectura.data.estatus,
  });
  if (!permiso.ok) return { ok: false, error: fallo(permiso.error) };

  return { ok: true, vehiculo: lectura.data, actor: permiso.actor };
};

/**
 * Invalida lo que la mutacion acaba de cambiar.
 *
 * **`updateTag` y no `revalidateTag`.** En Next.js 16 `revalidateTag` exige un
 * perfil de `cacheLife` y programa la expiracion; el que caduca de inmediato
 * dentro de una Server Action —con semantica de leer lo que uno acaba de
 * escribir— es `updateTag`. Con el otro, quien edita un vehiculo veria sus
 * propios datos viejos al volver al listado. Ver desafios-implementacion.md
 * seccion 18.
 */
const invalidar = (vehiculoId: string): void => {
  updateTag(etiqueta.vehiculo(vehiculoId));
  updateTag(etiqueta.catalogoVehiculos);
};

export const crearVehiculo = async (
  datos: DatosVehiculo,
): Promise<Resultado<{ vehiculoId: string }>> => {
  const permiso = await exigirPermiso("vehiculo:crear");
  if (!permiso.ok) return fallo(permiso.error);

  const resultado = await crearVehiculoServicio({
    datos,
    actor: permiso.actor,
  });
  if (resultado.ok) invalidar(resultado.data.vehiculoId);
  return resultado;
};

export const editarVehiculo = async (
  vehiculoId: string,
  cambios: Partial<DatosVehiculo>,
): Promise<Resultado<{ vehiculoId: string }>> => {
  const contexto = await conVehiculo("vehiculo:editar", vehiculoId);
  if (!contexto.ok) return contexto.error;

  const resultado = await editarVehiculoServicio({
    actual: contexto.vehiculo,
    cambios,
    actor: contexto.actor,
  });
  if (resultado.ok) invalidar(vehiculoId);
  return resultado;
};

export const retirarVehiculo = async (
  vehiculoId: string,
  motivo: string,
): Promise<Resultado<{ vehiculoId: string }>> => {
  const contexto = await conVehiculo("vehiculo:retirar", vehiculoId);
  if (!contexto.ok) return contexto.error;

  const resultado = await retirarVehiculoServicio({
    actual: contexto.vehiculo,
    motivo,
    actor: contexto.actor,
  });
  if (resultado.ok) invalidar(vehiculoId);
  return resultado;
};

export const agregarFotografia = async (entrada: {
  vehiculoId: string;
  archivo: File;
  esPrincipal?: boolean;
  descripcion?: string;
}): Promise<Resultado<{ fotoId: string }>> => {
  const contexto = await conVehiculo(
    "vehiculo:subir-fotografia",
    entrada.vehiculoId,
  );
  if (!contexto.ok) return contexto.error;

  const resultado = await agregarFotografiaServicio({
    actual: contexto.vehiculo,
    archivo: {
      bytes: new Uint8Array(await entrada.archivo.arrayBuffer()),
      // El tipo lo declara el navegador y el servicio lo valida contra la lista
      // admitida. El **nombre** del archivo no se usa para nada: la clave de S3
      // la arma el servidor con identificadores que genero el.
      contentType: entrada.archivo.type,
    },
    esPrincipal: entrada.esPrincipal,
    descripcion: entrada.descripcion,
    actor: contexto.actor,
  });
  if (resultado.ok) invalidar(entrada.vehiculoId);
  return resultado;
};

export const eliminarFotografia = async (
  vehiculoId: string,
  fotoId: string,
): Promise<Resultado<{ fotoId: string }>> => {
  const contexto = await conVehiculo(
    "vehiculo:eliminar-fotografia",
    vehiculoId,
  );
  if (!contexto.ok) return contexto.error;

  const resultado = await eliminarFotografiaServicio({
    actual: contexto.vehiculo,
    fotoId,
    actor: contexto.actor,
  });
  if (resultado.ok) invalidar(vehiculoId);
  return resultado;
};

export const marcarFotografiaPrincipal = async (
  vehiculoId: string,
  fotoId: string,
): Promise<Resultado<{ fotoId: string }>> => {
  // Designar la principal es gestion de galeria: mismo permiso que subir.
  const contexto = await conVehiculo("vehiculo:subir-fotografia", vehiculoId);
  if (!contexto.ok) return contexto.error;

  const resultado = await marcarFotografiaPrincipalServicio({
    actual: contexto.vehiculo,
    fotoId,
    actor: contexto.actor,
  });
  if (resultado.ok) invalidar(vehiculoId);
  return resultado;
};

export const reordenarFotografias = async (
  vehiculoId: string,
  ordenFotoIds: string[],
): Promise<Resultado<{ vehiculoId: string }>> => {
  // Reordenar es gestion de galeria, asi que exige el mismo permiso que subir
  // (`api-contracts.md` seccion 2).
  const contexto = await conVehiculo("vehiculo:subir-fotografia", vehiculoId);
  if (!contexto.ok) return contexto.error;

  const resultado = await reordenarFotografiasServicio({
    actual: contexto.vehiculo,
    ordenFotoIds,
    actor: contexto.actor,
  });
  if (resultado.ok) invalidar(vehiculoId);
  return resultado;
};

// --- Adaptadores de formulario ----------------------------------------------
//
// Las acciones de arriba son el contrato documentado y reciben datos tipados.
// Estas envuelven a las mismas con la firma `(estadoPrevio, formData)` que pide
// `useActionState`, que es lo que permite que el formulario **funcione sin
// JavaScript**: el navegador envia el `<form>` y el servidor responde.
//
// Se mantienen separadas en vez de cambiar la firma de las acciones: un
// `FormData` es un saco de cadenas sin tipo, y dejar que llegue hasta el
// servicio convertiria cada conversion en una oportunidad de equivocarse en
// silencio.

export type EstadoFormularioVehiculo =
  | { estado: "inicial" }
  | { estado: "guardado"; vehiculoId: string }
  | {
      estado: "error";
      error: CodigoError;
      detalles?: Record<string, string>;
    };

export const ESTADO_FORMULARIO_INICIAL: EstadoFormularioVehiculo = {
  estado: "inicial",
};

const texto = (formData: FormData, campo: string): string =>
  String(formData.get(campo) ?? "");

/**
 * Numero desde un campo de texto.
 *
 * Un campo vacio da `NaN` y no `0`. `Number("")` vale cero, asi que sin esto un
 * kilometraje sin capturar se guardaria como cero kilometros —un dato falso y
 * plausible, que es la peor clase— en vez de rechazarse.
 */
const numero = (formData: FormData, campo: string): number => {
  const crudo = texto(formData, campo).trim();
  return crudo === "" ? Number.NaN : Number(crudo);
};

const datosDesdeFormulario = (formData: FormData): DatosVehiculo => ({
  marca: texto(formData, "marca"),
  version: texto(formData, "version"),
  modelo: numero(formData, "modelo"),
  kilometraje: numero(formData, "kilometraje"),
  nivelEquipamiento: texto(formData, "nivelEquipamiento"),
  especificacionMecanica: texto(formData, "especificacionMecanica"),
  condicionesMecanicas: texto(formData, "condicionesMecanicas"),
  detallesEsteticos: texto(formData, "detallesEsteticos"),
});

const aEstado = (
  resultado: Resultado<{ vehiculoId: string }>,
): EstadoFormularioVehiculo =>
  resultado.ok
    ? { estado: "guardado", vehiculoId: resultado.data.vehiculoId }
    : {
        estado: "error",
        error: resultado.error,
        detalles: resultado.detalles,
      };

/**
 * Alta o edicion, segun venga o no `vehiculoId` en el formulario.
 *
 * Una sola action para las dos pantallas porque el formulario es el mismo y la
 * diferencia la decide un campo oculto. Dos actions casi identicas se
 * desincronizan al agregar un campo.
 */
export const guardarVehiculoDesdeFormulario = async (
  _estadoPrevio: EstadoFormularioVehiculo,
  formData: FormData,
): Promise<EstadoFormularioVehiculo> => {
  const datos = datosDesdeFormulario(formData);
  const vehiculoId = texto(formData, "vehiculoId").trim();

  return aEstado(
    vehiculoId
      ? await editarVehiculo(vehiculoId, datos)
      : await crearVehiculo(datos),
  );
};

export const retirarVehiculoDesdeFormulario = async (
  _estadoPrevio: EstadoFormularioVehiculo,
  formData: FormData,
): Promise<EstadoFormularioVehiculo> =>
  aEstado(
    await retirarVehiculo(
      texto(formData, "vehiculoId").trim(),
      texto(formData, "motivo"),
    ),
  );
