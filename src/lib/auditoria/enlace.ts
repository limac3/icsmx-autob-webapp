// Enlace a la bitacora de un registro concreto.
//
// **Sin `import "server-only"` a proposito**: lo usan tambien componentes
// cliente (`LotesDeConvocatoria`), y es puro — no lee nada, solo construye una
// URL.
//
// Existe para que los nombres de los parametros de `/auditoria` esten escritos
// en un solo lugar. Son el contrato de esa pantalla: si `agregadoId` se
// llamara distinto en uno de los cuatro sitios que enlazan, el enlace abriria
// la pantalla vacia y nadie lo notaria hasta que un auditor lo intentara.

import type { TipoDeAgregado } from "@/lib/data/claves";

/**
 * **No lleva fechas, y es deliberado.** La pantalla aplica su rango por
 * defecto —los ultimos 30 dias— y, como la consulta por identificador lee la
 * particion entera, ella misma detecta si hay historia anterior y ofrece
 * ampliarlo ("ver historia completa"). Mandar aqui la fecha de creacion del
 * registro obligaria a arrastrar `creadoEn` por cuatro componentes para
 * conseguir lo mismo que un clic ya resuelve.
 */
export const enlaceDeBitacora = (
  agregado: TipoDeAgregado,
  agregadoId: string,
): string =>
  `/auditoria?${new URLSearchParams({ agregado, agregadoId }).toString()}`;
