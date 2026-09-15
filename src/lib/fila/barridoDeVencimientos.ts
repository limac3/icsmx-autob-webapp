// Camino A del vencimiento (D-7) — `arquitectura-tecnica-aws.md` 2.6 y 4.4:
//
//   Lambda cada N minutos -> Query GSI4 VENCE#<dia>, GSI4SK <= ahora -> T5
//
// **Idempotente por construccion, no por cuidado.** Cada aplicacion de T5
// (`vencerYReasignar`) es una escritura condicional: si otro camino —el
// barrido de antes, la verificacion perezosa, otra instancia— ya resolvio la
// vencida, la condicion del item 0 falla, la transaccion se cancela sin
// efectos y `vencerYReasignar` devuelve `no_vigente`. Reejecutar el barrido no
// tiene que evitarse; solo tiene que no *hacer* nada la segunda vez
// (`runbooks.md` R-1: "es idempotente, se puede reejecutar sin miedo").
//
// **Tambien recoge los lotes libres con fila viva** —el hueco que
// `modelo-datos-dynamodb.md` deja anotado en el callout de T5b—: T1 y la
// liberacion de T5b/T6 no pueden adjudicar dentro de su propia transaccion, y
// un proceso que muere entre las dos escrituras deja un lote `EN_OFERTA` con
// candidatos y sin nadie que dispare la adjudicacion. Se recorre solo dentro
// de convocatorias `PUBLICADA` —fuera de ahi el lote no admite fila— y solo se
// llama a `adjudicarLote` cuando **ya se sabe** que hay al menos un candidato
// `EN_FILA`: sin esa comprobacion previa, cada lote nuevo y vacio (la
// inmensa mayoria) escribiria un `FILA_AGOTADA` en cada corrida, para
// siempre. `adjudicarLote` no es idempotente en eventos cuando la fila esta
// vacia — solo en mutaciones —, y esa diferencia es la que este barrido evita
// pagar (`desafios-implementacion.md`).
//
// **Y reconcilia el cierre de fila que `avalarPago` no pudo completar.** Ese
// cierre ocurre fuera de la transaccion de la venta, asi que puede fallar con la
// venta ya firme y dejar a los demas viendo una posicion en un lote vendido.
// Antes eso duraba hasta que alguien concluyera la convocatoria; aqui se repara
// en la corrida siguiente. Es el mismo recorrido de lotes que el punto anterior:
// una condicion mas, ninguna lectura extra.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { listarConvocatorias } from "@/lib/convocatorias/listarConvocatorias";
import { clave, gsi4, NOMBRES_DE_INDICE, PREFIJO } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, resolver, type DepsDeServicio } from "@/lib/data/deps";
import { diaDeNegocio } from "@/lib/domain/fechas";
import { registrar } from "@/lib/observabilidad/registro";
import { conTraza } from "@/lib/observabilidad/traza";
import type { Solicitud } from "@/types/fila";
import { adjudicarLote } from "./adjudicarLote";
import { cerrarFilaDelLote } from "./cerrarFilaDelLote";
import { aSolicitud } from "./mapeo";
import { vencerYReasignar } from "./vencerYReasignar";

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Cuantos dias de GSI4 revisa cada corrida. El indice esta particionado por
 * dia de vencimiento (modelo-datos 3); tres dias de holgura cubren un barrido
 * que no corrio durante un fin de semana sin tener que recorrer el historial
 * entero.
 */
export const DIAS_HACIA_ATRAS = 3;

export type ResultadoDeBarrido = {
  vencimientosResueltos: number;
  vencimientosAbstenidos: number;
  /** Reintentos agotados (`en_conflicto`) o datos inconsistentes. El siguiente barrido reintenta. */
  errores: number;
  lotesRecuperados: number;
  /**
   * Solicitudes cerradas al reconciliar un lote ya vendido cuya fila habia
   * quedado viva — el cierre que `avalarPago` no pudo completar.
   *
   * Cuenta aparte de `errores` a proposito: un valor mayor que cero no es un
   * fallo del barrido, es el barrido haciendo su trabajo. Lo que si conviene
   * mirar es que sea distinto de cero **de forma sostenida**, porque significa
   * que algo esta fallando aguas arriba en cada venta.
   */
  filasCerradas: number;
};

export const barridoDeVencimientos = async (
  entrada: { diasHaciaAtras?: number } = {},
  deps: DepsDeServicio = {},
): Promise<ResultadoDeBarrido> =>
  conTraza(
    "barridoDeVencimientos",
    {},
    async () => ejecutarBarrido(entrada, deps),
    (resultado) => ({
      // `errores` cuenta las vencidas que el barrido **encontro y no pudo
      // resolver**: convocatoria ilegible, lote ausente, contencion agotada.
      // Es el sintoma mas grave del sistema —"si esta alarma se dispara, los
      // dos caminos de vencimiento fallaron" (`arquitectura-tecnica-aws.md`
      // 7)—, porque una adjudicacion vencida que sigue vigente bloquea la fila
      // entera de su lote.
      //
      // `vencimientosAbstenidos` no cuenta como rechazo: abstenerse es la
      // respuesta correcta ante turnos en vuelo (R18) y la corrida siguiente
      // lo resuelve.
      desenlace: resultado.errores > 0 ? "rechazado" : "ok",
      ...resultado,
    }),
  );

