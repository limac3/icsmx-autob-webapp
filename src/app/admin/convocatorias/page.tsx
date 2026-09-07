import { forbidden, redirect } from "next/navigation";
import { Primary } from "@churchofjesuschrist/eden-buttons";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import TablaConvocatorias from "@/components/TablaConvocatorias";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { listarConvocatorias } from "@/lib/convocatorias/listarConvocatorias";
import { desdeIso, formatearFechaHora } from "@/lib/domain/fechas";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "./pagina.css";

/**
 * Listado administrativo de convocatorias — pantalla 4.3.
 *
 * Dinamica: los estatus cambian con cada aprobacion y publicacion, y esta
 * pantalla es de trabajo. No entra en cache estatica.
 *
 * **Las fechas se formatean aqui, en el servidor.** La zona de negocio es
 * `America/Mexico_City` (regla 9) y no la del navegador de quien mira: dejar
 * que el cliente las formatee mostraria una hora distinta a cada persona segun
 * donde tenga el reloj, para un dato que decide cuando abre una venta.
 */
export const dynamic = "force-dynamic";

const ConvocatoriasPagina = async () => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const permiso = await exigirPermiso("convocatoria:ver-administracion");
  if (!permiso.ok) forbidden();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.convocatorias;

  const resultado = await listarConvocatorias();
  if (!resultado.ok) throw new Error(resultado.error);

  const periodos: Record<string, string> = {};
  for (const convocatoria of resultado.data) {
    const inicio = desdeIso(convocatoria.inicioVenta);
    const fin = desdeIso(convocatoria.finVenta);
    periodos[convocatoria.convocatoriaId] =
      inicio && fin
        ? `${formatearFechaHora(inicio)} — ${formatearFechaHora(fin)}`
        : "";
  }

  return (
    <main className="convocatorias">
      <header className="convocatorias__encabezado">
        <div>
          <H1>{etiquetas.titulo}</H1>
          <Text2 renderAs="p">{etiquetas.descripcion}</Text2>
        </div>
        {sesion.permisos.has("Autob_Administrar_Convocatorias") ? (
          <Primary renderAs="a" href="/admin/convocatorias/nueva">
            {etiquetas.nueva}
          </Primary>
        ) : null}
      </header>

      <TablaConvocatorias
        convocatorias={resultado.data}
        diccionario={diccionario}
        periodos={periodos}
      />
    </main>
  );
};

export default ConvocatoriasPagina;
