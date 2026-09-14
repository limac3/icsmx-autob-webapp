import { Card } from "@churchofjesuschrist/eden-card";
import { DD, DL, DT } from "@churchofjesuschrist/eden-description-list";
import { HtmlFragment } from "@churchofjesuschrist/eden-html-fragment";
import { H1, H2 } from "@churchofjesuschrist/eden-headings";
import { Text2, Text4 } from "@churchofjesuschrist/eden-text";
import { EstadoDeVenta } from "@/components/CatalogoConvocatorias";
import RejillaDeLotes, {
  type LoteEnCatalogo,
} from "@/components/RejillaDeLotes";
import type { Diccionario } from "@/dictionaries";
import { formatearFechaHora } from "@/lib/domain/fechas";
import type { EstadoDeVentaUi } from "@/lib/domain/ventanas";
import type { Convocatoria } from "@/types/convocatoria";

/**
 * La convocatoria tal como la ve un participante — pantalla 3.2.
 *
 * **Es un componente y no el cuerpo de una pagina porque lo usan dos.** La
 * pantalla publica y la vista previa administrativa
 * (`/admin/convocatorias/[id]/vista-publica`) renderizan esto mismo; si cada una
 * armara su version, la vista previa dejaria de serlo el dia que una de las dos
 * cambie — y ese dia nadie se entera, porque las dos siguen compilando.
 *
 * Recibe todo resuelto y **no lee nada**: quien lo usa decide como obtiene los
 * datos y, sobre todo, con que permiso. Esa division es lo que permite que la
 * pantalla publica mantenga su gating triple con 404 (R-01) mientras la vista
 * previa se abre con el permiso de administracion, sin que ninguna de las dos
 * relaje la otra.
 */

const EXPLICACION_POR_FASE = {
  PUBLICADA_SIN_ABRIR: "explicacionSinAbrir",
  VENTA_ABIERTA: "explicacionAbierta",
  VENTA_CERRADA: "explicacionCerrada",
} as const satisfies Record<
  EstadoDeVentaUi["fase"],
  keyof Diccionario["catalogo"]
>;

export type VistaDeConvocatoriaProps = {
  /**
   * Ruta de esta misma pantalla. Los vehiculos cuelgan de ella, para que la
   * vista previa enlace dentro de la vista previa y la pantalla publica dentro
   * de la publica.
   */
  rutaBase: string;
  convocatoria: Convocatoria;
  lotes: readonly LoteEnCatalogo[];
  estadoDeVenta: EstadoDeVentaUi;
  inicioVenta: Date;
  finVenta: Date;
  diccionario: Diccionario;
  idioma: string;
};

const VistaDeConvocatoria = ({
  rutaBase,
  convocatoria,
  lotes,
  estadoDeVenta,
  inicioVenta,
  finVenta,
  diccionario,
  idioma,
}: VistaDeConvocatoriaProps) => {
  const etiquetas = diccionario.catalogo;

  // Lo que la convocatoria **es**, aparte de su descripcion. Se arma como dato
  // y no como JSX repetido para que el orden se lea de un golpe y para que
  // agregar un campo sea agregar un renglon.
  const datos: readonly { etiqueta: string; valor: string }[] = [
    {
      etiqueta: diccionario.convocatorias.campoTipo,
      valor: diccionario.tiposConvocatoria[convocatoria.tipo],
    },
    {
      etiqueta: diccionario.convocatorias.campoInicioVenta,
      valor: formatearFechaHora(inicioVenta),
    },
    {
      etiqueta: diccionario.convocatorias.campoFinVenta,
      valor: formatearFechaHora(finVenta),
    },
    {
      etiqueta: diccionario.convocatorias.campoHorasLiquidacion,
      valor: String(convocatoria.horasLiquidacion),
    },
  ];

  return (
    <>
      {/* El titulo es el nombre de la convocatoria, con el folio debajo. Antes
          era el **tipo** —"De empleados"—, que no distingue una venta de la
          siguiente: todas las de empleados se llamaban igual. El tipo pasa a
          ser un campo mas, que es lo que es. */}
      <header className="catalogo__encabezado">
        <H1>{convocatoria.nombre}</H1>
        <Text4 renderAs="p">
          {`${diccionario.convocatorias.campoFolio}: ${convocatoria.folio}`}
        </Text4>
        <EstadoDeVenta
          estado={estadoDeVenta}
          diccionario={diccionario}
          idioma={idioma}
        />
      </header>

      {/* Dos recuadros y no un encabezado corrido: la descripcion es texto
          libre de varios parrafos —lo que hay que leer— y los campos son datos
          de un renglon —lo que hay que consultar—. Mezclados, la descripcion
          se traga las fechas. */}
      <Card className="catalogo__recuadro">
        <H2>{diccionario.convocatorias.campoDescripcion}</H2>
        <HtmlFragment content={convocatoria.descripcionParticipacion} />
      </Card>

      <Card className="catalogo__recuadro">
        <H2>{etiquetas.seccionDatos}</H2>
        <DL>
          {datos.map(({ etiqueta, valor }) => (
            <div key={etiqueta}>
              <DT>{etiqueta}</DT>
              <DD>
                <Text2 renderAs="span">{valor}</Text2>
              </DD>
            </div>
          ))}
          {/* El estado otra vez, aqui con lo que **significa**. Arriba la
              insignia sola basta para reconocerlo de un vistazo; en la ficha de
              datos hace falta saber que se puede hacer en ese estado, que es la
              pregunta real: "abierta" no dice por si sola que hay que formarse
              en una fila, ni "cerrada" que un plazo de pago puede seguir
              corriendo. */}
          <div>
            <DT>{etiquetas.columnaEstadoVenta}</DT>
            <DD className="catalogo__estado">
              <EstadoDeVenta
                estado={estadoDeVenta}
                diccionario={diccionario}
                idioma={idioma}
              />
              <Text2 renderAs="p" className="catalogo__estado-explicacion">
                {etiquetas[EXPLICACION_POR_FASE[estadoDeVenta.fase]]}
              </Text2>
            </DD>
          </div>
        </DL>
        {/* Las dos fechas van en hora de negocio (regla 9). Dicho una vez para
            el recuadro, no colgado de cada fecha. */}
        <Text4 renderAs="p">{etiquetas.horaDeNegocio}</Text4>
      </Card>

      <section>
        <H2>{etiquetas.seccionLotes}</H2>
        <RejillaDeLotes
          rutaBase={rutaBase}
          lotes={lotes}
          diccionario={diccionario}
          idioma={idioma}
        />
      </section>
    </>
  );
};

export default VistaDeConvocatoria;
