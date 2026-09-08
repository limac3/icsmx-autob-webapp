import "server-only";
import { cache } from "react";
import {
  tiposDeConvocatoriaPermitidos,
  type Permiso,
  type Sesion,
} from "@/types/identidad";
import { auth } from "./auth0";
import { obtenerPermisos } from "./eas";
import { leerPersonaSimulada } from "./impersonacion";
import { permisosDePersona } from "./personasSimuladas";

// El upsert real en DynamoDB (para obtener un participanteId propio y
// estable, distinto del `sub` de Okta) llega en la Etapa 4 junto con
// src/lib/data — ver agent_files/desafios-implementacion.md. Hasta entonces
// participanteId es el propio oktaSub: identifica al participante de forma
// unica y estable, solo que con el formato largo de Okta en vez de un id
// interno corto. Cuando exista el upsert, esta es la unica funcion que
// cambia.
const resolverParticipanteId = async (oktaSub: string): Promise<string> =>
  oktaSub;

// Memoizado por peticion con `cache()` de React: una pagina que llama a
// getSession() desde el layout y desde tres componentes consulta EAS **una
// sola vez** (identidad-autorizacion.md 4.3). El cache dura lo que la
// peticion y nada mas: un permiso revocado surte efecto en la siguiente
// navegacion, sin esperar una expiracion.
const permisosDeLaPeticion = cache(
  async (oktaSub: string): Promise<Set<Permiso>> => obtenerPermisos(oktaSub),
);

/**
 * Sesion consolidada del participante autenticado, o `null` si no hay
 * sesion de Okta. Nunca lanza por ausencia de sesion; si lanza es porque EAS
 * fallo (sin fallback silencioso, regla 15 de CLAUDE.md) y el error se
 * propaga tal cual a quien llama.
 */
export const getSession = cache(async (): Promise<Sesion | null> => {
  const sesionOkta = await auth.getSession();
  const usuario = sesionOkta?.user;
  if (!usuario?.sub) return null;

  // Impersonacion de desarrollo (`impersonacion.ts`), y **despues** de exigir
  // la sesion de Okta, no antes: sustituye la identidad de negocio y los
  // permisos, jamas la autenticacion. Devuelve `null` sin tocar la peticion en
  // cualquier modo que no sea FULL, asi que en produccion esta rama no existe.
  //
  // `oktaSub` se conserva real a proposito: es el unico dato que sigue
  // respondiendo "quien esta conduciendo esta sesion".
  const persona = await leerPersonaSimulada();
  if (persona) {
    const permisos = permisosDePersona(persona);
    return {
      participanteId: persona.participanteId,
      oktaSub: usuario.sub,
      correo: persona.correo,
      nombre: persona.nombre,
      permisos,
      tiposDeConvocatoriaPermitidos: tiposDeConvocatoriaPermitidos(permisos),
    };
  }

  const [participanteId, permisos] = await Promise.all([
    resolverParticipanteId(usuario.sub),
    permisosDeLaPeticion(usuario.sub),
  ]);

  return {
    participanteId,
    oktaSub: usuario.sub,
    correo: usuario.email ?? "",
    nombre: usuario.name ?? usuario.email ?? usuario.sub,
    permisos,
    tiposDeConvocatoriaPermitidos: tiposDeConvocatoriaPermitidos(permisos),
  };
});
