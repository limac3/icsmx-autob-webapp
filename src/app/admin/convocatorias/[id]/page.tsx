import { forbidden, notFound, redirect } from "next/navigation";
import { Badge } from "@churchofjesuschrist/eden-badge";
import { H1, H4 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import AccionesDeConvocatoria from "@/components/AccionesDeConvocatoria";
import FormularioConvocatoria from "@/components/FormularioConvocatoria";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { obtenerConvocatoria } from "@/lib/convocatorias/obtenerConvocatoria";
import { aCampoLocal, desdeIso } from "@/lib/domain/fechas";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "../pagina.css";

/**
 * Detalle de una convocatoria — pantallas 4.3 y 4.4.
 *
 * Dinamica: el estatus cambia con cada accion del ciclo y la pantalla es de
 * trabajo. No entra en cache estatica.
 *
 * **Los campos se rellenan en hora de negocio.** Lo que se guarda es UTC; lo
 * que se teclea y se lee es hora de Ciudad de Mexico (regla 9), y la conversion
 * ocurre aqui, en el servidor.
 */
export const dynamic = "force-dynamic";

/** Un instante guardado, partido en los dos controles del formulario. */
const enCampos = (iso: string): { fecha: string; hora: string } => {
  const instante = desdeIso(iso);
  if (!instante) return { fecha: "", hora: "" };
  const [fecha = "", hora = ""] = aCampoLocal(instante).split("T");
  return { fecha, hora };
};

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

  return (
    <main className="convocatorias">
      <header className="convocatorias__encabezado">
        <div>
          <H1>{diccionario.tiposConvocatoria[convocatoria.tipo]}</H1>
          <Badge color="info">
            {diccionario.estatusConvocatoria[convocatoria.estatus]}
          </Badge>
        </div>
      </header>

      <FormularioConvocatoria
        diccionario={diccionario}
        convocatoriaId={convocatoria.convocatoriaId}
        editable={editable}
        valores={{
          tipo: convocatoria.tipo,
          descripcionParticipacion: convocatoria.descripcionParticipacion,
          publicadaEn: enCampos(convocatoria.publicadaEn),
          inicioVenta: enCampos(convocatoria.inicioVenta),
          finVenta: enCampos(convocatoria.finVenta),
          horasLiquidacion: convocatoria.horasLiquidacion,
        }}
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
        />
      </section>
    </main>
  );
};

export default DetalleDeConvocatoria;
