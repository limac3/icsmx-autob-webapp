import Link from "next/link";
import { Info } from "@churchofjesuschrist/eden-alert";
import { Secondary } from "@churchofjesuschrist/eden-buttons";
import { Text2 } from "@churchofjesuschrist/eden-text";
import type { Diccionario } from "@/dictionaries";
import { formatearFechaHora } from "@/lib/domain/fechas";

/**
 * El encabezado que distingue la vista previa de la pantalla de verdad.
 *
 * **Es un componente porque lo pintan las dos pantallas de vista previa** —la
 * convocatoria y el vehiculo— y porque es lo unico que impide confundirlas con
 * lo que ve el participante. Si una de las dos dejara de decirlo, o lo dijera
 * distinto, quien administra creeria estar mirando el estado real.
 *
 * Lleva siempre la salida al detalle administrativo: desde aqui, el resto de
 * los enlaces se quedan dentro de la vista previa a proposito.
 */
export type AvisoDeVistaPreviaProps = {
  /** Si hoy la convocatoria no la ve ningun participante. */
  aunNoVisible: boolean;
  /** Desde cuando sera visible. Se muestra en hora de negocio (regla 9). */
  publicadaEn: Date;
  /** Ruta del detalle administrativo de la convocatoria. */
  rutaDelDetalle: string;
  diccionario: Diccionario;
};

const AvisoDeVistaPrevia = ({
  aunNoVisible,
  publicadaEn,
  rutaDelDetalle,
  diccionario,
}: AvisoDeVistaPreviaProps) => {
  const etiquetas = diccionario.convocatorias;

  return (
    <Info title={etiquetas.vistaPreviaTitulo}>
      <Text2 renderAs="p">
        {aunNoVisible
          ? `${etiquetas.vistaPreviaAunNoVisible} ${formatearFechaHora(publicadaEn)} (${diccionario.catalogo.horaDeNegocio})`
          : etiquetas.vistaPreviaVisible}
      </Text2>
      <Text2 renderAs="p">{etiquetas.vistaPreviaEnlaces}</Text2>
      <Secondary renderAs={Link} href={rutaDelDetalle} small>
        {etiquetas.salirDeLaVistaPrevia}
      </Secondary>
    </Info>
  );
};

export default AvisoDeVistaPrevia;
