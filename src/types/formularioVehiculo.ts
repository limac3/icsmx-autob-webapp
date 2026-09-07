import type { CodigoError } from "./resultado";

/**
 * Estado que `useActionState` lleva entre el formulario y su adaptador.
 *
 * **Vive aqui y no junto a las actions a proposito.** Un modulo `"use server"`
 * solo puede exportar funciones async: cualquier otro valor exportado —un
 * objeto, una constante, un arreglo— hace fallar la evaluacion del modulo con
 * `A "use server" file can only export async functions, found object`. No lo
 * detecta ni `tsc` ni `next build`; revienta al servir la pagina.
 *
 * Los tipos si podrian quedarse alla, porque se borran al compilar, pero
 * separarlos del valor solo dejaria la mitad de la respuesta en cada archivo.
 *
 * Ver agent_files/desafios-implementacion.md seccion 24.
 */
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
