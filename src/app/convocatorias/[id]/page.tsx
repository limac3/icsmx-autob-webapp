import { notFound, redirect } from "next/navigation";
import { Card } from "@churchofjesuschrist/eden-card";
import { DD, DL, DT } from "@churchofjesuschrist/eden-description-list";
import { HtmlFragment } from "@churchofjesuschrist/eden-html-fragment";
import { H1, H2 } from "@churchofjesuschrist/eden-headings";
import { Text2, Text4 } from "@churchofjesuschrist/eden-text";
import { EstadoDeVenta } from "@/components/CatalogoConvocatorias";
import RejillaDeLotes, {
  type LoteEnCatalogo,
} from "@/components/RejillaDeLotes";
import { type Diccionario, obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { consultarTamanoFila } from "@/lib/fila/conteosDeFila";
import { desdeIso, formatearFechaHora } from "@/lib/domain/fechas";
import { contextoDeConvocatoria } from "@/lib/domain/gating";
import {
  calcularEstadoDeVentaUi,
  type EstadoDeVentaUi,
} from "@/lib/domain/ventanas";
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

/**
 * Que puede hacer el participante en cada fase, dicho en una frase.
 *
 * Es un mapa exhaustivo sobre las tres fases de `EstadoDeVentaUi` y no una
 * cadena de `if`: agregar una fase al dominio rompe la compilacion aqui, que es
 * exactamente cuando hay que decidir su explicacion.
 */
const EXPLICACION_POR_FASE = {
  PUBLICADA_SIN_ABRIR: "explicacionSinAbrir",
  VENTA_ABIERTA: "explicacionAbierta",
  VENTA_CERRADA: "explicacionCerrada",
} as const satisfies Record<
  EstadoDeVentaUi["fase"],
  keyof Diccionario["catalogo"]
>;

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

  const estadoDeVenta = calcularEstadoDeVentaUi(
    { publicadaEn, inicioVenta, finVenta },
    ahora,
  );

  // Lo que la convocatoria **es**, aparte de su descripcion. Se arma como dato
  // y no como JSX repetido para que el orden se lea de un golpe y para que
  // agregar un campo sea agregar un renglon.
  const datos: readonly { etiqueta: string; valor: string }[] = [
    {
      etiqueta: diccionario.convocatorias.campoTipo,
      valor: diccionario.tiposConvocatoria[convocatoria.tipo],
    },
    {
      etiqueta: diccionario.convocatorias.campoInicioVenta,
      valor: formatearFechaHora(inicioVenta),
    },
    {
      etiqueta: diccionario.convocatorias.campoFinVenta,
      valor: formatearFechaHora(finVenta),
    },
    {
      etiqueta: diccionario.convocatorias.campoHorasLiquidacion,
      valor: String(convocatoria.horasLiquidacion),
    },
  ];

  return (
    <main className="catalogo">
      {/* El titulo es el nombre de la convocatoria, con el folio debajo. Antes
          era el **tipo** —"De empleados"—, que no distingue una venta de la
          siguiente: todas las de empleados se llamaban igual. El tipo pasa a
          ser un campo mas, que es lo que es. */}
      <header className="catalogo__encabezado">
        <H1>{convocatoria.nombre}</H1>
        <Text4 renderAs="p">
          {`${diccionario.convocatorias.campoFolio}: ${convocatoria.folio}`}
        </Text4>
        <EstadoDeVenta
          estado={estadoDeVenta}
          diccionario={diccionario}
          idioma={idioma}
        />
      </header>

      {/* Dos recuadros y no un encabezado corrido: la descripcion es texto
          libre de varios parrafos —lo que hay que leer— y los campos son datos
          de un renglon —lo que hay que consultar—. Mezclados, la descripcion
          se traga las fechas. */}
      <Card className="catalogo__recuadro">
        <H2>{diccionario.convocatorias.campoDescripcion}</H2>
        <HtmlFragment content={convocatoria.descripcionParticipacion} />
      </Card>

      <Card className="catalogo__recuadro">
        <H2>{etiquetas.seccionDatos}</H2>
        <DL>
          {datos.map(({ etiqueta, valor }) => (
            <div key={etiqueta}>
              <DT>{etiqueta}</DT>
              <DD>
                <Text2 renderAs="span">{valor}</Text2>
              </DD>
            </div>
          ))}
          {/* El estado otra vez, aqui con lo que **significa**. Arriba la
              insignia sola basta para reconocerlo de un vistazo; en la ficha de
              datos hace falta saber que se puede hacer en ese estado, que es la
              pregunta real: "abierta" no dice por si sola que hay que formarse
              en una fila, ni "cerrada" que un plazo de pago puede seguir
              corriendo. */}
          <div>
            <DT>{etiquetas.columnaEstadoVenta}</DT>
            <DD className="catalogo__estado">
              <EstadoDeVenta
                estado={estadoDeVenta}
                diccionario={diccionario}
                idioma={idioma}
              />
              <Text2 renderAs="p" className="catalogo__estado-explicacion">
                {etiquetas[EXPLICACION_POR_FASE[estadoDeVenta.fase]]}
              </Text2>
            </DD>
          </div>
        </DL>
        {/* Las dos fechas van en hora de negocio (regla 9). Dicho una vez para
            el recuadro, no colgado de cada fecha. */}
        <Text4 renderAs="p">{etiquetas.horaDeNegocio}</Text4>
      </Card>

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
