import { forbidden, notFound, redirect } from "next/navigation";
import AvisoDeVistaPrevia from "@/components/AvisoDeVistaPrevia";
import VistaDeLote from "@/components/VistaDeLote";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { loteParaVista } from "@/lib/convocatorias/loteParaVista";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { desdeIso } from "@/lib/domain/fechas";
import { esLoteOfrecido } from "@/lib/domain/gating";
import { calcularEstadoDeVentaUi } from "@/lib/domain/ventanas";
import { momentoDeVistaPrevia } from "@/lib/domain/vistaPrevia";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "../../../../../../convocatorias/pagina.css";

/**
 * El vehiculo como lo ve un participante, para quien administra.
 *
 * **Existe porque la vista previa de la convocatoria se quedaba a medias.** Sus
 * tarjetas enlazaban al detalle publico del vehiculo, y esa ruta responde 404 a
 * quien administra por las dos razones del gating triple: la convocatoria puede
 * no estar publicada todavia —que es justo cuando se quiere revisar— y quien
 * administra normalmente no tiene el permiso de venta del tipo (R-01, R-02,
 * regla 17). Revisar la convocatoria sin poder abrir un vehiculo es revisar la
 * mitad.
 *
 * **Misma division que la vista previa de la convocatoria**: puerta propia con
 * `convocatoria:ver-administracion`, mismo componente (`VistaDeLote`) y mismos
 * datos (`loteParaVista`) que la pantalla del participante. La ruta publica
 * conserva su 404 intacto.
 *
 * **Se ve el bloque de participacion, y no se puede pulsar** (`soloLectura`).
 * Ocultarlo dejaria fuera la mitad de la pantalla que se quiere revisar;
 * dejarlo vivo invitaria a quien administra a formarse en una fila desde una
 * pantalla de revision. Nada de esto sustituye al servidor: `solicitarCompra`
 * vuelve a comprobar el gating triple en cada llamada.
 *
 * **Sin `consultarMiLugar`**, y no por ahorro: quien administra no participa,
 * asi que su lugar en la fila siempre seria `null`. Preguntarlo daria la misma
 * respuesta y sugeriria que esta pantalla es de participacion.
 *
 * Dinamica: depende del estatus y del reloj (regla 14).
 */
export const dynamic = "force-dynamic";

const VistaPublicaDeLote = async ({
  params,
}: {
  params: Promise<{ id: string; loteId: string }>;
}) => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const permiso = await exigirPermiso("convocatoria:ver-administracion");
  if (!permiso.ok) forbidden();

  const { id, loteId } = await params;
  const lectura = await obtenerConvocatoria(id);
  if (!lectura.ok) notFound();

  const convocatoria = lectura.data;
  const lote = convocatoria.lotes.find((l) => l.loteId === loteId);
  // Un lote retirado no se ofrece, asi que tampoco tiene URL viva: quien
  // guardo el enlace antes de la correccion recibe el mismo 404 que si nunca
  // hubiera existido, y no la ficha de un vehiculo que ya volvio al catalogo.
  if (!lote || !esLoteOfrecido(lote)) notFound();

  const publicadaEn = desdeIso(convocatoria.publicadaEn);
  const inicioVenta = desdeIso(convocatoria.inicioVenta);
  const finVenta = desdeIso(convocatoria.finVenta);
  if (!publicadaEn || !inicioVenta || !finVenta) notFound();

  const { momento, aunNoVisible } = momentoDeVistaPrevia(
    { estatus: convocatoria.estatus, publicadaEn },
    new Date(),
  );

  const datos = await loteParaVista(lote);
  if (!datos) notFound();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);

  const estadoDeVenta = calcularEstadoDeVentaUi(
    { publicadaEn, inicioVenta, finVenta },
    momento,
  );

  return (
    <main className="catalogo">
      <AvisoDeVistaPrevia
        aunNoVisible={aunNoVisible}
        publicadaEn={publicadaEn}
        rutaDelDetalle={`/admin/convocatorias/${id}`}
        diccionario={diccionario}
      />

      <VistaDeLote
        rutaDeLaConvocatoria={`/admin/convocatorias/${id}/vista-publica`}
        convocatoriaId={convocatoria.convocatoriaId}
        lote={lote}
        vehiculo={datos.vehiculo}
        fotografias={datos.fotografias}
        tamanoFila={datos.tamanoFila}
        estadoDeVenta={estadoDeVenta}
        miLugar={null}
        soloLectura
        diccionario={diccionario}
        idioma={idioma}
      />
    </main>
  );
};

export default VistaPublicaDeLote;
