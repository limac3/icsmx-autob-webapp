import Link from "next/link";
import { Info, Warn } from "@churchofjesuschrist/eden-alert";
import { Primary, Secondary } from "@churchofjesuschrist/eden-buttons";
import { Text2 } from "@churchofjesuschrist/eden-text";
import CuentaRegresiva from "@/components/CuentaRegresiva";
import type { Diccionario } from "@/dictionaries";
import type { SiguientePaso } from "@/lib/domain/siguientePaso";
import type { PendienteDeBandeja } from "@/types/inicio";
import "./PanelDeInicio.css";

/**
 * Lo que le toca hacer ahora a quien mira el home: un plazo corriendo, una
 * venta abierta, o su bandeja con trabajo.
 *
 * **Una sola linea de "siguiente paso", no un tablero.** La prioridad la
 * decide `calcularSiguientePaso` en el dominio; aqui solo se pinta. Si esta
 * pantalla mostrara a la vez el plazo, el catalogo y la proxima apertura, lo
 * unico que se pierde por no mirarlo —el plazo— dejaria de resaltar.
 *
 * **No calcula ninguna fecha.** El vencimiento llega formateado en hora de
 * negocio y los segundos restantes llegan resueltos del servidor; el cliente
 * solo decrementa (regla 9, R-04). Es el mismo trato que en `/mis-solicitudes`.
 *
 * **Un fallo de lectura no se lo lleva todo.** Con `fallo`, el panel degrada a
 * un aviso explicito y la guia de instrucciones de abajo se sigue dibujando,
 * porque no depende de ninguna consulta. La regla 15 prohibe callar el fallo o
 * rellenarlo con datos inventados, no conservar la parte de la pantalla que si
 * funciona.
 */

export type SiguientePasoEnPantalla = SiguientePaso & {
  /**
   * La fecha del paso —el vencimiento, o la apertura— ya formateada en hora de
   * negocio **por el servidor**.
   */
  fechaFormateada?: string;
  /** Solo con `PLAZO_CORRIENDO`: segundos que faltan, calculados al render. */
  segundosParaVencer?: number;
};

export type PanelDeInicioProps = {
  siguientePaso?: SiguientePasoEnPantalla;
  pendientes: readonly PendienteDeBandeja[];
  /** La lectura de los datos fallo. Se avisa; no se inventa un estado vacio. */
  fallo?: boolean;
  diccionario: Diccionario;
  idioma: string;
};

const PanelDeInicio = ({
  siguientePaso,
  pendientes,
  fallo,
  diccionario,
  idioma,
}: PanelDeInicioProps) => {
  const etiquetas = diccionario.inicio.siguientePaso;
  const deBandeja = diccionario.inicio.pendientes;
  const horaDeNegocio = diccionario.catalogo.horaDeNegocio;

  if (fallo) {
    return (
      <div className="panel-inicio">
        <Warn title={etiquetas.errorTitulo}>
          <Text2 renderAs="p">{etiquetas.errorDescripcion}</Text2>
        </Warn>
      </div>
    );
  }

  // Nada que hacer y ninguna bandeja con trabajo: no se dibuja nada. Un
  // recuadro que dice "no tienes pendientes" es ruido con marco.
  if (!siguientePaso && pendientes.length === 0) return null;

  const etiquetaDeBandeja = (pendiente: PendienteDeBandeja): string => {
    if (pendiente.id === "adjudicacion") return deBandeja.adjudicacion;
    const una = pendiente.cantidad === 1;
    if (pendiente.id === "aprobaciones") {
      return `${pendiente.cantidad} ${una ? deBandeja.aprobacionesUna : deBandeja.aprobaciones}`;
    }
    return `${pendiente.cantidad} ${una ? deBandeja.tesoreriaUno : deBandeja.tesoreria}`;
  };

  return (
    <div className="panel-inicio">
      {siguientePaso ? (
        <PasoDestacado
          paso={siguientePaso}
          etiquetas={etiquetas}
          horaDeNegocio={horaDeNegocio}
          idioma={idioma}
        />
      ) : null}

      {pendientes.length > 0 ? (
        <Info title={deBandeja.titulo}>
          <ul className="panel-inicio__pendientes">
            {pendientes.map((pendiente) => (
              <li key={pendiente.id}>
                <Text2 renderAs="span">{etiquetaDeBandeja(pendiente)}</Text2>
                <Secondary renderAs={Link} href={pendiente.href} small>
                  {deBandeja.ver}
                </Secondary>
              </li>
            ))}
          </ul>
        </Info>
      ) : null}
    </div>
  );
};

