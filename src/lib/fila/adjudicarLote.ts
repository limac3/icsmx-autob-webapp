// T2 — adjudicacion. `modelo-datos-dynamodb.md` seccion 6.
//
// **Aqui vive la equidad del sistema.** Tres reglas gobiernan este archivo y
// ninguna es negociable:
//
//  1. **La adjudicacion se gana con escritura condicional, jamas con una
//     lectura previa** (regla 6). Ante N intentos simultaneos, DynamoDB deja
//     pasar exactamente uno. Cualquier "leer el lote y decidir" es una carrera.
//  2. **El orden manda sobre el tiempo** (R-08). Se recorre PA-07, que devuelve
//     la fila ordenada por turno **por construccion** —el relleno de ceros de la
//     `SK`—, y no se ordena nada en memoria.
//  3. **Toda desviacion aparente del orden lleva su propio evento.** Saltarse un
//     turno vivo sin registrarlo es indistinguible de un fraude
//     (`trazabilidad-auditoria.md` 3).
//
// La abstencion por reservas (R18) es lo unico que se decide leyendo, y solo
// puede **detener**: una lectura que nunca concede no puede autorizar de mas.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import {
  clave,
  gsi4,
  identificadorDeSolicitud,
  PREFIJO,
  turnoDesdeClave,
} from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { resolver, type DepsDeServicio } from "@/lib/data/deps";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import { itemsDeQuery } from "@/lib/data/paginacion";
import {
  CONDICION_LOTE_LIBRE,
  ejecutarTransaccion,
} from "@/lib/data/transacciones";
import { diaDeNegocio } from "@/lib/domain/fechas";
import { calcularVenceEn } from "@/lib/domain/plazos";
import { conTraza } from "@/lib/observabilidad/traza";
import { itemsDeEncoladoAdjudicacion } from "@/lib/correo/outbox";
import type { ActorDeEvento } from "@/types/auditoria";
import type { MotivoDeAdjudicacion } from "@/types/fila";
import type { Lote } from "@/types/lote";
import type { CodigoError } from "@/types/resultado";
import { itemDeConsumoDeCupo } from "./cupo";
import { depurarYContarReservas } from "./reservas";

/**
 * Reintentos ante `TransactionConflict` sobre el item del lote.
 *
 * El item del lote es el mutex de la adjudicacion: dos procesos que intentan
 * adjudicar a la vez **tienen** que tocarlo. Cuando DynamoDB cancela por
 * conflicto no dice quien gano, asi que releer y reintentar es la unica
 * respuesta correcta — decidir aqui seria adivinar.
 *
 * Es distinto del conflicto que hundio a la variante descartada de R18: alli el
 * item caliente estaba en el camino de **toda solicitud**; aqui solo en el de la
 * adjudicacion, que ocurre una vez por lote.
 */
export const INTENTOS_DE_ADJUDICACION = 4;

export type ResultadoDeAdjudicacion =
  | {
      estado: "adjudicado";
      turno: number;
      solicitudId: string;
      participanteId: string;
      venceEn: string;
    }
  /** Hay turnos en vuelo que la fila todavia no muestra (R18). */
  | { estado: "abstenido"; reservasVigentes: number }
  /**
   * El lote no esta en juego. Casi siempre porque otro proceso acaba de
   * ganarlo; tambien si su vehiculo no esta `EN_CONVOCATORIA`, que seria una
   * inconsistencia de datos. En los dos casos la respuesta es la misma —
   * abortar el bucle— porque ninguno depende del candidato: reintentar con el
   * turno siguiente solo produciria N fracasos identicos.
   */
  | { estado: "no_adjudicable" }
  /** Ningun candidato vivo pudo tomarlo (R-17). */
  | { estado: "fila_agotada"; turnosRevisados: number }
  /**
   * El lote se adjudica a mano (R-23): aqui no se decide nada. No es un error
   * ni una carrera perdida — es que este lote no le corresponde a esta funcion.
   */
  | { estado: "modalidad_manual" }
  /** Contencion sostenida sobre el item del lote. Reintentable. */
  | { estado: "en_conflicto" };

