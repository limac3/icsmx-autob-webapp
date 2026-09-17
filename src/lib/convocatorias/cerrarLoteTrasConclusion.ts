// Cierre tardio de un lote que sobrevivio a la conclusion de su convocatoria
// y cuyo compromiso se cayo despues — la cola de R-11, anotada como R-11b.
//
// **De donde sale este caso.** R-18 deja vivo al lote `ADJUDICADO` cuando la
// convocatoria concluye: quien gano antes del cierre tiene derecho a terminar
// de pagar. Si no paga —vencimiento, rechazo de tesoreria o cancelacion— los
// tres caminos hacen lo mismo que harian en una convocatoria abierta: devolver
// el lote a `EN_OFERTA` y el vehiculo a `EN_CONVOCATORIA`, para que lo tome el
// siguiente de la fila. Solo que ya no hay fila ni convocatoria donde tomarlo.
//
// **Por que nada lo recogia.** `CONCLUIDA` es terminal, asi que
// `concluirConvocatoria` no puede volver a correr; la reconciliacion del
// barrido solo recorre convocatorias `PUBLICADA`; y retirar el vehiculo a mano
// exige `BORRADOR`. El vehiculo quedaba `EN_CONVOCATORIA` con su centinela
// puesto: invendible —su convocatoria termino— e inofertable —el centinela lo
// declara activo en ella—, para siempre y en silencio. El sintoma solo aparecia
// semanas despues, al intentar incluirlo en otra convocatoria y recibir un
// rechazo inexplicable.
//
// **Deja exactamente el mismo estado que la conclusion**, porque usa sus mismas
// escrituras: `itemsParaCerrar`, en `cierreDeLote.ts`. Lo unico que agrega es el
// evento de bitacora, y eso tiene razon (ver `LOTE_CERRADO_TRAS_CONCLUSION` en
// `types/auditoria`): alli el resumen de `CONVOCATORIA_CONCLUIDA` responde por
// todos los lotes a la vez, aqui el cierre ocurre dias despues y no hay ningun
// evento que lo cubra.
//
// **Sin `import "server-only"`, como los demas modulos que el barrido alcanza.**
// La guarda lanza al importar bajo el empaquetado de `defineFunction` y tumbaria
// el Lambda en el arranque; es la misma concesion acotada que ya pagaron
// `vencerYReasignar.ts` y `cerrarFilaDelLote.ts`, y la vigila
// `amplify/barrido/alcance.test.ts`. Por eso este archivo importa los
// constructores de `cierreDeLote.ts` y no de `concluirConvocatoria.ts`: aquel
// arrastraria la conclusion entera —y su guarda— dentro del Lambda.

