// Registro operativo estructurado — `arquitectura-tecnica-aws.md` 7:
// "una linea por operacion, con `correlacionId` compartido con la bitacora".
//
// **No es la bitacora de auditoria y no la sustituye.** Aquel documento lo dice
// en una frase que conviene no perder de vista: "el registro operativo es
// distinto de la bitacora; aquel es para depurar y caduca, esta es para probar
// y no caduca". De ahi salen las dos diferencias que importan:
//
//   - Este registro **puede perderse** sin romper nada. Si escribirlo falla, la
//     operacion continua. Lo contrario —regla 4— es la bitacora: si su evento
//     no se puede escribir, la mutacion no ocurre.
//   - Este registro **no lleva identidad de personas**. La bitacora si, porque
//     su proposito es responder quien hizo que; un registro de depuracion que
//     acumule correos y nombres solo agrega superficie de fuga a cambio de
//     nada. `redactar` lo hace cumplir en tiempo de ejecucion.
//
// El `correlacionId` es el hilo que une los dos: el mismo valor que viaja en
// los eventos de la transaccion aparece en esta linea, asi que un hallazgo de
// auditoria se puede llevar al registro tecnico y al reves.

/** Un ULID compartido con los eventos de la transaccion (`eventos.ts`). */
export type CorrelacionId = string;

export const NIVELES = ["info", "warn", "error"] as const;
export type Nivel = (typeof NIVELES)[number];

/**
 * Catalogo cerrado de operaciones con traza.
 *
 * Cerrado a proposito, y no un `string` libre: `operacion` es lo que agrupa las
 * consultas de Logs Insights de `runbooks.md` y lo que dimensiona los filtros
 * de metrica de `amplify/alarmas.ts`. Un nombre escrito de dos formas parte una
 * serie en dos y la alarma deja de ver la mitad de los datos.
 *
 * Las tres primeras son las "operaciones criticas" que nombra
 * `arquitectura-tecnica-aws.md` 7 (solicitar, adjudicar, vencer). Las demas se
 * agregan por un criterio comun: **su fallo no lo reporta ningun usuario**, asi
 * que sin esta linea no hay forma de enterarse. Cada una dice abajo por que
 * cumple ese criterio.
 */
export const OPERACIONES = [
  "solicitarCompra",
  "adjudicarLote",
  "vencerYReasignar",
  "barridoDeVencimientos",
  "procesarOutbox",
  "transaccion",
  // De mejor esfuerzo y fuera de toda transaccion: su fallo no cancela nada,
  // asi que la unica forma de enterarse es esta linea (`session.ts`).
  "registrarPerfil",
  // Por la misma razon que las dos del barrido: cuando el cierre de la fila
  // falla **despues** de que la venta quedo firme (`avalarPago`), nadie lo
  // reporta — el tesorero ve la venta hecha y los participantes solo ven una
  // posicion que ya no significa nada. Esta linea es la unica forma de
  // enterarse antes de que el barrido lo repare.
  "cerrarFilaDelLote",
] as const;
export type Operacion = (typeof OPERACIONES)[number];

/**
 * Valores admitidos en una linea de registro.
 *
 * Sin arreglos, a proposito. Una lista sin cota superior convierte una linea de
 * registro en un volcado: encarece CloudWatch de forma proporcional al tamano
 * de la fila y hace inservible la consulta. Lo que se necesita de una lista es
 * su tamano, y eso es un numero.
 */
export type ValorDeRegistro =
  | string
  | number
  | boolean
  | null
  | undefined
  | { readonly [clave: string]: ValorDeRegistro };

export type CamposDeRegistro = Readonly<Record<string, ValorDeRegistro>>;

export type LineaDeRegistro = {
  nivel: Nivel;
  operacion: Operacion;
  /** ISO-8601 UTC. Lambda agrega el suyo; este sobrevive fuera de Lambda. */
  en: string;
} & CamposDeRegistro;

