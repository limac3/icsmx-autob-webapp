import Link from "next/link";
import { forbidden, notFound, redirect } from "next/navigation";
import { Info } from "@churchofjesuschrist/eden-alert";
import { Secondary } from "@churchofjesuschrist/eden-buttons";
import { Text2 } from "@churchofjesuschrist/eden-text";
import VistaDeConvocatoria from "@/components/VistaDeConvocatoria";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { lotesParaCatalogo } from "@/lib/convocatorias/lotesParaCatalogo";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { desdeIso, formatearFechaHora } from "@/lib/domain/fechas";
import { calcularEstadoDeVentaUi } from "@/lib/domain/ventanas";
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
 * **El instante desde el que se mira.** Si la convocatoria todavia no es
 * visible, mostrarla "ahora" seria enganoso: `calcularEstadoDeVentaUi` traduce
 * `NO_VISIBLE` a `VENTA_CERRADA` —lo mas conservador que puede mostrar sin
 * inventar un dato— y un borrador apareceria como venta cerrada, que es falso.
 * Se renderiza entonces desde `publicadaEn`, o sea **como se vera al
 * publicarse**, y el aviso lo dice con la fecha. Un dato que parece cierto y no
 * lo es es peor que no mostrarlo.
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

  const ahora = new Date();
  // Ver el borrador "desde el futuro": el instante en que empezara a ser
  // visible. Con `ahora` a secas, una convocatoria sin publicar se veria como
  // venta cerrada.
  const aunNoVisible =
    convocatoria.estatus !== "PUBLICADA" || publicadaEn > ahora;
  const momento = publicadaEn > ahora ? publicadaEn : ahora;

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.convocatorias;

  const lotes = await lotesParaCatalogo(convocatoria.lotes);
  const estadoDeVenta = calcularEstadoDeVentaUi(
    { publicadaEn, inicioVenta, finVenta },
    momento,
  );

  return (
    <main className="catalogo">
      <Info title={etiquetas.vistaPreviaTitulo}>
        <Text2 renderAs="p">
          {aunNoVisible
            ? `${etiquetas.vistaPreviaAunNoVisible} ${formatearFechaHora(publicadaEn)} (${diccionario.catalogo.horaDeNegocio})`
            : etiquetas.vistaPreviaVisible}
        </Text2>
        <Text2 renderAs="p">{etiquetas.vistaPreviaEnlaces}</Text2>
        <Secondary renderAs={Link} href={`/admin/convocatorias/${id}`} small>
          {etiquetas.volverAlDetalle}
        </Secondary>
      </Info>

      <VistaDeConvocatoria
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