export type EntradaDeAdjudicacion = {
  /** Ya leido por quien invoca: releerlo abriria una ventana innecesaria. */
  lote: Lote;
  motivo: MotivoDeAdjudicacion;
  umbralDeReservaMs?: number;
  intentos?: number;
  /**
   * Quien firma el `LOTE_ADJUDICADO`. Omitido es `SISTEMA`, que es el caso de
   * los cuatro disparadores automaticos; lo llena `adjudicarManualmente` con el
   * adjudicador (R-23).
   */
  actor?: ActorDeEvento;
  /** El criterio del adjudicador. Obligatorio en modalidad manual. */
  motivoDelAdjudicador?: string;
  /**
   * Si la venta seguia abierta al decidir. Informativo y solo manual: el
   * adjudicador puede dictaminar con la fila todavia creciendo, y quien audite
   * tiene que poder verlo sin reconstruir fechas.
   */
  ventaAbiertaAlDecidir?: boolean;
};

export type Candidato = {
  turno: number;
  participanteId: string;
  /** Para encolar el correo de adjudicacion (Etapa 10). Puede faltar en datos viejos. */
  correoTitular?: string;
};

const dormir = (ms: number): Promise<void> =>
  new Promise((continuar) => setTimeout(continuar, ms));

/**
 * Intenta adjudicar el lote al turno vivo menor.
 *
 * **No devuelve `Resultado`** y no es un descuido: ninguno de sus desenlaces es
 * un error que quien invoca deba propagar. Abstenerse, encontrar el lote ya
 * adjudicado o agotar la fila son resultados normales de una operacion que se
 * dispara sola despues de cada solicitud y de cada liberacion.
 */
export const adjudicarLote = async (
  entrada: EntradaDeAdjudicacion,
  deps: DepsDeServicio = {},
): Promise<ResultadoDeAdjudicacion> =>
  conTraza(
    "adjudicarLote",
    { loteId: entrada.lote.loteId, motivo: entrada.motivo },
    async () => ejecutarAdjudicacion(entrada, deps),
    (resultado) => ({
      // `adjudicado` es el unico desenlace `ok`. Los demas son respuestas
      // correctas y no errores —el comentario de `ResultadoDeAdjudicacion` lo
      // explica—, pero si merecen `warn`: `en_conflicto` y `fila_agotada`
      // sostenidos son justo lo que hay que poder buscar (runbook R-4).
      desenlace: resultado.estado === "adjudicado" ? "ok" : "rechazado",
      estado: resultado.estado,
      ...(resultado.estado === "adjudicado"
        ? { turno: resultado.turno, participanteId: resultado.participanteId }
        : {}),
      ...(resultado.estado === "abstenido"
        ? { reservasVigentes: resultado.reservasVigentes }
        : {}),
      ...(resultado.estado === "fila_agotada"
        ? { turnosRevisados: resultado.turnosRevisados }
        : {}),
    }),
  );

const ejecutarAdjudicacion = async (
  entrada: EntradaDeAdjudicacion,
  deps: DepsDeServicio,
): Promise<ResultadoDeAdjudicacion> => {
  // **La compuerta de la modalidad manual (R-23), y esta puesta aqui a
  // proposito.**
  //
  // Tres de los cuatro disparadores de adjudicacion automatica —crear
  // solicitud, rechazar pago y cancelar— llegan por esta funcion. Comprobar la
  // modalidad en cada uno seria tres oportunidades de olvidarla, y olvidarla
  // significa que el lote se adjudica solo pasando por encima del adjudicador.
  // Una sola compuerta en la puerta del motor no se puede saltar.
  //
  // El cuarto, `vencerYReasignar`, no pasa por aqui porque hace su propia
  // transaccion: se bifurca en su sitio, hacia la variante reducida. El quinto
  // —el barrido— se excluye en `barridoDeVencimientos`, que ni siquiera llama.
  if (entrada.lote.modalidadAdjudicacion === "MANUAL") {
    return { estado: "modalidad_manual" };
  }

  const intentos = entrada.intentos ?? INTENTOS_DE_ADJUDICACION;

  for (let intento = 0; intento < intentos; intento += 1) {
    const resultado = await intentarRonda(entrada, deps);
    if (resultado.estado !== "en_conflicto") return resultado;

    // Espera con jitter: sin el, dos procesos en conflicto reintentan en fase y
    // vuelven a chocar.
    await dormir(25 * (intento + 1) + Math.floor(Math.random() * 25));
  }

  return { estado: "en_conflicto" };
};