/**
 * Nombres de campo cuyo **valor** nunca se escribe.
 *
 * No es una lista de datos "privados" en abstracto: es la lista de los que ya
 * existen en el dominio y no aportan nada a un diagnostico. `participanteId`
 * **no** esta aqui y es deliberado — es un ULID interno, no una identidad
 * legible, y sin el no se puede diagnosticar el runbook R-8 ("sospecha de orden
 * injusto en una fila"), que consiste precisamente en seguir a un participante
 * por la fila.
 *
 * `destinatario` si esta: es la direccion de correo del adjudicado, que es lo
 * que el outbox trae a mano y lo que se colaria sin pensarlo al registrar un
 * fallo de envio.
 */
export const CAMPOS_REDACTADOS = new Set([
  "correo",
  "email",
  "destinatario",
  "nombre",
  "name",
  "telefono",
  "authorization",
  "password",
  "contrasena",
  "secreto",
  "token",
]);

export const MARCA_DE_REDACCION = "[redactado]";

/**
 * Sustituye los valores sensibles por una marca visible, en vez de omitir la
 * clave.
 *
 * Omitirla dejaria un registro que parece completo y no lo esta. La marca dice
 * "aqui habia algo y se quito a proposito", que es lo que permite distinguir un
 * campo redactado de un campo que nadie paso.
 */
export const redactar = (campos: CamposDeRegistro): CamposDeRegistro => {
  const salida: Record<string, ValorDeRegistro> = {};
  for (const [clave, valor] of Object.entries(campos)) {
    if (CAMPOS_REDACTADOS.has(clave)) {
      salida[clave] = MARCA_DE_REDACCION;
    } else if (typeof valor === "object" && valor !== null) {
      salida[clave] = redactar(valor);
    } else {
      salida[clave] = valor;
    }
  }
  return salida;
};

const escribir: Record<Nivel, (linea: LineaDeRegistro) => void> = {
  // Se pasa el **objeto** y no `JSON.stringify(objeto)`. Con el formato JSON de
  // Lambda (`amplify/barrido/resource.ts`), una cadena queda como
  // `message: "{\"operacion\":...}"` —JSON escapado dentro de JSON, que Logs
  // Insights no sabe recorrer— mientras que un objeto queda como
  // `message.operacion` y se consulta directo.
  info: (linea) => {
    console.info(linea);
  },
  warn: (linea) => {
    console.warn(linea);
  },
  error: (linea) => {
    console.error(linea);
  },
};

/**
 * Dentro de Vitest no se escribe nada.
 *
 * Se comprueba `VITEST` y **no** una variable propia del tipo
 * `REGISTRO_OPERATIVO=off`. Una variable asi seria una palanca para apagar todo
 * el diagnostico en produccion sin que nada lo delate, que es justo la clase de
 * fallback silencioso que prohibe la regla 15. `VITEST` solo existe dentro del
 * corredor de pruebas: no hay forma de activarla por error en un despliegue.
 *
 * Sin esto, la compuerta escupe unas tres mil lineas de traza —el motor de fila
 * se ejercita cientos de veces— y el resultado de `verify:rapido` deja de ser
 * legible, que es la unica cosa que esa compuerta tiene que hacer bien.
 */
const silenciado = (): boolean => process.env.VITEST !== undefined;

/**
 * Escribe una linea de registro operativo.
 *
 * **Nunca lanza.** Es la contrapartida de la regla 15: un fallo de
 * infraestructura de negocio tiene que ser explicito, pero un fallo al
 * *registrar* no puede tumbar la operacion que estaba describiendo. Si la
 * consola falla —o si un campo no es serializable— se pierde la linea y la
 * adjudicacion sigue adelante.
 */
export const registrar = (
  nivel: Nivel,
  operacion: Operacion,
  campos: CamposDeRegistro = {},
): void => {
  if (silenciado()) return;

  try {
    escribir[nivel]({
      ...redactar(campos),
      nivel,
      operacion,
      en: new Date().toISOString(),
    });
  } catch {
    // Sin reintento y sin ruido: si el propio registro no funciona, insistir
    // solo cambia una linea perdida por dos.
  }
};
