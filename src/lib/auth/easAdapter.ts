import "server-only";
import { PERMISOS, type Permiso } from "@/types/identidad";

// Adaptador real de EAS.
//
// EAS no expone roles: se le envian nombres de permiso y responde un booleano
// por cada uno (agent_files/identidad-autorizacion.md seccion 4.2). Esa
// semantica esta confirmada; **el sobre HTTP exacto no** — ruta, forma de la
// peticion y de la respuesta pueden cambiar cuando el equipo de EAS confirme el
// contrato (riesgo R19). Por eso el parseo vive aislado en este archivo: es lo
// unico que deberia necesitar ajuste.

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

/**
 * Convierte la respuesta de EAS en el conjunto de permisos concedidos.
 *
 * Exige que **todos** los permisos preguntados vengan en la respuesta. Un
 * permiso ausente no se interpreta como `false`: eso convertiria un cambio de
 * contrato en "usuario sin acceso", que es indistinguible de una cuenta sin
 * privilegios y por tanto imposible de depurar. Es la misma logica de la regla
 * 15 de CLAUDE.md aplicada al detalle del contrato.
 */
const extraerPermisos = (
  cuerpo: unknown,
  solicitados: readonly Permiso[],
): Set<Permiso> => {
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) {
    throw new ErrorConsultaEas(
      "respuesta_invalida",
      "EAS devolvio un cuerpo que no es un objeto de permisos",
    );
  }

  const mapa = cuerpo as Record<string, unknown>;
  const concedidos = new Set<Permiso>();
  const ausentes: Permiso[] = [];

  for (const permiso of solicitados) {
    const valor = mapa[permiso];
    if (typeof valor !== "boolean") {
      ausentes.push(permiso);
      continue;
    }
    if (valor) concedidos.add(permiso);
  }

  if (ausentes.length > 0) {
    throw new ErrorConsultaEas(
      "respuesta_invalida",
      `EAS no respondio por ${ausentes.length} permiso(s) solicitado(s): ${ausentes.join(", ")}`,
    );
  }

  return concedidos;
};

/**
 * Consulta a EAS los permisos de `oktaSub`.
 *
 * Sin fallback silencioso (regla 15 de CLAUDE.md): configuracion incompleta,
 * red, timeout o respuesta invalida **lanzan**. Nunca devuelve un conjunto
 * vacio como sustituto de un error — un usuario sin permisos y un EAS caido
 * deben verse distintos.
 */
export const consultarPermisosEas = async (
  oktaSub: string,
  solicitados: readonly Permiso[] = PERMISOS,
): Promise<Set<Permiso>> => {
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
    respuesta = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ oktaSub, permisos: solicitados }),
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

  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch (error) {
    throw new ErrorConsultaEas(
      "respuesta_invalida",
      `EAS devolvio un cuerpo que no es JSON: ${String(error)}`,
    );
  }

  return extraerPermisos(cuerpo, solicitados);
};
