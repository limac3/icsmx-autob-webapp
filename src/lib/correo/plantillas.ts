// Plantilla del correo de adjudicacion — R-15: "con los datos de pago y el
// plazo". El "dato de pago" es el precio del lote: la aplicacion no modela
// instrucciones bancarias, el cobro es un proceso externo (`proyecto.md`
// seccion 2). El correo solo puede avisar cuanto y hasta cuando, y llevar de
// vuelta a la pantalla donde subir el comprobante.
//
// Modulo puro: sin I/O, para poder probarlo sin CES ni DynamoDB. Recibe el
// idioma como parametro en vez de leer `src/dictionaries` — el catalogo de ahi
// son etiquetas de UI con sus propias claves de ENUM, y este correo no
// necesita esa maquinaria para dos frases fijas. Si el catalogo de correos
// llega a crecer, es el primer candidato a moverse alli.

import { formatearFechaHora } from "@/lib/domain/fechas";
import { urlBaseDeLaApp } from "@/lib/entorno";
import { formatearPrecio } from "@/lib/domain/dinero";
import type { DatosCorreoAdjudicacion } from "@/types/correo";

export type CorreoRenderizado = { asunto: string; cuerpoHtml: string };

const enlaceDelLote = (datos: DatosCorreoAdjudicacion): string => {
  // `urlBaseDeLaApp` quita la barra final: sin eso, una `APP_BASE_URL` pegada
  // del navegador produce `https://host//convocatorias/...`.
  const base = urlBaseDeLaApp();
  return datos.convocatoriaId
    ? `${base}/convocatorias/${datos.convocatoriaId}/lotes/${datos.loteId}`
    : base;
};

/** `idioma` por omision `"es"` (regla 11 de CLAUDE.md). */
export const correoDeAdjudicacion = (
  datos: DatosCorreoAdjudicacion,
  idioma = "es",
): CorreoRenderizado => {
  const precio = formatearPrecio(datos.precio, idioma);
  const plazo = formatearFechaHora(new Date(datos.venceEn));
  const enlace = enlaceDelLote(datos);

  return {
    asunto:
      idioma === "en"
        ? "You won the bid — upload your proof of payment"
        : "Ganaste la adjudicacion — sube tu comprobante de pago",
    cuerpoHtml:
      idioma === "en"
        ? `<p>You are the winning bidder. Amount: ${precio}. Pay before ${plazo} and upload your proof of payment.</p>` +
          `<p><a href="${enlace}">Go to your request</a></p>`
        : `<p>Ganaste la adjudicacion. Monto: ${precio}. Paga antes del ${plazo} y sube tu comprobante de pago.</p>` +
          `<p><a href="${enlace}">Ir a tu solicitud</a></p>`,
  };
};