const ejecutarBarrido = async (
  entrada: { diasHaciaAtras?: number },
  deps: DepsDeServicio,
): Promise<ResultadoDeBarrido> => {
  const { ahora } = resolver(deps);
  const dias = entrada.diasHaciaAtras ?? DIAS_HACIA_ATRAS;

  const resultado: ResultadoDeBarrido = {
    vencimientosResueltos: 0,
    vencimientosAbstenidos: 0,
    errores: 0,
    lotesRecuperados: 0,
    filasCerradas: 0,
  };

  for (let i = 0; i < dias; i += 1) {
    const dia = diaDeNegocio(
      new Date(ahora.getTime() - i * MILISEGUNDOS_POR_DIA),
    );
    const vencidas = await leerVencidasDelDia(dia, ahora, deps);
    for (const solicitud of vencidas) {
      await resolverVencida(solicitud, resultado, deps);
    }
  }

  await reconciliarLotesPublicados(resultado, deps);

  return resultado;
};

/** PA-10: `Query` GSI4 `VENCE#<dia>`, `GSI4SK <= ahora`. */
const leerVencidasDelDia = async (
  dia: string,
  ahora: Date,
  deps: DepsDeServicio,
): Promise<Solicitud[]> => {
  const salida = await clienteDe(deps).send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      IndexName: NOMBRES_DE_INDICE.trabajoPendiente,
      KeyConditionExpression: "GSI4PK = :pk AND GSI4SK <= :ahora",
      ExpressionAttributeValues: {
        // "relleno" solo completa la firma de `gsi4.vencimiento`; la clave que
        // importa aqui es la particion, que depende unicamente del dia. Mismo
        // atajo que `reservas.ts` y `descongelarSolicitudes.ts`.
        ":pk": gsi4.vencimiento(dia, "relleno").GSI4PK,
        ":ahora": ahora.toISOString(),
      },
    }),
  );

  const solicitudes: Solicitud[] = [];
  for (const item of salida.Items ?? []) {
    const solicitud = aSolicitud(item);
    if (solicitud) solicitudes.push(solicitud);
  }
  return solicitudes;
};

/**
 * Resuelve una vencida: lee su lote y aplica T5. No propaga excepciones de
 * negocio — un dato inconsistente cuenta como error y el barrido sigue con la
 * siguiente, en vez de dejar el resto del dia sin revisar.
 */
const resolverVencida = async (
  solicitud: Solicitud,
  resultado: ResultadoDeBarrido,
  deps: DepsDeServicio,
): Promise<void> => {
  // GSI4 es disperso (modelo-datos 3): un item que aparece aqui deberia seguir
  // ADJUDICADA, pero la lectura no es consistente y puede llegar tarde a un
  // cambio reciente. No es un error, es exactamente D-7.
  if (solicitud.estatus !== "ADJUDICADA") return;

  if (!solicitud.convocatoriaId) {
    resultado.errores += 1;
    return;
  }

  const convocatoria = await obtenerConvocatoria(
    solicitud.convocatoriaId,
    deps,
  );
  if (!convocatoria.ok) {
    resultado.errores += 1;
    return;
  }
  const lote = convocatoria.data.lotes.find(
    (candidato) => candidato.loteId === solicitud.loteId,
  );
  if (!lote) {
    resultado.errores += 1;
    return;
  }

  const desenlace = await vencerYReasignar(
    { lote, solicitudVencida: solicitud, detectadoPor: "BARRIDO" },
    deps,
  );

  switch (desenlace.estado) {
    case "reasignado":
    case "fila_agotada":
      resultado.vencimientosResueltos += 1;
      return;
    case "abstenido":
      resultado.vencimientosAbstenidos += 1;
      return;
    case "no_vigente":
      // Alguien mas ya la resolvio (avalado, rechazo, otra corrida). D-7: los
      // dos caminos compiten sin riesgo.
      return;
    case "en_conflicto":
      resultado.errores += 1;
      return;
  }
};

/**
 * `Query` acotada a la fila de un lote: ¿hay al menos un candidato `EN_FILA`?
 *
 * **Sin `Limit`.** `FilterExpression` se evalua *despues* de leer, asi que un
 * `Limit` acotaria items **leidos**, no items que pasan el filtro — con
 * `Limit: 1` un lote con el primer turno `CANCELADA_POR_PARTICIPANTE` y el
 * segundo `EN_FILA` reportaria "sin fila" por error. Una fila cabe de sobra en
 * una sola pagina.
 */
const hayFilaViva = async (
  loteId: string,
  deps: DepsDeServicio,
): Promise<boolean> => {
  const salida = await clienteDe(deps).send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefijo)",
      FilterExpression: "estatus = :enFila",
      ExpressionAttributeValues: {
        ":pk": clave.solicitud(loteId, 0).PK,
        ":prefijo": PREFIJO.solicitud,
        ":enFila": "EN_FILA",
      },
      Select: "COUNT",
    }),
  );
  return (salida.Count ?? 0) > 0;
};

