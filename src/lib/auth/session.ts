import "server-only";
import type { Rol, Sesion, TipoParticipante } from "@/types/identidad";
import { auth } from "./auth0";
import { obtenerRoles } from "./eas";

const resolverTipoParticipante = (roles: Rol[]): TipoParticipante =>
  roles.includes("EMPLEADO") ? "EMPLEADO" : "OTRO_USUARIO";

// El upsert real en DynamoDB (para obtener un participanteId propio y
// estable, distinto del `sub` de Okta) llega en la Etapa 4 junto con
// src/lib/data — ver agent_files/desafios-implementacion.md. Hasta entonces
// participanteId es el propio oktaSub: identifica al participante de forma
// unica y estable, solo que con el formato largo de Okta en vez de un id
// interno corto. Cuando exista el upsert, esta es la unica funcion que
// cambia.
const resolverParticipanteId = async (oktaSub: string): Promise<string> =>
  oktaSub;

/**
 * Sesion consolidada del participante autenticado, o `null` si no hay
 * sesion de Okta. Nunca lanza por ausencia de sesion; si lanza es porque EAS
 * fallo (sin fallback silencioso, regla 15 de CLAUDE.md) y el error se
 * propaga tal cual a quien llama.
 */
export const getSession = async (): Promise<Sesion | null> => {
  const sesionOkta = await auth.getSession();
  const usuario = sesionOkta?.user;
  if (!usuario?.sub) return null;

  const [participanteId, roles] = await Promise.all([
    resolverParticipanteId(usuario.sub),
    obtenerRoles(usuario.sub),
  ]);

  return {
    participanteId,
    oktaSub: usuario.sub,
    correo: usuario.email ?? "",
    nombre: usuario.name ?? usuario.email ?? usuario.sub,
    roles,
    tipoParticipante: resolverTipoParticipante(roles),
  };
};