type PasoDestacadoProps = {
  paso: SiguientePasoEnPantalla;
  etiquetas: Diccionario["inicio"]["siguientePaso"];
  horaDeNegocio: string;
  idioma: string;
};

/**
 * Un caso por variante, sin `default`: agregar una variante a `SiguientePaso`
 * y no pintarla aqui es un error de compilacion, no un hueco en la pantalla.
 */
const PasoDestacado = ({
  paso,
  etiquetas,
  horaDeNegocio,
  idioma,
}: PasoDestacadoProps) => {
  switch (paso.tipo) {
    case "PLAZO_CORRIENDO":
      return (
        // `Warn` y no `Info`: es lo unico del home que se pierde por no
        // mirarlo a tiempo.
        <Warn title={etiquetas.titulo}>
          <Text2 renderAs="p">
            {etiquetas.plazoCorriendo} {paso.vehiculo}. {etiquetas.plazoVence}{" "}
            {paso.fechaFormateada} ({horaDeNegocio})
          </Text2>
          {paso.segundosParaVencer !== undefined ? (
            <CuentaRegresiva
              segundosIniciales={paso.segundosParaVencer}
              idioma={idioma}
            />
          ) : null}
          <div className="panel-inicio__accion">
            <Primary
              renderAs={Link}
              href={`/convocatorias/${paso.convocatoriaId}/lotes/${paso.loteId}`}
              small
            >
              {etiquetas.irAPagar}
            </Primary>
          </div>
        </Warn>
      );

    case "PLAZO_CORRIENDO_SIN_PRECISAR":
      return (
        <Warn title={etiquetas.titulo}>
          <Text2 renderAs="p">{etiquetas.plazoSinPrecisar}</Text2>
          <div className="panel-inicio__accion">
            <Primary renderAs={Link} href="/mis-solicitudes" small>
              {etiquetas.verMisSolicitudes}
            </Primary>
          </div>
        </Warn>
      );

    case "VENTA_ABIERTA":
      return (
        <Info title={etiquetas.titulo}>
          <Text2 renderAs="p">
            {etiquetas.ventaAbierta} {paso.nombre} — {paso.cantidadDeLotes}{" "}
            {etiquetas.ventaAbiertaLotes}
          </Text2>
          <div className="panel-inicio__accion">
            <Primary renderAs={Link} href="/convocatorias" small>
              {etiquetas.irAlCatalogo}
            </Primary>
          </div>
        </Info>
      );

    case "VARIAS_VENTAS_ABIERTAS":
      return (
        <Info title={etiquetas.titulo}>
          <Text2 renderAs="p">
            {paso.cantidad} {etiquetas.variasVentasAbiertas}
          </Text2>
          <div className="panel-inicio__accion">
            <Primary renderAs={Link} href="/convocatorias" small>
              {etiquetas.irAlCatalogo}
            </Primary>
          </div>
        </Info>
      );

    case "PROXIMA_APERTURA":
      return (
        <Info title={etiquetas.titulo}>
          <Text2 renderAs="p">
            {etiquetas.proximaApertura} {paso.fechaFormateada} ({horaDeNegocio})
            — {paso.nombre}
          </Text2>
          <div className="panel-inicio__accion">
            <Secondary renderAs={Link} href="/convocatorias" small>
              {etiquetas.irAlCatalogo}
            </Secondary>
          </div>
        </Info>
      );
  }
};

export default PanelDeInicio;
