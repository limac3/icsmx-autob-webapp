// ULID — identificadores ordenables por tiempo.
//
// `modelo-datos-dynamodb.md` y `trazabilidad-auditoria.md` los exigen para
// `participanteId`, `vehiculoId`, `eventoId` y `correlacionId`. La razon es la
// misma en todos los casos: un UUID v4 es aleatorio, asi que una lista de
// identificadores no dice nada sobre el orden en que se crearon. Un ULID lleva
// el milisegundo en los primeros 10 caracteres y **ordena lexicograficamente
// igual que cronologicamente**, que es justo lo que necesita una clave de
// ordenamiento de DynamoDB.
//
// Se implementa aqui en lugar de agregar una dependencia: son treinta lineas de
// una especificacion estable, y el alfabeto de Crockford resuelve de paso la
// restriccion de `claves.ts` —ningun caracter es `#`— sin tener que confiar en
// que un paquete externo la respete.

/**
 * Alfabeto base32 de Crockford. Excluye `I`, `L`, `O` y `U`: las tres primeras
 * para que no se confundan con `1` y `0` al leerlas o dictarlas, y la `U` para
 * que ninguna combinacion accidental forme una palabra ofensiva.
 */
const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BASE = ALFABETO.length; // 32

const LONGITUD_TIEMPO = 10;
const LONGITUD_AZAR = 16;
export const LONGITUD_ULID = LONGITUD_TIEMPO + LONGITUD_AZAR; // 26

/**
 * Instante maximo representable: 48 bits de milisegundos, el ano 10889.
 *
 * Se comprueba en vez de dejarlo desbordar en silencio, porque un desbordamiento
 * produciria un identificador que **ordena antes** que los anteriores y romperia
 * la unica propiedad por la que se eligio un ULID.
 */
export const INSTANTE_MAXIMO = 281_474_976_710_655; // 2^48 - 1

const codificarTiempo = (milisegundos: number): string => {
  if (
    !Number.isInteger(milisegundos) ||
    milisegundos < 0 ||
    milisegundos > INSTANTE_MAXIMO
  ) {
    throw new RangeError(
      `Instante fuera del rango de un ULID: ${String(milisegundos)}`,
    );
  }

  let resto = milisegundos;
  let texto = "";
  for (let i = 0; i < LONGITUD_TIEMPO; i += 1) {
    texto = ALFABETO[resto % BASE] + texto;
    resto = Math.floor(resto / BASE);
  }
  return texto;
};

const codificarAzar = (): string => {
  // 16 caracteres de 5 bits = 80 bits de entropia.
  //
  // `byte % 32` **no** introduce sesgo porque 256 es multiplo exacto de 32: cada
  // simbolo sale de ocho valores de byte. Con un alfabeto que no dividiera a 256
  // habria que rechazar y reintentar.
  const bytes = new Uint8Array(LONGITUD_AZAR);
  globalThis.crypto.getRandomValues(bytes);

  let texto = "";
  for (const byte of bytes) texto += ALFABETO[byte % BASE];
  return texto;
};

/**
 * Genera un ULID para `instante` (por omision, ahora).
 *
 * **No es monotono dentro del mismo milisegundo**, y no necesita serlo. Donde el
 * orden importa —la bitacora— la clave de ordenamiento es
 * `<ocurridoEn>#<eventoId>`: el instante manda y el ULID solo desempata. Y la
 * causalidad entre eventos simultaneos no se infiere del orden sino del
 * `correlacionId` que comparten (`trazabilidad-auditoria.md` 2.2).
 */
export const nuevoUlid = (instante: Date = new Date()): string => {
  const milisegundos = instante.getTime();
  if (Number.isNaN(milisegundos)) {
    throw new RangeError("nuevoUlid recibio una fecha invalida");
  }
  return codificarTiempo(milisegundos) + codificarAzar();
};

const FORMATO_ULID = new RegExp(`^[${ALFABETO}]{${String(LONGITUD_ULID)}}$`);

/** Reconoce un ULID bien formado. No afirma que exista. */
export const esUlid = (texto: string): boolean => FORMATO_ULID.test(texto);

/**
 * Instante codificado en un ULID, o `undefined` si el texto no lo es.
 *
 * Existe sobre todo para poder **probar** que el orden lexicografico es el orden
 * cronologico. Como dato de negocio no se usa: la fecha autoritativa siempre es
 * un atributo explicito del item, no algo que haya que decodificar de una clave.
 */
export const instanteDeUlid = (texto: string): Date | undefined => {
  if (!esUlid(texto)) return undefined;

  let milisegundos = 0;
  for (const caracter of texto.slice(0, LONGITUD_TIEMPO)) {
    milisegundos = milisegundos * BASE + ALFABETO.indexOf(caracter);
  }
  return new Date(milisegundos);
};
