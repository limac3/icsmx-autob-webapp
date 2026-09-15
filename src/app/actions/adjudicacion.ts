"use server";

// Server Actions del adjudicador — modalidad manual (R-23).
//
// **No reusa el `conLote` de `fila.ts`, y la diferencia es de fondo.** Aquel
// resuelve el gating triple y la solicitud propia porque sirve a un
// **participante**: pregunta "¿puedes ver esta convocatoria y estas ya en su
// fila?". El adjudicador no participa —no compra, decide— asi que el gating
// triple no le aplica: su permiso no es de venta y exigirle uno lo dejaria
// fuera de las convocatorias que tiene que dictaminar.
//
// Lo que si comparte es la forma: sesion, lectura, permiso, delegacion,
// invalidacion. Y la disciplina de que el actor sale de la sesion y nunca del
// input.

import { updateTag } from "next/cache";

import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { etiqueta } from "@/lib/cache";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { desdeIso } from "@/lib/domain/fechas";
import { ventaAbierta } from "@/lib/domain/ventanas";
import {
  adjudicarManualmente as adjudicarServicio,
  type AdjudicacionManual,
} from "@/lib/fila/adjudicarManualmente";
import { fallo, type Resultado } from "@/types/resultado";

/**
 * Decide a mano el ganador de un lote.
 *
 * `turno` viene del cliente y **eso es correcto aqui**, al contrario que el
 * identificador del actor: es la eleccion del adjudicador, que es justamente el
 * dato que esta accion existe para recibir. Lo que no viene del cliente es
 * **quien** lo eligio.
 *
 * Que el turno exista y siga `EN_FILA` no se comprueba leyendo antes: lo
 * decide la condicion de la transaccion (regla 6).
 */
export const adjudicarManualmente = async (entrada: {
  convocatoriaId: string;
  loteId: string;
  turno: number;
  motivo: string;
}): Promise<Resultado<AdjudicacionManual>> => {
  if (!(await getSession())) return fallo("unauthorized");

  const lectura = await obtenerConvocatoria(entrada.convocatoriaId);
  if (!lectura.ok) return lectura;

  const convocatoria = lectura.data;
  const lote = convocatoria.lotes.find((uno) => uno.loteId === entrada.loteId);
  if (!lote) return fallo("not_found");

  const permiso = await exigirPermiso("adjudicacion:adjudicar", {
    estatusConvocatoria: convocatoria.estatus,
    estatusLote: lote.estatus,
    // Booleano y no la modalidad cruda: las guardas afirman en positivo y
    // `undefined` deniega (regla 18).
    modalidadManual: convocatoria.modalidadAdjudicacion === "MANUAL",
    motivoProvisto: entrada.motivo.trim() !== "",
  });
  if (!permiso.ok) return fallo(permiso.error);

  const inicioVenta = desdeIso(convocatoria.inicioVenta);
  const finVenta = desdeIso(convocatoria.finVenta);

  const resultado = await adjudicarServicio({
    lote,
    turno: entrada.turno,
    motivo: entrada.motivo,
    actor: permiso.actor,
    // Se decidio que el adjudicador puede dictaminar **en cualquier momento**,
    // aun con la fila creciendo. Eso lo hace legitimo, no invisible: queda en
    // el evento para que quien audite no tenga que reconstruirlo comparando
    // fechas.
    ...(inicioVenta && finVenta
      ? {
          ventaAbiertaAlDecidir: ventaAbierta(
            { inicioVenta, finVenta },
            new Date(),
          ),
        }
      : {}),
  });

  if (resultado.ok) {
    updateTag(etiqueta.lote(lote.loteId));
    updateTag(etiqueta.convocatoria(lote.convocatoriaId));
  }
  return resultado;
};