import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { clave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import {
  ejecutarTransaccion,
  type ItemDeTransaccion,
} from "@/lib/data/transacciones";
import type { Lote } from "@/types/lote";
import { exito, fallo, type Resultado } from "@/types/resultado";
import { itemsParaCerrar } from "./cierreDeLote";

export type EntradaDeCierreTardio = {
  /** El lote tal como lo devolvio GSI4. Debe venir `EN_OFERTA`. */
  lote: Lote;
};

export type ResultadoDeCierreTardio = {
  loteId: string;
  vehiculoId: string;
};

/**
 * Cierra el lote, libera su centinela y devuelve el vehiculo al catalogo, todo
 * en una transaccion con su evento (regla 4).
 *
 * **Lo dispara el barrido, no una persona**, asi que el actor es `SISTEMA`. No
 * es politica organizacional y la regla 17 no pide que decida nadie: la
 * decision ya la tomo quien concluyo la convocatoria, y esto solo termina de
 * aplicarla sobre el lote que entonces seguia comprometido. Lo que R-11 si
 * reserva a un administrador —incluir el vehiculo en otra convocatoria— sigue
 * siendo suyo y no cambia.
 *
 * **Idempotente por condicion, como todo el barrido.** Las tres escrituras
 * condicionan sobre el estado que esperan encontrar, asi que una segunda
 * corrida sobre un lote ya cerrado cancela la transaccion sin efectos. El
 * `REMOVE` de las claves de GSI4 viaja dentro, de modo que resolverlo y sacarlo
 * del indice de trabajo pendiente son el mismo acto: no hay ventana en la que
 * el lote este cerrado pero siga apareciendo como pendiente.
 */
export const cerrarLoteTrasConclusion = async (
  entrada: EntradaDeCierreTardio,
  deps: DepsDeServicio = {},
): Promise<Resultado<ResultadoDeCierreTardio>> => {
  const { ahora } = resolver(deps);
  const { lote } = entrada;

  if (lote.estatus !== "EN_OFERTA") return fallo("invalid_state");

  const items: ItemDeTransaccion[] = itemsParaCerrar({
    lote,
    convocatoriaId: lote.convocatoriaId,
    momento: ahora.toISOString(),
    tabla: nombreDeTabla(),
  });
  // `itemsParaCerrar` devuelve vacio si la maquina de estados dejara de admitir
  // `CONCLUIR_CONVOCATORIA` desde `EN_OFERTA`. Escribir solo el evento diria que
  // el lote se cerro cuando no se cerro.
  if (items.length === 0) return fallo("invalid_state");

  items.push(
    eventoParaTransaccion({
      tipo: "LOTE_CERRADO_TRAS_CONCLUSION",
      agregado: "LOTE",
      agregadoId: lote.loteId,
      actor: { tipo: "SISTEMA" },
      ocurridoEn: ahora,
      correlacionId: nuevaCorrelacion(ahora),
      convocatoriaId: lote.convocatoriaId,
      loteId: lote.loteId,
      vehiculoId: lote.vehiculoId,
      estadoAnterior: lote.estatus,
      estadoNuevo: "NO_VENDIDO",
      datos: {
        // Lo que el auditor va a querer saber: por que este lote se cerro solo
        // y semanas despues del resto de su convocatoria.
        razon: "ADJUDICACION_CAIDA_TRAS_CONCLUSION",
        vehiculoLiberado: lote.vehiculoId,
      },
    }),
  );

  const resultado = await ejecutarTransaccion(items, deps);
  if (!resultado.ok) return fallo(resultado.error);

  return exito({ loteId: lote.loteId, vehiculoId: lote.vehiculoId });
};

/**
 * Saca del indice de trabajo pendiente un lote que ya no lo necesita, **sin
 * cambiarle nada mas**.
 *
 * Es el desenlace feliz: el adjudicado pago y el lote quedo `VENDIDO`. No hay
 * nada que reparar, pero la marca de GSI4 sigue puesta —`avalarPago` no sabe de
 * este mecanismo y no tiene por que saberlo— y sin quitarla el barrido volveria
 * a mirar el mismo lote en cada corrida, para siempre.
 *
 * Se limpia aqui y no en `avalarPago` a proposito: acoplar el camino de la
 * venta a este indice lo obligaria a conocer un caso que solo existe en las
 * convocatorias ya concluidas. El precio de limpiarlo tarde es una lectura de
 * mas hasta la siguiente corrida; el de acoplarlo es permanente.
 *
 * La condicion impide una carrera fea: si entre la lectura de GSI4 y esta
 * escritura el lote volviera a `EN_OFERTA`, quitar la marca lo dejaria
 * huerfano — que es el defecto entero que este mecanismo existe para evitar.
 */
export const soltarMarcaDeCierre = async (
  entrada: { lote: Lote },
  deps: DepsDeServicio = {},
): Promise<Resultado<{ loteId: string }>> => {
  const { lote } = entrada;

  try {
    await clienteDe(deps).send(
      new UpdateCommand({
        TableName: nombreDeTabla(),
        Key: clave.lote(lote.convocatoriaId, lote.loteId),
        UpdateExpression: "REMOVE #gsi4pk, #gsi4sk",
        ConditionExpression: "attribute_exists(SK) AND #estatus = :estatus",
        ExpressionAttributeNames: {
          "#estatus": "estatus",
          "#gsi4pk": "GSI4PK",
          "#gsi4sk": "GSI4SK",
        },
        ExpressionAttributeValues: { ":estatus": lote.estatus },
      }),
    );
  } catch {
    return fallo("conflicto_concurrencia");
  }

  return exito({ loteId: lote.loteId });
};