/**
 * Una pasada completa: abstencion, lectura de la fila y bucle de candidatos.
 *
 * **Las reservas se leen antes que la fila, y ese orden es parte del
 * mecanismo.** Al reves no sirve: una solicitud cuyo paso 2 se confirmara entre
 * la lectura de la fila y la de las reservas no apareceria en la primera y ya
 * no tendria reserva en la segunda — quedaria invisible por ambos lados.
 * Leyendo las reservas primero, toda reserva ausente pertenece a una solicitud
 * que o bien ya esta escrita —y la `Query` consistente posterior la vera— o
 * bien nunca se escribira.
 */
const intentarRonda = async (
  entrada: EntradaDeAdjudicacion,
  deps: DepsDeServicio,
): Promise<ResultadoDeAdjudicacion> => {
  const { lote } = entrada;
  const { ahora } = resolver(deps);

  const vigentes = await depurarYContarReservas(
    {
      loteId: lote.loteId,
      ahora,
      ...(entrada.umbralDeReservaMs === undefined
        ? {}
        : { umbralMs: entrada.umbralDeReservaMs }),
    },
    deps,
  );
  if (vigentes > 0) return { estado: "abstenido", reservasVigentes: vigentes };

  const candidatos = await leerFila(lote.loteId, deps);
  let turnosRevisados = 0;

  for (const candidato of candidatos) {
    turnosRevisados += 1;
    const intento = await intentarAdjudicar(candidato, entrada, deps);

    if (intento.ok) {
      return {
        estado: "adjudicado",
        turno: candidato.turno,
        solicitudId: identificadorDeSolicitud(lote.loteId, candidato.turno),
        participanteId: candidato.participanteId,
        venceEn: intento.venceEn,
      };
    }

    // Fallo el item 1 o el item 4: el problema es del lote, no del candidato.
    // Se aborta el bucle entero — seguir con el turno siguiente solo
    // produciria N fracasos identicos.
    if (intento.error === "lote_no_disponible") {
      return { estado: "no_adjudicable" };
    }

    // Cancelacion por conflicto: no dice quien gano. Releer y reintentar.
    if (intento.error === "conflicto_concurrencia")
      return { estado: "en_conflicto" };

    // Fallo el item 3: el candidato agoto su cupo en esta convocatoria (R-09).
    // Se **omite** —dejando el evento que lo explica— y se sigue con el turno
    // siguiente.
    //
    // Omitir, y no congelar como hacia la version anterior de R-09: el cupo se
    // libera si esa adjudicacion vence o la rechazan, asi que la solicitud
    // saltada se queda `EN_FILA` con su turno intacto y vuelve a ser candidata
    // por delante de quien llego despues. Congelarla le costaria su lugar por
    // una condicion reversible.
    if (intento.error === "limite_alcanzado") {
      await omitirPorLimite(candidato, lote, deps);
      continue;
    }

    // Fallo el item 2: la solicitud dejo de estar `EN_FILA` bajo nosotros. No
    // hace falta evento — quien provoco ese cambio escribio el suyo, y una
    // solicitud que ya no esta viva no es un turno saltado.
  }

  await registrarFilaAgotada(lote, turnosRevisados, deps);
  return { estado: "fila_agotada", turnosRevisados };
};

/**
 * PA-07: la fila de un lote, en orden de turno.
 *
 * **No se ordena en memoria.** El turno va con ceros a la izquierda en la `SK`
 * (D-5), asi que la `Query` la devuelve ya ordenada; ordenar aqui ocultaria un
 * error de construccion de claves en vez de exponerlo.
 *
 * `ConsistentRead` porque alimenta un bucle de escrituras condicionales
 * (modelo-datos 8): una lectura eventual podria no ver al turno menor y coronar
 * al siguiente.
 *
 * **Recorre todas las paginas.** La particion de un lote conserva sus
 * solicitudes terminales para siempre, asi que no basta con la primera: si los
 * `EN_FILA` quedaran detras del corte de 1 MB, esta funcion devolveria una
 * lista vacia y `adjudicarLote` escribiria `FILA_AGOTADA` con candidatos vivos
 * esperando. Y no se autocura, al contrario que el barrido (8.2): la corrida
 * siguiente lee la misma primera pagina.
 */
