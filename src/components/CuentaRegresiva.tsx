"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatearCuentaRegresiva } from "@/lib/domain/fechas";

/**
 * Cuenta regresiva a la apertura de venta — pantalla 3.1 y 3.2.
 *
 * **El valor inicial lo calcula el servidor; el cliente solo decrementa.**
 * Nunca se compara contra `Date.now()` del navegador para decidir si la venta
 * abrio (regla 9, R-04): un reloj adelantado habilitaria el boton antes de
 * tiempo. Este componente es puramente decorativo — la autoridad sigue siendo
 * el servidor.
 *
 * **Al llegar a cero, se revalida contra el servidor.** `router.refresh()`
 * vuelve a ejecutar el Server Component con la hora real; nada se habilita
 * localmente.
 */

export type CuentaRegresivaProps = {
  /** Segundos restantes, calculados por el servidor al momento del render. */
  segundosIniciales: number;
  idioma: string;
};

const CuentaRegresiva = ({
  segundosIniciales,
  idioma,
}: CuentaRegresivaProps) => {
  const router = useRouter();
  const [segundos, setSegundos] = useState(segundosIniciales);

  // Un nuevo valor del servidor (tras revalidar la pagina) reinicia el
  // contador local en vez de seguir decrementando el anterior. Se ajusta
  // **durante el render**, siguiendo el patron que React documenta para
  // "adjusting state when a prop changes": un efecto que solo sincroniza
  // estado con una prop dispara un re-render en cascada evitable.
  const [previo, setPrevio] = useState(segundosIniciales);
  if (segundosIniciales !== previo) {
    setPrevio(segundosIniciales);
    setSegundos(segundosIniciales);
  }

  useEffect(() => {
    if (segundos <= 0) {
      // Se ejecuta una sola vez por transicion a cero: sin mas descuentos no
      // hay mas cambios de `segundos` que vuelvan a disparar este efecto,
      // hasta que un nuevo valor del servidor lo reinicie arriba.
      router.refresh();
      return undefined;
    }

    const id = setInterval(() => {
      setSegundos((actual) => Math.max(0, actual - 1));
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [segundos, router]);

  return (
    <span aria-live="polite">{formatearCuentaRegresiva(segundos, idioma)}</span>
  );
};

export default CuentaRegresiva;
