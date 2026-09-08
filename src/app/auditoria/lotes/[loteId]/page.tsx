import { forbidden, redirect } from "next/navigation";
import { H1, H4 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import ReconstruccionDeFila from "@/components/ReconstruccionDeFila";
import VerificacionDeIntegridad from "@/components/VerificacionDeIntegridad";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { reconstruirFila } from "@/lib/auditoria/reconstruirFila";
import { verificarIntegridad } from "@/lib/auditoria/verificarIntegridad";
import { aFilaDeBitacora } from "@/lib/auditoria/vistaDeEvento";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "../../pagina.css";

/**
 * Reconstruccion de fila y verificacion de integridad de un lote —
 * `ui-ux-requerimientos.md` seccion 7, ruta `/auditoria/lotes/[loteId]`.
 *
 * Dos permisos, no uno: `auditoria:ver-fila-historica` cubre la
 * reconstruccion, `auditoria:ver-bitacora` la verificacion
 * (`api-contracts.md` seccion 6). Hoy los dos exigen el mismo
 * `Autob_Auditar`, pero comprobarlos por separado es lo que evita que esta
 * pantalla se rompa en silencio si algun dia dejan de coincidir.
 *
 * Llama a los servicios directo, no a las Server Actions (AGENTS.md: "las
 * lecturas las hacen los Server Components llamando al servicio directo").
 */
export const dynamic = "force-dynamic";

const LoteAuditadoPagina = async ({
  params,
}: {
  params: Promise<{ loteId: string }>;
}) => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const [puedeReconstruir, puedeVerificar] = await Promise.all([
    exigirPermiso("auditoria:ver-fila-historica"),
    exigirPermiso("auditoria:ver-bitacora"),
  ]);
  if (!puedeReconstruir.ok && !puedeVerificar.ok) forbidden();

  const { loteId } = await params;
  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.auditoria;

  const [reconstruccion, verificacion] = await Promise.all([
    puedeReconstruir.ok ? reconstruirFila(loteId) : null,
    puedeVerificar.ok ? verificarIntegridad(loteId) : null,
  ]);

  if (reconstruccion && !reconstruccion.ok) {
    throw new Error(`No se pudo reconstruir la fila: ${reconstruccion.error}`);
  }
  if (verificacion && !verificacion.ok) {
    throw new Error(
      `No se pudo verificar la integridad: ${verificacion.error}`,
    );
  }

  return (
    <main className="auditoria">
      <header>
        <H1>{etiquetas.tituloReconstruccion}</H1>
        <Text2 renderAs="p">{etiquetas.descripcionReconstruccion}</Text2>
      </header>

      {reconstruccion && reconstruccion.ok ? (
        <ReconstruccionDeFila
          solicitudes={reconstruccion.data.solicitudes.map((solicitud) => ({
            turno: solicitud.turno,
            participanteId: solicitud.participanteId,
            eventos: solicitud.eventos.map((evento) =>
              aFilaDeBitacora(evento, diccionario),
            ),
          }))}
          eventosDelLote={reconstruccion.data.eventosDelLote.map((evento) =>
            aFilaDeBitacora(evento, diccionario),
          )}
          diccionario={diccionario}
        />
      ) : null}

      {verificacion && verificacion.ok ? (
        <section className="auditoria__verificacion">
          <H4>{etiquetas.tituloVerificacion}</H4>
          <Text2 renderAs="p">{etiquetas.descripcionVerificacion}</Text2>
          <VerificacionDeIntegridad
            comprobaciones={verificacion.data.comprobaciones}
            diccionario={diccionario}
          />
        </section>
      ) : null}
    </main>
  );
};

export default LoteAuditadoPagina;