export const leerFila = async (
  loteId: string,
  deps: DepsDeServicio,
): Promise<Candidato[]> => {
  const items = await itemsDeQuery(
    (desde) =>
      new QueryCommand({
        TableName: nombreDeTabla(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefijo)",
        ExpressionAttributeValues: {
          ":pk": clave.solicitud(loteId, 0).PK,
          ":prefijo": PREFIJO.solicitud,
        },
        ScanIndexForward: true,
        ConsistentRead: true,
        ExclusiveStartKey: desde,
      }),
    deps,
  );

  const candidatos: Candidato[] = [];
  for (const item of items) {
    const turno = turnoDesdeClave(String(item.SK));
    if (turno === undefined || item.estatus !== "EN_FILA") continue;
    candidatos.push({
      turno,
      participanteId: String(item.participanteId),
      ...(typeof item.correoTitular === "string"
        ? { correoTitular: item.correoTitular }
        : {}),
    });
  }
  return candidatos;
};

/**
 * La transaccion de T2, con dos correcciones respecto del documento.
 *
 * **1. La condicion del item 1 incluye `estatus = EN_OFERTA`.** El documento
 * pedia solo `attribute_not_exists(adjudicacionActual)`, y eso deja pasar un
 * lote `NO_VENDIDO`: al concluir la convocatoria el lote cierra **sin**
 * `adjudicacionActual`, asi que una adjudicacion en vuelo podria entregarlo
 * despues del cierre. Un lote `VENDIDO` ya queda excluido por conservar su
 * adjudicacion, pero `NO_VENDIDO` y `RETIRADO` no.
 *
 * **2. Lleva el vehiculo a `RESERVADO` (item 4).** T2 no lo mencionaba, pero la
 * maquina de estados del vehiculo (`proyecto.md` 5.2) solo admite
 * `AVALAR_PAGO` desde `RESERVADO`: sin este item, `RESERVADO` seria inalcanzable
 * y T4 no tendria transicion valida al vender. El item no reintroduce la
 * contencion de R18 —el vehiculo se toca una vez por adjudicacion, no una vez
 * por solicitud— y R-10 garantiza que ningun otro lote activo lo comparte.
 */
const intentarAdjudicar = async (
  candidato: Candidato,
  entrada: EntradaDeAdjudicacion,
  deps: DepsDeServicio,
): Promise<
  { ok: true; venceEn: string } | { ok: false; error: CodigoError }