/**
 * Estatus de lote en los que una fila viva **no tiene sentido**: el lote ya
 * salio de juego y quien siguiera `EN_FILA` o `CONGELADA` espera algo que no va
 * a pasar. `EN_OFERTA` y `ADJUDICADO` no estan aqui a proposito — en el primero
 * la fila espera su turno, y en el segundo sigue abierta por R-17.
 */
const CERRADOS = ["VENDIDO", "NO_VENDIDO"] as const;

/**
 * Un recorrido, dos reparaciones. Las dos sobre los lotes de las convocatorias
 * `PUBLICADA`, que es donde puede haber fila viva.
 *
 *  1. **Lotes `EN_OFERTA` con fila viva que nadie llego a adjudicar** (callout
 *     de T5b en `modelo-datos-dynamodb.md`): T1 y la liberacion no pueden
 *     adjudicar dentro de su propia transaccion, asi que un proceso que muere
 *     entre las dos escrituras deja el lote sin nadie que dispare la
 *     adjudicacion.
 *  2. **Lotes ya cerrados con fila viva detras**: `avalarPago` confirma la
 *     venta en su transaccion y cierra la fila **despues**, fuera de ella. Si
 *     ese cierre falla —o si se corta a mitad de una tanda—, la venta queda
 *     firme y los demas siguen viendo una posicion en un lote vendido. Antes
 *     eso duraba hasta que alguien concluyera la convocatoria; aqui se repara
 *     en la corrida siguiente.
 *
 * Acotado a `PUBLICADA` y no a todo el catalogo porque al concluir la
 * convocatoria `concluirConvocatoria` ya recorre **todos** sus lotes y cierra
 * lo que quede: entre las dos, la ventana se cubre completa.
 *
 * `contadorTurnos === 0` descarta sin ninguna lectura extra al lote que nunca
 * tuvo una sola solicitud —la inmensa mayoria del inventario en cualquier
 * instante— y `hayFilaViva` descarta al que las tuvo pero ya se resolvieron
 * todas.
 */
const reconciliarLotesPublicados = async (
  resultado: ResultadoDeBarrido,
  deps: DepsDeServicio,
): Promise<void> => {
  const publicadas = await listarConvocatorias(
    { estatus: ["PUBLICADA"] },
    deps,
  );
  if (!publicadas.ok) {
    resultado.errores += 1;
    return;
  }

  for (const convocatoria of publicadas.data) {
    const detalle = await obtenerConvocatoria(
      convocatoria.convocatoriaId,
      deps,
    );
    if (!detalle.ok) {
      resultado.errores += 1;
      continue;
    }

    for (const lote of detalle.data.lotes) {
      const cerrado = (CERRADOS as readonly string[]).includes(lote.estatus);
      if (lote.contadorTurnos === 0) continue;
      if (lote.estatus !== "EN_OFERTA" && !cerrado) continue;
      if (!(await hayFilaViva(lote.loteId, deps))) continue;

      if (cerrado) {
        const cierre = await cerrarFilaDelLote(
          { lote, actor: { tipo: "SISTEMA" } },
          deps,
        );
        if (cierre.ok) {
          resultado.filasCerradas += cierre.data;
        } else {
          // No entra en `errores` a proposito: esa cuenta mide vencidas que no
          // se pudieron resolver y es lo que dispara
          // `vencimientos-sin-resolver`, "el sintoma mas grave del sistema".
          // Meter aqui un cierre fallido cambiaria lo que esa alarma significa.
          registrar("warn", "cerrarFilaDelLote", {
            loteId: lote.loteId,
            convocatoriaId: lote.convocatoriaId,
            desenlace: "rechazado",
            error: cierre.error,
            descripcion:
              "reconciliacion del barrido: el cierre volvio a fallar",
          });
        }
        continue;
      }

      // **Los lotes manuales no se recuperan, y esto es R21** (R-23).
      //
      // Un lote esperando la decision del adjudicador es, para el resto de esta
      // funcion, **indistinguible** de uno automatico que se quedo sin
      // adjudicar: `EN_OFERTA`, con fila viva y sin `adjudicacionActual`. Sin
      // esta linea el barrido nocturno adjudicaria al turno menor por su cuenta
      // y desharia la modalidad entera — en silencio, de madrugada, y con un
      // `LOTE_ADJUDICADO` que diria `RECUPERACION_POR_BARRIDO`.
      //
      // Va aqui y no antes de `hayFilaViva` a proposito: un lote manual cuya
      // convocatoria ya cerro **si** debe pasar por el cierre de fila de arriba,
      // que es lo que deja a los que no alcanzaron en `NO_ADJUDICADA`.
      if (lote.modalidadAdjudicacion === "MANUAL") continue;

      const desenlace = await adjudicarLote(
        { lote, motivo: "RECUPERACION_POR_BARRIDO" },
        deps,
      );
      if (desenlace.estado === "adjudicado") resultado.lotesRecuperados += 1;
    }
  }
};

export const __test__ = { leerVencidasDelDia, hayFilaViva, resolverVencida };
