import type { Diccionario } from "@/dictionaries";
import "./Esqueleto.css";

/**
 * Esqueleto de carga — `ui-ux-requerimientos.md` 8.
 *
 * **La seccion 8 pide "esqueleto de la forma real, no un giro centrado"**, y la
 * diferencia no es estetica: un giro no dice cuanto contenido viene ni donde va
 * a caer, asi que la pantalla salta cuando llega. Un esqueleto con la forma
 * correcta reserva el espacio y el salto desaparece.
 *
 * **Es un Server Component**: no tiene estado ni eventos, y un `loading.tsx`
 * se sirve como parte de la respuesta inicial. Marcarlo `"use client"` lo
 * mandaria al bundle sin ganar nada.
 *
 * Accesibilidad: las barras son decorativas y van `aria-hidden`; lo que el
 * lector de pantalla anuncia es el `role="status"` con el texto traducido, una
 * sola vez, en lugar de una lista de cajas vacias.
 */

export type EsquetoProps = {
  variante: "tabla" | "rejilla";
  /** Cuantas filas o tarjetas dibujar. Por omision, lo que suele caber. */
  cuantos?: number;
  diccionario: Diccionario;
};

const Esqueleto = ({ variante, cuantos, diccionario }: EsquetoProps) => {
  const total = cuantos ?? (variante === "tabla" ? 5 : 6);

  return (
    <div className="esqueleto" role="status">
      <span className="esqueleto__anuncio">{diccionario.comun.cargando}</span>

      <div className={`esqueleto__${variante}`} aria-hidden="true">
        {Array.from({ length: total }, (_, indice) => (
          <div className={`esqueleto__${variante}-item`} key={indice} />
        ))}
      </div>
    </div>
  );
};

export default Esqueleto;
