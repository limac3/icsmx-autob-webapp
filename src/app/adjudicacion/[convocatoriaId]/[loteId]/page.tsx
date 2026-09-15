import { forbidden, notFound, redirect } from "next/navigation";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import FilaParaAdjudicar, {
  type CandidatoVista,
} from "@/components/FilaParaAdjudicar";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { desdeIso, formatearFechaHora } from "@/lib/domain/fechas";
import { ventaAbierta } from "@/lib/domain/ventanas";
import { leerFilaParaAdjudicar } from "@/lib/fila/leerFilaParaAdjudicar";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "../../pagina.css";

/**
 * Detalle del lote a adjudicar — donde vive el dictamen (R-23).
 *
 * Dinamica: la fila crece mientras la venta siga abierta, y decidir sobre una
 * copia en cache seria decidir sobre una fila que ya no existe.
 *
 * **Expone identidades**, y es la unica pantalla fuera de auditoria que lo
 * hace. La guarda de `adjudicacion:ver-fila-identificada` la acota a la
 * modalidad que la justifica: en una convocatoria automatica nadie necesita ver
 * quien es quien, y R-12 vuelve a aplicar entera.
 */
export const dynamic = "force-dynamic";

const DetalleDeAdjudicacion = async ({
  params,
}: {
  params: Promise<{ convocatoriaId: string; loteId: string }>;
}) => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const { convocatoriaId, loteId } = await params;

  const lectura = await obtenerConvocatoria(convocatoriaId);
  if (!lectura.ok) notFound();

  const convocatoria = lectura.data;
  const lote = convocatoria.lotes.find((uno) => uno.loteId === loteId);
  if (!lote) notFound();

  const esManual = convocatoria.modalidadAdjudicacion === "MANUAL";

  const puedeVer = await exigirPermiso("adjudicacion:ver-fila-identificada", {
    modalidadManual: esManual,
  });
  if (!puedeVer.ok) forbidden();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.adjudicacion;

  const inicio = desdeIso(convocatoria.inicioVenta);
  const fin = desdeIso(convocatoria.finVenta);
  const abierta =
    inicio !== undefined &&
    fin !== undefined &&
    ventaAbierta({ inicioVenta: inicio, finVenta: fin }, new Date());

  const fila = await leerFilaParaAdjudicar({
    lote,
    lotesDeLaConvocatoria: convocatoria.lotes,
  });
  if (!fila.ok) throw new Error(fila.error);

  // El permiso de decidir se evalua aparte del de ver: `Autob_Auditar` ve la
  // fila pero no adjudica. Se pide sin motivo —todavia no hay ninguno— asi que
  // solo responde por la capacidad; la guarda completa vuelve a correr en la
  // action, con el motivo ya escrito.
  const puedeAdjudicar = await exigirPermiso("adjudicacion:adjudicar", {
    modalidadManual: esManual,
    estatusConvocatoria: convocatoria.estatus,
    estatusLote: lote.estatus,
    motivoProvisto: true,
  });

  const candidatos: CandidatoVista[] = fila.data.candidatos.map((c) => {
    const llegada = desdeIso(c.solicitadoEn);
    return {
      turno: c.turno,
      participanteId: c.participanteId,
      ...(c.correoTitular ? { correoTitular: c.correoTitular } : {}),
      // Se formatea en el servidor, en hora de negocio: dejarselo al navegador
      // mostraria la hora local de cada quien (regla 9).
      solicitadoEn: llegada ? formatearFechaHora(llegada) : c.solicitadoEn,
      ...(c.ordenEnConvocatoria === undefined
        ? {}
        : { ordenEnConvocatoria: c.ordenEnConvocatoria }),
      adjudicacionesEnConvocatoria: c.adjudicacionesEnConvocatoria,
      sinCupo: c.sinCupo,
      otrasParticipaciones: c.otrasParticipaciones,
    };
  });

  return (
    <main className="adjudicacion">
      <header>
        <H1>{etiquetas.tituloDetalle}</H1>
        <Text2 renderAs="p">
          {convocatoria.nombre} · {lote.vehiculoId}
        </Text2>
      </header>

      <FilaParaAdjudicar
        convocatoriaId={convocatoriaId}
        loteId={loteId}
        candidatos={candidatos}
        puedeAdjudicar={puedeAdjudicar.ok}
        ventaAbierta={abierta}
        diccionario={diccionario}
      />
    </main>
  );
};

export default DetalleDeAdjudicacion;
