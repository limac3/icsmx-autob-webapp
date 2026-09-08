import "server-only";

// R-09, la mitad que devuelve lo que la otra congelo.
//
// "Si pierde la adjudicacion (vencimiento, rechazo o cancelacion), sus
// solicitudes `CONGELADA` vuelven a `EN_FILA` con el turno original intacto."
//
// **El turno no se reescribe nunca.** El estatus vuelve a `EN_FILA` y la clave
// `SOL#<turno:010d>` se queda como estaba, asi que el lugar en la fila es
// inmutable por construccion: no hay codigo que pueda adelantar a nadie al
// descongelarlo.
//
// **Fuera de la transaccion que provoca la perdida, y a proposito.** Las
// solicitudes congeladas de un participante son una cantidad no acotada y
// `TransactWriteItems` admite 100; meterlas dentro convertiria una garantia en
// un limite. Cada una se descongela en su propia transaccion —con su evento,
// regla 4— y un fallo aislado deja congelada esa y no bloquea las demas: la
// siguiente perdida, o el barrido de la Etapa 10, vuelven a intentarlo.
//
// Lo que **no** hace es disparar adjudicaciones en los lotes que vuelven a
// tener candidato. Sumar eso aqui encadenaria adjudicaciones en cascada dentro
// de una cancelacion; esos lotes los recoge quien solicite despues o el barrido.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { clave, gsi3, NOMBRES_DE_INDICE } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import { ejecutarTransaccion } from "@/lib/data/transacciones";
import { aSolicitud } from "./mapeo";

/**
 * Tope de solicitudes congeladas que se revisan de una vez. Un participante se
 * forma en unos cuantos lotes, no en cientos; el tope evita que un dato raro
 * convierta una cancelacion en un recorrido sin fin.
 */
export const MAXIMO_A_DESCONGELAR = 100;

/**
 * Devuelve a `EN_FILA` las solicitudes `CONGELADA` del participante.
 *
 * Devuelve cuantas descongelo. No devuelve `Resultado` porque ningun fallo
 * suyo debe tumbar la operacion que la provoco: quien pierde una adjudicacion
 * la pierde igual, y sus congeladas se recuperan en el siguiente intento.
 */
export const descongelarSolicitudes = async (
  entrada: { participanteId: string },
  deps: DepsDeServicio = {},
): Promise<number> => {
  const { ahora } = resolver(deps);

  const salida = await clienteDe(deps).send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      IndexName: NOMBRES_DE_INDICE.porParticipante,
      KeyConditionExpression: "GSI3PK = :pk",
      FilterExpression: "estatus = :congelada",
      ExpressionAttributeValues: {
        // La fecha y el lote de relleno solo construyen la particion; las
        // claves se siguen armando en un unico lugar.
        ":pk": gsi3.solicitudDeParticipante(
          entrada.participanteId,
          "relleno",
          "relleno",
        ).GSI3PK,
        ":congelada": "CONGELADA",
      },
      Limit: MAXIMO_A_DESCONGELAR,
    }),
  );

  let descongeladas = 0;

  for (const item of salida.Items ?? []) {
    const solicitud = aSolicitud(item);
    if (!solicitud) continue;

    const resultado = await ejecutarTransaccion(
      [
        {
          item: {
            Update: {
              TableName: nombreDeTabla(),
              Key: clave.solicitud(solicitud.loteId, solicitud.turno),
              UpdateExpression: "SET #estatus = :enFila",
              ConditionExpression: "#estatus = :congelada",
              ExpressionAttributeNames: { "#estatus": "estatus" },
              ExpressionAttributeValues: {
                ":enFila": "EN_FILA",
                ":congelada": "CONGELADA",
              },
            },
          },
          siFalla: "invalid_state",
          descripcion: `descongelar turno ${String(solicitud.turno)}`,
        },
        eventoParaTransaccion({
          tipo: "SOLICITUD_DESCONGELADA",
          agregado: "LOTE",
          agregadoId: solicitud.loteId,
          actor: { tipo: "SISTEMA" },
          ocurridoEn: ahora,
          correlacionId: nuevaCorrelacion(ahora),
          loteId: solicitud.loteId,
          solicitudId: solicitud.solicitudId,
          estadoAnterior: "CONGELADA",
          estadoNuevo: "EN_FILA",
          datos: { turno: solicitud.turno },
        }),
      ],
      deps,
    );

    if (resultado.ok) descongeladas += 1;
  }

  return descongeladas;
};
