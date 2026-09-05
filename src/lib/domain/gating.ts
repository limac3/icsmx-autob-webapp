// Fuente: proyecto.md R-01, R-02 y R-03; modelo-datos-dynamodb.md 5.1 y T8;
// regla 8 de CLAUDE.md.
//
// El gating triple: una convocatoria es visible para un participante solo si
// se cumplen las **tres** condiciones.
//
//   1. `estatus = PUBLICADA`          -> clave de particion de GSI2 en PA-05
//   2. `publicadaEn <= ahora`         -> condicion de rango sobre GSI2SK
//   3. permiso de venta del tipo      -> filtro derivado de la sesion
//
// Falla cualquiera y la respuesta es **404, no 403**: un 403 confirmaria que
// la convocatoria existe, y lo que aun no se publica no debe poder deducirse
// (R-01, y la decision registrada al final de proyecto.md).
//
// Este modulo es el puente entre el dominio y la autorizacion. No decide
// permisos —eso es `src/lib/auth/permisos.ts`— sino que **calcula** los campos
// del contexto que aquel exige ya resueltos. La regla 18 deniega ante un campo
// ausente, asi que producirlos en un solo lugar es lo que evita que una
// pantalla nueva olvide uno y reciba un `invalid_state` inexplicable.

import type {
  EstatusConvocatoria,
  TipoConvocatoria,
} from "@/types/convocatoria";
import { TIPO_POR_PERMISO_DE_VENTA, type Permiso } from "@/types/identidad";
import {
  ventaAbierta,
  ventaFinalizada,
  yaPublicada,
  type VentanaDeConvocatoria,
} from "./ventanas";

/**
 * Lo que el gating necesita saber de una convocatoria.
 *
 * **Debe construirse con el registro de la convocatoria, nunca con los
 * atributos desnormalizados del lote.** T8 propaga `estatusConvocatoria` a los
 * lotes por tandas y marca la convocatoria al final, asi que una interrupcion
 * deja lotes que ya dicen `PUBLICADA` bajo una convocatoria que todavia no lo
 * esta. La copia del lote sirve para filtrar y para condicionar barato; la
 * ultima palabra es de la convocatoria (modelo-datos-dynamodb.md T8).
 */
export type ConvocatoriaParaGating = VentanaDeConvocatoria & {
  estatus: EstatusConvocatoria;
  tipo: TipoConvocatoria;
};

export type RazonNoVisible =
  /** El estatus no es PUBLICADA: borrador, en aprobacion, oculta o concluida. */
  | "no_publicada"
  /** Publicada, pero `publicadaEn` esta en el futuro. */
  | "aun_no_visible"
  /** Sin el permiso de venta que corresponde al tipo (R-02). */
  | "sin_permiso_de_tipo";

export type DecisionDeVisibilidad =
  { visible: true } | { visible: false; razon: RazonNoVisible };

/**
 * ¿Da la sesion acceso a este tipo de convocatoria? (R-02)
 *
 * La correspondencia tipo -> permiso vive en `identidad.ts`, no aqui: es parte
 * del catalogo de permisos y cambia con EAS. Este archivo solo la consulta.
 */
export const tieneAccesoAlTipo = (
  tipo: TipoConvocatoria,
  permisos: ReadonlySet<Permiso>,
): boolean => permisos.has(TIPO_POR_PERMISO_DE_VENTA[tipo]);

/**
 * Las tres condiciones de R-01, con la razon de la negativa.
 *
 * La razon es **para el servidor**: alimenta la bitacora y el diagnostico. No
 * se le devuelve al participante, que recibe siempre un 404 indistinguible —
 * distinguir "no existe" de "no tienes permiso" es exactamente la fuga que
 * R-01 evita.
 *
 * El orden de evaluacion no es casual: se comprueba primero lo que no depende
 * de la persona, para que la razon registrada describa el estado del recurso
 * cuando ese es el motivo real.
 */
export const evaluarVisibilidad = (
  convocatoria: ConvocatoriaParaGating,
  permisos: ReadonlySet<Permiso>,
  ahora: Date,
): DecisionDeVisibilidad => {
  if (convocatoria.estatus !== "PUBLICADA") {
    return { visible: false, razon: "no_publicada" };
  }
  if (!yaPublicada(convocatoria.publicadaEn, ahora)) {
    return { visible: false, razon: "aun_no_visible" };
  }
  if (!tieneAccesoAlTipo(convocatoria.tipo, permisos)) {
    return { visible: false, razon: "sin_permiso_de_tipo" };
  }
  return { visible: true };
};

export const esVisible = (
  convocatoria: ConvocatoriaParaGating,
  permisos: ReadonlySet<Permiso>,
  ahora: Date,
): boolean => evaluarVisibilidad(convocatoria, permisos, ahora).visible;

/**
 * ¿Puede solicitarse en esta convocatoria en este momento?
 *
 * Visible **y** con la venta abierta. Son dos cosas distintas por R-03: entre
 * `publicadaEn` e `inicioVenta` el participante ve la convocatoria, sus
 * vehiculos y la hora de apertura, pero no puede formarse. Esa ventana es lo
 * que da a todos la misma oportunidad de prepararse.
 *
 * Esta funcion **no sustituye** la condicion del paso 1 de T1. La autoridad
 * sigue siendo la escritura condicional en DynamoDB; esto decide que se le
 * ofrece al participante y evita un viaje seguro al fracaso.
 */
export const puedeSolicitarse = (
  convocatoria: ConvocatoriaParaGating,
  permisos: ReadonlySet<Permiso>,
  ahora: Date,
): boolean =>
  esVisible(convocatoria, permisos, ahora) && ventaAbierta(convocatoria, ahora);

/**
 * Campos del contexto de `puedeEjecutar` que se derivan de una convocatoria.
 *
 * Se calculan todos juntos y una sola vez. La alternativa —que cada llamador
 * arme el objeto a mano— es justo lo que la regla 18 castiga: un campo
 * olvidado no es un permiso concedido, pero si una denegacion que nadie sabe
 * explicar.
 *
 * Los campos que dependen de una consulta (`tieneSolicitudViva`,
 * `existeAlgunaSolicitud`, `tieneAlMenosUnLote`) no salen de aqui: exigen I/O
 * y este modulo es puro. Los agrega el servicio que ya hizo esa lectura.
 */
export const contextoDeConvocatoria = (
  convocatoria: ConvocatoriaParaGating,
  ahora: Date,
): {
  estatusConvocatoria: EstatusConvocatoria;
  tipoConvocatoria: TipoConvocatoria;
  yaPublicada: boolean;
  ventaAbierta: boolean;
  ventaFinalizada: boolean;
} => ({
  estatusConvocatoria: convocatoria.estatus,
  tipoConvocatoria: convocatoria.tipo,
  yaPublicada: yaPublicada(convocatoria.publicadaEn, ahora),
  ventaAbierta: ventaAbierta(convocatoria, ahora),
  ventaFinalizada: ventaFinalizada(convocatoria.finVenta, ahora),
});
