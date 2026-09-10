import "server-only";

// PA-05 — convocatorias visibles para un participante, con el gating triple
// (R-01) aplicado **dentro de la consulta** (modelo-datos-dynamodb.md 5.1):
//
//   1. `estatus = PUBLICADA`   -> particion de GSI2.
//   2. `publicadaEn <= ahora`  -> condicion de rango sobre GSI2SK, con la cota
//      superior de `gsi2.cotaSuperiorPorFecha` para que sea inclusiva.
//   3. tipo compatible         -> filtro en memoria contra los permisos de
//      venta de la sesion, ya resueltos en `tiposPermitidos`.
//
// Lo que no se recupera no puede filtrarse mal despues.

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { gsi2, NOMBRES_DE_INDICE } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, type DepsDeServicio } from "@/lib/data/deps";
import { aIso } from "@/lib/domain/fechas";
import type { Convocatoria, TipoConvocatoria } from "@/types/convocatoria";
import { exito, type Resultado } from "@/types/resultado";
import { aConvocatoria } from "./mapeo";
import { obtenerConvocatoria } from "./obtenerConvocatoria";

/**
 * Lo que ve el catalogo de participante de cada convocatoria visible.
 * `ConvocatoriaListadoDTO` de `api-contracts.md` seccion 8: nunca lleva datos
 * de participantes.
 */
export type ConvocatoriaVisible = {
  convocatoriaId: string;
  /** Con lo que la organizacion la nombra; es el dato con el que se pregunta. */
  folio: string;
  nombre: string;
  tipo: TipoConvocatoria;
  publicadaEn: string;
  inicioVenta: string;
  finVenta: string;
  cantidadDeLotes: number;
};

/**
 * Tope de convocatorias publicadas a la vez. Igual criterio que
 * `listarConvocatorias`: se cuentan por decenas, no por miles.
 */
export const MAXIMO_VISIBLES = 500;

/**
 * Lista las convocatorias `PUBLICADA` con `publicadaEn <= ahora` y tipo
 * compatible con `tiposPermitidos`.
 *
 * Sin tipos permitidos no hay nada que consultar: una sesion sin ningun
 * permiso de venta ve el catalogo vacio, nunca un error.
 *
 * El conteo de lotes se resuelve con una lectura por convocatoria
 * (`obtenerConvocatoria`, PA-04). El volumen es el mismo "decenas" que ya
 * acepta `modelo-datos-dynamodb.md` para el listado administrativo; no hay
 * un contador desnormalizado que ahorre esa lectura.
 */
export const listarConvocatoriasVisibles = async (
  tiposPermitidos: readonly TipoConvocatoria[],
  ahora: Date,
  deps: DepsDeServicio = {},
): Promise<Resultado<ConvocatoriaVisible[]>> => {
  if (tiposPermitidos.length === 0) return exito([]);

  const cliente = clienteDe(deps);
  const ahoraIso = aIso(ahora);

  const salida = await cliente.send(
    new QueryCommand({
      TableName: nombreDeTabla(),
      IndexName: NOMBRES_DE_INDICE.porEstatus,
      KeyConditionExpression: "GSI2PK = :pk AND GSI2SK <= :cota",
      ExpressionAttributeValues: {
        ":pk": gsi2.particionDeEstatus("CONV", "PUBLICADA").GSI2PK,
        ":cota": gsi2.cotaSuperiorPorFecha(ahoraIso),
      },
      Limit: MAXIMO_VISIBLES,
    }),
  );

  const candidatas = (salida.Items ?? [])
    .map((item) => aConvocatoria(item))
    .filter((c): c is Convocatoria => c !== undefined)
    .filter((c) => tiposPermitidos.includes(c.tipo));

  const visibles = await Promise.all(
    candidatas.map(async (c): Promise<ConvocatoriaVisible> => {
      const detalle = await obtenerConvocatoria(c.convocatoriaId, deps);
      return {
        convocatoriaId: c.convocatoriaId,
        folio: c.folio,
        nombre: c.nombre,
        tipo: c.tipo,
        publicadaEn: c.publicadaEn,
        inicioVenta: c.inicioVenta,
        finVenta: c.finVenta,
        cantidadDeLotes: detalle.ok ? detalle.data.lotes.length : 0,
      };
    }),
  );

  // Mas proxima a abrir primero: es lo que decide a que atender antes.
  visibles.sort((a, b) => a.inicioVenta.localeCompare(b.inicioVenta));

  return exito(visibles);
};
