import { notFound, redirect } from "next/navigation";
import VistaDeConvocatoria from "@/components/VistaDeConvocatoria";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { lotesParaCatalogo } from "@/lib/convocatorias/lotesParaCatalogo";
import { desdeIso } from "@/lib/domain/fechas";
import { contextoDeConvocatoria } from "@/lib/domain/gating";
import { calcularEstadoDeVentaUi } from "@/lib/domain/ventanas";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
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

/**
 * Que puede hacer el participante en cada fase, dicho en una frase.
 *
 * Es un mapa exhaustivo sobre las tres fases de `EstadoDeVentaUi` y no una
 * cadena de `if`: agregar una fase al dominio rompe la compilacion aqui, que es
 * exactamente cuando hay que decidir su explicacion.
 */
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

  const lotes = await lotesParaCatalogo(convocatoria.lotes);

  const estadoDeVenta = calcularEstadoDeVentaUi(
    { publicadaEn, inicioVenta, finVenta },
    ahora,
  );

  return (
    <main className="catalogo">
      <VistaDeConvocatoria
        rutaBase={`/convocatorias/${id}`}
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

export default DetalleDeConvocatoria;
