// Identificadores cortos y ordenables por tiempo — 12 caracteres.
//
// `modelo-datos-dynamodb.md` los exige ordenables para `vehiculoId`,
// `convocatoriaId`, `eventoId` y `correlacionId`. La razon es la misma en todos
// los casos: un UUID v4 es aleatorio, asi que una lista de identificadores no
// dice nada sobre el orden en que se crearon, y **ordenar lexicograficamente
// igual que cronologicamente** es justo lo que necesita una clave de
// ordenamiento de DynamoDB.
//
// Antes eran ULIDs de 26 caracteres (48 bits de milisegundo + 80 de azar). Se
// cambiaron por doce, y el reparto no es arbitrario:
//
//   - **7 caracteres de segundos** son 2^35 segundos, unos 1 090 anos. Gastar
//     el septimo caracter en precision de segundo y no en rango sobrante es lo
//     que mantiene el identificador ordenado por segundo: con precision de
//     minuto, sesenta segundos de identificadores quedarian en orden aleatorio
//     entre si, y de ese orden dependen las listas de opciones de la bitacora.
//   - **5 caracteres de azar** son 2^25 = 33 554 432 valores. La colision solo
//     es posible **dentro del mismo segundo**: con diez identificadores del
//     mismo tipo en un segundo la probabilidad es 1,5 x 10^-6, y con cien es
//     1,5 x 10^-4.
//
// Y esa probabilidad es tolerable porque **una colision falla de forma
// visible**, nunca sobrescribe: los tres `Put` de creacion llevan
// `attribute_not_exists` (vehiculo y convocatoria sobre `PK`, lote sobre `SK`),
// igual que la reserva de turno de `fila/reservas.ts`. Quien pierda el sorteo
// recibe un error y reintenta.
//
// Se implementa aqui en lugar de agregar una dependencia: son cuarenta lineas y
// el alfabeto de Crockford resuelve de paso dos restricciones de `claves.ts`
// —ningun caracter es `#`, el separador de las claves, ni `-`, por el que
// `loteYTurnoDesdeIdentificador` parte el identificador de una solicitud— sin
// tener que confiar en que un paquete externo las respete.

/**
 * Alfabeto base32 de Crockford. Excluye `I`, `L`, `O` y `U`: las tres primeras
 * para que no se confundan con `1` y `0` al leerlas o dictarlas, y la `U` para
 * que ninguna combinacion accidental forme una palabra ofensiva.
 *
 * Su orden es tambien el orden ASCII, que es lo que hace que comparar dos
 * identificadores como cadenas los ordene por su valor.
 */
const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BASE = ALFABETO.length; // 32

const LONGITUD_TIEMPO = 7;
const LONGITUD_AZAR = 5;
export const LONGITUD_ID = LONGITUD_TIEMPO + LONGITUD_AZAR; // 12

/**
 * Instante maximo representable: 2^35 segundos, el ano 3059.
 *
 * Se comprueba en vez de dejarlo desbordar en silencio, porque un
 * desbordamiento produciria un identificador que **ordena antes** que los
 * anteriores y romperia la unica propiedad por la que se eligio este formato.
 */
export const SEGUNDOS_MAXIMOS = 34_359_738_367; // 32^7 - 1 = 2^35 - 1

const codificarTiempo = (segundos: number): string => {
  if (
    !Number.isInteger(segundos) ||
    segundos < 0 ||
    segundos > SEGUNDOS_MAXIMOS
  ) {
    throw new RangeError(
      `Instante fuera del rango de un identificador: ${String(segundos)}`,
    );
  }

  let resto = segundos;
  let texto = "";
  for (let i = 0; i < LONGITUD_TIEMPO; i += 1) {
    texto = ALFABETO[resto % BASE] + texto;
    resto = Math.floor(resto / BASE);
  }
  return texto;
};

const codificarAzar = (): string => {
  // 5 caracteres de 5 bits = 25 bits de entropia.
  //
  // `byte % 32` **no** introduce sesgo porque 256 es multiplo exacto de 32:
  // cada simbolo sale de ocho valores de byte. Con un alfabeto que no dividiera
  // a 256 habria que rechazar y reintentar.
  const bytes = new Uint8Array(LONGITUD_AZAR);
  globalThis.crypto.getRandomValues(bytes);

  let texto = "";
  for (const byte of bytes) texto += ALFABETO[byte % BASE];
  return texto;
};

/**
 * Genera un identificador para `instante` (por omision, ahora).
 *
 * **No es monotono dentro del mismo segundo**, y no necesita serlo. Donde el
 * orden fino importa —la bitacora— la clave de ordenamiento es
 * `<ocurridoEn>#<eventoId>`: el instante manda al milisegundo y el
 * identificador solo desempata. Y la causalidad entre eventos simultaneos no se
 * infiere del orden sino del `correlacionId` que comparten
 * (`trazabilidad-auditoria.md` 2.2).
 */
export const nuevoId = (instante: Date = new Date()): string => {
  const milisegundos = instante.getTime();
  if (Number.isNaN(milisegundos)) {
    throw new RangeError("nuevoId recibio una fecha invalida");
  }
  return codificarTiempo(Math.floor(milisegundos / 1000)) + codificarAzar();
};

const FORMATO_ID = new RegExp(`^[${ALFABETO}]{${String(LONGITUD_ID)}}$`);

/** Reconoce un identificador bien formado. No afirma que exista. */
export const esId = (texto: string): boolean => FORMATO_ID.test(texto);

/**
 * Segundo codificado en un identificador, o `undefined` si el texto no lo es.
 *
 * Existe sobre todo para poder **probar** que el orden lexicografico es el
 * orden cronologico. Como dato de negocio no se usa: la fecha autoritativa
 * siempre es un atributo explicito del item, no algo que haya que decodificar
 * de una clave — y aqui, ademas, se perdio el milisegundo.
 */
export const instanteDeId = (texto: string): Date | undefined => {
  if (!esId(texto)) return undefined;

  let segundos = 0;
  for (const caracter of texto.slice(0, LONGITUD_TIEMPO)) {
    segundos = segundos * BASE + ALFABETO.indexOf(caracter);
  }
  return new Date(segundos * 1000);
};
