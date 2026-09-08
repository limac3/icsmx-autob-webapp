import "server-only";

// PA-08 — "¿estoy en esta fila y en que lugar?".
//
// **La proyeccion mas delicada del sistema** (api-contracts 4.1). Lo que sale
// de aqui va directo a la pantalla de un participante, y R-12 no admite grados:
// jamas puede contener el identificador, el correo ni el nombre de un tercero,
// ni metadatos suyos —cuando solicito, cuantas veces—.
//
// La garantia **no** es "acordarse de no serializar esos campos". Es que nunca
// se leen: el lugar propio sale del centinela y de la propia solicitud, y los
// dos agregados salen de `Select: COUNT`. Los items de terceros no salen de
// DynamoDB.
//
// El centinela hace de acceso directo: sin el habria que recorrer la fila
// entera para encontrarse a uno mismo, y esa lectura si traeria a los demas.

import { GetCommand } from "@aws-sdk/lib-dynamodb";

import { aLote } from "@/lib/convocatorias/mapeo";
import { clave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, resolver, type DepsDeServicio } from "@/lib/data/deps";
import { desdeIso } from "@/lib/domain/fechas";
import { estaVencido } from "@/lib/domain/plazos";
import type { MiLugarDTO, Solicitud } from "@/types/fila";
import type { Lote } from "@/types/lote";
import { exito, type Resultado } from "@/types/resultado";
import { consultarTamanoFila, contarVivasAntesDe } from "./conteosDeFila";
import { aSolicitud } from "./mapeo";
import { vencerYReasignar } from "./vencerYReasignar";

/**
 * La solicitud viva del participante en un lote, o `null` si no tiene ninguna.
 *
 * `null` **no es un error**: es la respuesta normal de quien todavia no ha
 * solicitado, y tambien la de quien ya termino —el centinela se retira al
 * alcanzar un estado terminal, que es lo que le permite volver a formarse con
 * un turno nuevo (R-07)—.
 *
 * Se expone porque la cancelacion necesita exactamente esta lectura: al partir
 * del centinela, que esta indexado por el `participanteId` **de la sesion**, es
 * imposible alcanzar la solicitud de otro. La propiedad no depende de una
 * guarda que alguien pueda olvidar.
 *
 * `ConsistentRead` en las dos lecturas: quien acaba de formarse tiene que verse
 * en la fila, y quien acaba de ganar tiene que ver su plazo.
 */
export const leerMiSolicitud = async (
  entrada: { loteId: string; participanteId: string },
  deps: DepsDeServicio = {},
): Promise<Resultado<Solicitud | null>> => {
  const cliente = clienteDe(deps);
  const tabla = nombreDeTabla();

  const centinela = await cliente.send(
    new GetCommand({
      TableName: tabla,
      Key: clave.centinelaFila(entrada.loteId, entrada.participanteId),
      ConsistentRead: true,
    }),
  );

  const turno = centinela.Item?.turno;
  if (typeof turno !== "number") return exito(null);

  const item = await cliente.send(
    new GetCommand({
      TableName: tabla,
      Key: clave.solicitud(entrada.loteId, turno),
      ConsistentRead: true,
    }),
  );
  if (!item.Item) return exito(null);

  return exito(aSolicitud(item.Item) ?? null);
};

/**
 * `MiLugarDTO`, o `null` si el participante no esta en esa fila.
 *
 * **Camino B del vencimiento (D-7)**, antes de construir el DTO:
 * "al leer una fila cuya adjudicacion vigente ya vencio -> T5 antes de
 * responder" (`arquitectura-tecnica-aws.md` 4.4). El barrido es la red de
 * seguridad; esta lectura es la que hace que quien consulta **su propio**
 * plazo nunca vea un `venceEn` que ya paso. Competir con el barrido es
 * inofensivo: la transaccion es la misma escritura condicional, y quien llega
 * segundo no hace nada (`vencerYReasignar` responde `no_vigente`).
 *
 * Los dos conteos van en paralelo porque son independientes entre si y ninguno
 * depende del otro; el orden en que lleguen no cambia el resultado.
 */
export const consultarMiLugar = async (
  entrada: { loteId: string; participanteId: string },
  deps: DepsDeServicio = {},
): Promise<Resultado<MiLugarDTO | null>> => {
  const lectura = await leerMiSolicitud(entrada, deps);
  if (!lectura.ok) return lectura;
  if (!lectura.data) return exito(null);

  const solicitud = await resolverSiVencida(lectura.data, entrada, deps);
  const [tamano, anteriores] = await Promise.all([
    consultarTamanoFila(entrada.loteId, deps),
    contarVivasAntesDe(entrada.loteId, solicitud.turno, deps),
  ]);
  if (!tamano.ok) return tamano;
  if (!anteriores.ok) return anteriores;

  return exito({
    solicitudId: solicitud.solicitudId,
    loteId: solicitud.loteId,
    miTurno: solicitud.turno,
    // "Cuantos me faltan por delante, mas uno". Cambia conforme la fila avanza;
    // `miTurno`, en cambio, no cambia nunca (R-12).
    miPosicion: anteriores.data + 1,
    tamanoFila: tamano.data,
    estatus: solicitud.estatus,
    ...(solicitud.venceEn ? { venceEn: solicitud.venceEn } : {}),
    ...(solicitud.motivoRechazo
      ? { motivoRechazo: solicitud.motivoRechazo }
      : {}),
  });
};

/**
 * Si `solicitud` esta `ADJUDICADA` y su plazo ya paso, aplica T5 y devuelve la
 * solicitud **releida** — que sera `CANCELADA_POR_VENCIMIENTO` si esta
 * transaccion ganó, o `EN_VERIFICACION`/`VENDIDA`/etc. si alguien mas la
 * resolvio entre la lectura y este intento. En cualquier otro caso —no vencida,
 * sin `convocatoriaId` (dato viejo), o el lote no aparece— devuelve la misma
 * solicitud sin tocar nada: el barrido es la red de seguridad, no la unica
 * defensa, y esta lectura nunca debe fallar por no poder resolver.
 */
const resolverSiVencida = async (
  solicitud: Solicitud,
  entrada: { loteId: string; participanteId: string },
  deps: DepsDeServicio,
): Promise<Solicitud> => {
  const { ahora } = resolver(deps);
  const venceEn = solicitud.venceEn ? desdeIso(solicitud.venceEn) : undefined;

  if (
    solicitud.estatus !== "ADJUDICADA" ||
    !venceEn ||
    !estaVencido(venceEn, ahora) ||
    !solicitud.convocatoriaId
  ) {
    return solicitud;
  }

  const lote = await leerLote(solicitud.convocatoriaId, solicitud.loteId, deps);
  if (!lote) return solicitud;

  const desenlace = await vencerYReasignar(
    {
      lote,
      solicitudVencida: solicitud,
      detectadoPor: "VERIFICACION_PEREZOSA",
    },
    deps,
  );
  if (
    desenlace.estado !== "reasignado" &&
    desenlace.estado !== "fila_agotada"
  ) {
    return solicitud;
  }

  const releida = await leerMiSolicitud(entrada, deps);
  return releida.ok && releida.data ? releida.data : solicitud;
};

const leerLote = async (
  convocatoriaId: string,
  loteId: string,
  deps: DepsDeServicio,
): Promise<Lote | undefined> => {
  const salida = await clienteDe(deps).send(
    new GetCommand({
      TableName: nombreDeTabla(),
      Key: clave.lote(convocatoriaId, loteId),
      ConsistentRead: true,
    }),
  );
  return salida.Item ? aLote(salida.Item) : undefined;
};
