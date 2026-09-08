// Codificacion generica de un cursor de paginacion de DynamoDB.
//
// `LastEvaluatedKey`/`ExclusiveStartKey` son objetos con las claves del indice
// consultado; nunca son secretos ni deben interpretarse, solo transportarse
// entre una respuesta y la peticion siguiente. Por eso el cursor que ve quien
// llama es una cadena opaca: Base64 de su JSON, sin cifrar y sin firmar.
//
// Un cursor corrupto o de otra consulta no debe tirar la pagina completa: se
// ignora y la lectura empieza desde el principio, igual que si no hubiera
// cursor. Es preferible a lanzar, porque quien pega un enlace viejo en la URL
// no esta atacando nada.

export const codificarCursor = (
  clave: Record<string, unknown> | undefined,
): string | undefined =>
  clave
    ? Buffer.from(JSON.stringify(clave), "utf8").toString("base64url")
    : undefined;

export const decodificarCursor = (
  cursor: string | undefined,
): Record<string, unknown> | undefined => {
  if (!cursor) return undefined;
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const valor = JSON.parse(json);
    return valor && typeof valor === "object" ? valor : undefined;
  } catch {
    return undefined;
  }
};
