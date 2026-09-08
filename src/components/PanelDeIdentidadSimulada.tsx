import { cambiarPersonaSimulada } from "@/app/actions/devTools";
import BarraDeIdentidadSimulada, {
  type PersonaEnBarra,
} from "@/components/BarraDeIdentidadSimulada";
import { obtenerDiccionario } from "@/dictionaries";
import {
  impersonacionHabilitada,
  leerPersonaSimulada,
} from "@/lib/auth/impersonacion";
import {
  permisosDePersona,
  PERSONAS_SIMULADAS,
} from "@/lib/auth/personasSimuladas";
import { getSession } from "@/lib/auth/session";
import { obtenerIdiomaDePeticion } from "@/lib/idioma";

/**
 * Monta el conmutador de identidad simulada — **solo desarrollo**.
 *
 * **El unico componente de `src/components` que hace I/O**, y a proposito: el
 * layout raiz no puede leer la sesion sin volverse el punto donde se espera a
 * EAS en cada peticion, asi que la lectura tiene que ocurrir dentro de un
 * `<Suspense>`, y para estar dentro de un `<Suspense>` tiene que ser un
 * componente. Toda la presentacion vive en `BarraDeIdentidadSimulada.tsx`,
 * que si es props puro y se prueba en jsdom.
 *
 * Devuelve `null` —y no renderiza nada— en tres casos:
 *
 * - El modo no es `FULL`. En produccion es siempre, asi que ni el roster ni la
 *   action llegan a evaluarse.
 * - No hay sesion de Okta. La impersonacion nunca sustituye la autenticacion,
 *   asi que sin sesion no hay nada que conmutar.
 * - La sesion falla. Un fallo del conmutador de desarrollo no debe tumbar la
 *   pantalla que se esta probando; el `<Suspense>` del layout ya lo aisla, y
 *   aqui se traga el error a proposito.
 */
const PanelDeIdentidadSimulada = async () => {
  if (!impersonacionHabilitada()) return null;

  const [sesion, personaActiva] = await Promise.all([
    getSession().catch(() => null),
    leerPersonaSimulada().catch(() => null),
  ]);
  if (!sesion) return null;

  const idioma = await obtenerIdiomaDePeticion();

  const personas: PersonaEnBarra[] = PERSONAS_SIMULADAS.map((persona) => ({
    id: persona.id,
    nombre: persona.nombre,
    // Se derivan aqui, no en la barra: asi el concepto de rol no cruza hacia
    // ningun componente (invariante de la Etapa 2.1).
    permisos: [...permisosDePersona(persona)],
  }));

  return (
    <BarraDeIdentidadSimulada
      personas={personas}
      idActivo={personaActiva?.id ?? null}
      nombreVigente={sesion.nombre}
      oktaSub={sesion.oktaSub}
      accion={cambiarPersonaSimulada}
      diccionario={obtenerDiccionario(idioma)}
    />
  );
};

export default PanelDeIdentidadSimulada;
