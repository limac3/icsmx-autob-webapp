import { forbidden, redirect } from "next/navigation";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import BandejaDeAprobacion, {
  type PendienteDeAprobacion,
} from "@/components/BandejaDeAprobacion";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { listarConvocatorias } from "@/lib/convocatorias/listarConvocatorias";
import {
  desdeIso,
  formatearEspera,
  formatearFechaHora,
} from "@/lib/domain/fechas";
import { textoPlanoDeDescripcion } from "@/lib/domain/htmlDeDescripcion";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "./pagina.css";

/**
 * Bandeja del aprobador — pantalla 5.
 *
 * Dinamica por definicion: lo que muestra es exactamente lo que aun no se ha
 * dictaminado, y deja de estar aqui en cuanto alguien lo hace. No entra en
 * cache estatica.
 *
 * **El dictamen no vive en esta ruta.** Cada fila lleva a la pantalla de
 * detalle, que ya muestra los datos completos, los lotes y —porque las acciones
 * salen de la maquina de estados y del permiso de quien mira— los botones de
 * aprobar y rechazar. Una segunda vista del mismo dictamen se separaria de la
 * primera al primer cambio.
 */
export const dynamic = "force-dynamic";

const AprobacionesPagina = async () => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const permiso = await exigirPermiso("convocatoria:ver-aprobaciones");
  if (!permiso.ok) forbidden();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.aprobaciones;

  const resultado = await listarConvocatorias({ estatus: ["EN_APROBACION"] });
  if (!resultado.ok) throw new Error(resultado.error);

  const ahora = new Date();

  const conAntiguedad = resultado.data
    .map((convocatoria) => {
      // `actualizadoEn` es cuando entro a `EN_APROBACION`; `creadoEn` es el
      // respaldo para una convocatoria que nunca se edito. La espera cuenta
      // desde que quedo en manos de quien dictamina, no desde que nacio.
      const enviada =
        desdeIso(convocatoria.actualizadoEn ?? "") ??
        desdeIso(convocatoria.creadoEn);
      const inicio = desdeIso(convocatoria.inicioVenta);
      const fin = desdeIso(convocatoria.finVenta);

      const pendiente: PendienteDeAprobacion = {
        convocatoriaId: convocatoria.convocatoriaId,
        tipo: convocatoria.tipo,
        resumen: textoPlanoDeDescripcion(
          convocatoria.descripcionParticipacion,
          120,
        ),
        creadoPor: convocatoria.creadoPor,
        espera: enviada ? formatearEspera(enviada, ahora, idioma) : "",
        periodo:
          inicio && fin
            ? `${formatearFechaHora(inicio)} — ${formatearFechaHora(fin)}`
            : "",
      };

      // La antiguedad viaja aparte: es para ordenar, no para pintar. Una
      // convocatoria con la fecha ilegible se va al final en vez de colarse
      // arriba como si llevara esperando desde el principio de los tiempos.
      return {
        pendiente,
        orden: enviada?.getTime() ?? Number.MAX_SAFE_INTEGER,
      };
    })
    // Las mas antiguas primero: la que lleva mas tiempo esperando es la que
    // esta reteniendo una venta.
    .sort((a, b) => a.orden - b.orden);

  const pendientes = conAntiguedad.map((entrada) => entrada.pendiente);

  return (
    <main className="aprobaciones">
      <header>
        <H1>{etiquetas.titulo}</H1>
        <Text2 renderAs="p">{etiquetas.descripcion}</Text2>
      </header>

      <BandejaDeAprobacion pendientes={pendientes} diccionario={diccionario} />
    </main>
  );
};

export default AprobacionesPagina;
