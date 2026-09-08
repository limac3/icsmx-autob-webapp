import { forbidden, notFound, redirect } from "next/navigation";
import { H1, H2 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import DictamenDePago from "@/components/DictamenDePago";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { formatearPrecio } from "@/lib/domain/dinero";
import { desdeIso, formatearFechaHora } from "@/lib/domain/fechas";
import { leerSolicitudPorId } from "@/lib/fila/leerSolicitud";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import "./pagina.css";

/**
 * Detalle de verificacion — pantalla 6, vista de dictamen.
 *
 * **404, no forbidden, si el `solicitudId` no existe.** Igual que el resto
 * del catalogo administrativo: no hay nada que ocultar sobre la existencia de
 * una solicitud a quien ya tiene `tesoreria:ver-bandeja`, asi que la
 * distincion aqui no es de privacidad — es que no hay nada que mostrar.
 *
 * **No se marca 404 si ya se dictamino.** Abrir dos pestanas y resolver en
 * una es un caso real: la otra debe poder decir "ya se resolvio", no
 * desaparecer.
 */
export const dynamic = "force-dynamic";

const DetalleDeVerificacion = async ({
  params,
}: {
  params: Promise<{ solicitudId: string }>;
}) => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const permiso = await exigirPermiso("tesoreria:ver-bandeja");
  if (!permiso.ok) forbidden();

  const { solicitudId } = await params;
  const lectura = await leerSolicitudPorId(solicitudId);
  if (!lectura.ok) notFound();

  const solicitud = lectura.data;
  if (!solicitud.convocatoriaId) notFound();

  const convocatoria = await obtenerConvocatoria(solicitud.convocatoriaId);
  if (!convocatoria.ok) notFound();

  const lote = convocatoria.data.lotes.find(
    (uno) => uno.loteId === solicitud.loteId,
  );
  if (!lote) notFound();

  const vehiculo = await obtenerVehiculo(lote.vehiculoId);
  if (!vehiculo.ok) notFound();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.tesoreria;

  const adjudicadoEn = solicitud.adjudicadoEn
    ? desdeIso(solicitud.adjudicadoEn)
    : undefined;
  const comprobanteSubidoEn = solicitud.comprobanteSubidoEn
    ? desdeIso(solicitud.comprobanteSubidoEn)
    : undefined;

  const extension = solicitud.comprobanteClaveS3?.split(".").pop();
  const esImagen = extension === "jpg" || extension === "png";
  const urlComprobante = `/api/comprobantes/${solicitudId}`;
  const yaResuelta = solicitud.estatus !== "EN_VERIFICACION";

  const titulo = `${vehiculo.data.marca} ${vehiculo.data.version} ${String(vehiculo.data.modelo)}`;

  return (
    <main className="detalle-verificacion">
      <header>
        <H1>{titulo}</H1>
        <Text2 renderAs="p">
          {`${etiquetas.columnaConvocatoria}: ${diccionario.tiposConvocatoria[convocatoria.data.tipo]}`}
        </Text2>
        <Text2 renderAs="p">
          {`${diccionario.catalogo.precioDestacado}: ${formatearPrecio(lote.precio, idioma)}`}
        </Text2>
        <Text2 renderAs="p">
          {`${etiquetas.columnaCorreo}: ${solicitud.correoTitular ?? ""}`}
        </Text2>
        <Text2 renderAs="p">
          {`${etiquetas.columnaAdjudicadoEn}: ${
            adjudicadoEn ? formatearFechaHora(adjudicadoEn) : ""
          }`}
        </Text2>
        <Text2 renderAs="p">
          {`${etiquetas.columnaComprobante}: ${
            comprobanteSubidoEn ? formatearFechaHora(comprobanteSubidoEn) : ""
          }`}
        </Text2>
      </header>

      <section>
        <H2>{etiquetas.comprobante}</H2>
        {esImagen ? (
          // El origen es el Route Handler de descarga, no un asset estatico:
          // `next/image` exige dimensiones y un dominio configurado, y aqui
          // el contenido es privado, dinamico y verificado en cada peticion.
          <img
            src={urlComprobante}
            alt={etiquetas.comprobante}
            className="detalle-verificacion__imagen"
          />
        ) : (
          <a href={urlComprobante} target="_blank" rel="noreferrer">
            {etiquetas.abrirComprobantePdf}
          </a>
        )}
      </section>

      {yaResuelta ? (
        <Text2 renderAs="p">{etiquetas.yaResuelta}</Text2>
      ) : (
        <DictamenDePago
          solicitudId={solicitudId}
          puedeDictaminar={sesion.permisos.has("Autob_Operar_Tesoreria")}
          diccionario={diccionario}
        />
      )}
    </main>
  );
};

export default DetalleDeVerificacion;
