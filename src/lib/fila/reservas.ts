// Reserva de turno — el mecanismo que cierra R18
// (`modelo-datos-dynamodb.md` 4.4, validado contra DynamoDB real por el
// prototipo de la Etapa 4.1).
//
// **Que problema resuelve.** Entre el `ADD` que entrega el turno (paso 1 de T1)
// y la transaccion que hace visible la solicitud (paso 2) hay una ventana en la
// que el turno existe pero la fila no lo muestra. Sin marcarla, una adjudicacion
// disparada en ese instante corona a un turno mayor y viola R-08. El prototipo
// lo reproduce de forma determinista: con una pausa deliberada, el turno 2 gana
// el vehiculo del turno 1 en **todas** las corridas.
//
// **Por que es un item propio y no un atributo del lote.** La diferencia se
// midio. Anotar la reserva dentro del item del lote cierra la carrera igual,
// pero obliga al paso 2 a escribir ese item — que comparten todas las
// solicitudes simultaneas—, y DynamoDB no las serializa: las cancela con
// `TransactionConflict`. De 10 solicitudes a la vez se perdian entre 5 y 9. Con
// un item por intento no hay dos transacciones que compartan item
// (`desafios-implementacion.md` 17).
//
// Vive entre `PART#` y `SOL#` en la particion del lote, asi que ninguna
// consulta de la fila la ve.

import { DeleteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

import { clave, PREFIJO } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import {
  esConflictoDeTransaccion,
  esFalloDeCondicion,
} from "@/lib/data/transacciones";

/**
 * Cuanto se espera a una reserva antes de darla por muerta.
 *
 * **Acota la espera, no la correccion.** El paso 2 exige que su reserva siga
 * viva (`attribute_exists(SK)`), asi que un proceso al que ya se le dio por
 * muerto no puede escribir su solicitud tarde con un turno menor que el del
 * ganador: pierde el turno y queda un hueco, que el diseno acepta de forma
 * explicita.
 *
 * 15 s es dos ordenes de magnitud mas que el viaje de red que separa los dos
 * pasos, y mucho menos que la paciencia de quien espera el resultado.
 */
export const UMBRAL_DE_RESERVA_MS = 15_000;

/**
 * La reserva sigue viva en el momento de retirarla.
 *
 * Sin esta condicion el mecanismo seria solo una espera cortes y R18 seguiria
 * abierto, solo que mas dificil de reproducir.
 */
export const CONDICION_RESERVA_VIVA = "attribute_exists(SK)";

/**
 * La reserva es nueva.
 *
 * **No es una formalidad: es lo que impide que dos solicitudes simultaneas se
 * pisen la reserva.** El `reservaId` tiene 25 bits de azar dentro de su segundo
 * (`identificadores.ts`), asi que con cien solicitudes por segundo sobre el
 * mismo lote la probabilidad de repetirlo es ~1,5 x 10^-4. Sin condicion, ese
 * caso sobrescribiria **en silencio** la reserva de otro participante: su
 * ventana quedaria sin marcar, una adjudicacion podria coronar a un turno mayor
 * y R18 dejaria de sostenerse justo en el escenario que existe para cubrir.
 * Con condicion, el que pierde recibe un rechazo reintentable.
 */
export const CONDICION_RESERVA_NUEVA = "attribute_not_exists(SK)";

/**
 * Escribe la reserva. Va **antes** de pedir el turno, no despues: al reves
 * quedaria abierta exactamente la ventana que se quiere cerrar. Al derecho, lo
 * peor que puede pasar es una reserva huerfana que el umbral depura.
 *
 * Devuelve `false` si el `reservaId` ya existia — ver
 * `CONDICION_RESERVA_NUEVA`. Se devuelve en vez de lanzar porque quien llama
 * tiene que poder responder `conflicto_concurrencia`, que es un rechazo que la
 * interfaz sabe reintentar, y no un 500 (`desafios-implementacion.md` 41).
 */
export const anotarReserva = async (
  entrada: { loteId: string; reservaId: string; ahora: Date },
  deps: DepsDeServicio = {},
): Promise<boolean> => {
  try {
    await clienteDe(deps).send(
      new PutCommand({
        TableName: nombreDeTabla(),
        Item: {
          ...clave.reservaDeTurno(entrada.loteId, entrada.reservaId),
          anotadaEn: entrada.ahora.toISOString(),
        },
        ConditionExpression: CONDICION_RESERVA_NUEVA,
      }),
    );
    return true;
  } catch (error) {
    if (esFalloDeCondicion(error)) return false;
    throw error;
  }
};

/**
 * Retira una reserva. Idempotente: que ya no exista es exito, no error.
 *
 * Compensa un paso 1 o un paso 2 fallidos, y depura las muertas desde la
 * adjudicacion. Es de **mejor esfuerzo**: la correccion no depende de ella,
 * solo la espera.
 */
export const liberarReserva = async (
  entrada: { loteId: string; reservaId: string },
  deps: DepsDeServicio = {},
): Promise<void> => {
  try {
    await clienteDe(deps).send(
      new DeleteCommand({
        TableName: nombreDeTabla(),
        Key: clave.reservaDeTurno(entrada.loteId, entrada.reservaId),
      }),
    );
  } catch (error) {
    if (esFalloDeCondicion(error)) return;
    // El item de la reserva **si** participa en transacciones: el paso 2 de T1
    // lo borra dentro de la suya. Cuando `depurarYContarReservas` retira una
    // reserva muerta que en ese instante esta siendo borrada por el paso 2 de
    // su propia solicitud, DynamoDB rechaza esta operacion suelta con
    // `TransactionConflictException`.
    //
    // Se ignora, porque significa exactamente lo que este helper ya declara
    // tolerar: alguien mas la esta resolviendo. Dejarla escapar convertiria una
    // limpieza de mejor esfuerzo en una adjudicacion fallida — `adjudicarLote`
    // llama a `depurarYContarReservas` en cada ronda (`desafios-implementacion.md` 41).
    if (esConflictoDeTransaccion(error)) return;
    throw error;
  }
};

/**
 * Cuenta las reservas vigentes de un lote y retira las muertas.
 *
 * La lectura es **fuertemente consistente** y decide unicamente si abstenerse.
 * No concede nada: quien gana el lote lo sigue decidiendo la escritura
 * condicional del item 1 de T2 (regla 6). Una lectura que solo puede detener
 * nunca puede autorizar de mas.
 *
 * Retirar las muertas es lo que impide que un proceso caido bloquee el lote
 * para siempre; su paso 2, si algun dia llega, fallara por la condicion.
 */
export const depurarYContarReservas = async (
  entrada: { loteId: string; ahora: Date; umbralMs?: number },
  deps: DepsDeServicio = {},
): Promise<number> => {
  const umbral = entrada.umbralMs ?? UMBRAL_DE_RESERVA_MS;

  const salida = await clienteDe(deps).send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefijo)",
      ExpressionAttributeValues: {
        // El identificador de relleno solo construye la particion del lote; las
        // claves se siguen armando en un unico lugar.
        ":pk": clave.reservaDeTurno(entrada.loteId, "x").PK,
        ":prefijo": PREFIJO.reservaDeTurno,
      },
      ConsistentRead: true,
    }),
  );

  let vigentes = 0;
  for (const item of salida.Items ?? []) {
    const reservaId = String(item.SK).slice(PREFIJO.reservaDeTurno.length);
    const edad = entrada.ahora.getTime() - Date.parse(String(item.anotadaEn));

    // Una fecha ilegible se trata como vigente y **no** se depura: en la duda,
    // abstenerse retrasa una adjudicacion; depurar de mas la entrega al turno
    // equivocado.
    if (!Number.isFinite(edad) || edad <= umbral) {
      vigentes += 1;
      continue;
    }

    await liberarReserva({ loteId: entrada.loteId, reservaId }, deps);
  }

  return vigentes;
};
