import { forbidden, redirect } from "next/navigation";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import BandejaDeVerificacion, {
  type PendienteDeVerificacion,
} from "@/components/BandejaDeVerificacion";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { desdeIso, formatearFechaHora } from "@/lib/domain/fechas";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import { listarPendientesVerificacion } from "@/lib/tesoreria/listarPendientesVerificacion";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import "./pagina.css";

/**
 * Bandeja de tesoreria — pantalla 6, `PA-11`.
 *
 * Dinamica por definicion, igual que `/aprobaciones`: lo que muestra es
 * exactamente el trabajo pendiente de dictaminar, y deja de estar aqui en
 * cuanto alguien lo hace.
 *
 * La lectura llama al servicio directo, no a la Server Action
 * (AGENTS.md: "las lecturas las hacen los Server Components llamando al
 * servicio directo"); el permiso se comprueba aqui, porque el servicio no
 * lo hace.
 */
export const dynamic = "force-dynamic";

const VerificacionPagina = async () => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const permiso = await exigirPermiso("tesoreria:ver-bandeja");
  if (!permiso.ok) forbidden();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.tesoreria;

  const resultado = await listarPendientesVerificacion();
  if (!resultado.ok) throw new Error(resultado.error);

  // Una lectura de lote y vehiculo por pendiente: el mismo costo que acepta
  // `/aprobaciones` para su propio listado, y al volumen de "decenas en
  // verificacion a la vez" no justifica desnormalizar mas en el modelo.
  const pendientes = (
    await Promise.all(
      resultado.data.map(async (pendiente) => {
        const convocatoria = await obtenerConvocatoria(
          pendiente.convocatoriaId,
        );
        if (!convocatoria.ok) return null;

        const lote = convocatoria.data.lotes.find(
          (uno) => uno.loteId === pendiente.loteId,
        );
        if (!lote) return null;

        const vehiculo = await obtenerVehiculo(lote.vehiculoId);
        if (!vehiculo.ok) return null;

        const adjudicadoEn = desdeIso(pendiente.adjudicadoEn);
        const comprobanteSubidoEn = desdeIso(pendiente.comprobanteSubidoEn);

        const entrada: PendienteDeVerificacion = {
          solicitudId: pendiente.solicitudId,
          vehiculo: `${vehiculo.data.marca} ${vehiculo.data.version} ${String(vehiculo.data.modelo)}`,
          convocatoria: diccionario.tiposConvocatoria[convocatoria.data.tipo],
          correoTitular: pendiente.correoTitular,
          adjudicadoEn: adjudicadoEn ? formatearFechaHora(adjudicadoEn) : "",
          comprobanteSubidoEn: comprobanteSubidoEn
            ? formatearFechaHora(comprobanteSubidoEn)
            : "",
        };
        return entrada;
      }),
    )
  ).filter((entrada): entrada is PendienteDeVerificacion => entrada !== null);

  return (
    <main className="verificacion">
      <header>
        <H1>{etiquetas.titulo}</H1>
        <Text2 renderAs="p">{etiquetas.descripcion}</Text2>
      </header>

      <BandejaDeVerificacion
        pendientes={pendientes}
        diccionario={diccionario}
      />
    </main>
  );
};

export default VerificacionPagina;
