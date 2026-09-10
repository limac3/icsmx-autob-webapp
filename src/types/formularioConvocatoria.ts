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
      /**
       * Lo que se capturo, por nombre de control y tal como se tecleo.
       *
       * Misma razon que en `EstadoFormularioVehiculo`: React 19 reinicia el
       * formulario a `defaultValue` cuando la action termina, asi que sin
       * devolverlo un rechazo del servidor —un folio duplicado, por ejemplo—
       * borraba la descripcion y las seis mitades de fecha y hora.
       *
       * Las claves son nombres de **control**, no campos del dominio:
       * `publicadaEnFecha` y `publicadaEnHora` son dos, porque Eden no tiene un
       * campo combinado.
       */
      capturado?: Record<string, string>;
      /**
       * Numero de rechazo, contado por el adaptador desde el estado anterior.
       *
       * Es la `key` del editor enriquecido, y lo cuenta el servidor porque en
       * el cliente no hay de donde sacarlo: `useActionState` entrega un objeto
       * nuevo en cada envio, pero con el **mismo contenido** si se reenvia sin
       * cambiar nada, y contarlo con `setState` dentro de un efecto encadena
       * renders (lo prohibe la regla `react-hooks/set-state-in-effect`).
       *
       * Hace falta un valor distinto en **cada** rechazo porque el editor se
       * vacia en cada uno: Eden atiende el evento `reset` que dispara el
       * reinicio de React, y Lexical solo lee `initialContent` al montar.
       */
      intento: number;
    };

export const ESTADO_CONVOCATORIA_INICIAL: EstadoFormularioConvocatoria = {
  estado: "inicial",
};
