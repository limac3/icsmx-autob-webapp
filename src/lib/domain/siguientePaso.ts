// Fuente: ui-ux-requerimientos.md, pantalla de inicio.
//
// Que es lo unico que le toca hacer ahora a quien compra. Vive en el dominio
// —sin I/O— porque es una regla de prioridad, no una consulta: quien invoca ya
// trajo sus solicitudes y las convocatorias visibles, y aqui solo se decide
// cual de las dos cosas se dice.
//
// **Una sola linea, no un tablero.** El home no compite con `/mis-solicitudes`
// ni con el catalogo; si pintara las tres cosas a la vez, la que importa —un
// plazo corriendo— dejaria de resaltar, que es justo lo que esta pantalla
// existe para evitar.

import { ventaAbierta } from "./ventanas";
import type { GrupoDeMiSolicitud } from "./misSolicitudes";

/**
 * Lo que esta funcion necesita de una solicitud propia. `MiSolicitudDTO` es
 * asignable; se declara el minimo para que el dominio no dependa del DTO de
 * una pantalla.
 */
export type SolicitudParaSiguientePaso = {
  solicitudId: string;
  convocatoriaId: string;
  loteId: string;
  marca: string;
  modelo: number;
  grupo: GrupoDeMiSolicitud;
  venceEn?: string;
};

/**
 * Lo que necesita de una convocatoria visible. `ConvocatoriaVisible` es
 * asignable, y por la misma razon: la regla no importa el modulo del servicio.
 *
 * Las fechas llegan en ISO-8601 UTC, tal como estan persistidas. Se comparan
 * como cadenas donde alcanza —ordenan lexicograficamente— y se deserializan
 * solo para preguntarle a `ventaAbierta`, que es la frontera compartida con
 * DynamoDB y no debe reimplementarse aqui.
 */
export type ConvocatoriaParaSiguientePaso = {
  convocatoriaId: string;
  nombre: string;
  inicioVenta: string;
  finVenta: string;
  cantidadDeLotes: number;
};

export type SiguientePaso =
  /** Hay un plazo corriendo y se sabe cual vence antes. */
  | {
      tipo: "PLAZO_CORRIENDO";
      convocatoriaId: string;
      loteId: string;
      vehiculo: string;
      venceEn: string;
    }
  /**
   * Hay al menos un plazo corriendo, pero la lista venia truncada: no se puede
   * afirmar cual vence antes. Ver `elegirPlazo`.
   */
  | { tipo: "PLAZO_CORRIENDO_SIN_PRECISAR" }
  | {
      tipo: "VENTA_ABIERTA";
      convocatoriaId: string;
      nombre: string;
      cantidadDeLotes: number;
    }
  | { tipo: "VARIAS_VENTAS_ABIERTAS"; cantidad: number }
  | { tipo: "PROXIMA_APERTURA"; nombre: string; inicioVenta: string };

/** Comparacion de cadenas ISO-8601 UTC, que ordenan lexicograficamente. */
const porCadena = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

const desdeIsoSeguro = (texto: string): Date | undefined => {
  const instante = new Date(texto);
  return Number.isNaN(instante.getTime()) ? undefined : instante;
};

/**
 * El plazo mas proximo entre las solicitudes propias, si lo hay.
 *
 * **Con la lista truncada no se nombra cual.** `listarMisSolicitudes` recorta
 * a las 100 mas **recientes** (`ScanIndexForward: false`), asi que una
 * solicitud mas vieja que quedo fuera pudo tener un vencimiento anterior:
 * afirmar "esta es la que vence antes" seria una afirmacion que el dato no
 * sostiene, y sobre un plazo eso cuesta un vehiculo. Se dice que hay plazos
 * corriendo y se manda a la pantalla que los lista completos.
 *
 * Si la lista se trunco y **no** hay ningun plazo vivo entre las que si
 * llegaron, se sigue de largo. Tampoco se puede afirmar que no exista ninguno,
 * pero para esconderse tendria que ser una adjudicacion anterior a las 100 mas
 * recientes y seguir viva, y el plazo de liquidacion se cuenta en horas:
 * habria vencido mucho antes. Callar aqui no oculta nada alcanzable.
 */
