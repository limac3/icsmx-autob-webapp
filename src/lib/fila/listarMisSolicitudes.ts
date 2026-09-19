import "server-only";

// PA-09 — "¿en que me meti y que debo?".
//
// **Estrena el indice.** GSI3 (`PART#<participanteId>` / `SOL#<solicitadoEn>#
// <loteId>`) existe y esta desplegado desde la Etapa 3, y hasta hoy solo lo
// leia la auditoria. Esta pantalla no cuesta un indice nuevo ni una escritura
// nueva: la solicitud ya escribe sus claves de GSI3 desde la Etapa 8.
//
// **Esta lectura no resuelve vencimientos, al contrario que `consultarMiLugar`
// (D-35).** Alli la verificacion perezosa de D-7 mira **un** lote; aqui serian
// N escrituras condicionales disparadas por una lista, que es la forma del
// gasto que R26 midio en el camino caliente, y un tercer camino de escritura
// del vencimiento donde D-7 define dos. Lo que si hace es comparar `venceEn`
// contra el reloj del servidor y decirlo: `plazoVencido`. La transicion la
// escribe el barrido, o el detalle del lote cuando se abra.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { gsi3, NOMBRES_DE_INDICE } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, resolver, type DepsDeServicio } from "@/lib/data/deps";
import {
  agruparMiSolicitud,
  ordenDeMisSolicitudes,
} from "@/lib/domain/misSolicitudes";
import { desdeIso } from "@/lib/domain/fechas";
import { estaVencido } from "@/lib/domain/plazos";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import type { ConvocatoriaConLotes } from "@/types/convocatoria";
import type { MiSolicitudDTO, Solicitud } from "@/types/fila";
import type { Lote } from "@/types/lote";
import { exito, type Resultado } from "@/types/resultado";
import { aSolicitud } from "./mapeo";

/**
 * Tope de la consulta.
 *
 * No es de correccion: es cuanta historia cabe en una pantalla sin paginar. Lo
 * que si es de correccion es el **orden** en que se recorta — ver abajo.
 */
export const MAXIMO_MIS_SOLICITUDES = 100;

export type MisSolicitudes = {
  solicitudes: MiSolicitudDTO[];
  /** Se alcanzo el tope: hay mas historia de la que se muestra. */
  truncada: boolean;
};

/**
 * Las solicitudes del participante, agrupadas y ordenadas para la pantalla 3.5.
 *
 * **`ScanIndexForward: false`, y no es una preferencia de presentacion
 * (D-37).** `GSI3SK` es `SOL#<solicitadoEn>#<loteId>`, asi que una consulta
 * ascendente con `Limit` devolveria **las mas viejas** y dejaria fuera justo
 * las que pueden tener un plazo corriendo. Es el mismo modo de fallo silencioso
 * que `listarConvocatorias` tenia con `MAXIMO_POR_ESTATUS`: una lista
 * incompleta que se ve completa.
 *
 * No recibe el `participanteId` de ningun parametro de ruta: se lo pasa la
 * pagina desde la sesion.
 */
export const listarMisSolicitudes = async (
  participanteId: string,
  deps: DepsDeServicio = {},
): Promise<Resultado<MisSolicitudes>> => {
  const { ahora } = resolver(deps);

  const salida = await clienteDe(deps).send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      IndexName: NOMBRES_DE_INDICE.porParticipante,
      KeyConditionExpression: "GSI3PK = :pk",
      ExpressionAttributeValues: {
        ":pk": gsi3.solicitudDeParticipante(
          participanteId,
          "relleno",
          "relleno",
        ).GSI3PK,
      },
      ScanIndexForward: false,
      Limit: MAXIMO_MIS_SOLICITUDES,
    }),
  );

  const solicitudes: Solicitud[] = [];
  for (const item of salida.Items ?? []) {
    const solicitud = aSolicitud(item);
    // Sin `convocatoriaId` no hay forma de alcanzar el lote ni el vehiculo, asi
    // que no habria fila que mostrar. Se omite en vez de pintarla a medias, que
    // es lo mismo que hace la bandeja de tesoreria ante un item incompleto.
    if (solicitud?.convocatoriaId) solicitudes.push(solicitud);
  }

  const convocatorias = await leerConvocatorias(solicitudes, deps);
  const filas = await Promise.all(
    solicitudes.map((solicitud) =>
      aFila(solicitud, convocatorias, ahora, deps),
    ),
  );

  return exito({
    solicitudes: filas
      .filter((fila): fila is MiSolicitudDTO => fila !== undefined)
      .sort(ordenDeMisSolicitudes),
    truncada: salida.LastEvaluatedKey !== undefined,
  });
};

