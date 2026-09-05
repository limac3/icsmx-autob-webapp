import "server-only";

// Guarda comun de Server Actions y paginas: sesion + permiso, en un solo paso.
//
// Existe para que la comprobacion sea **imposible de olvidar a medias**. Sin
// ella, cada action repetiria "obtener sesion, comprobar que no es nula,
// consultar `puedeEjecutar`, traducir la razon a un codigo de error", y basta
// que una omita el segundo paso para que un usuario sin sesion llegue al
// servicio con un `participanteId` vacio.
//
// La otra mitad de su trabajo es traducir: `puedeEjecutar` responde con una
// **razon** de negocio y las actions devuelven un `CodigoError`. Que la
// traduccion viva en un solo lugar es lo que impide que una accion devuelva
// `forbidden` donde otra devuelve `invalid_state` para el mismo caso.

import {
  puedeEjecutar,
  type Accion,
  type Contexto,
  type RazonDenegacion,
} from "./permisos";
import { getSession } from "./session";
import type { ActorUsuario } from "@/types/auditoria";
import type { CodigoError } from "@/types/resultado";
import type { Sesion } from "@/types/identidad";

export type Autorizacion =
  | { ok: true; sesion: Sesion; actor: ActorUsuario }
  | { ok: false; error: CodigoError };

/**
 * Razon de denegacion -> codigo de error de la API.
 *
 * `not_owner` y `self_approval` se distinguen de `forbidden` a proposito: los
 * tres son negativas, pero solo el primero le sirve a la interfaz para explicar
 * **por que** —"esto no es tuyo", "no puedes aprobar lo que tu creaste"— y esa
 * explicacion no filtra nada que quien pregunta no supiera ya.
 */
const CODIGO_POR_RAZON: Record<RazonDenegacion, CodigoError> = {
  forbidden: "forbidden",
  not_owner: "forbidden",
  self_approval: "forbidden",
  sin_permiso_de_tipo: "forbidden",
  invalid_state: "invalid_state",
};

/**
 * Exige sesion y permiso para `accion` sobre `contexto`.
 *
 * El `participanteId` del contexto lo pone **esta funcion**, desde la sesion:
 * quien invoca no puede pasarlo, porque aceptarlo del input permitiria actuar
 * en nombre de otro (AGENTS.md).
 */
export const exigirPermiso = async (
  accion: Accion,
  contexto: Omit<Contexto, "participanteId"> = {},
): Promise<Autorizacion> => {
  const sesion = await getSession();
  if (!sesion) return { ok: false, error: "unauthorized" };

  const decision = puedeEjecutar({
    accion,
    permisos: sesion.permisos,
    contexto: { ...contexto, participanteId: sesion.participanteId },
  });

  if (!decision.permitido) {
    return { ok: false, error: CODIGO_POR_RAZON[decision.razon] };
  }

  return {
    ok: true,
    sesion,
    // El actor de la bitacora se arma aqui y no en cada action: los permisos
    // que se registran son los **vigentes en este momento**, y tomarlos de la
    // misma sesion que autorizo es lo que garantiza que la bitacora diga con
    // que autoridad se actuo de verdad.
    actor: {
      tipo: "USUARIO",
      id: sesion.participanteId,
      permisos: [...sesion.permisos],
    },
  };
};
