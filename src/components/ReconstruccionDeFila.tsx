import { Drawer, Summary } from "@churchofjesuschrist/eden-accordion";
import { Text2, Text3, Text4 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import BitacoraDeEventos, { type FilaDeBitacora } from "./BitacoraDeEventos";
import "./ReconstruccionDeFila.css";

/**
 * Reconstruccion de la fila de un lote — `ui-ux-requerimientos.md` seccion 7.
 *
 * **Aqui si se muestran identidades**: es la unica pantalla del sistema que
 * lo hace (permission-matrix.md seccion 5). Cada turno es un `Drawer`
 * colapsado con su propia linea de tiempo; `Drawer`/`Summary` no comparan
 * hijos por identidad, asi que este componente puede quedarse Server
 * Component aunque `BitacoraDeEventos` (dentro) sea cliente
 * (`desafios-implementacion.md` 23, igual que `BarraDeIdentidadSimulada`).
 */
export type SolicitudParaVista = {
  turno: number;
  participanteId: string;
  eventos: readonly FilaDeBitacora[];
};

export type ReconstruccionDeFilaProps = {
  solicitudes: readonly SolicitudParaVista[];
  /** Eventos que no pertenecen a ningun turno — hoy solo `FILA_AGOTADA`. */
  eventosDelLote: readonly FilaDeBitacora[];
  diccionario: Diccionario;
};

const ReconstruccionDeFila = ({
  solicitudes,
  eventosDelLote,
  diccionario,
}: ReconstruccionDeFilaProps) => {
  const etiquetas = diccionario.auditoria;

  if (solicitudes.length === 0 && eventosDelLote.length === 0) {
    return <Text2 renderAs="p">{etiquetas.sinSolicitudes}</Text2>;
  }

  return (
    <div className="reconstruccion-fila">
      {solicitudes.map((solicitud) => (
        <Drawer key={solicitud.turno}>
          <Summary>
            <span className="reconstruccion-fila__resumen">
              <Text3 renderAs="span">
                {`${etiquetas.columnaTurno} ${String(solicitud.turno)}`}
              </Text3>
              <Text4 renderAs="span">{solicitud.participanteId}</Text4>
            </span>
          </Summary>
          <BitacoraDeEventos
            eventos={solicitud.eventos}
            diccionario={diccionario}
          />
        </Drawer>
      ))}

      {eventosDelLote.length > 0 ? (
        <section className="reconstruccion-fila__lote">
          <Text3 renderAs="h2">{etiquetas.eventosDelLote}</Text3>
          <BitacoraDeEventos
            eventos={eventosDelLote}
            diccionario={diccionario}
          />
        </section>
      ) : null}
    </div>
  );
};

export default ReconstruccionDeFila;
