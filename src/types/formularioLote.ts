import type { CodigoError } from "./resultado";

/**
 * Estado que `useActionState` lleva entre la pantalla de lotes y sus dos
 * adaptadores de formulario.
 *
 * **Un solo tipo para inclusion y retiro**, con dos estados de exito distintos:
 * los dos formularios viven en la misma pantalla y comparten la traduccion de
 * errores, pero el mensaje de "listo" no es el mismo y confundirlos diria que se
 * retiro un vehiculo que en realidad se acaba de incluir.
 *
 * Vive aqui y no junto a las actions porque un modulo `"use server"` solo puede
 * exportar funciones async: cualquier otro valor exportado hace fallar la
 * evaluacion del modulo entero. Ver `desafios-implementacion.md` seccion 24.
 */
export type EstadoFormularioLote =
  | { estado: "inicial" }
  | { estado: "incluido"; loteId: string }
  | { estado: "retirado"; loteId: string }
  | {
      estado: "error";
      error: CodigoError;
      detalles?: Record<string, string>;
    };

export const ESTADO_LOTE_INICIAL: EstadoFormularioLote = { estado: "inicial" };
