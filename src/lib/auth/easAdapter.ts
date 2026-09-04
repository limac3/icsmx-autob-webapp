import "server-only";
import { ROLES, type Rol } from "@/types/identidad";

// Adaptador real de EAS. El contrato exacto del endpoint (forma de la
// respuesta) todavia no esta confirmado por el equipo de EAS — se deja
// escrito con la firma definitiva y una forma de respuesta razonable
// ({ roles: string[] }), ver agent_files/identidad-autorizacion.md seccion
// 4.2. Ajustar el parseo aqui cuando se confirme el contrato real; nada mas
// deberia necesitar cambiar.

export type CausaErrorEas =
  "timeout" | "red" | "respuesta_invalida" | "configuracion";

export class ErrorConsultaEas extends Error {
  readonly causa: CausaErrorEas;

  constructor(causa: CausaErrorEas, mensaje: string) {
    super(mensaje);
    this.name = "ErrorConsultaEas";
    this.causa = causa;
  }
}

const TIEMPO_LIMITE_MS = 5000;

const ROLES_VALIDOS = new Set<string>(ROLES);

const extraerRoles = (cuerpo: unknown): Rol[] | null => {
  if (!cuerpo || typeof cuerpo !== "object" || !("roles" in cuerpo))
    return null;
  const { roles } = cuerpo as { roles: unknown };
  if (!Array.isArray(roles)) return null;
  return roles.filter(
    (valor): valor is Rol =>
      typeof valor === "string" && ROLES_VALIDOS.has(valor),
  );
};

// Sin fallback silencioso (regla 15 de CLAUDE.md): cualquier fallo de
// configuracion, red, timeout o forma de respuesta invalida lanza. Nunca
// devuelve una lista vacia como sustituto de un error.
export const consultarRolesEas = async (oktaSub: string): Promise<Rol[]> => {
  const url = process.env.EAS_PROFILE_URL;
  const apiKey = process.env.EAS_API_KEY;
  if (!url || !apiKey) {
    throw new ErrorConsultaEas(
      "configuracion",
      "EAS_PROFILE_URL o EAS_API_KEY no estan configurados",
    );
  }

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIEMPO_LIMITE_MS);

  let respuesta: Response;
  try {
    respuesta = await fetch(`${url}/${encodeURIComponent(oktaSub)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controlador.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ErrorConsultaEas(
        "timeout",
        `EAS no respondio en ${TIEMPO_LIMITE_MS}ms`,
      );
    }
    throw new ErrorConsultaEas(
      "red",
      `Fallo de red consultando EAS: ${String(error)}`,
    );
  } finally {
    clearTimeout(temporizador);
  }

  if (!respuesta.ok) {
    throw new ErrorConsultaEas(
      "respuesta_invalida",
      `EAS respondio con estatus ${respuesta.status}`,
    );
  }

  const roles = extraerRoles(await respuesta.json());
  if (!roles) {
    throw new ErrorConsultaEas(
      "respuesta_invalida",
      "EAS devolvio un formato inesperado",
    );
  }
  return roles;
};
