import Link from "next/link";
import { forbidden, notFound, redirect } from "next/navigation";
import { Badge } from "@churchofjesuschrist/eden-badge";
import { H1, H4 } from "@churchofjesuschrist/eden-headings";
import { Text2, Text4 } from "@churchofjesuschrist/eden-text";
import AccionesDeConvocatoria from "@/components/AccionesDeConvocatoria";
import FormularioConvocatoria from "@/components/FormularioConvocatoria";
import LotesDeConvocatoria, {
  type LoteEnPantalla,
  type VehiculoDisponible,
} from "@/components/LotesDeConvocatoria";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { enlaceDeBitacora } from "@/lib/auditoria/enlace";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { aCampoLocal, desdeIso, formatearFechaHora } from "@/lib/domain/fechas";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import { listarVehiculos } from "@/lib/vehiculos/listarVehiculos";
import { obtenerVehiculo } from "@/lib/vehiculos/obtenerVehiculo";
import type { Vehiculo } from "@/types/vehiculo";
import "../pagina.css";

/**
 * Detalle de una convocatoria — pantallas 4.3 y 4.4, y la vista de dictamen de
 * la pantalla 5.
 *
 * Dinamica: el estatus cambia con cada accion del ciclo y la pantalla es de
 * trabajo. No entra en cache estatica.
 *
 * **Los campos se rellenan en hora de negocio.** Lo que se guarda es UTC; lo
 * que se teclea y se lee es hora de Ciudad de Mexico (regla 9), y la conversion
 * ocurre aqui, en el servidor.
 *
 * **Es tambien la pantalla del aprobador.** El dictamen no tiene ruta propia:
 * las acciones se derivan de la maquina de estados y del permiso de quien mira,
 * asi que quien puede aprobar ve aqui sus dos botones sobre exactamente los
 * mismos datos que vera quien administra. Dos vistas del mismo dictamen se
 * separarian al primer cambio.
 */
export const dynamic = "force-dynamic";

/** Un instante guardado, partido en los dos controles del formulario. */
const enCampos = (iso: string): { fecha: string; hora: string } => {
  const instante = desdeIso(iso);
  if (!instante) return { fecha: "", hora: "" };
  const [fecha = "", hora = ""] = aCampoLocal(instante).split("T");
  return { fecha, hora };
};

