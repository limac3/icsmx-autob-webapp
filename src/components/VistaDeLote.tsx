import Link from "next/link";
import { Badge } from "@churchofjesuschrist/eden-badge";
import { Secondary } from "@churchofjesuschrist/eden-buttons";
import { DD, DL, DT } from "@churchofjesuschrist/eden-description-list";
import { H1, H2 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import BloqueDeAccionDeLote, {
  type FaseDeVentaEnLote,
} from "@/components/BloqueDeAccionDeLote";
import { EstadoDeVenta } from "@/components/CatalogoConvocatorias";
import FichaTecnicaVehiculo from "@/components/FichaTecnicaVehiculo";
import GaleriaPublica, {
  type FotografiaEnGaleria,
} from "@/components/GaleriaPublica";
import { COLOR_POR_ESTATUS } from "@/components/RejillaDeLotes";
import type { Diccionario } from "@/dictionaries";
import { formatearPrecio } from "@/lib/domain/dinero";
import type { EstadoDeVentaUi } from "@/lib/domain/ventanas";
import type { MiLugarDTO } from "@/types/fila";
import type { Lote } from "@/types/lote";
import type { Vehiculo } from "@/types/vehiculo";
import "./VistaDeLote.css";

/**
 * El vehiculo de un lote tal como lo ve un participante — pantallas 3.3 y 3.4.
 *
 * **Es un componente y no el cuerpo de una pagina porque lo usan dos**, igual
 * que `VistaDeConvocatoria`: la pantalla publica y la vista previa
 * administrativa (`/admin/convocatorias/[id]/vista-publica/lotes/[loteId]`).
 * Si cada una armara su version, la vista previa dejaria de serlo el dia que
 * una de las dos cambie — y ese dia nadie se entera, porque las dos siguen
 * compilando.
 *
 * Recibe todo resuelto y **no lee nada**: quien lo usa decide como obtiene los
 * datos y, sobre todo, con que permiso. Esa division es lo que permite que la
 * pantalla publica mantenga su gating triple con 404 (R-01) mientras la vista
 * previa se abre con el permiso de administracion, sin que ninguna de las dos
 * relaje la otra.
 *
 * **La fase del bloque de accion se deriva aqui y no la pasa la pagina.** Es la
 * misma traduccion para las dos, y duplicarla era una forma barata de que la
 * vista previa mostrara otra cosa que la pantalla real.
 */

/**
 * La fase de venta, reducida a lo que el bloque de accion necesita decidir.
 *
 * La cuenta regresiva viaja en **segundos** —calculados en el servidor— y no
 * como fecha: el cliente decrementa, nunca compara contra su propio reloj
 * (R-04).
 */
const faseParaElBloque = (estado: EstadoDeVentaUi): FaseDeVentaEnLote => {
  if (estado.fase === "PUBLICADA_SIN_ABRIR") {
    return { fase: "SIN_ABRIR", segundosParaAbrir: estado.segundosParaAbrir };
  }
  return estado.fase === "VENTA_ABIERTA"
    ? { fase: "ABIERTA" }
    : { fase: "CERRADA" };
};

export type VistaDeLoteProps = {
  /** La pantalla de convocatoria de la que cuelga esta. */
  rutaDeLaConvocatoria: string;
  convocatoriaId: string;
  lote: Lote;
  vehiculo: Vehiculo;
  /** URLs ya firmadas por el servidor (regla 13). */
  fotografias: readonly FotografiaEnGaleria[];
  tamanoFila: number;
  estadoDeVenta: EstadoDeVentaUi;
  /** `null` si quien mira no tiene solicitud viva en este lote. */
  miLugar: MiLugarDTO | null;
  /** `venceEn` ya formateado en hora de negocio, si esta adjudicada. */
  venceEnFormateado?: string;
  /** Segundos que faltan para el vencimiento, calculados por el servidor. */
  segundosParaVencer?: number;
  /** Vista previa: se ve todo, no se puede actuar sobre la fila. */
  soloLectura?: boolean;
  diccionario: Diccionario;
  idioma: string;
};

const VistaDeLote = ({
  rutaDeLaConvocatoria,
  convocatoriaId,
  lote,
  vehiculo,
  fotografias,
  tamanoFila,
  estadoDeVenta,
  miLugar,
  venceEnFormateado,
  segundosParaVencer,
  soloLectura,
  diccionario,
  idioma,
}: VistaDeLoteProps) => {
  const etiquetas = diccionario.catalogo;
  const titulo = `${vehiculo.marca} ${vehiculo.version} ${String(vehiculo.modelo)}`;

  // El vehiculo fisico, no su modelo: dos unidades de la misma marca, version y
  // anio se llaman igual y solo estos dos numeros las distinguen. Quien compra
  // los necesita para cotejar la unidad que le adjudicaron.
  const identificacion: readonly { etiqueta: string; valor: string }[] = [
    {
      etiqueta: diccionario.vehiculos.campos.numeroEconomico,
      valor: vehiculo.numeroEconomico,
    },
    {
      etiqueta: diccionario.vehiculos.campos.numeroDeSerie,
      valor: vehiculo.numeroDeSerie,
    },
  ];

  return (
    <div className="vista-lote">
      {/* Volver a la convocatoria: desde aqui la unica salida era el boton
          "atras" del navegador, y quien llego por un enlace directo al lote no
          tenia ninguna. */}
      <Secondary renderAs={Link} href={rutaDeLaConvocatoria}>
        {etiquetas.volverALaConvocatoria}
      </Secondary>

      <header className="vista-lote__identificacion">
        <H1>{titulo}</H1>
        <DL>
          {identificacion.map(({ etiqueta, valor }) => (
            <div key={etiqueta}>
              <DT>{etiqueta}</DT>
              <DD>
                <Text2 renderAs="span">{valor}</Text2>
              </DD>
            </div>
          ))}
        </DL>
        <Text2 renderAs="p" className="vista-lote__precio">
          {`${etiquetas.precioDestacado}: ${formatearPrecio(lote.precio, idioma)}`}
        </Text2>
        <Badge
          color={COLOR_POR_ESTATUS[lote.estatus]}
          className="vista-lote__insignia"
        >
          {diccionario.estatusLote[lote.estatus]}
        </Badge>
        <Text2 renderAs="p">
          {`${String(tamanoFila)} ${etiquetas.enFila}`}
        </Text2>

        <EstadoDeVenta
          estado={estadoDeVenta}
          diccionario={diccionario}
          idioma={idioma}
        />
      </header>

      <BloqueDeAccionDeLote
        convocatoriaId={convocatoriaId}
        loteId={lote.loteId}
        miLugar={miLugar}
        estatusLote={lote.estatus}
        venta={faseParaElBloque(estadoDeVenta)}
        venceEnFormateado={venceEnFormateado}
        segundosParaVencer={segundosParaVencer}
        soloLectura={soloLectura}
        diccionario={diccionario}
        idioma={idioma}
      />

      <section>
        <H2>{etiquetas.seccionFichaTecnica}</H2>
        <FichaTecnicaVehiculo
          kilometraje={vehiculo.kilometraje}
          nivelEquipamiento={vehiculo.nivelEquipamiento}
          especificacionMecanica={vehiculo.especificacionMecanica}
          condicionesMecanicas={vehiculo.condicionesMecanicas}
          detallesEsteticos={vehiculo.detallesEsteticos}
          diccionario={diccionario}
          idioma={idioma}
        />
      </section>

      {/* Las fotos van despues de la ficha y no antes. Arriba empujaban la
          identificacion y el bloque de accion —el precio, la fila, el boton de
          formarse— fuera de la primera pantalla en movil, que es donde se
          decide. Primero que vehiculo es y en que estado esta; luego como se
          ve. */}
      <section>
        <H2>{diccionario.vehiculos.seccionFotografias}</H2>
        <GaleriaPublica
          titulo={titulo}
          fotografias={fotografias}
          diccionario={diccionario}
        />
      </section>
    </div>
  );
};

export default VistaDeLote;
