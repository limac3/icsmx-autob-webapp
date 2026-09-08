import Link from "next/link";
import { forbidden, notFound, redirect } from "next/navigation";
import { Badge } from "@churchofjesuschrist/eden-badge";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2, Text4 } from "@churchofjesuschrist/eden-text";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { desdeIso, formatearFechaHora } from "@/lib/domain/fechas";
import { consultarTamanoFila } from "@/lib/fila/conteosDeFila";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import "../../../../pagina.css";

/**
 * Vista administrativa de la fila de un lote — pantalla 4.5.
 *
 * **Muestra agregados, jamas identidades.** Quien administra la venta no
 * conoce el orden de la fila ni quien esta en ella: `fila:ver-completa` es
 * exclusiva del auditor (`permission-matrix.md` seccion 5). Lo que se ve aqui
 * —cuantos hay formados, si hay adjudicacion vigente y cuando vence— alcanza
 * para operar y no revela a nadie.
 *
 * El turno adjudicado si se muestra: es un numero, no una persona, y sin el no
 * se puede contrastar la operacion con la bitacora.
 *
 * Dinamica: la fila cambia con cada solicitud.
 */
export const dynamic = "force-dynamic";

const FilaDelLote = async ({
  params,
}: {
  params: Promise<{ id: string; loteId: string }>;
}) => {
  if (!(await getSession())) redirect("/auth/login");

  const { id, loteId } = await params;
  const lectura = await obtenerConvocatoria(id);
  if (!lectura.ok) notFound();

  const lote = lectura.data.lotes.find((uno) => uno.loteId === loteId);
  if (!lote) notFound();

  const permiso = await exigirPermiso("convocatoria:ver-administracion");
  if (!permiso.ok) forbidden();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.filaAdministrativa;

  const [tamanoFila, vehiculo] = await Promise.all([
    consultarTamanoFila(lote.loteId),
    obtenerVehiculo(lote.vehiculoId),
  ]);

  const adjudicadoEn = desdeIso(lote.adjudicadoEn ?? "");
  const venceEn = desdeIso(lote.venceEn ?? "");
  const hayAdjudicacion = lote.adjudicacionActual !== undefined;

  const filas: { etiqueta: string; valor: string }[] = [
    {
      etiqueta: etiquetas.tamanoFila,
      valor: String(tamanoFila.ok ? tamanoFila.data : 0),
    },
    {
      etiqueta: etiquetas.adjudicacionVigente,
      valor: hayAdjudicacion
        ? diccionario.estatusSolicitud.ADJUDICADA
        : etiquetas.sinAdjudicacion,
    },
    ...(lote.turnoAdjudicado === undefined
      ? []
      : [
          {
            etiqueta: etiquetas.turnoAdjudicado,
            valor: String(lote.turnoAdjudicado),
          },
        ]),
    ...(adjudicadoEn
      ? [
          {
            etiqueta: etiquetas.adjudicadoEn,
            valor: formatearFechaHora(adjudicadoEn),
          },
        ]
      : []),
    ...(venceEn
      ? [{ etiqueta: etiquetas.venceEn, valor: formatearFechaHora(venceEn) }]
      : []),
  ];

  return (
    <main className="convocatorias">
      <header className="convocatorias__encabezado">
        <div>
          <H1>{etiquetas.titulo}</H1>
          <Text2 renderAs="p">
            {vehiculo.ok
              ? `${vehiculo.data.marca} ${vehiculo.data.version} ${String(vehiculo.data.modelo)}`
              : lote.vehiculoId}
          </Text2>
          <Badge>{diccionario.estatusLote[lote.estatus]}</Badge>
          <Text4 renderAs="p">{etiquetas.descripcion}</Text4>
        </div>
        <Link href={`/admin/convocatorias/${id}`}>
          {etiquetas.volverALaConvocatoria}
        </Link>
      </header>

      <section>
        <dl className="fila-lote__datos">
          {filas.map((fila) => (
            <div key={fila.etiqueta}>
              <dt>
                <Text4 renderAs="span">{fila.etiqueta}</Text4>
              </dt>
              <dd>
                <Text2 renderAs="span">{fila.valor}</Text2>
              </dd>
            </div>
          ))}
        </dl>
        <Text4 renderAs="p">{etiquetas.sinIdentidades}</Text4>
      </section>
    </main>
  );
};

export default FilaDelLote;
