import "server-only";

// Dependencias inyectables de los servicios de vehiculo — estrategia 2.2.
//
// Estan en un archivo compartido y no repetidas en cada servicio porque los
// cinco necesitan exactamente las mismas tres, y porque `ahora` y `nuevoId`
// solo sirven si **todos** las usan: basta un servicio que llame a `new Date()`
// por su cuenta para que una prueba de frontera de tiempo deje de ser
// determinista sin que nadie lo note.

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { obtenerCliente } from "@/lib/data/cliente";
import { nuevoUlid } from "@/lib/data/identificadores";
export type { ActorUsuario } from "@/types/auditoria";

export type DepsDeVehiculos = {
  cliente?: DynamoDBDocumentClient;
  /** Reloj inyectable: sin el, las fronteras de tiempo no son probables. */
  ahora?: () => Date;
  /** Generador de identificadores, para que las pruebas sepan que esperar. */
  nuevoId?: () => string;
};

export type DepsResueltas = {
  cliente: DynamoDBDocumentClient | undefined;
  ahora: Date;
  nuevoId: () => string;
};

/**
 * Resuelve las dependencias una sola vez por invocacion.
 *
 * `ahora` se congela a proposito: si cada uso llamara al reloj, una operacion
 * podria escribir `creadoEn` y `actualizadoEn` con milisegundos distintos, y el
 * evento con un tercero. Un instante por acto es lo que hace que la bitacora y
 * el item cuenten la misma historia.
 *
 * `cliente` se deja `undefined` cuando no se inyecta, en vez de resolverlo aqui:
 * asi las operaciones que no tocan DynamoDB —una validacion que falla temprano—
 * no fuerzan la construccion del cliente ni exigen credenciales.
 */
export const resolver = (deps: DepsDeVehiculos): DepsResueltas => ({
  cliente: deps.cliente,
  ahora: (deps.ahora ?? (() => new Date()))(),
  nuevoId: deps.nuevoId ?? (() => nuevoUlid()),
});

/** Cliente efectivo, para las operaciones de lectura que no usan transaccion. */
export const clienteDe = (deps: DepsDeVehiculos): DynamoDBDocumentClient =>
  deps.cliente ?? obtenerCliente();
