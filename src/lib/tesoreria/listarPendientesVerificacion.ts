import "server-only";

// PA-11 — bandeja de tesoreria. `modelo-datos-dynamodb.md` seccion 5.
//
// `Query` sobre la particion `SOL_ESTATUS#EN_VERIFICACION` de GSI2, que T3
// escribe al subir el comprobante y que `avalarPago`/`rechazarPago` retiran al
// resolver: el indice contiene exactamente el trabajo pendiente de tesoreria,
// igual que GSI4 lo hace para los vencimientos (modelo-datos 3).
//
// `ScanIndexForward: true` porque `GSI2SK` es `<comprobanteSubidoEn>#<id>`:
// las mas antiguas primero, la misma convencion que la bandeja del aprobador
// (ui-ux-requerimientos.md seccion 6).

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { gsi2, NOMBRES_DE_INDICE } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import type { PendienteDTO } from "@/types/fila";
import { exito, type Resultado } from "@/types/resultado";
import { aSolicitud } from "@/lib/fila/mapeo";

export const listarPendientesVerificacion = async (
  deps: DepsDeServicio = {},
): Promise<Resultado<PendienteDTO[]>> => {
  const salida = await clienteDe(deps).send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      IndexName: NOMBRES_DE_INDICE.porEstatus,
      KeyConditionExpression: "GSI2PK = :pk",
      ExpressionAttributeValues: {
        ":pk": gsi2.particionDeEstatus("SOL", "EN_VERIFICACION").GSI2PK,
      },
      ScanIndexForward: true,
    }),
  );

  const pendientes: PendienteDTO[] = [];
  for (const item of salida.Items ?? []) {
    const solicitud = aSolicitud(item);
    if (
      !solicitud ||
      solicitud.estatus !== "EN_VERIFICACION" ||
      !solicitud.convocatoriaId ||
      !solicitud.adjudicadoEn ||
      !solicitud.comprobanteSubidoEn
    ) {
      // Un item que llega hasta aqui sin estos campos es una inconsistencia
      // de datos, no trabajo pendiente que mostrar: se omite en vez de
      // fabricar una fila a medias.
      continue;
    }

    pendientes.push({
      solicitudId: solicitud.solicitudId,
      loteId: solicitud.loteId,
      convocatoriaId: solicitud.convocatoriaId,
      // R-12 lo prohibe para cualquier otra proyeccion; esta es la excepcion
      // deliberada de `PendienteDTO` (permission-matrix.md seccion 6).
      correoTitular: solicitud.correoTitular ?? "",
      adjudicadoEn: solicitud.adjudicadoEn,
      comprobanteSubidoEn: solicitud.comprobanteSubidoEn,
    });
  }

  return exito(pendientes);
};
