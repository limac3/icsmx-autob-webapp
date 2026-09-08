import "server-only";

// Fuente: modelo-datos-dynamodb.md seccion 6, y reglas 4, 5 y 6 de CLAUDE.md.
//
// Helpers de `TransactWriteItems` y traduccion de sus fallos a errores de
// dominio.
//
// El problema que resuelve este archivo es concreto. `TransactionCanceledException`
// trae `CancellationReasons` **posicional**: un arreglo paralelo a los items,
// donde el que fallo dice `ConditionalCheckFailed` y los demas dicen `None`.
// Tratar todas las cancelaciones igual haria imposible distinguir "el lote ya
// se adjudico, abortar" de "este candidato ya tiene una adjudicacion, probar
// con el siguiente" — y esas dos reacciones son opuestas (T2).
//
// La solucion es obligar a que cada item declare, en el punto de llamada, que
// significa que falle **su** condicion. La posicion deja de ser un detalle que
// hay que recordar y pasa a estar escrita junto al item que la produce.

import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
  TransactionConflictException,
  type CancellationReason,
} from "@aws-sdk/client-dynamodb";
import {
  TransactWriteCommand,
  type DynamoDBDocumentClient,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";

import { registrar } from "@/lib/observabilidad/registro";
import type { CodigoError } from "@/types/resultado";
import { nombreDeTabla, obtenerCliente } from "./cliente";
import type { Clave } from "./claves";

type ItemCrudo = NonNullable<
  TransactWriteCommandInput["TransactItems"]
>[number];

/**
 * Un item de la transaccion junto con el significado de negocio de su
 * condicion.
 *
 * `siFalla` es obligatorio incluso para los items sin `ConditionExpression`:
 * cuesta poco y evita el caso en que alguien agrega una condicion despues y
 * olvida decir que significa.
 */
export type ItemDeTransaccion = {
  item: ItemCrudo;
  /** Codigo de dominio a devolver si **este** item cancela la transaccion. */
  siFalla: CodigoError;
  /** Etiqueta corta para el diagnostico. No se le muestra al participante. */
  descripcion: string;
};

export type ResultadoDeTransaccion =
  | { ok: true }
  | {
      ok: false;
      error: CodigoError;
      /** Posicion del item que cancelo, o `undefined` si no fue una condicion. */
      indice?: number;
      descripcion?: string;
    };

/**
 * Limite duro de `TransactWriteItems`. T8 procesa por tandas justamente por
 * esto: una convocatoria con mas de ~95 lotes no cabe en una transaccion.
 */
export const MAXIMO_ITEMS_POR_TRANSACCION = 100;

/**
 * Condicion que hace append-only la bitacora — regla 5.
 *
 * IAM **no** puede impedir la sobrescritura, porque `PutItem` es justamente lo
 * que la regla 4 obliga a permitir, y un `Put` con la misma clave reemplaza el
 * item completo. Esta comprobado contra AWS real en
 * `amplify/auditoriaInmutable.integracion.test.ts`. La condicion es lo que
 * convierte "no se puede modificar" en "no se puede modificar **ni**
 * reescribir".
 */
export const CONDICION_APPEND_ONLY = "attribute_not_exists(PK)";

/**
 * Condicion de exclusion mutua de la adjudicacion — regla 6 y R-08.
 *
 * Se gana con escritura condicional, nunca con una lectura previa: ante N
 * intentos simultaneos DynamoDB deja pasar exactamente uno. "Leer y luego
 * decidir" es una carrera.
 */
export const CONDICION_LOTE_LIBRE = "attribute_not_exists(adjudicacionActual)";

/** Condicion de creacion de cualquier item centinela (modelo-datos 4). */
export const CONDICION_CENTINELA_NUEVO = "attribute_not_exists(SK)";

/**
 * `Put` de un evento de auditoria, con la condicion append-only ya puesta.
 *
 * Existe para que ningun llamador pueda olvidarla. La regla 4 exige que el
 * evento viaje en la misma transaccion que la mutacion, asi que este helper se
 * usa siempre dentro de `ejecutarTransaccion`, nunca suelto.
 *
 * `siFalla` es `conflicto_concurrencia` y no `validation_failed` a proposito:
 * si la clave ya existe, o bien se reintento una transaccion que ya se aplico,
 * o bien dos eventos colisionaron en el mismo milisegundo con el mismo
 * identificador. Ninguna de las dos es culpa de quien opera.
 */
export const putDeEvento = (
  clave: Clave,
  atributos: Record<string, unknown>,
): ItemDeTransaccion => ({
  item: {
    Put: {
      TableName: nombreDeTabla(),
      Item: { ...atributos, ...clave },
      ConditionExpression: CONDICION_APPEND_ONLY,
    },
  },
  siFalla: "conflicto_concurrencia",
  descripcion: `evento ${clave.PK} ${clave.SK}`,
});

type Deps = {
  cliente?: DynamoDBDocumentClient;
};

/**
 * Ejecuta la transaccion y traduce su fallo a un error de dominio.
 *
 * **Nunca lanza por un fallo de negocio** (estrategia 3): devuelve
 * `{ ok: false, error }`. Un fallo de infraestructura que no sea una
 * cancelacion si escapa, porque no hay nada sensato que la capa superior pueda
 * hacer con el.
 */
export const ejecutarTransaccion = async (
  items: readonly ItemDeTransaccion[],
  deps: Deps = {},
): Promise<ResultadoDeTransaccion> => {
  if (items.length === 0) {
    throw new RangeError("ejecutarTransaccion recibio una lista vacia");
  }
  if (items.length > MAXIMO_ITEMS_POR_TRANSACCION) {
    // No se parte en tandas automaticamente: dos transacciones no son una
    // transaccion, y partir una escritura que se creia atomica es la clase de
    // ayuda que rompe invariantes en silencio. Quien necesite tandas las
    // orquesta explicitamente, como hace T8.
    throw new RangeError(
      `TransactWriteItems admite ${MAXIMO_ITEMS_POR_TRANSACCION} items y se pasaron ${items.length}`,
    );
  }

  const cliente = deps.cliente ?? obtenerCliente();

  try {
    await cliente.send(
      new TransactWriteCommand({ TransactItems: items.map((i) => i.item) }),
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof TransactionCanceledException) {
      const traducido = traducirCancelacion(error, items);
      registrarCancelacion(error, items, traducido);
      return traducido;
    }
    throw error;
  }
};

/**
 * Deja constancia operativa de **por que** se cancelo una transaccion.
 *
 * Se registra aqui y no en cada llamador porque este es el unico punto que ve
 * las tres cosas a la vez: el codigo crudo de DynamoDB, la posicion del item
 * que fallo y la `descripcion` que quien escribio la transaccion le puso. La
 * traza de la operacion (`conTraza`) dice que la adjudicacion se rechazo; solo
 * esta linea dice que fallo la condicion del item 0, "lote L7 libre".
 *
 * Solo en el fallo. Una linea por transaccion exitosa multiplicaria el volumen
 * de CloudWatch por el de las escrituras del sistema sin agregar nada que la
 * traza de la operacion no diga ya.
 */
const registrarCancelacion = (
  error: TransactionCanceledException,
  items: readonly ItemDeTransaccion[],
  traducido: ResultadoDeTransaccion,
): void => {
  if (traducido.ok) return;

  registrar("warn", "transaccion", {
    error: traducido.error,
    indice: traducido.indice,
    descripcion: traducido.descripcion,
    // Los codigos crudos, en el orden posicional en que los devuelve DynamoDB.
    // `traducirCancelacion` se queda con el primero distinto de "None"; cuando
    // fallan varias condiciones a la vez, esta cadena es lo unico que permite
    // reconstruir si la eleccion fue la correcta.
    codigos: (error.CancellationReasons ?? [])
      .map((motivo) => motivo.Code ?? "?")
      .join(","),
    items: items.length,
  });
};

const traducirCancelacion = (
  error: TransactionCanceledException,
  items: readonly ItemDeTransaccion[],
): ResultadoDeTransaccion => {
  const motivos: readonly CancellationReason[] =
    error.CancellationReasons ?? [];

  // Se busca el **primer** motivo distinto de "None". Cuando fallan varias
  // condiciones a la vez, la primera es la mas especifica por como se ordenan
  // las transacciones del modelo: el item 1 de T2 es "el lote ya esta
  // adjudicado", que aborta el bucle, y los siguientes son razones para
  // continuar con otro candidato. Quedarse con el ultimo invertiria la
  // decision.
  const indice = motivos.findIndex(
    (motivo) => motivo.Code !== undefined && motivo.Code !== "None",
  );

  if (indice === -1) {
    // Cancelada sin motivo atribuible a un item. Es una carrera, no un fallo
    // del usuario: la UI relee y reintenta.
    return { ok: false, error: "conflicto_concurrencia" };
  }

  const motivo = motivos[indice];
  const declarado = items[indice];

  switch (motivo?.Code) {
    case "ConditionalCheckFailed":
      // Aqui vive el valor de este archivo: el codigo lo eligio quien escribio
      // la transaccion, junto al item cuya condicion fallo.
      return {
        ok: false,
        error: declarado?.siFalla ?? "invalid_state",
        indice,
        descripcion: declarado?.descripcion,
      };

    case "TransactionConflict":
      // Otra transaccion toco el mismo item. Es reintentable por definicion.
      return {
        ok: false,
        error: "conflicto_concurrencia",
        indice,
        descripcion: declarado?.descripcion,
      };

    case "ThrottlingError":
    case "ProvisionedThroughputExceeded":
    case "ItemCollectionSizeLimitExceeded":
      return {
        ok: false,
        error: "dependencia_no_disponible",
        indice,
        descripcion: declarado?.descripcion,
      };

    default:
      // `ValidationError` y cualquier codigo nuevo del servicio. Es un defecto
      // de la transaccion que escribimos, no un estado del negocio.
      return {
        ok: false,
        error: "invalid_state",
        indice,
        descripcion: declarado?.descripcion,
      };
  }
};

/**
 * ¿Fallo una escritura condicional **fuera** de una transaccion?
 *
 * El paso 1 de T1 es un `UpdateItem` suelto —`ADD contadorTurnos :uno` con la
 * condicion de venta abierta—, y no puede estar en la transaccion porque
 * `TransactWriteItems` no devuelve valores: el turno que produce el `ADD` no
 * se podria usar como clave del `Put` de la misma transaccion.
 */
export const esFalloDeCondicion = (error: unknown): boolean =>
  error instanceof ConditionalCheckFailedException;

/**
 * ¿Choco una escritura **suelta** contra una transaccion en curso sobre el
 * mismo item?
 *
 * DynamoDB lanza `TransactionConflictException` cuando un `UpdateItem` o un
 * `PutItem` normal toca un item que en ese instante participa en un
 * `TransactWriteItems`. No es lo mismo que el codigo `TransactionConflict`
 * dentro de `CancellationReasons`: aquel llega cuando **la transaccion** es la
 * que pierde; este, cuando la que pierde es la operacion suelta.
 *
 * Existe por el paso 1 de T1, que es la unica escritura del sistema que ocurre
 * fuera de transaccion sobre un item que si esta en otras: el `ADD
 * contadorTurnos` sobre el lote compite con la transaccion de T2, que condiciona
 * y escribe ese mismo item. En `inicioVenta` los dos caminos se cruzan de forma
 * rutinaria.
 *
 * **Es reintentable y hay que tratarlo como tal.** El SDK reintenta por su
 * cuenta —`maxAttempts` vale 3 por omision—, asi que casi nunca llega hasta
 * aqui; cuando llega, es porque la contencion agoto los intentos, y la
 * respuesta correcta es `conflicto_concurrencia` (relee y reintenta), no un
 * error de negocio ni una excepcion sin atrapar.
 *
 * Lo detecto la prueba de carga de la Etapa 12: sin reintentos del SDK, la
 * excepcion escapaba de `solicitarCompra` (`desafios-implementacion.md` 41).
 */
export const esConflictoDeTransaccion = (error: unknown): boolean =>
  error instanceof TransactionConflictException;
