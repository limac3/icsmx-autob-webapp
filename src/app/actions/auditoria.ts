"use server";

// Server Actions de auditoria — contrato en `api-contracts.md` seccion 6.
//
// Delgadas, como toda action: permiso y delegacion. Ninguna hace `puedeEjecutar`
// con contexto de recurso porque las cuatro acciones del catalogo no llevan
// guarda (`Autob_Auditar` solo, sin condicion adicional) — la matriz lo deja
// explicito en su seccion 7.
//
// `exportarBitacora` **no** escribe el evento `BITACORA_EXPORTADA` aqui. Lo
// escribe el Route Handler de descarga (`src/app/api/auditoria/exportar`),
// en el momento en que los datos realmente salen — el mismo criterio que
// `COMPROBANTE_DESCARGADO`. Registrarlo en esta action y no ahi dejaria un
// hueco: cualquiera con `Autob_Auditar` podria construir la URL de descarga a
// mano y exportar sin dejar rastro. Ver `desafios-implementacion.md` 36.

import { redirect } from "next/navigation";

import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { consultarBitacora as consultarBitacoraServicio } from "@/lib/auditoria/consultarBitacora";
import { reconstruirFila as reconstruirFilaServicio } from "@/lib/auditoria/reconstruirFila";
import { verificarIntegridad as verificarIntegridadServicio } from "@/lib/auditoria/verificarIntegridad";
import type { FiltrosDeBitacora } from "@/lib/auditoria/filtrosDeBitacora";
import { TIPOS_DE_AGREGADO, type TipoDeAgregado } from "@/lib/data/claves";
import {
  TIPOS_DE_EVENTO,
  type FilaHistoricaDTO,
  type PaginaDeEventosDTO,
  type ResultadoVerificacion,
  type TipoDeEvento,
} from "@/types/auditoria";
import { exito, fallo, type Resultado } from "@/types/resultado";

const esTipoDeAgregado = (valor: string): valor is TipoDeAgregado =>
  (TIPOS_DE_AGREGADO as readonly string[]).includes(valor);

const esTipoDeEvento = (valor: string): valor is TipoDeEvento =>
  (TIPOS_DE_EVENTO as readonly string[]).includes(valor);

export const consultarBitacora = async (entrada: {
  agregado: string;
  agregadoId: string;
  cursor?: string;
}): Promise<Resultado<PaginaDeEventosDTO>> => {
  const permiso = await exigirPermiso("auditoria:ver-bitacora");
  if (!permiso.ok) return fallo(permiso.error);

  if (!esTipoDeAgregado(entrada.agregado)) return fallo("validation_failed");

  return consultarBitacoraServicio({
    agregado: entrada.agregado,
    agregadoId: entrada.agregadoId,
    cursor: entrada.cursor,
  });
};

export const reconstruirFila = async (entrada: {
  loteId: string;
}): Promise<Resultado<FilaHistoricaDTO>> => {
  const permiso = await exigirPermiso("auditoria:ver-fila-historica");
  if (!permiso.ok) return fallo(permiso.error);

  return reconstruirFilaServicio(entrada.loteId);
};

export const verificarIntegridad = async (entrada: {
  loteId: string;
}): Promise<Resultado<ResultadoVerificacion>> => {
  const permiso = await exigirPermiso("auditoria:ver-bitacora");
  if (!permiso.ok) return fallo(permiso.error);

  return verificarIntegridadServicio(entrada.loteId);
};

/**
 * Solo verifica el permiso y construye la URL: la lectura y el registro de
 * `BITACORA_EXPORTADA` ocurren al descargar, no aqui (ver comentario del
 * archivo).
 */
export const exportarBitacora = async (
  filtros: FiltrosDeBitacora,
): Promise<Resultado<{ urlDescarga: string }>> => {
  const permiso = await exigirPermiso("auditoria:exportar");
  if (!permiso.ok) return fallo(permiso.error);

  const parametros = new URLSearchParams({
    agregado: filtros.agregado,
    agregadoId: filtros.agregadoId,
  });
  if (filtros.tipo) parametros.set("tipo", filtros.tipo);
  if (filtros.desde) parametros.set("desde", filtros.desde);
  if (filtros.hasta) parametros.set("hasta", filtros.hasta);
  if (filtros.participanteId)
    parametros.set("participanteId", filtros.participanteId);

  return exito({
    urlDescarga: `/api/auditoria/exportar?${parametros.toString()}`,
  });
};

/**
 * Adaptador de formulario (AGENTS.md): la pantalla `/auditoria` es un
 * `<form method="get">` sin JavaScript, y exportar necesita ejecutar una
 * mutacion (avanzar la descarga) — de ahi un segundo `<form>`, este por
 * `action`, que solo reenvia los mismos filtros ya visibles en la URL.
 */
export const exportarBitacoraFormulario = async (
  formData: FormData,
): Promise<void> => {
  const agregado = String(formData.get("agregado") ?? "");
  const agregadoId = String(formData.get("agregadoId") ?? "");
  if (!esTipoDeAgregado(agregado) || !agregadoId) return;

  const tipo = String(formData.get("tipo") ?? "");
  const desde = String(formData.get("desde") ?? "");
  const hasta = String(formData.get("hasta") ?? "");
  const participanteId = String(formData.get("participanteId") ?? "");

  const resultado = await exportarBitacora({
    agregado,
    agregadoId,
    ...(esTipoDeEvento(tipo) ? { tipo } : {}),
    ...(desde ? { desde } : {}),
    ...(hasta ? { hasta } : {}),
    ...(participanteId ? { participanteId } : {}),
  });
  if (resultado.ok) redirect(resultado.data.urlDescarga);
};
