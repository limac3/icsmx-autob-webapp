import type { CodigoError } from "./resultado";

/**
 * Estado que `useActionState` lleva entre el formulario de convocatoria y su
 * adaptador.
 *
 * Vive aqui y no junto a las actions por lo mismo que el de vehiculo: un modulo
 * `"use server"` solo puede exportar funciones async, y cualquier otro valor
 * exportado hace fallar la evaluacion del modulo entero. Ver
 * `agent_files/desafios-implementacion.md` seccion 24.
 */
export type EstadoFormularioConvocatoria =
  | { estado: "inicial" }
  | { estado: "guardado"; convocatoriaId: string }
  | {
      estado: "error";
      error: CodigoError;
      detalles?: Record<string, string>;
    };

export const ESTADO_CONVOCATORIA_INICIAL: EstadoFormularioConvocatoria = {
  estado: "inicial",
};