> => {
  const { lote } = entrada;
  const { ahora, nuevoId } = resolver(deps);
  const tabla = nombreDeTabla();

  const vence = calcularVenceEn(ahora, lote.horasLiquidacion);
  if (!vence) {
    // Un lote sin `horasLiquidacion` valida es un item corrupto, no un estado
    // del negocio: R-14 lo exige mayor que cero desde que se captura.
    throw new RangeError(
      `El lote ${lote.loteId} tiene horasLiquidacion invalida: ${String(lote.horasLiquidacion)}`,
    );
  }

  const adjudicadoEn = ahora.toISOString();
  const venceEn = vence.toISOString();
  const solicitudId = identificadorDeSolicitud(lote.loteId, candidato.turno);
  const claves = gsi4.vencimiento(diaDeNegocio(vence), venceEn);
  const correlacionId = nuevaCorrelacion(ahora);

  const resultado = await ejecutarTransaccion(
    [
      {
        item: {
          Update: {
            TableName: tabla,
            Key: clave.lote(lote.convocatoriaId, lote.loteId),
            UpdateExpression:
              "SET adjudicacionActual = :solicitud, turnoAdjudicado = :turno," +
              " adjudicadoEn = :adjudicadoEn, venceEn = :venceEn," +
              " #estatus = :adjudicado",
            ConditionExpression: `${CONDICION_LOTE_LIBRE} AND #estatus = :enOferta`,
            ExpressionAttributeNames: { "#estatus": "estatus" },
            ExpressionAttributeValues: {
              ":solicitud": solicitudId,
              ":turno": candidato.turno,
              ":adjudicadoEn": adjudicadoEn,
              ":venceEn": venceEn,
              ":adjudicado": "ADJUDICADO",
              ":enOferta": "EN_OFERTA",
            },
          },
        },
        siFalla: "lote_no_disponible",
        descripcion: "lote libre y en oferta (regla 6)",
      },
      {
        item: {
          Update: {
            TableName: tabla,
            Key: clave.solicitud(lote.loteId, candidato.turno),
            UpdateExpression:
              "SET #estatus = :adjudicada, adjudicadoEn = :adjudicadoEn," +
              " venceEn = :venceEn, GSI4PK = :gsi4pk, GSI4SK = :gsi4sk",
            ConditionExpression: "#estatus = :enFila",
            ExpressionAttributeNames: { "#estatus": "estatus" },
            ExpressionAttributeValues: {
              ":adjudicada": "ADJUDICADA",
              ":enFila": "EN_FILA",
              ":adjudicadoEn": adjudicadoEn,
              ":venceEn": venceEn,
              // GSI4 es disperso a proposito: la solicitud entra al indice del
              // trabajo pendiente al adjudicarse y sale al subir el comprobante
              // (T3). El barrido de R-15 no filtra nada porque el indice
              // contiene exactamente lo que vence.
              ":gsi4pk": claves.GSI4PK,
              ":gsi4sk": claves.GSI4SK,
            },
          },
        },
        siFalla: "invalid_state",
        descripcion: `solicitud turno ${String(candidato.turno)} sigue EN_FILA`,
      },
      itemDeConsumoDeCupo({
        participanteId: candidato.participanteId,
        convocatoriaId: lote.convocatoriaId,
        limite: lote.limiteAdjudicaciones,
      }),
      {
        item: {
          Update: {
            TableName: tabla,
            Key: clave.vehiculo(lote.vehiculoId),
            UpdateExpression:
              "SET #estatus = :reservado, actualizadoEn = :adjudicadoEn",
            ConditionExpression: "#estatus = :enConvocatoria",
            ExpressionAttributeNames: { "#estatus": "estatus" },
            ExpressionAttributeValues: {
              ":reservado": "RESERVADO",
              ":enConvocatoria": "EN_CONVOCATORIA",
              ":adjudicadoEn": adjudicadoEn,
            },
          },
        },
        // `lote_no_disponible` y no `invalid_state`: si el vehiculo no esta
        // `EN_CONVOCATORIA` el problema no es de este candidato sino del lote,
        // y probar con el turno siguiente fallaria igual.
        siFalla: "lote_no_disponible",
        descripcion: "vehiculo EN_CONVOCATORIA pasa a RESERVADO",
      },
      eventoParaTransaccion({
        tipo: "LOTE_ADJUDICADO",
        agregado: "LOTE",
        agregadoId: lote.loteId,
        // **`SISTEMA` salvo que decida una persona.** En modalidad manual el
        // actor es el adjudicador, con sus permisos del momento, y es lo unico
        // que distingue una decision humana legitima de un automatismo que
        // actuo donde no debia (R-23, trazabilidad 5.1).
        actor: entrada.actor ?? { tipo: "SISTEMA" },
        ocurridoEn: ahora,
        correlacionId,
        convocatoriaId: lote.convocatoriaId,
        loteId: lote.loteId,
        solicitudId,
        vehiculoId: lote.vehiculoId,
        estadoAnterior: "EN_FILA",
        estadoNuevo: "ADJUDICADA",
        ...(entrada.motivoDelAdjudicador
          ? { motivo: entrada.motivoDelAdjudicador }
          : {}),
        datos: {
          turno: candidato.turno,
          adjudicadoEn,
          venceEn,
          motivoAdjudicacion: entrada.motivo,
          ...(entrada.ventaAbiertaAlDecidir === undefined
            ? {}
            : { ventaAbiertaAlDecidir: entrada.ventaAbiertaAlDecidir }),
        },
      }),
      // Outbox (D-6, riesgo R8): "exito -> encolar correo en outbox"
      // (arquitectura-tecnica-aws.md 4.3). Vacio si el candidato no tiene
      // `correoTitular` — un dato viejo o ausente no bloquea la adjudicacion.
      ...itemsDeEncoladoAdjudicacion({
        mensajeId: nuevoId(),
        destinatario: candidato.correoTitular,
        datos: {
          solicitudId,
          loteId: lote.loteId,
          convocatoriaId: lote.convocatoriaId,
          vehiculoId: lote.vehiculoId,
          precio: lote.precio,
          venceEn,
        },
        actor: { tipo: "SISTEMA" },
        ahora,
        correlacionId,
      }),
    ],
    deps,
  );

  return resultado.ok
    ? { ok: true, venceEn }
    : { ok: false, error: resultado.error };
};

