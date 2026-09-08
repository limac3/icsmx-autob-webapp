import { NextResponse } from "next/server";

import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { consultarBitacoraCompleta } from "@/lib/auditoria/consultarBitacora";
import { csvDeBitacora } from "@/lib/auditoria/csvDeBitacora";
import { eventoCoincideConFiltros } from "@/lib/auditoria/filtrosDeBitacora";
import { TIPOS_DE_AGREGADO, type TipoDeAgregado } from "@/lib/data/claves";
import { eventoParaTransaccion, nuevaCorrelacion } from "@/lib/data/eventos";
import { ejecutarTransaccion } from "@/lib/data/transacciones";
import { TIPOS_DE_EVENTO, type TipoDeEvento } from "@/types/auditoria";

// Route Handler de la exportacion de bitacora — la segunda de las tres
// excepciones a "todas las mutaciones por Server Action" (regla 2): entrega
// un archivo con cabeceras propias.
//
// **No hereda ninguna proteccion.** Verifica sesion y permiso por su cuenta,
// igual que `/api/comprobantes/[solicitudId]` — la Server Action
// `exportarBitacora` solo devuelve esta URL, no ejecuta ninguna lectura.
//
// **`BITACORA_EXPORTADA` se escribe aqui, no en la action.** Es el punto en
// el que los datos sensibles realmente salen; si el evento se registrara al
// pedir la URL, cualquiera con `Autob_Auditar` podria construir esta misma
// URL a mano y descargar sin dejar rastro (`desafios-implementacion.md` 36).

const esTipoDeAgregado = (valor: string | null): valor is TipoDeAgregado =>
  valor !== null && (TIPOS_DE_AGREGADO as readonly string[]).includes(valor);

const esTipoDeEvento = (valor: string | null): valor is TipoDeEvento =>
  valor !== null && (TIPOS_DE_EVENTO as readonly string[]).includes(valor);

export const GET = async (request: Request): Promise<Response> => {
  const permiso = await exigirPermiso("auditoria:exportar");
  if (!permiso.ok) return new NextResponse(null, { status: 403 });

  const parametros = new URL(request.url).searchParams;
  const agregado = parametros.get("agregado");
  const agregadoId = parametros.get("agregadoId");
  if (!esTipoDeAgregado(agregado) || !agregadoId) {
    return new NextResponse(null, { status: 400 });
  }

  const tipo = parametros.get("tipo");
  const filtros = {
    tipo: esTipoDeEvento(tipo) ? tipo : undefined,
    desde: parametros.get("desde") ?? undefined,
    hasta: parametros.get("hasta") ?? undefined,
    participanteId: parametros.get("participanteId") ?? undefined,
  };

  const lectura = await consultarBitacoraCompleta({ agregado, agregadoId });
  if (!lectura.ok) {
    throw new Error(`No se pudo leer la bitacora de ${agregado}#${agregadoId}`);
  }

  const eventos = lectura.data.filter((evento) =>
    eventoCoincideConFiltros(evento, filtros),
  );

  // El acceso queda auditado antes de responder: sin fallback silencioso
  // (regla 15), un fallo aqui tiene que impedir la exportacion, no perderse.
  const ahora = new Date();
  const auditoria = await ejecutarTransaccion([
    eventoParaTransaccion({
      tipo: "BITACORA_EXPORTADA",
      agregado,
      agregadoId,
      actor: permiso.actor,
      ocurridoEn: ahora,
      correlacionId: nuevaCorrelacion(ahora),
      datos: { filtros, cantidadDeEventos: eventos.length },
    }),
  ]);
  if (!auditoria.ok) {
    throw new Error(
      `No se pudo registrar la exportacion de ${agregado}#${agregadoId}`,
    );
  }

  return new NextResponse(csvDeBitacora(eventos), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bitacora-${agregado}-${agregadoId}.csv"`,
      "Cache-Control": "no-store",
    },
  });
};
