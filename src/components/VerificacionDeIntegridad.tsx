import { Badge } from "@churchofjesuschrist/eden-badge";
import { Text3, Text4 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import type {
  ComprobacionDeIntegridad,
  VeredictoDeComprobacion,
} from "@/types/auditoria";
import "./VerificacionDeIntegridad.css";

/**
 * Las seis comprobaciones de `trazabilidad-auditoria.md` 5.1 —
 * `ui-ux-requerimientos.md` seccion 7: "cada una con veredicto visible".
 *
 * Server Component puro: solo traduce claves de union discriminada contra el
 * diccionario (regla 11) y arma listas de numeros, sin estado ni eventos.
 */
export type VerificacionDeIntegridadProps = {
  comprobaciones: readonly ComprobacionDeIntegridad[];
  diccionario: Diccionario;
};

const COLOR_POR_VEREDICTO: Record<
  VeredictoDeComprobacion,
  "success" | "error" | "warn"
> = {
  cumple: "success",
  incumple: "error",
  informativo: "warn",
};

const Detalle = ({
  comprobacion,
  etiquetas,
}: {
  comprobacion: ComprobacionDeIntegridad;
  etiquetas: Diccionario["auditoria"];
}) => {
  switch (comprobacion.clave) {
    case "turnosContiguos":
      return (
        <>
          {comprobacion.huecos.length > 0 && (
            <Text4 renderAs="p">
              {`${etiquetas.huecos}: ${comprobacion.huecos.join(", ")}`}
            </Text4>
          )}
          {comprobacion.duplicados.length > 0 && (
            <Text4 renderAs="p">
              {`${etiquetas.duplicados}: ${comprobacion.duplicados.join(", ")}`}
            </Text4>
          )}
        </>
      );
    case "ordenDeAdjudicacion":
      return (
        <>
          {comprobacion.saltosSinJustificar.map((salto) => (
            <Text4
              renderAs="p"
              key={`${String(salto.turnoSaltado)}-${String(salto.turnoAdjudicado)}`}
            >
              {`${etiquetas.saltoTurno} ${String(salto.turnoAdjudicado)} ${etiquetas.saltoAdjudicado} ${String(salto.turnoSaltado)}`}
            </Text4>
          ))}
        </>
      );
    case "unaAdjudicacionVigente":
      return (
        <>
          {comprobacion.conflictos.map((conflicto) => (
            <Text4
              renderAs="p"
              key={`${String(conflicto.turnoVigente)}-${String(conflicto.turnoNuevo)}`}
            >
              {`${etiquetas.conflictoTurno} ${String(conflicto.turnoNuevo)} ${etiquetas.conflictoNuevo} ${String(conflicto.turnoVigente)}`}
            </Text4>
          ))}
        </>
      );
    case "vencimientosConTiempo":
      return comprobacion.turnosConFechaInconsistente.length > 0 ? (
        <Text4 renderAs="p">
          {`${etiquetas.turnosInconsistentes}: ${comprobacion.turnosConFechaInconsistente.join(", ")}`}
        </Text4>
      ) : null;
    case "transicionesConEvento":
      return comprobacion.turnosSinExplicar.length > 0 ? (
        <Text4 renderAs="p">
          {`${etiquetas.turnosSinExplicar}: ${comprobacion.turnosSinExplicar.join(", ")}`}
        </Text4>
      ) : null;
    case "motivosObligatorios":
      return comprobacion.eventosSinMotivo.length > 0 ? (
        <Text4 renderAs="p">
          {`${etiquetas.eventosSinMotivo}: ${comprobacion.eventosSinMotivo.join(", ")}`}
        </Text4>
      ) : null;
  }
};

const VerificacionDeIntegridad = ({
  comprobaciones,
  diccionario,
}: VerificacionDeIntegridadProps) => {
  const etiquetas = diccionario.auditoria;

  return (
    <ul className="verificacion-integridad">
      {comprobaciones.map((comprobacion) => (
        <li key={comprobacion.clave} className="verificacion-integridad__item">
          <div className="verificacion-integridad__encabezado">
            <Text3 renderAs="span">
              {etiquetas.comprobaciones[comprobacion.clave]}
            </Text3>
            <Badge color={COLOR_POR_VEREDICTO[comprobacion.veredicto]}>
              {etiquetas.veredictos[comprobacion.veredicto]}
            </Badge>
          </div>
          <Detalle comprobacion={comprobacion} etiquetas={etiquetas} />
        </li>
      ))}
    </ul>
  );
};

export default VerificacionDeIntegridad;
