import { forbidden, notFound, redirect } from "next/navigation";
import AvisoDeVistaPrevia from "@/components/AvisoDeVistaPrevia";
import VistaDeConvocatoria from "@/components/VistaDeConvocatoria";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { lotesParaCatalogo } from "@/lib/convocatorias/lotesParaCatalogo";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { desdeIso } from "@/lib/domain/fechas";
import { calcularEstadoDeVentaUi } from "@/lib/domain/ventanas";
import { momentoDeVistaPrevia } from "@/lib/domain/vistaPrevia";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "../../../../convocatorias/pagina.css";

/**
 * La convocatoria como la ve un participante, para quien la administra.
 *
 * **Por que existe una ruta y no un enlace a la pantalla publica.** Aquella
 * tiene gating triple con 404 (R-01): exige `PUBLICADA`, `publicadaEn <= ahora`
 * y el permiso de venta del tipo. Quien administra normalmente **no** tiene
 * permiso de venta —la organizacion no se lo da, y la aplicacion no codifica
 * politica (regla 17)—, asi que un enlace le daria 404. Y sobre todo: lo util
 * es revisar **antes** de publicar, que es justo cuando aquella ruta no abre.
 *
 * **No relaja el gating publico.** Esta pantalla se abre con
 * `convocatoria:ver-administracion` y renderiza el **mismo componente**
 * (`VistaDeConvocatoria`) con los **mismos datos** (`lotesParaCatalogo`). La
 * ruta publica conserva su 404 intacto; lo que cambia es quien puede mirar y
 * con que permiso, que es la division que la Etapa 2.1 fijo.
 *
 * **Los vehiculos cuelgan de esta ruta, no de la publica** (`rutaBase`): por lo
 * mismo, un enlace al detalle publico del vehiculo terminaba en 404. La vista
 * previa tiene su propio detalle de lote.
 *
 * **El instante desde el que se mira** lo decide `momentoDeVistaPrevia`, que es
 * donde esta explicada la trampa de `NO_VISIBLE`.
 *
 * Dinamica: depende del estatus y del reloj (regla 14).
 */
export const dynamic = "force-dynamic";

const VistaPublicaDeConvocatoria = async ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const permiso = await exigirPermiso("convocatoria:ver-administracion");
  if (!permiso.ok) forbidden();

  const { id } = await params;
  const lectura = await obtenerConvocatoria(id);
  if (!lectura.ok) notFound();

  const convocatoria = lectura.data;
  const publicadaEn = desdeIso(convocatoria.publicadaEn);
  const inicioVenta = desdeIso(convocatoria.inicioVenta);
  const finVenta = desdeIso(convocatoria.finVenta);
  if (!publicadaEn || !inicioVenta || !finVenta) notFound();

  const { momento, aunNoVisible } = momentoDeVistaPrevia(
    { estatus: convocatoria.estatus, publicadaEn },
    new Date(),
  );

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);

  const lotes = await lotesParaCatalogo(convocatoria.lotes);
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

      <VistaDeConvocatoria
        rutaBase={`/admin/convocatorias/${id}/vista-publica`}
        convocatoria={convocatoria}
        lotes={lotes}
        estadoDeVenta={estadoDeVenta}
        inicioVenta={inicioVenta}
        finVenta={finVenta}
        diccionario={diccionario}
        idioma={idioma}
      />
    </main>
  );
};

export default VistaPublicaDeConvocatoria;
