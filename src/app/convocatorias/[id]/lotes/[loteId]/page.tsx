import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@churchofjesuschrist/eden-badge";
import { Secondary } from "@churchofjesuschrist/eden-buttons";
import { DD, DL, DT } from "@churchofjesuschrist/eden-description-list";
import { H1, H2 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import BloqueDeAccionDeLote, {
  type FaseDeVentaEnLote,
} from "@/components/BloqueDeAccionDeLote";
import { EstadoDeVenta } from "@/components/CatalogoConvocatorias";
import FichaTecnicaVehiculo from "@/components/FichaTecnicaVehiculo";
import GaleriaPublica, {
  type FotografiaEnGaleria,
} from "@/components/GaleriaPublica";
import { COLOR_POR_ESTATUS } from "@/components/RejillaDeLotes";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { desdeIso, formatearFechaHora } from "@/lib/domain/fechas";
import { contextoDeConvocatoria } from "@/lib/domain/gating";
import { calcularEstadoDeVentaUi } from "@/lib/domain/ventanas";
import { formatearPrecio } from "@/lib/domain/dinero";
import { consultarMiLugar } from "@/lib/fila/consultarMiLugar";
import { consultarTamanoFila } from "@/lib/fila/conteosDeFila";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import { firmarFotografia } from "@/lib/media/cloudfrontSigner";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import "./pagina.css";

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

  const [vehiculo, tamanoFila, miLugar] = await Promise.all([
    obtenerVehiculo(lote.vehiculoId),
    consultarTamanoFila(lote.loteId),
    consultarMiLugar({
      loteId: lote.loteId,
      participanteId: permiso.sesion.participanteId,
    }),
  ]);
  if (!vehiculo.ok) notFound();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.catalogo;

  const estadoDeVenta = calcularEstadoDeVentaUi(
    { publicadaEn, inicioVenta, finVenta },
    ahora,
  );

  // La misma fase, reducida a lo que el bloque de accion necesita decidir. La
  // cuenta regresiva viaja en segundos —calculados aqui— y no como fecha: el
  // cliente decrementa, nunca compara contra su propio reloj (R-04).
  const venta: FaseDeVentaEnLote =
    estadoDeVenta.fase === "PUBLICADA_SIN_ABRIR"
      ? {
          fase: "SIN_ABRIR",
          segundosParaAbrir: estadoDeVenta.segundosParaAbrir,
        }
      : estadoDeVenta.fase === "VENTA_ABIERTA"
        ? { fase: "ABIERTA" }
        : { fase: "CERRADA" };

  const venceEn = miLugar.ok
    ? desdeIso(miLugar.data?.venceEn ?? "")
    : undefined;

  const titulo = `${vehiculo.data.marca} ${vehiculo.data.version} ${String(vehiculo.data.modelo)}`;
  const fotografias: FotografiaEnGaleria[] = vehiculo.data.fotografias.map(
    (foto) => ({
      fotoId: foto.fotoId,
      url: firmarFotografia(foto.claveS3),
      descripcion: foto.descripcion,
    }),
  );

  // El vehiculo fisico, no su modelo: dos unidades de la misma marca, version y
  // anio se llaman igual y solo estos dos numeros las distinguen. Quien compra
  // los necesita para cotejar la unidad que le adjudicaron.
  const identificacion: readonly { etiqueta: string; valor: string }[] = [
    {
      etiqueta: diccionario.vehiculos.campos.numeroEconomico,
      valor: vehiculo.data.numeroEconomico,
    },
    {
      etiqueta: diccionario.vehiculos.campos.numeroDeSerie,
      valor: vehiculo.data.numeroDeSerie,
    },
  ];

  return (
    <main className="detalle-lote">
      {/* Volver a la convocatoria: desde aqui la unica salida era el boton
          "atras" del navegador, y quien llego por un enlace directo al lote no
          tenia ninguna. */}
      <Secondary renderAs={Link} href={`/convocatorias/${id}`}>
        {etiquetas.volverALaConvocatoria}
      </Secondary>

      <header className="detalle-lote__identificacion">
        <H1>{titulo}</H1>
        <DL>
          {identificacion.map(({ etiqueta, valor }) => (
            <div key={etiqueta}>
              <DT>{etiqueta}</DT>
              <DD>
                <Text2 renderAs="span">{valor}</Text2>
              </DD>
            </div>
          ))}
        </DL>
        <Text2 renderAs="p" className="detalle-lote__precio">
          {`${etiquetas.precioDestacado}: ${formatearPrecio(lote.precio, idioma)}`}
        </Text2>
        <Badge
          color={COLOR_POR_ESTATUS[lote.estatus]}
          className="detalle-lote__insignia"
        >
          {diccionario.estatusLote[lote.estatus]}
        </Badge>
        <Text2 renderAs="p">
          {`${String(tamanoFila.ok ? tamanoFila.data : 0)} ${etiquetas.enFila}`}
        </Text2>

        <EstadoDeVenta
          estado={estadoDeVenta}
          diccionario={diccionario}
          idioma={idioma}
        />
      </header>

      <BloqueDeAccionDeLote
        convocatoriaId={convocatoria.convocatoriaId}
        loteId={lote.loteId}
        miLugar={miLugar.ok ? miLugar.data : null}
        estatusLote={lote.estatus}
        venta={venta}
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

      <section>
        <H2>{etiquetas.seccionFichaTecnica}</H2>
        <FichaTecnicaVehiculo
          kilometraje={vehiculo.data.kilometraje}
          nivelEquipamiento={vehiculo.data.nivelEquipamiento}
          especificacionMecanica={vehiculo.data.especificacionMecanica}
          condicionesMecanicas={vehiculo.data.condicionesMecanicas}
          detallesEsteticos={vehiculo.data.detallesEsteticos}
          diccionario={diccionario}
          idioma={idioma}
        />
      </section>

      {/* Las fotos van despues de la ficha y no antes. Arriba empujaban la
          identificacion y el bloque de accion —el precio, la fila, el boton de
          formarse— fuera de la primera pantalla en movil, que es donde se
          decide. Primero que vehiculo es y en que estado esta; luego como se
          ve. */}
      <section>
        <H2>{diccionario.vehiculos.seccionFotografias}</H2>
        <GaleriaPublica
          titulo={titulo}
          fotografias={fotografias}
          diccionario={diccionario}
        />
      </section>
    </main>
  );
};

export default DetalleDeLote;
