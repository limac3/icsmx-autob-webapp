// Identificadores que teclea una persona: el folio de una convocatoria, el
// numero economico y el numero de serie de un vehiculo.
//
// **Son distintos del identificador interno** y por eso viven aparte. El
// interno lo acuna el sistema (`src/lib/data/identificadores.ts`), es la clave
// del item y **el ancla de la bitacora**: no cambia nunca, porque la bitacora es
// append-only y renombrarlo partiria en dos la historia de cada registro. Estos
// los escribe la organizacion, identifican la cosa en el mundo real y **se
// pueden corregir**: un numero economico mal tecleado se arregla, y la historia
// sigue colgando del identificador interno. Es la misma division que la decision
// D-15 tomo para `participanteId`.
//
// Modulo puro: normaliza y revisa, sin I/O. La **unicidad** no se decide aqui —
// eso es una garantia de la base de datos, con un centinela por valor
// (`modelo-datos-dynamodb.md`), porque comprobarla leyendo antes de escribir
// seria justo el "leer y luego decidir" que prohibe la regla 6.

/**
 * Alfabeto admitido: mayusculas, digitos y los tres separadores que aparecen en
 * los codigos reales de un inventario.
 *
 * Es una **lista blanca** y no una lista de caracteres prohibidos, y eso importa
 * por seguridad: el valor normalizado entra en la `PK` del centinela
 * (`NUMECO_VEH#<valor>`), asi que un `#` colado desplazaria la clave y podria
 * fabricar el centinela de otro registro. Con lista blanca no hay que acordarse
 * de prohibir el separador de mañana.
 *
 * Se excluyen los espacios a proposito: un codigo con espacios se copia y se
 * dicta mal, y "AB 12" contra "AB  12" serian dos registros distintos que nadie
 * distingue a la vista.
 */
const ALFABETO = /^[A-Z0-9\-_/]+$/;

/** Cota de longitud. No es una regla de negocio: acota la clave del centinela. */
export const LIMITE_IDENTIFICADOR_DE_NEGOCIO = 40;

export const MOTIVOS_IDENTIFICADOR_DE_NEGOCIO = [
  "requerido",
  "muy_largo",
  "caracter_no_permitido",
] as const;

export type MotivoIdentificadorDeNegocio =
  (typeof MOTIVOS_IDENTIFICADOR_DE_NEGOCIO)[number];

/**
 * Recorta y pasa a mayusculas.
 *
 * **La normalizacion es lo que hace real la unicidad.** Sin ella, `"ab-1"`,
 * `"AB-1"` y `" AB-1 "` serian tres registros distintos para la base de datos y
 * el mismo vehiculo para cualquier persona. Se aplica siempre antes de construir
 * la clave del centinela y antes de guardar el atributo, para que lo que se
 * compara y lo que se muestra sean el mismo valor.
 */
export const normalizarIdentificadorDeNegocio = (valor: string): string =>
  valor.trim().toUpperCase();

/**
 * Revisa el valor **ya normalizado**; devuelve el motivo o `undefined`.
 *
 * Se revisa despues de normalizar y no antes: `" ab-1 "` es valido y
 * `"AB 1"` no, y decidirlo sobre el texto crudo daria un veredicto sobre algo
 * que no es lo que se va a guardar.
 */
export const revisarIdentificadorDeNegocio = (
  normalizado: string,
): MotivoIdentificadorDeNegocio | undefined => {
  if (normalizado.length === 0) return "requerido";
  if (normalizado.length > LIMITE_IDENTIFICADOR_DE_NEGOCIO) return "muy_largo";
  if (!ALFABETO.test(normalizado)) return "caracter_no_permitido";
  return undefined;
};

/**
 * Normaliza y revisa en un paso. Devuelve el valor listo para guardar, o el
 * motivo por el que no sirve.
 *
 * Los servicios llaman a esta y no a las dos anteriores, por la misma razon que
 * `validarDatosVehiculo` existe: asi es imposible guardar un valor revisado sin
 * normalizar, que es como se cuela un duplicado que la base de datos no ve.
 */
export const prepararIdentificadorDeNegocio = (
  valor: string,
):
  | { ok: true; valor: string }
  | { ok: false; motivo: MotivoIdentificadorDeNegocio } => {
  const normalizado = normalizarIdentificadorDeNegocio(valor);
  const motivo = revisarIdentificadorDeNegocio(normalizado);
  return motivo ? { ok: false, motivo } : { ok: true, valor: normalizado };
};