/**
 * Una lectura por convocatoria distinta, no una por solicitud.
 *
 * PA-04 trae la convocatoria **con todos sus lotes** en una sola `Query`, y
 * quien se forma en varios lotes lo hace casi siempre dentro de la misma
 * convocatoria — que es justo lo que R-22 mide. Es el mismo cruce en memoria
 * que la bandeja del adjudicador prefirio a un indice nuevo.
 */
const leerConvocatorias = async (
  solicitudes: readonly Solicitud[],
  deps: DepsDeServicio,
): Promise<Map<string, ConvocatoriaConLotes>> => {
  const ids = [
    ...new Set(
      solicitudes.map((solicitud) => solicitud.convocatoriaId).filter(Boolean),
    ),
  ] as string[];

  const leidas = await Promise.all(
    ids.map(async (id) => {
      const resultado = await obtenerConvocatoria(id, deps);
      return resultado.ok ? ([id, resultado.data] as const) : undefined;
    }),
  );

  return new Map(
    leidas.filter(
      (par): par is readonly [string, ConvocatoriaConLotes] =>
        par !== undefined,
    ),
  );
};

const aFila = async (
  solicitud: Solicitud,
  convocatorias: Map<string, ConvocatoriaConLotes>,
  ahora: Date,
  deps: DepsDeServicio,
): Promise<MiSolicitudDTO | undefined> => {
  const convocatoria = solicitud.convocatoriaId
    ? convocatorias.get(solicitud.convocatoriaId)
    : undefined;
  if (!convocatoria) return undefined;

  const lote = convocatoria.lotes.find(
    (uno) => uno.loteId === solicitud.loteId,
  );
  if (!lote) return undefined;

  const venceEn = solicitud.venceEn ? desdeIso(solicitud.venceEn) : undefined;
  const plazoVencido = venceEn ? estaVencido(venceEn, ahora) : false;

  return {
    solicitudId: solicitud.solicitudId,
    loteId: solicitud.loteId,
    convocatoriaId: convocatoria.convocatoriaId,
    convocatoriaFolio: convocatoria.folio,
    convocatoriaNombre: convocatoria.nombre,
    ...(await datosDelVehiculo(lote, deps)),
    precio: lote.precio,
    estatus: solicitud.estatus,
    miTurno: solicitud.turno,
    solicitadoEn: solicitud.solicitadoEn,
    ...(solicitud.venceEn ? { venceEn: solicitud.venceEn } : {}),
    ...(plazoVencido ? { plazoVencido: true } : {}),
    grupo: agruparMiSolicitud({ estatus: solicitud.estatus, plazoVencido }),
  };
};

/**
 * Un vehiculo ilegible deja la fila con los campos en blanco en vez de
 * desaparecerla: la misma tolerancia que `lotesParaCatalogo`. Aqui importa mas
 * que alla — desaparecer la fila le ocultaria a alguien una adjudicacion suya
 * con el plazo corriendo, que es exactamente lo que esta pantalla existe para
 * evitar.
 */
const datosDelVehiculo = async (
  lote: Lote,
  deps: DepsDeServicio,
): Promise<{ marca: string; version: string; modelo: number }> => {
  const vehiculo = await obtenerVehiculo(lote.vehiculoId, deps);
  return vehiculo.ok
    ? {
        marca: vehiculo.data.marca,
        version: vehiculo.data.version,
        modelo: vehiculo.data.modelo,
      }
    : { marca: "", version: "", modelo: 0 };
};
