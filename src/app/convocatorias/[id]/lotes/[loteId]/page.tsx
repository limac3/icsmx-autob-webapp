import { notFound, redirect } from "next/navigation";
import VistaDeLote from "@/components/VistaDeLote";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { loteParaVista } from "@/lib/convocatorias/loteParaVista";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { desdeIso, formatearFechaHora } from "@/lib/domain/fechas";
import { contextoDeConvocatoria } from "@/lib/domain/gating";
import { calcularEstadoDeVentaUi } from "@/lib/domain/ventanas";
import { consultarMiLugar } from "@/lib/fila/consultarMiLugar";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "../../../pagina.css";

/**
 * Detalle del vehiculo de un lote — pantallas 3.3 y 3.4.
 *
 * **La ficha es cacheable y el bloque de accion no lo es nunca**
 * (`arquitectura-tecnica-aws.md` 3): el estado de la fila cambia con cada
 * solicitud y depende de quien mira. Hoy la pagina entera es dinamica, que es
 * la version conservadora de esa misma regla.
 *
 * **Gating triple, siempre 404** (regla 8, R-01), igual que el detalle de
 * convocatoria. El gating se calcula **desde la convocatoria**, nunca desde
 * la copia desnormalizada del lote (`src/lib/domain/gating.ts`): T8 la
 * propaga por tandas y puede quedarse atras durante una interrupcion.
 *
 * **Todo lo que el bloque de accion necesita se calcula aqui, en el servidor**:
 * el lugar en la fila, la fase de venta y los segundos que faltan. El cliente
 * decrementa contadores y pulsa botones; no decide nada (R-04).
 *
 * La presentacion vive en `VistaDeLote`, que comparte con la vista previa
 * administrativa; lo unico propio de esta pagina es **con que permiso se
 * abre** y el lugar en la fila de quien mira.
 *
 * **Dinamica y sin cache estatica** (regla 14).
 */
export const dynamic = "force-dynamic";

const DetalleDeLote = async ({
  params,
}: {
  params: Promise<{ id: string; loteId: string }>;
}) => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const { id, loteId } = await params;
  const lectura = await obtenerConvocatoria(id);
  if (!lectura.ok) notFound();

  const convocatoria = lectura.data;
  const lote = convocatoria.lotes.find((l) => l.loteId === loteId);
  if (!lote) notFound();

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

  const permiso = await exigirPermiso("lote:ver-detalle", contexto);
  if (!permiso.ok) notFound();

  const [datos, miLugar] = await Promise.all([
    loteParaVista(lote),
    consultarMiLugar({
      loteId: lote.loteId,
      participanteId: permiso.sesion.participanteId,
    }),
  ]);
  if (!datos) notFound();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);

  const estadoDeVenta = calcularEstadoDeVentaUi(
    { publicadaEn, inicioVenta, finVenta },
    ahora,
  );

  const venceEn = miLugar.ok
    ? desdeIso(miLugar.data?.venceEn ?? "")
    : undefined;

  return (
    <main className="catalogo">
      <VistaDeLote
        rutaDeLaConvocatoria={`/convocatorias/${id}`}
        convocatoriaId={convocatoria.convocatoriaId}
        lote={lote}
        vehiculo={datos.vehiculo}
        fotografias={datos.fotografias}
        tamanoFila={datos.tamanoFila}
        estadoDeVenta={estadoDeVenta}
        miLugar={miLugar.ok ? miLugar.data : null}
        {...(venceEn
          ? {
              venceEnFormateado: formatearFechaHora(venceEn),
              segundosParaVencer: Math.max(
                0,
                Math.round((venceEn.getTime() - ahora.getTime()) / 1000),
              ),
            }
          : {})}
        diccionario={diccionario}
        idioma={idioma}
      />
    </main>
  );
};

export default DetalleDeLote;
