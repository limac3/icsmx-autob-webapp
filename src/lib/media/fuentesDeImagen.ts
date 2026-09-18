import "server-only";

// Que URLs firmadas se le pasan a un `<img>`, y con que descriptores.
//
// **Existe para que las tres pantallas no se desincronicen.** La rejilla del
// catalogo, la galeria publica y la galeria de administracion tienen necesidades
// de ancho distintas, y si cada una armara su `srcSet` por su cuenta, el dia que
// se agregue una variante dos de ellas seguirian pidiendo la vieja y nada lo
// delataria: las tres seguirian compilando y mostrando imagenes.
//
// Lo que se decide aqui, y no en el componente, es **cuanto peso baja cada
// pantalla**. El componente decide `sizes`, que depende de su maquetacion.

import type { FuentesDeImagen } from "@/types/media";
import type { Fotografia, VarianteImagen } from "@/types/vehiculo";
import { NOMBRES_DE_VARIANTE } from "@/types/vehiculo";

export type FirmadorDeFotografia = (claveS3: string) => string;

export type OpcionesDeFuentes = {
  /**
   * Tope de ancho que la pantalla puede llegar a pedir.
   *
   * Acota lo que se firma y lo que el navegador puede elegir. La rejilla del
   * catalogo nunca supera unos 485 px CSS, asi que la variante de 2048 solo la
   * pediria una pantalla con densidad mayor que 4: incluirla seria ofrecer un
   * peso que nadie necesita.
   */
  anchoMaximo: number;
  firmar: FirmadorDeFotografia;
};

/**
 * Las variantes de una fotografia, ordenadas y acotadas, listas para un `<img>`.
 *
 * Siempre devuelve algo renderizable: si ninguna variante cabe en `anchoMaximo`
 * —una pantalla muy estrecha frente a una fotografia grande— se conserva la mas
 * chica, porque una imagen de mas peso es mejor que ninguna.
 */
export const fuentesDeImagen = (
  foto: Pick<Fotografia, "variantes">,
  opciones: OpcionesDeFuentes,
): FuentesDeImagen => {
  const ordenadas = NOMBRES_DE_VARIANTE.map(
    (nombre) => foto.variantes[nombre],
  ).sort((una, otra) => una.ancho - otra.ancho);

  // Deduplicar por ancho: dos candidatas con el mismo descriptor `w` dejan al
  // navegador eligiendo al azar entre bytes equivalentes, y pueden colapsar el
  // conjunto a una sola —el caso que pierde el `alt` en Eden—.
  const unicas: VarianteImagen[] = [];
  for (const variante of ordenadas) {
    if (!unicas.some((ya) => ya.ancho === variante.ancho)) {
      unicas.push(variante);
    }
  }

  const dentroDelTope = unicas.filter(
    (variante) => variante.ancho <= opciones.anchoMaximo,
  );
  const elegidas = dentroDelTope.length > 0 ? dentroDelTope : [unicas[0]!];

  // **Una firma por variante, reutilizada.** Firmar la menor dos veces —una
  // para `src` y otra dentro del `srcSet`— no solo gastaba una operacion de
  // mas: con la cubeta de `cloudfrontSigner.ts` las dos cadenas coinciden, pero
  // no hay nada que lo garantice, y dos URLs distintas para el mismo objeto son
  // dos entradas distintas en el cache del navegador.
  const firmadas = elegidas.map((variante) => ({
    ...variante,
    url: opciones.firmar(variante.claveS3),
  }));

  const menor = firmadas[0]!;
  const mayor = firmadas.at(-1)!;

  return {
    src: menor.url,
    ...(firmadas.length > 1
      ? {
          srcSet: firmadas
            .map((variante) => `${variante.url} ${String(variante.ancho)}w`)
            .join(", "),
        }
      : {}),
    ancho: mayor.ancho,
    alto: mayor.alto,
  };
};
