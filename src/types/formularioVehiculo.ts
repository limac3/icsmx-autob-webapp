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
      /**
       * Lo que se capturo, por nombre de control y **tal como se tecleo**.
       *
       * Existe porque React 19 **reinicia el formulario** cuando la action
       * termina, y lo reinicia a `defaultValue`. Sin devolver lo capturado, un
       * rechazo del servidor dejaba todos los campos vacios con el mensaje de
       * error debajo. El caso peor es el que solo el servidor puede detectar
       * —un numero de serie duplicado—: corregir un caracter obligaba a
       * teclear el vehiculo entero otra vez.
       *
       * Cadenas crudas y no `DatosVehiculo`: hay que devolver lo que la persona
       * escribio, incluido un modelo que no es un numero. Normalizarlo aqui
       * corregiria en silencio el dato sobre el que se esta informando un
       * error.
       */
      capturado?: Record<string, string>;
    };

export const ESTADO_FORMULARIO_INICIAL: EstadoFormularioVehiculo = {
  estado: "inicial",
};
