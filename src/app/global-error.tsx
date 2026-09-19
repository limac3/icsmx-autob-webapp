"use client";

import { obtenerDiccionario, idiomaPorDefecto } from "@/dictionaries";

/**
 * Boundary de ultimo recurso: lo que atrapa un fallo del **propio layout raiz**
 * (`ui-ux-requerimientos.md` 8).
 *
 * **Sustituye al layout entero, asi que tiene que traer su `<html>` y su
 * `<body>`.** Y por lo mismo no usa componentes de Eden ni hojas de la
 * aplicacion: si se esta renderizando esto es porque el layout que monta
 * `<Fonts>` y `<Normalize>` fallo, y apoyarse en el seria apostar a que lo
 * unico que ya se rompio funcione. Los estilos van en linea a proposito.
 *
 * **El idioma cae al de omision**, sin intentar adivinarlo: `<html lang>` lo
 * escribia el layout que acaba de fallar, y en esta pantalla el marcado es el
 * de este archivo. Una linea en el idioma equivocado es preferible a no
 * renderizar nada.
 */
const ErrorGlobal = ({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) => {
  const etiquetas = obtenerDiccionario(idiomaPorDefecto).comun;

  return (
    <html lang={idiomaPorDefecto}>
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <main
          style={{
            padding: "1.5rem",
            display: "grid",
            gap: "1rem",
            justifyItems: "start",
          }}
        >
          <h1>{etiquetas.error}</h1>
          <p>{etiquetas.errorDescripcion}</p>
          <button type="button" onClick={reset}>
            {etiquetas.reintentar}
          </button>
          {error.digest === undefined ? null : (
            <p style={{ opacity: 0.6, fontFamily: "monospace" }}>
              {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
};

export default ErrorGlobal;
