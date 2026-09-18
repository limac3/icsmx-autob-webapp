import "server-only";

// La fila de un lote **con identidades y con el historial del participante en
// la convocatoria** — lo que el adjudicador necesita para decidir (R-23).
//
// Es la tercera lectura de PA-07 del sistema, y las tres existen por separado a
// proposito porque responden preguntas distintas y **exponen cosas distintas**:
//
//   leerFila (adjudicarLote)   candidatos `EN_FILA`, sin mas. Es lo unico que
//                              el motor necesita para recorrer turnos.
//   leerFilaCompleta           todas las solicitudes con su identidad. Para el
//                              auditor, que contrasta la bitacora contra la
//                              tabla.
//   leerFilaParaAdjudicar      esta. Identidades **mas** el cruce con las demas
//                              solicitudes del mismo participante en la misma
//                              convocatoria, que es el dato que el requerimiento
//                              pidio explicitamente.
//
// Colapsarlas en una con banderas haria que la mas permisiva fuera la que se
// usa por omision, y la privacidad de R-12 dejaria de ser estructural para
// pasar a depender de acordarse de pasar un parametro.
//
// **El cruce no necesita un GSI nuevo.** GSI3 indexa por participante pero no
// filtra por convocatoria en la clave; aqui, en cambio, la pantalla **es** por
// convocatoria: PA-04 da los lotes y PA-07 da cada fila, y el cruce se arma en
// memoria sobre exactamente el ambito que el adjudicador ya tiene que ver. Un
// indice seria infraestructura irreversible para una pantalla administrativa de
// volumen acotado.

import { GetCommand } from "@aws-sdk/lib-dynamodb";

