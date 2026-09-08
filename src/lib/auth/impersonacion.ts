import "server-only";
import { cookies } from "next/headers";
import {
  exigirModoSeguro,
  obtenerModoDevTools,
  type ModoDevTools,
} from "./devMode";
import {
  buscarPersonaSimulada,
  type PersonaSimulada,
} from "./personasSimuladas";

/**
 * Impersonacion de desarrollo: elegir con que identidad de negocio se recorre
 * la aplicacion, sin reiniciar el servidor.
 *
 * **Sustituye permisos e identidad, nunca la autenticacion**
 * (`identidad-autorizacion.md` seccion 4.1). `getSession()` sigue exigiendo una
 * sesion real de Okta antes de mirar esta cookie, y `oktaSub` conserva el valor
 * real: quien conduce la sesion sigue siendo quien inicio sesion.
 *
 * **Solo en modo `FULL`.** Es lo que finalmente distingue `FULL` de
 * `MOCK_USERS`, que la documentacion reservaba para esto desde la Etapa 2:
 * `MOCK_USERS` se configura por variables de entorno y no lee ninguna cookie;
 * `FULL` habilita el conmutador interactivo y cae a las variables de entorno
 * cuando no hay ninguna persona elegida.
 *
 * La cookie es **por navegador**, no por servidor. Es la propiedad que hace
 * util al conmutador: dos ventanas —o una normal y una de incognito— son dos
 * participantes simultaneos, y con eso la fila FIFO se puede recorrer a mano.
 */
export const COOKIE_PERSONA_SIMULADA = "autob_persona_simulada";

/** Duracion generosa: una jornada de pruebas no deberia perder al actor. */
const VIGENCIA_EN_SEGUNDOS = 60 * 60 * 12;

/**
 * `true` solo en el unico modo que admite impersonacion. Se consulta con el
 * modo ya resuelto cuando quien llama lo tiene a mano, para no releer el
 * entorno dos veces.
 */
export const impersonacionHabilitada = (
  modo: ModoDevTools = obtenerModoDevTools(),
): boolean => modo === "FULL";

/**
 * La persona elegida en este navegador, o `null` si no hay ninguna, si el id
 * de la cookie no esta en el roster, o si el modo no admite impersonacion.
 *
 * **Devuelve `null` sin leer la cookie cuando el modo no es `FULL`.** Importa
 * el orden: en produccion —y en `MOCK_USERS`— esta funcion no toca la peticion,
 * asi que no puede volver dinamica una pantalla que no lo era.
 */
export const leerPersonaSimulada =
  async (): Promise<PersonaSimulada | null> => {
    const modo = obtenerModoDevTools();
    if (!impersonacionHabilitada(modo)) return null;

    // Cinturon y tirantes: `obtenerModoDevTools()` ya devuelve OFF ante un valor
    // invalido, pero si alguien pone FULL en produccion esto lanza antes de
    // conceder una sola identidad simulada.
    exigirModoSeguro(modo);

    const id = (await cookies()).get(COOKIE_PERSONA_SIMULADA)?.value;
    if (!id) return null;

    // Un id fuera del roster se ignora en silencio en vez de lanzar: una cookie
    // vieja de un roster anterior no debe dejar la aplicacion inservible hasta
    // que alguien la borre a mano. Se cae al comportamiento de `MOCK_USERS`.
    return buscarPersonaSimulada(id) ?? null;
  };

/**
 * Fija o borra la persona simulada. `null` borra la cookie y devuelve la sesion
 * al comportamiento por variables de entorno.
 *
 * Lanza si el modo no admite impersonacion o si el id no esta en el roster:
 * un conmutador de desarrollo mal invocado debe fallar a la vista, no aplicar
 * medio cambio en silencio (regla 15).
 *
 * Solo se puede llamar desde una Server Action o un Route Handler — es la
 * unica parte del ciclo de vida de Next.js donde se puede escribir una cookie.
 */
export const fijarPersonaSimulada = async (
  id: string | null,
): Promise<PersonaSimulada | null> => {
  const modo = obtenerModoDevTools();
  exigirModoSeguro(modo);
  if (!impersonacionHabilitada(modo)) {
    throw new Error(
      `La impersonacion exige ENABLE_DEV_TOOLS=FULL; el modo vigente es "${modo}".`,
    );
  }

  const almacen = await cookies();

  if (id === null) {
    almacen.delete(COOKIE_PERSONA_SIMULADA);
    return null;
  }

  const persona = buscarPersonaSimulada(id);
  if (!persona) {
    throw new Error(`No existe la persona simulada "${id}".`);
  }

  almacen.set(COOKIE_PERSONA_SIMULADA, persona.id, {
    // Nada de codigo de cliente necesita leerla, y no quererla legible desde
    // JavaScript cuesta lo mismo que quererla.
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: VIGENCIA_EN_SEGUNDOS,
    // En produccion esto es inalcanzable —`exigirModoSeguro` ya lanzo—, pero
    // la condicion deja la intencion escrita y cubre un despliegue de prueba
    // servido por HTTPS.
    secure: process.env.NODE_ENV === "production",
  });

  return persona;
};