/** Como se nombra un vehiculo en una lista. */
const rotulo = (vehiculo: Vehiculo): string =>
  `${vehiculo.marca} ${vehiculo.version} ${String(vehiculo.modelo)}`;

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

  const permiso = await exigirPermiso("convocatoria:ver-administracion");
  if (!permiso.ok) forbidden();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const convocatoria = lectura.data;

  // Solo en BORRADOR se edita (permission-matrix seccion 2). El servidor lo
  // vuelve a exigir; esto solo evita ofrecer un formulario que no guardaria.
  const editable =
    convocatoria.estatus === "BORRADOR" &&
    sesion.permisos.has("Autob_Administrar_Convocatorias");

  const puedeAuditar = sesion.permisos.has("Autob_Auditar");

  // Una lectura por lote. Son los vehiculos de **esta** convocatoria, que se
  // cuentan por decenas: `listarVehiculos` traeria el catalogo entero para
  // quedarse con unos pocos, y ademas no encontraria un vehiculo ya vendido.
  const vehiculosDelLote = new Map<string, Vehiculo>();
  const lecturas = await Promise.all(
    convocatoria.lotes.map(async (lote) => obtenerVehiculo(lote.vehiculoId)),
  );
  for (const vehiculo of lecturas) {
    if (vehiculo.ok)
      vehiculosDelLote.set(vehiculo.data.vehiculoId, vehiculo.data);
  }

  const lotes: LoteEnPantalla[] = convocatoria.lotes.map((lote) => {
    const vehiculo = vehiculosDelLote.get(lote.vehiculoId);
    return {
      loteId: lote.loteId,
      vehiculoId: lote.vehiculoId,
      // El identificador es el respaldo si el vehiculo no se pudo leer: sin el,
      // la fila apareceria sin nada en la primera columna y no habria forma de
      // saber de cual se trata.
      vehiculo: vehiculo ? rotulo(vehiculo) : lote.vehiculoId,
      precio: lote.precio,
      estatus: lote.estatus,
      puedeRetirarse: lote.contadorTurnos === 0,
      ...(lote.motivoRetiro ? { motivoRetiro: lote.motivoRetiro } : {}),
    };
  });

  // El catalogo de disponibles solo hace falta si se puede incluir algo.
  let disponibles: VehiculoDisponible[] = [];
  if (editable) {
    const catalogo = await listarVehiculos({ estatus: ["DISPONIBLE"] });
    if (catalogo.ok) {
      disponibles = catalogo.data.map((vehiculo) => ({
        vehiculoId: vehiculo.vehiculoId,
        etiqueta: rotulo(vehiculo),
      }));
    }
  }

  const creadoEn = desdeIso(convocatoria.creadoEn);

  return (
    <main className="convocatorias">
      <header className="convocatorias__encabezado">
        <div>
          <H1>{diccionario.tiposConvocatoria[convocatoria.tipo]}</H1>
          <Badge color="info">
            {diccionario.estatusConvocatoria[convocatoria.estatus]}
          </Badge>
          {/* Quien dictamina necesita saber quien la creo: R-05 le impide
              aprobar la suya, y sin este dato no sabria por que. */}
          <Text4 renderAs="p">
            {`${diccionario.convocatorias.creadaPor}: ${convocatoria.creadoPor}` +
              (creadoEn ? ` — ${formatearFechaHora(creadoEn)}` : "")}
          </Text4>
          {/* Atajo a la bitacora con el tipo y el identificador ya puestos:
              sin esto, consultar la historia de esta convocatoria exige
              copiar su ULID a mano en la pantalla de auditoria. */}
          {puedeAuditar ? (
            <Link
              href={enlaceDeBitacora(
                "CONVOCATORIA",
                convocatoria.convocatoriaId,
              )}
            >
              {diccionario.auditoria.verEnBitacora}
            </Link>
          ) : null}
        </div>
      </header>

      <FormularioConvocatoria
        diccionario={diccionario}
        convocatoriaId={convocatoria.convocatoriaId}
        editable={editable}
        valores={{
          folio: convocatoria.folio,
          nombre: convocatoria.nombre,
          tipo: convocatoria.tipo,
          descripcionParticipacion: convocatoria.descripcionParticipacion,
          publicadaEn: enCampos(convocatoria.publicadaEn),
          inicioVenta: enCampos(convocatoria.inicioVenta),
          finVenta: enCampos(convocatoria.finVenta),
          horasLiquidacion: convocatoria.horasLiquidacion,
        }}
      />

      <LotesDeConvocatoria
        convocatoriaId={convocatoria.convocatoriaId}
        lotes={lotes}
        disponibles={disponibles}
        editable={editable}
        puedeAuditar={puedeAuditar}
        diccionario={diccionario}
        idioma={idioma}
      />

      <section>
        <H4 renderAs="h2">{diccionario.acciones.titulo}</H4>
        {convocatoria.estatus === "OCULTA" &&
        convocatoria.motivoOcultamiento ? (
          <Text2 renderAs="p">
            {`${diccionario.acciones.motivo}: ${convocatoria.motivoOcultamiento}`}
          </Text2>
        ) : null}
        <AccionesDeConvocatoria
          convocatoriaId={convocatoria.convocatoriaId}
          estatus={convocatoria.estatus}
          diccionario={diccionario}
          permisos={[...sesion.permisos]}
          esCreador={convocatoria.creadoPor === sesion.participanteId}
        />
      </section>
    </main>
  );
};

export default DetalleDeConvocatoria;
