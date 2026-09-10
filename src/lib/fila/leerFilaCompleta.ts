import "server-only";

// PA-07, sin el filtro de `leerFila` (adjudicarLote.ts). Esa version solo
// devuelve candidatos `EN_FILA` porque es lo unico que la adjudicacion
// necesita; esta devuelve **todas** las solicitudes del lote, en cualquier
// estatus, con su identidad — es la capacidad detras de `fila:ver-completa`
// (permission-matrix.md seccion 5), y la que necesita `verificarIntegridad`
// para contrastar el estado vigente contra la bitacora (comprobacion 5 de
// trazabilidad-auditoria.md 5.1): sin el estado **real** de la tabla, una
// mutacion que olvido escribir su evento seria invisible para el auditor.
//
// No tiene contraparte en ninguna pantalla de participante ni de
// administracion: es exclusiva de auditoria.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { clave, PREFIJO, turnoDesdeClave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import type { DepsDeServicio } from "@/lib/data/deps";
import { itemsDeQuery } from "@/lib/data/paginacion";
import type { Solicitud } from "@/types/fila";
import { exito, type Resultado } from "@/types/resultado";
import { aSolicitud } from "./mapeo";

/**
 * **Recorre todas las paginas y lee consistente**, y las dos cosas por la misma
 * razon: es la lectura contra la que el auditor contrasta la bitacora. Una
 * pagina truncada o una lectura eventual producen diferencias que no existen —o
 * peor, dejan invisible la mutacion sin evento que la comprobacion 5 existe
 * para atrapar—. Sus dos hermanas (`leerFila` y `leerCerrables`) ya leian
 * consistente; esta se habia quedado sin `ConsistentRead`.
 */
export const leerFilaCompleta = async (
  loteId: string,
  deps: DepsDeServicio = {},
): Promise<Resultado<Solicitud[]>> => {
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

  const solicitudes: Solicitud[] = [];
  for (const item of items) {
    if (turnoDesdeClave(String(item.SK)) === undefined) continue;
    const solicitud = aSolicitud(item);
    if (solicitud) solicitudes.push(solicitud);
  }
  return exito(solicitudes);
};
