import { Text2 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import type { EstadoAplicacion } from "@/lib/estadoAplicacion";
import "./EstadoServicio.css";

type EstadoServicioProps = {
  estado: EstadoAplicacion;
  diccionario: Diccionario;
};

const EstadoServicio = ({ estado, diccionario }: EstadoServicioProps) => (
  <section
    className="estado-servicio"
    aria-label={diccionario.estadoServicio.titulo}
  >
    <dl className="estado-servicio__lista">
      <div className="estado-servicio__fila">
        <dt>
          <Text2 renderAs="span">
            {diccionario.estadoServicio.etiquetaEstado}
          </Text2>
        </dt>
        <dd>
          <Text2 renderAs="span">{estado.estado}</Text2>
        </dd>
      </div>
      <div className="estado-servicio__fila">
        <dt>
          <Text2 renderAs="span">
            {diccionario.estadoServicio.etiquetaVersion}
          </Text2>
        </dt>
        <dd>
          <Text2 renderAs="span">{estado.version}</Text2>
        </dd>
      </div>
      <div className="estado-servicio__fila">
        <dt>
          <Text2 renderAs="span">
            {diccionario.estadoServicio.etiquetaHora}
          </Text2>
        </dt>
        <dd>
          <Text2 renderAs="span">{estado.tiempo}</Text2>
        </dd>
      </div>
    </dl>
  </section>
);

export default EstadoServicio;