import { clave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import type { Lote } from "@/types/lote";
import { exito, type Resultado } from "@/types/resultado";
import { leerFilaCompleta } from "./leerFilaCompleta";

/**
 * Una solicitud de otro lote del mismo participante, dentro de esta
 * convocatoria. Es la respuesta a "¿que mas pidio esta persona y en que orden?".
 */
export type OtraParticipacion = {
  loteId: string;
  turno: number;
  estatus: string;
  /** Cuantos siguen `EN_FILA` en ese otro lote. */
  tamanoFila: number;
  ordenEnConvocatoria?: number;
};

/** Una fila de la tabla que ve el adjudicador. **Expone identidad** (R-23). */
export type CandidatoParaAdjudicar = {
  turno: number;
  solicitudId: string;
  participanteId: string;
  correoTitular?: string;
  estatus: string;
  /** La hora exacta de llegada. Informativa: el orden lo fija `turno` (R-08). */
  solicitadoEn: string;
  /** El n-esimo intento de esta persona en la convocatoria (R-22). */
  ordenEnConvocatoria?: number;
  /** Cuantos vehiculos de esta convocatoria tiene o tuvo en firme (R-09). */
  adjudicacionesEnConvocatoria: number;
  /** Si ya agoto su cupo: adjudicarle fallaria con `limite_alcanzado`. */
  sinCupo: boolean;
  /** Sus otras solicitudes en esta convocatoria, ordenadas por su ordinal. */
  otrasParticipaciones: OtraParticipacion[];
};

export type FilaParaAdjudicar = {
  loteId: string;
  candidatos: CandidatoParaAdjudicar[];
};

export const leerFilaParaAdjudicar = async (
  entrada: {
    /** El lote a decidir. */
    lote: Lote;
    /** Los demas lotes de la convocatoria, para el cruce. */
    lotesDeLaConvocatoria: readonly Lote[];
  },
  deps: DepsDeServicio = {},
): Promise<Resultado<FilaParaAdjudicar>> => {
  const { lote, lotesDeLaConvocatoria } = entrada;

  const fila = await leerFilaCompleta(lote.loteId, deps);
  if (!fila.ok) return fila;

  // Solo los que pueden ganar. Los terminales siguen en la particion para
  // siempre y mostrarlos como candidatos invitaria a elegir a alguien que ya
  // no esta.
  const candidatos = fila.data.filter((s) => s.estatus === "EN_FILA");
  if (candidatos.length === 0) {
    return exito({ loteId: lote.loteId, candidatos: [] });
  }

  const interesados = new Set(candidatos.map((c) => c.participanteId));

  // El cruce: las filas de los demas lotes, quedandose solo con lo de estas
  // personas. Se leen todos porque la pantalla es por convocatoria y su volumen
  // esta acotado por cuantos vehiculos tiene.
  const otrasPorParticipante = new Map<string, OtraParticipacion[]>();
  for (const otro of lotesDeLaConvocatoria) {
    if (otro.loteId === lote.loteId) continue;
    const suFila = await leerFilaCompleta(otro.loteId, deps);
    if (!suFila.ok) continue;
    // Cuantos siguen `EN_FILA` en ese otro lote: "turno 3 de 8", no solo "3".
    const enEseLote = suFila.data.filter((s) => s.estatus === "EN_FILA").length;
    for (const solicitud of suFila.data) {
      if (!interesados.has(solicitud.participanteId)) continue;
      const lista = otrasPorParticipante.get(solicitud.participanteId) ?? [];
      lista.push({
        loteId: otro.loteId,
        turno: solicitud.turno,
        estatus: solicitud.estatus,
        tamanoFila: enEseLote,
        ...(solicitud.ordenEnConvocatoria === undefined
          ? {}
          : { ordenEnConvocatoria: solicitud.ordenEnConvocatoria }),
      });
      otrasPorParticipante.set(solicitud.participanteId, lista);
    }
  }

  const cupos = new Map<string, number>();
  for (const participanteId of interesados) {
    cupos.set(
      participanteId,
      await leerCupoConsumido(participanteId, lote.convocatoriaId, deps),
    );
  }

  return exito({
    loteId: lote.loteId,
    candidatos: candidatos.map((s) => {
      const consumido = cupos.get(s.participanteId) ?? 0;
      return {
        turno: s.turno,
        solicitudId: s.solicitudId,
        participanteId: s.participanteId,
        ...(s.correoTitular ? { correoTitular: s.correoTitular } : {}),
        estatus: s.estatus,
        solicitadoEn: s.solicitadoEn,
        ...(s.ordenEnConvocatoria === undefined
          ? {}
          : { ordenEnConvocatoria: s.ordenEnConvocatoria }),
        adjudicacionesEnConvocatoria: consumido,
        sinCupo: consumido >= lote.limiteAdjudicaciones,
        // **Ordenadas por el ordinal de la convocatoria, no por el turno.** Los
        // turnos son por lote y no se comparan entre si; el ordinal es lo unico
        // que dice en que orden llego esta persona a la convocatoria (R-22).
        // Las que no lo traen —anteriores a la Etapa 14— van al final.
        otrasParticipaciones: (
          otrasPorParticipante.get(s.participanteId) ?? []
        ).sort(
          (a, b) =>
            (a.ordenEnConvocatoria ?? Number.MAX_SAFE_INTEGER) -
            (b.ordenEnConvocatoria ?? Number.MAX_SAFE_INTEGER),
        ),
      };
    }),
  });
};

/**
 * `cupoConsumido` del participante en esta convocatoria.
 *
 * **Es informativo, no la autoridad.** Quien decide si queda cupo es la
 * condicion del `ADD` dentro de la transaccion (regla 6); esto solo le avisa al
 * adjudicador para que no elija a alguien cuya adjudicacion va a fallar. Entre
 * esta lectura y su decision puede cambiar, y esta bien que asi sea.
 */
const leerCupoConsumido = async (
  participanteId: string,
  convocatoriaId: string,
  deps: DepsDeServicio,
): Promise<number> => {
  const salida = await clienteDe(deps).send(
    new GetCommand({
      TableName: nombreDeTabla(),
      Key: clave.cupoDeParticipante(participanteId, convocatoriaId),
    }),
  );
  const consumido = salida.Item?.cupoConsumido;
  return typeof consumido === "number" ? consumido : 0;
};
