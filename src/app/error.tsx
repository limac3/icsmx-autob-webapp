"use client";

import { useEffect } from "react";
import { Primary, Secondary } from "@churchofjesuschrist/eden-buttons";
import { H1 } from "@churchofjesuschrist/eden-headings";
import { Text2 } from "@churchofjesuschrist/eden-text";
import { idiomaDelDocumento } from "@/lib/idiomaDelDocumento";
import { obtenerDiccionario } from "@/dictionaries";
import "./error.css";

/**
 * Error boundary de toda la aplicacion — `ui-ux-requerimientos.md` 8.
 *
 * **Un error boundary de Next es forzosamente un componente cliente**, asi que
 * no puede leer el header `x-lang` como hacen las paginas. El idioma se toma
 * del `lang` del documento, que el layout de servidor ya escribio: es el mismo
 * valor, resuelto una sola vez y por el servidor.
 *
 * **No muestra `error.message`.** Un mensaje de excepcion puede llevar nombres
 * de tabla, claves o fragmentos de consulta, y esta pantalla la ve cualquiera.
 * Lo que si se conserva es el `digest`, que es lo unico que permite encontrar
 * la traza correspondiente en el registro sin filtrar nada.
 *
 * `reset()` reintenta el segmento sin recargar la pagina, que es lo que pide la
 * seccion 8 —"boton de reintento"— y no un enlace que vuelva a navegar.
 */
const ErrorDeAplicacion = ({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) => {
  const diccionario = obtenerDiccionario(idiomaDelDocumento());
  const etiquetas = diccionario.comun;

  useEffect(() => {
    // El registro estructurado del servidor no ve lo que falla al hidratar. La
    // consola del navegador es el unico sitio donde este error existe, y sin
    // esta linea `digest` —lo unico que lo ata a la traza del servidor— se
    // pierde con el render.
    console.error("error_de_aplicacion", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <main className="error-aplicacion">
      <H1>{etiquetas.error}</H1>
      <Text2 renderAs="p">{etiquetas.errorDescripcion}</Text2>

      <div className="error-aplicacion__acciones">
        <Primary type="button" onClick={reset}>
          {etiquetas.reintentar}
        </Primary>
        <Secondary renderAs="a" href="/">
          {etiquetas.volverAlInicio}
        </Secondary>
      </div>

      {error.digest === undefined ? null : (
        <Text2 renderAs="p" className="error-aplicacion__digest">
          {error.digest}
        </Text2>
      )}
    </main>
  );
};

export default ErrorDeAplicacion;