/**
 * Deja escrito **por que** la adjudicacion se salto este turno: su titular
 * agoto el cupo de la convocatoria (R-09).
 *
 * Un solo evento, y **ningun cambio de estado**. Hasta la Etapa 14 esto eran
 * dos eventos porque omitir implicaba congelar, y `SOLICITUD_CONGELADA`
 * explicaba la transicion mientras `SOLICITUD_OMITIDA` explicaba el salto. Ya
 * no hay transicion que explicar: la solicitud sigue `EN_FILA` con su turno, y
 * volvera a ser candidata en cuanto su titular recupere cupo.
 *
 * **Eso convierte a este evento en la unica explicacion del salto**, y por eso
 * `comprobarOrdenDeAdjudicacion` tiene que darlo por suficiente sin exigir
 * ademas un cambio de estado. Sin el, el auditor veria una adjudicacion al
 * turno 5 con los turnos 3 y 4 vivos — que es exactamente la senal de fraude
 * que la comprobacion 2 existe para dar.
 *
 * De mejor esfuerzo: si falla, el candidato sigue `EN_FILA` y la proxima ronda
 * volvera a intentarlo y a omitirlo. No adelanta a nadie.
 */
export const omitirPorLimite = async (
  candidato: Candidato,
  lote: Lote,
  deps: DepsDeServicio,
): Promise<void> => {
  const { ahora } = resolver(deps);
  const solicitudId = identificadorDeSolicitud(lote.loteId, candidato.turno);

  await ejecutarTransaccion(
    [
      eventoParaTransaccion({
        tipo: "SOLICITUD_OMITIDA",
        agregado: "LOTE",
        agregadoId: lote.loteId,
        actor: { tipo: "SISTEMA" },
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        convocatoriaId: lote.convocatoriaId,
        loteId: lote.loteId,
        solicitudId,
        datos: {
          turno: candidato.turno,
          razonOmision: "LIMITE_ALCANZADO",
          limiteAdjudicaciones: lote.limiteAdjudicaciones,
        },
      }),
    ],
    deps,
  );
};

/**
 * `FILA_AGOTADA` — R-17: no quedo ningun candidato vivo y el lote sigue
 * `EN_OFERTA`, disponible para quien solicite despues.
 *
 * Es un evento sin mutacion, y es correcto que lo sea: la ausencia de
 * adjudicacion tambien es un hecho que el auditor tiene que poder ver. Sin el,
 * una fila con turnos vivos y un lote sin adjudicar pareceria un proceso que
 * dejo de correr.
 */
const registrarFilaAgotada = async (
  lote: Lote,
  turnosRevisados: number,
  deps: DepsDeServicio,
): Promise<void> => {
  const { ahora } = resolver(deps);

  await ejecutarTransaccion(
    [
      eventoParaTransaccion({
        tipo: "FILA_AGOTADA",
        agregado: "LOTE",
        agregadoId: lote.loteId,
        actor: { tipo: "SISTEMA" },
        ocurridoEn: ahora,
        correlacionId: nuevaCorrelacion(ahora),
        convocatoriaId: lote.convocatoriaId,
        loteId: lote.loteId,
        datos: { turnosRevisados },
      }),
    ],
    deps,
  );
};

export const __test__ = { leerFila, omitirPorLimite, registrarFilaAgotada };

/**
 * La transaccion de T2 para **un candidato concreto**, expuesta para que
 * `adjudicarManualmente` la reuse sin duplicarla (R-23).
 *
 * Es la pieza que hace honesta la frase "la modalidad manual cambia solo como
 * se elige al candidato": las cinco condiciones —lote libre y `EN_OFERTA`,
 * solicitud `EN_FILA`, cupo disponible, vehiculo `EN_CONVOCATORIA`, evento
 * append-only— son literalmente las mismas, porque la regla 6 aplica igual
 * cuando quien decide es una persona.
 */
export const intentarAdjudicarA = intentarAdjudicar;
