import { forbidden, redirect } from "next/navigation";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import MisSolicitudes, {
  type SolicitudEnLista,
} from "@/components/MisSolicitudes";
import { obtenerDiccionario } from "@/dictionaries";
import { exigirPermiso } from "@/lib/auth/exigirPermiso";
import { getSession } from "@/lib/auth/session";
import { desdeIso } from "@/lib/domain/fechas";
import { tiempoRestante } from "@/lib/domain/plazos";
import { listarMisSolicitudes } from "@/lib/fila/listarMisSolicitudes";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import "./pagina.css";

/**
 * `/mis-solicitudes` — pantalla 3.5.
 *
 * **La pantalla que evita que alguien pierda un vehiculo por olvido**, y hoy el
 * unico canal que lo hace: el correo de adjudicacion no sale mientras CES siga
 * sin aprobacion (R17). Hasta que exista, esta lista es lo unico que le dice a
 * una persona que gano algo y que el reloj corre.
 *
 * `participanteId` sale de la **sesion**, nunca de la ruta: no hay forma de
 * pedir las solicitudes de otro porque no hay donde escribir su identificador.
 *
 * Dinamica y sin cache: lo que muestra depende de quien mira y de la hora.
 */
export const dynamic = "force-dynamic";

const MisSolicitudesPagina = async () => {
  const sesion = await getSession();
  if (!sesion) redirect("/auth/login");

  const permiso = await exigirPermiso("solicitud:ver-mis-solicitudes");
  if (!permiso.ok) forbidden();

  const idioma = await obtenerIdiomaDePeticion();
  const diccionario = obtenerDiccionario(idioma);
  const etiquetas = diccionario.misSolicitudes;

  const resultado = await listarMisSolicitudes(sesion.participanteId);
  if (!resultado.ok) throw new Error(resultado.error);

  // Los segundos los calcula el servidor; el cliente solo decrementa (regla 9).
  // Solo para el plazo que sigue corriendo: uno ya vencido no lleva contador,
  // lleva el aviso de que vencio.
  const ahora = new Date();
  const solicitudes: SolicitudEnLista[] = resultado.data.solicitudes.map(
    (solicitud) => {
      const venceEn = solicitud.venceEn
        ? desdeIso(solicitud.venceEn)
        : undefined;
      const corriendo =
        venceEn !== undefined && solicitud.plazoVencido !== true;

      return {
        ...solicitud,
        ...(corriendo
          ? {
              segundosParaVencer: Math.floor(
                tiempoRestante(venceEn, ahora) / 1000,
              ),
            }
          : {}),
      };
    },
  );

  return (
    <main className="mis-solicitudes">
      <header className="mis-solicitudes__encabezado">
        <H1>{etiquetas.titulo}</H1>
        <Text2 renderAs="p">{etiquetas.descripcion}</Text2>
      </header>

      <MisSolicitudes
        solicitudes={solicitudes}
        truncada={resultado.data.truncada}
        diccionario={diccionario}
        idioma={idioma}
      />
    </main>
  );
};

export default MisSolicitudesPagina;