const elegirPlazo = (
  solicitudes: readonly SolicitudParaSiguientePaso[],
  truncada: boolean,
): SiguientePaso | undefined => {
  // `REQUIERE_ATENCION` es exactamente "ADJUDICADA con el plazo todavia
  // corriendo" (`agruparMiSolicitud`). Se reusa esa definicion en vez de
  // recomponerla con `estatus` y `plazoVencido`, que es donde las dos
  // pantallas se separarian.
  const conPlazo = solicitudes.filter(
    (solicitud) =>
      solicitud.grupo === "REQUIERE_ATENCION" &&
      solicitud.venceEn !== undefined,
  );
  if (conPlazo.length === 0) return undefined;
  if (truncada) return { tipo: "PLAZO_CORRIENDO_SIN_PRECISAR" };

  const primera = conPlazo.reduce((masProxima, candidata) =>
    porCadena(candidata.venceEn ?? "", masProxima.venceEn ?? "") < 0
      ? candidata
      : masProxima,
  );

  return {
    tipo: "PLAZO_CORRIENDO",
    convocatoriaId: primera.convocatoriaId,
    loteId: primera.loteId,
    vehiculo: `${primera.marca} ${primera.modelo}`.trim(),
    // `conPlazo` ya filtro las que no lo traen.
    venceEn: primera.venceEn ?? "",
  };
};

/**
 * Que hacer ahora, en orden de urgencia:
 *
 *   1. Un plazo de pago corriendo — es lo unico que se pierde por no mirarlo,
 *      y mientras CES siga sin aprobar (R17) esta aplicacion es el unico canal
 *      que lo avisa.
 *   2. Una venta abierta ahora mismo.
 *   3. La proxima apertura.
 *   4. Nada: se devuelve `undefined` y la pantalla no dibuja el bloque. Un
 *      recuadro que dice "no tienes nada pendiente" es ruido con marco.
 */
export const calcularSiguientePaso = ({
  solicitudes,
  truncada,
  convocatorias,
  ahora,
}: {
  solicitudes: readonly SolicitudParaSiguientePaso[];
  truncada: boolean;
  convocatorias: readonly ConvocatoriaParaSiguientePaso[];
  ahora: Date;
}): SiguientePaso | undefined => {
  const plazo = elegirPlazo(solicitudes, truncada);
  if (plazo) return plazo;

  const conVentana = convocatorias.flatMap((convocatoria) => {
    const inicioVenta = desdeIsoSeguro(convocatoria.inicioVenta);
    const finVenta = desdeIsoSeguro(convocatoria.finVenta);
    // Una convocatoria con fechas ilegibles no se convierte en "abre pronto":
    // se omite. El catalogo la sigue mostrando con su propio aviso.
    return inicioVenta && finVenta
      ? [{ convocatoria, inicioVenta, finVenta }]
      : [];
  });

  const abiertas = conVentana.filter((entrada) =>
    ventaAbierta(
      { inicioVenta: entrada.inicioVenta, finVenta: entrada.finVenta },
      ahora,
    ),
  );

  if (abiertas.length > 1) {
    return { tipo: "VARIAS_VENTAS_ABIERTAS", cantidad: abiertas.length };
  }

  if (abiertas.length === 1) {
    const { convocatoria } = abiertas[0];
    return {
      tipo: "VENTA_ABIERTA",
      convocatoriaId: convocatoria.convocatoriaId,
      nombre: convocatoria.nombre,
      cantidadDeLotes: convocatoria.cantidadDeLotes,
    };
  }

  const porAbrir = conVentana
    .filter((entrada) => entrada.inicioVenta.getTime() > ahora.getTime())
    .sort((a, b) =>
      porCadena(a.convocatoria.inicioVenta, b.convocatoria.inicioVenta),
    );

  const proxima = porAbrir[0];
  if (!proxima) return undefined;

  return {
    tipo: "PROXIMA_APERTURA",
    nombre: proxima.convocatoria.nombre,
    inicioVenta: proxima.convocatoria.inicioVenta,
  };
};
