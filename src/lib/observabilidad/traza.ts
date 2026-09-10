// Trazas de las operaciones criticas — `arquitectura-tecnica-aws.md` 7:
// "Trazas | Operaciones criticas: solicitar, adjudicar, vencer".
//
// **No es AWS X-Ray**, y la diferencia es una decision, no una carencia. Una
// traza distribuida sirve para descubrir *donde* se fue el tiempo entre varios
// servicios; aqui hay un solo proceso hablando con DynamoDB, y lo que hace
// falta saber es otra cosa: que le paso a **esta** solicitud. Eso lo responde
// una linea por operacion con el `correlacionId` que comparte con la bitacora
// —el mismo identificador que el auditor ya tiene delante—, sin agregar el SDK,
// el permiso de IAM ni el costo por traza que X-Ray exige.
//
// Si algun dia hace falta el detalle por segmento, X-Ray se activa por
// configuracion de la funcion y este registro no estorba: el `correlacionId`
// tambien sirve de anotacion.

import { registrar, type CamposDeRegistro, type Operacion } from "./registro";

/**
 * Como termino la operacion.
 *
 * `rechazado` no es `error`. Un lote que ya estaba adjudicado, una fila en la
 * que el participante ya estaba, un plazo vencido: son respuestas correctas del
 * sistema y llenar el registro de `error` con ellas hace inservible cualquier
 * alarma basada en el nivel. `error` queda para lo que nadie previo — una
 * excepcion que escapa.
 */
export const DESENLACES = ["ok", "rechazado", "error"] as const;
export type Desenlace = (typeof DESENLACES)[number];

export type ResumenDeTraza = { desenlace: Desenlace } & CamposDeRegistro;

/**
 * Ejecuta `operar` y deja una linea con su desenlace y su duracion.
 *
 * `resumir` es obligatorio y se pasa en el punto de llamada porque cada
 * operacion critica devuelve una forma distinta —`Resultado<T>` con `ok`,
 * `ResultadoDeAdjudicacion` con `estado`, contadores del barrido— y no hay
 * ninguna regla general que sepa leerlas todas. Adivinarlo con `"ok" in valor`
 * funcionaria hoy y clasificaria mal el primer tipo nuevo, en silencio.
 *
 * **No altera el flujo.** Devuelve lo que devolvio `operar`, y si `operar`
 * lanza, deja la linea en nivel `error` y **vuelve a lanzar**: el registro
 * observa, no decide.
 */
export const conTraza = async <T>(
  operacion: Operacion,
  contexto: CamposDeRegistro,
  operar: () => Promise<T>,
  resumir: (valor: T) => ResumenDeTraza,
): Promise<T> => {
  // Reloj monotono y no el `ahora` inyectable de `DepsDeServicio`. Ese esta
  // congelado a proposito —un instante por acto, para que el item y su evento
  // cuenten la misma historia— asi que medir con el daria siempre cero. Una
  // duracion no es un dato de negocio y no tiene que ser reproducible.
  const inicio = performance.now();

  try {
    const valor = await operar();
    const { desenlace, ...campos } = resumir(valor);

    registrar(desenlace === "ok" ? "info" : "warn", operacion, {
      ...contexto,
      ...campos,
      desenlace,
      duracionMs: Math.round(performance.now() - inicio),
    });

    return valor;
  } catch (error) {
    registrar("error", operacion, {
      ...contexto,
      desenlace: "error",
      // Nombre y mensaje, no la pila. La pila de un error del SDK de AWS ocupa
      // veinte lineas y no dice nada que el nombre no diga; y los fallos de
      // negocio no llegan aqui —los servicios los devuelven como
      // `{ ok: false }` (estrategia 3)—, asi que lo que se registra son
      // errores de infraestructura, sin datos del participante dentro.
      error: descripcionDeError(error),
      duracionMs: Math.round(performance.now() - inicio),
    });

    throw error;
  }
};

const descripcionDeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

export const __test__ = { descripcionDeError };
