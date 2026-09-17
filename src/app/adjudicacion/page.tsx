import { forbidden, redirect } from "next/navigation";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import BandejaDeAdjudicacion, {
  type LotePorDecidir,
} from "@/components/BandejaDeAdjudicacion";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { listarConvocatorias } from "@/lib/convocatorias/listarConvocatorias";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { formatearPrecio } from "@/lib/domain/dinero";
import { desdeIso, formatearEspera } from "@/lib/domain/fechas";
import { ventaAbierta } from "@/lib/domain/ventanas";
import { rotuloVehiculo } from "@/lib/domain/vehiculos";
import { consultarTamanoFila } from "@/lib/fila/conteosDeFila";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import "./pagina.css";

/**
 * Bandeja del adjudicador — modalidad manual (R-23).
 *
 * Dinamica por definicion, igual que la del aprobador: muestra exactamente lo
 * que aun no se ha decidido, y deja de estar aqui en cuanto alguien decide. No
 * entra en cache estatica.
 *
 * **La bandeja no dictamina.** Cada fila lleva al detalle del lote, donde ya
 * viven la fila identificada, el historial de cada participante y el boton.
 */
export const dynamic = "force-dynamic";

const AdjudicacionPagina = async () => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const permiso = await exigirPermiso("adjudicacion:ver-bandeja");
  if (!permiso.ok) forbidden();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.adjudicacion;

  const publicadas = await listarConvocatorias({ estatus: ["PUBLICADA"] });
  if (!publicadas.ok) throw new Error(publicadas.error);

  const ahora = new Date();
  const pendientes: { lote: LotePorDecidir; orden: number }[] = [];

  for (const resumen of publicadas.data) {
    // Solo las manuales. Una convocatoria automatica no tiene nada que decidir
    // aqui, y listarla invitaria a intervenir donde el motor ya decide.
    if (resumen.modalidadAdjudicacion !== "MANUAL") continue;

    const detalle = await obtenerConvocatoria(resumen.convocatoriaId);
    if (!detalle.ok) continue;

    const convocatoria = detalle.data;
    const inicio = desdeIso(convocatoria.inicioVenta);
    const fin = desdeIso(convocatoria.finVenta);
    const abierta =
      inicio !== undefined &&
      fin !== undefined &&
      ventaAbierta({ inicioVenta: inicio, finVenta: fin }, ahora);

    for (const lote of convocatoria.lotes) {
      // Un lote ya adjudicado, vendido o retirado no espera decision. Uno sin
      // nadie formado tampoco: no hay entre quien elegir.
      if (lote.estatus !== "EN_OFERTA") continue;
      if (lote.contadorTurnos === 0) continue;

      const tamano = await consultarTamanoFila(lote.loteId);
      if (!tamano.ok || tamano.data === 0) continue;

      // Sin esto la bandeja solo mostraba `vehiculoId`, el identificador
      // interno: nada que permita reconocer el vehiculo sin abrir el detalle.
      const vehiculo = await obtenerVehiculo(lote.vehiculoId);

      pendientes.push({
        lote: {
          convocatoriaId: convocatoria.convocatoriaId,
          loteId: lote.loteId,
          vehiculo: vehiculo.ok
            ? rotuloVehiculo(vehiculo.data)
            : lote.vehiculoId,
          identificadores: vehiculo.ok
            ? `${vehiculo.data.numeroEconomico} · ${vehiculo.data.numeroDeSerie}`
            : "",
          precio: formatearPrecio(lote.precio, idioma),
          convocatoria: convocatoria.nombre,
          tamanoFila: tamano.data,
          espera: inicio ? formatearEspera(inicio, ahora, idioma) : "",
          ventaAbierta: abierta,
        },
        // Para ordenar, no para pintar: una fecha ilegible se va al final en
        // vez de colarse arriba como si llevara esperando desde siempre.
        orden: inicio?.getTime() ?? Number.MAX_SAFE_INTEGER,
      });
    }
  }

  // Los que llevan mas esperando, primero: un lote sin decidir es una venta
  // detenida.
  pendientes.sort((a, b) => a.orden - b.orden);

  return (
    <main className="adjudicacion">
      <header>
        <H1>{etiquetas.titulo}</H1>
        <Text2 renderAs="p">{etiquetas.descripcion}</Text2>
      </header>

      <BandejaDeAdjudicacion
        lotes={pendientes.map((entrada) => entrada.lote)}
        diccionario={diccionario}
      />
    </main>
  );
};

export default AdjudicacionPagina;
