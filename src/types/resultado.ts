// Fuente: agent_files/estrategia-aplicacion.md seccion 3, y api-contracts.md.

/**
 * Codigos de error de servicios y Server Actions.
 *
 * Son **estables**: se traducen en `src/dictionaries/` y se prueban. Agregar
 * uno obliga a agregar su etiqueta en `es.json` y `en.json`; hay prueba de que
 * el catalogo y los diccionarios no se separan.
 *
 * `not_found` cubre tambien lo que existe pero no debe revelarse: una
 * convocatoria sin publicar responde 404 y no 403, para no delatar su
 * existencia (R-01).
 *
 * `conflicto_concurrencia` no es un fallo del usuario sino una carrera
 * perdida. La UI lo trata releyendo y reintentando, no con un error rojo.
 */
export const CODIGOS_ERROR = [
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_failed",
  "invalid_state",
  "already_in_queue",
  "lote_no_disponible",
  "adjudicacion_activa",
  "plazo_vencido",
  "conflicto_concurrencia",
  "dependencia_no_disponible",
] as const;

export type CodigoError = (typeof CODIGOS_ERROR)[number];

/**
 * Forma de retorno de todo servicio y toda Server Action. **Nunca lanzan**
 * (estrategia 3): solo lo irrecuperable escapa como excepcion.
 *
 * Con TypeScript `strict`, la union discriminada obliga a comprobar `ok` antes
 * de tocar `data`. Un caso de error olvidado es un error de compilacion, no un
 * fallo en produccion.
 */
export type Resultado<T> =
  | { ok: true; data: T }
  | { ok: false; error: CodigoError; detalles?: Record<string, string> };

/**
 * Constructores. Existen para que ningun servicio tenga que recordar el
 * `as const` que necesita la union discriminada al inferirse desde un
 * `return` dentro de una funcion async.
 */
export const exito = <T>(data: T): Resultado<T> => ({ ok: true, data });

export const fallo = <T = never>(
  error: CodigoError,
  detalles?: Record<string, string>,
): Resultado<T> =>
  detalles ? { ok: false, error, detalles } : { ok: false, error };
