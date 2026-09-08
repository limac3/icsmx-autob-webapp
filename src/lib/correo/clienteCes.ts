import "server-only";

// Adaptador de CES (Church Email Service) — `arquitectura-tecnica-aws.md` 2.5.
// `POST` de un JSON con autenticacion `Authorization: Basic`. **No es SES**:
// no hay SDK, no hay permiso de IAM, solo una URL y credenciales.
//
// **CES aun no esta aprobado para este proyecto** (riesgo R17,
// `plan-ejecucion.md`). El contrato exacto del cuerpo JSON no esta confirmado
// todavia — el que sigue es el mejor esfuerzo documentado en
// `arquitectura-tecnica-aws.md`: "POST de un JSON con los datos del mensaje".
// Por eso este archivo es **la unica pieza que hay que tocar** si el contrato
// real difiere, o si se sustituye por otro proveedor (SES, etc.): el resto del
// sistema solo conoce `enviarCorreo` y su `ResultadoDeEnvio`.

export type MensajeSaliente = {
  destinatario: string;
  asunto: string;
  cuerpoHtml: string;
};

export type ResultadoDeEnvio =
  | { ok: true; idExterno?: string }
  /**
   * `reintentable` distingue lo que `runbooks.md` R-2 ya distingue a mano:
   * un `5xx` o un timeout es indisponibilidad transitoria de CES y se
   * reintenta solo; un `401` (credenciales) o un `4xx` (mensaje mal formado,
   * destinatario rechazado) no se arregla reintentando el mismo envio.
   */
  | { ok: false; error: string; reintentable: boolean };

const requerido = (valor: string | undefined, nombre: string): string => {
  // Sin fallback silencioso (regla 15): si el procesador del outbox corre sin
  // estas variables, el error debe ser explicito y no un envio que desaparece.
  if (!valor) {
    throw new Error(`Falta configuracion de CES: ${nombre}`);
  }
  return valor;
};

/**
 * Envia un correo por CES. Nunca lanza por un fallo del servicio remoto —lo
 * traduce a `{ ok: false }`—; solo lanza si falta configuracion, que es un
 * defecto de despliegue y no algo que el procesador del outbox deba tratar
 * mensaje por mensaje.
 */
export const enviarCorreo = async (
  mensaje: MensajeSaliente,
): Promise<ResultadoDeEnvio> => {
  const url = requerido(process.env.CES_URL, "CES_URL");
  const usuario = requerido(process.env.CES_USER, "CES_USER");
  const password = requerido(process.env.CES_PASSWORD, "CES_PASSWORD");
  const remitente = requerido(process.env.CES_FROM_ADDRESS, "CES_FROM_ADDRESS");

  const credenciales = Buffer.from(`${usuario}:${password}`).toString("base64");

  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credenciales}`,
      },
      body: JSON.stringify({
        from: remitente,
        to: mensaje.destinatario,
        subject: mensaje.asunto,
        html: mensaje.cuerpoHtml,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "error de red",
      reintentable: true,
    };
  }

  if (respuesta.ok) {
    const cuerpo: unknown = await respuesta.json().catch(() => ({}));
    const idExterno =
      typeof (cuerpo as { id?: unknown }).id === "string"
        ? (cuerpo as { id: string }).id
        : undefined;
    return { ok: true, idExterno };
  }

  const texto = await respuesta.text().catch(() => "");
  return {
    ok: false,
    error: `CES respondio ${String(respuesta.status)}: ${texto}`,
    reintentable: respuesta.status >= 500,
  };
};
