// Fuente: modelo-datos-dynamodb.md seccion 8, y reglas 10 y 15 de CLAUDE.md.
//
// Cliente unico de DynamoDB, **construido de forma diferida**.
//
// Diferido y no en el ambito del modulo por una razon concreta: `next build`
// evalua los modulos que alcanza al recolectar rutas, y un cliente creado al
// importar exigiria region y credenciales en tiempo de compilacion. La
// compuerta debe correr en una maquina sin AWS.
//
// `DynamoDBDocumentClient` en vez del cliente crudo para que el resto del
// codigo escriba objetos de JavaScript y no mapas de `AttributeValue`. La
// prueba de integracion de `amplify/` si usa el cliente crudo: alli lo que se
// ejerce es la politica de IAM, y conviene que no dependa de esta capa.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

let memo: DynamoDBDocumentClient | undefined;

/**
 * Nombre de la tabla unica. Sin valor por defecto y sin fallback silencioso
 * (regla 15): una tabla equivocada es peor que un arranque fallido, porque
 * escribe datos reales en el lugar incorrecto.
 */
export const nombreDeTabla = (): string => {
  const nombre = process.env.AUTOB_TABLE_NAME;
  if (!nombre) {
    throw new Error(
      "Falta AUTOB_TABLE_NAME. La crea `npx ampx sandbox`; ver .env.local.example",
    );
  }
  return nombre;
};

export const obtenerCliente = (): DynamoDBDocumentClient => {
  if (memo) return memo;

  memo = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: {
      // Omitir los atributos `undefined` en lugar de fallar. Sin esto, todo
      // item con un atributo opcional exigiria borrar la clave a mano.
      //
      // **No confundir con `null`.** Un `null` si se escribe, y escribir
      // `adjudicacionActual: null` romperia la exclusion mutua del lote: la
      // condicion `attribute_not_exists(adjudicacionActual)` pasaria sobre un
      // atributo que existe, y el mismo lote se adjudicaria dos veces
      // (modelo-datos 2.2). Ese atributo se quita con `REMOVE`, nunca se
      // asigna.
      removeUndefinedValues: true,
      convertClassInstanceToMap: false,
    },
    unmarshallOptions: {
      // Los numeros del modelo —turno, contador, precio, horas— caben de
      // sobra en un `number`. Envolverlos en `BigInt` obligaria a convertir en
      // cada comparacion, que es donde se cometen los errores.
      wrapNumbers: false,
    },
  });

  return memo;
};

/**
 * Solo para pruebas: descarta el cliente memorizado.
 *
 * Los servicios reciben su cliente por `deps`, asi que casi ningun test lo
 * necesita. Existe para los que ejercen la construccion misma — que la falta
 * de `AUTOB_TABLE_NAME` falle, que el cliente se reuse — sin contaminar al
 * siguiente archivo de pruebas.
 */
export const __test__ = {
  reiniciar: (): void => {
    memo = undefined;
  },
};
