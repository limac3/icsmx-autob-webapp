import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { vi } from "vitest";

/**
 * Cliente de DynamoDB falso para las pruebas de servicio.
 *
 * Captura los comandos enviados en vez de simular la base de datos. Es una
 * decision, no una limitacion: lo que estas pruebas tienen que afirmar es
 * **que se le pide a DynamoDB** —la condicion, las claves del indice, que el
 * evento viaje en la misma transaccion—, y un simulador de DynamoDB solo
 * comprobaria que el simulador coincide con lo que el mismo simulador
 * implementa. Que la base de datos de verdad se comporte como se espera lo
 * verifican las pruebas de integracion contra el sandbox.
 */
export type ComandoEnviado = {
  readonly nombre: string;
  readonly input: Record<string, unknown>;
};

/**
 * El tipo del cliente es un parametro porque el mismo doble sirve para DynamoDB
 * y para S3: los dos clientes del SDK v3 tienen la misma superficie —un `send`
 * que recibe un comando— y duplicar el doble solo duplicaria el mantenimiento.
 */
export type ClienteFalso<T = DynamoDBDocumentClient> = {
  readonly cliente: T;
  /** Comandos enviados, en orden. */
  readonly comandos: ComandoEnviado[];
};

export type OpcionesDeClienteFalso = {
  /** Respuestas sucesivas. Agotadas, se responde un objeto vacio. */
  respuestas?: readonly unknown[];
  /**
   * Respuesta calculada a partir del comando.
   *
   * Preferible a `respuestas` cuando el servicio lanza varias consultas en
   * paralelo: depender del orden en que `Promise.all` las despacha ataria la
   * prueba a un detalle de implementacion que puede cambiar sin romper nada.
   */
  responder?: (comando: ComandoEnviado) => unknown;
  /** Si se define, el cliente lanza esto en vez de responder. */
  lanza?: unknown;
};

export const crearClienteFalso = <T = DynamoDBDocumentClient>(
  opciones: OpcionesDeClienteFalso = {},
): ClienteFalso<T> => {
  const comandos: ComandoEnviado[] = [];
  let siguiente = 0;

  const send = vi.fn(async (comando: unknown): Promise<unknown> => {
    const { constructor, input } = comando as {
      constructor: { name: string };
      input: Record<string, unknown>;
    };
    const enviado = { nombre: constructor.name, input };
    comandos.push(enviado);

    if (opciones.lanza !== undefined) throw opciones.lanza;
    if (opciones.responder) return opciones.responder(enviado);

    const respuesta = opciones.respuestas?.[siguiente] ?? {};
    siguiente += 1;
    return respuesta;
  });

  return {
    cliente: { send } as unknown as T,
    comandos,
  };
};

/** Primer comando de un tipo, para no depender del orden cuando no importa. */
export const comandoDe = (
  { comandos }: ClienteFalso<unknown>,
  nombre: string,
): Record<string, unknown> | undefined =>
  comandos.find((comando) => comando.nombre === nombre)?.input;
