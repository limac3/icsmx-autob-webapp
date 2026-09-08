import { notFound, redirect } from "next/navigation";
import { HtmlFragment } from "@churchofjesuschrist/eden-html-fragment";
import { H1, H2 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import { EstadoDeVenta } from "@/components/CatalogoConvocatorias";
import RejillaDeLotes, {
  type LoteEnCatalogo,
} from "@/components/RejillaDeLotes";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { consultarTamanoFila } from "@/lib/fila/conteosDeFila";
import { desdeIso, formatearFechaHora } from "@/lib/domain/fechas";
import { contextoDeConvocatoria } from "@/lib/domain/gating";
import { calcularEstadoDeVentaUi } from "@/lib/domain/ventanas";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import { firmarFotografia } from "@/lib/media/cloudfrontSigner";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import "../pagina.css";

/**
 * Detalle de convocatoria para el participante — pantalla 3.2.
 *
 * **Gating triple, siempre 404** (regla 8, R-01). Se lee la convocatoria antes
 * de comprobar el permiso, igual que el detalle administrativo, pero aqui
 * **cualquier** falla —no exista, no este publicada, no haya llegado
 * `publicadaEn`, o el tipo no corresponda al permiso de venta de la sesion—
 * termina en `notFound()`. Un `forbidden()` confirmaria que la convocatoria
 * existe, que es justo la fuga que R-01 prohibe.
 *
 * **Dinamica y sin cache estatica** (regla 14): depende de `publicadaEn` y del
 * permiso de venta de quien mira.
 */
export const dynamic = "force-dynamic";

const DetalleDeConvocatoria = async ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const { id } = await params;
  const lectura = await obtenerConvocatoria(id);
  if (!lectura.ok) notFound();

  const convocatoria = lectura.data;
  const publicadaEn = desdeIso(convocatoria.publicadaEn);
  const inicioVenta = desdeIso(convocatoria.inicioVenta);
  const finVenta = desdeIso(convocatoria.finVenta);
  if (!publicadaEn || !inicioVenta || !finVenta) notFound();

  const ahora = new Date();
  const contexto = contextoDeConvocatoria(
    {
      publicadaEn,
      inicioVenta,
      finVenta,
      estatus: convocatoria.estatus,
      tipo: convocatoria.tipo,
    },
    ahora,
  );

  const permiso = await exigirPermiso("convocatoria:ver-publicada", contexto);
  if (!permiso.ok) notFound();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.catalogo;

  const lotes: LoteEnCatalogo[] = await Promise.all(
    convocatoria.lotes.map(async (lote): Promise<LoteEnCatalogo> => {
      const [vehiculo, tamanoFila] = await Promise.all([
        obtenerVehiculo(lote.vehiculoId),
        consultarTamanoFila(lote.loteId),
      ]);

      const foto =
        vehiculo.ok && vehiculo.data.fotografiaPrincipalId
          ? vehiculo.data.fotografias.find(
              (f) => f.fotoId === vehiculo.data.fotografiaPrincipalId,
            )
          : undefined;

      return {
        loteId: lote.loteId,
        marca: vehiculo.ok ? vehiculo.data.marca : "",
        version: vehiculo.ok ? vehiculo.data.version : "",
        modelo: vehiculo.ok ? vehiculo.data.modelo : 0,
        kilometraje: vehiculo.ok ? vehiculo.data.kilometraje : 0,
        precio: lote.precio,
        estatus: lote.estatus,
        tamanoFila: tamanoFila.ok ? tamanoFila.data : 0,
        ...(foto
          ? { fotografiaPrincipalUrl: firmarFotografia(foto.claveS3) }
          : {}),
      };
    }),
  );

  return (
    <main className="catalogo">
      <header className="catalogo__encabezado">
        <H1>{diccionario.tiposConvocatoria[convocatoria.tipo]}</H1>
        <HtmlFragment content={convocatoria.descripcionParticipacion} />
        <Text2 renderAs="p">
          {`${diccionario.convocatorias.campoInicioVenta}: ${formatearFechaHora(inicioVenta)} (${etiquetas.horaDeNegocio})`}
        </Text2>
        <EstadoDeVenta
          estado={calcularEstadoDeVentaUi(
            { publicadaEn, inicioVenta, finVenta },
            ahora,
          )}
          diccionario={diccionario}
          idioma={idioma}
        />
      </header>

      <section>
        <H2>{etiquetas.seccionLotes}</H2>
        <RejillaDeLotes
          convocatoriaId={convocatoria.convocatoriaId}
          lotes={lotes}
          diccionario={diccionario}
          idioma={idioma}
        />
      </section>
    </main>
  );
};

export default DetalleDeConvocatoria;
