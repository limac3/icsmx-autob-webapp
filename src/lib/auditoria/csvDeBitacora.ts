// Serializacion de `EventoDTO[]` a CSV para `exportarBitacora`.
//
// **Valores crudos, no traducidos.** El CSV es un artefacto permanente que
// alguien puede archivar o auditar fuera de la aplicacion; una etiqueta de
// `es.json` puede cambiar de redaccion, el nombre del evento en el catalogo
// no (es append-only, igual que la bitacora que describe). Traducir aqui
// atrapa el idioma de hoy dentro del archivo.

import type { EventoDTO } from "@/types/auditoria";

const ENCABEZADOS = [
  "eventoId",
  "tipo",
  "ocurridoEn",
  "actorTipo",
  "actorId",
  "correlacionId",
  "vehiculoId",
  "convocatoriaId",
  "loteId",
  "solicitudId",
  "estadoAnterior",
  "estadoNuevo",
  "motivo",
  "datos",
] as const;

/** RFC 4180: comillas dobles alrededor de cualquier campo con `,`, `"` o salto de linea. */
const campoCsv = (valor: string): string =>
  /[",\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;

const fila = (evento: EventoDTO): string =>
  ENCABEZADOS.map((columna) => {
    if (columna === "datos") {
      return campoCsv(evento.datos ? JSON.stringify(evento.datos) : "");
    }
    const valor = evento[columna];
    return campoCsv(valor === undefined ? "" : String(valor));
  }).join(",");

export const csvDeBitacora = (eventos: readonly EventoDTO[]): string =>
  [ENCABEZADOS.join(","), ...eventos.map(fila)].join("\r\n");
