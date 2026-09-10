// Filtros de la pantalla de bitacora (`ui-ux-requerimientos.md` 7) y de
// `exportarBitacora`. Puro: la lectura de la bitacora de **un agregado** es
// PA-12 (`consultarBitacora.ts`) y la del **rango completo** es PA-13
// (`consultarBitacoraGlobal.ts`); todo lo demas —tipo de evento, participante—
// se aplica en memoria sobre lo que esas consultas ya trajeron. Al volumen de
// la bitacora de un lote o de una convocatoria (cientos de eventos en toda su
// vida, nunca miles), filtrar despues de leer no pierde nada y evita una
// expresion dinamica para dos o tres condiciones opcionales — el mismo
// argumento que `listarVehiculos` aplica a su busqueda de texto.

import { TIPOS_DE_AGREGADO, type TipoDeAgregado } from "@/lib/data/claves";
import {
  desdeIso,
  diaDeNegocio,
  diasDeNegocioEntre,
  sumarDiasDeNegocio,
} from "@/lib/domain/fechas";
import {
  TIPOS_DE_EVENTO,
  type EventoDTO,
  type TipoDeEvento,
} from "@/types/auditoria";

export type FiltrosDeBitacora = {
  agregado: TipoDeAgregado;
  agregadoId: string;
  tipo?: TipoDeEvento;
  /** Dia de negocio `yyyy-mm-dd`, inclusivo. */
  desde?: string;
  /** Dia de negocio `yyyy-mm-dd`, inclusivo. */
  hasta?: string;
  /** Compara contra `actorId`: quien participo, no solo quien administro. */
  participanteId?: string;
};

/**
 * Dia de negocio del evento, o `undefined` si `ocurridoEn` esta mal formado.
 *
 * **El rango se compara en dias de negocio y no contra el ISO crudo**, y esa
 * decision no es de estilo. La lectura global (PA-13) consulta particiones
 * `AUDIT#<dia>` calculadas con `diaDeNegocio`, asi que sus fronteras son las
 * medianoches de Mexico. Comparar aqui `ocurridoEn` contra `"2026-10-06"` a
 * secas pondria la frontera en la medianoche **UTC**, seis horas antes: el
 * mismo rango devolveria un conjunto distinto segun si la busqueda fue por
 * identificador o global, y un auditor no puede trabajar con dos respuestas
 * para la misma pregunta.
 */
const diaDelEvento = (evento: EventoDTO): string | undefined => {
  const instante = desdeIso(evento.ocurridoEn);
  return instante ? diaDeNegocio(instante) : undefined;
};

export const eventoCoincideConFiltros = (
  evento: EventoDTO,
  filtros: Pick<
    FiltrosDeBitacora,
    "tipo" | "desde" | "hasta" | "participanteId"
  >,
): boolean => {
  if (filtros.tipo && evento.tipo !== filtros.tipo) return false;

  if (filtros.desde || filtros.hasta) {
    const dia = diaDelEvento(evento);
    // Un `ocurridoEn` que no se puede interpretar no puede afirmarse dentro
    // del rango: la bitacora es prueba, y ante un dato ilegible se calla en
    // vez de adivinar.
    if (!dia) return false;
    // Comparacion lexicografica de `yyyy-mm-dd`: ordena igual que el
    // calendario, que es la misma propiedad que sostiene las claves.
    if (filtros.desde && dia < filtros.desde) return false;
    if (filtros.hasta && dia > filtros.hasta) return false;
  }

  if (filtros.participanteId && evento.actorId !== filtros.participanteId) {
    return false;
  }
  return true;
};

// --- La busqueda de la pantalla -------------------------------------------
//
// La pantalla dejo de tener un solo modo de consulta. Con un identificador
// concreto la lectura sigue siendo PA-12 —una particion, la historia completa
// de ese agregado—, y sin el es PA-13: una particion **por dia** del rango.
// De ahi salen las dos reglas de abajo, y ninguna es cosmetica:
//
//   - El rango nunca puede estar vacio, porque en el modo global **es la
//     llave** de la consulta y no un filtro.
//   - El rango se acota a `MAXIMO_DIAS_DE_RANGO`, pero **solo en el modo
//     global**: con un identificador se lee una sola particion y el rango
//     vuelve a ser un filtro en memoria, asi que acotarlo solo esconderia
//     historia sin ahorrar nada.

/**
 * Dias hacia atras del rango por defecto.
 *
 * Treinta hacia atras contando hoy son 31 dias de calendario, y por eso
 * `MAXIMO_DIAS_DE_RANGO` es 31 y no 30: el tope tiene que admitir el valor por
 * defecto, o la pantalla abriria en un estado que ella misma rechaza.
 */
export const DIAS_DE_RANGO_POR_DEFECTO = 30;

/**
 * Dias que una busqueda global puede abarcar.
 *
 * Era 31, y era el numero de `Query` que la version anterior lanzaba: una por
 * dia sobre `AUDIT#<dia>`. Ahora el rango es una **condicion de clave** dentro
 * de particiones por mes, asi que 90 dias cuestan entre una y cuatro consultas
 * y el limite deja de ser un presupuesto de red para volverse lo que siempre
 * debio ser: cuanta historia cabe en una pantalla sin paginar.
 *
 * Los sondeos de las opciones si siguen siendo por dia (`valoresConActividad`),
 * y ese es el costo que este tope acota de verdad.
 */
export const MAXIMO_DIAS_DE_RANGO = 90;

export type RangoDeDias = { desde: string; hasta: string };

/** Los ultimos 30 dias, contando hoy, en dias de negocio. */
export const rangoPorDefecto = (ahora: Date): RangoDeDias => {
  const hasta = diaDeNegocio(ahora);
  const desde = sumarDiasDeNegocio(hasta, -DIAS_DE_RANGO_POR_DEFECTO);
  if (!desde) {
    // `diaDeNegocio` siempre produce un dia valido, asi que llegar aqui seria
    // un defecto de `sumarDiasDeNegocio` y no un dato de entrada.
    throw new Error(`rangoPorDefecto no pudo retroceder desde ${hasta}`);
  }
  return { desde, hasta };
};

/**
 * Motivos por los que una busqueda no se ejecuta. Claves de diccionario, no
 * texto (regla 11).
 */
export const MOTIVOS_BUSQUEDA_INVALIDA = [
  "rango_invalido",
  "rango_excedido",
  "sin_criterio",
] as const;

export type MotivoBusquedaInvalida = (typeof MOTIVOS_BUSQUEDA_INVALIDA)[number];

/** Lo que llega de la URL, sin validar. */
export type CriteriosCrudos = {
  agregado?: string;
  agregadoId?: string;
  tipo?: string;
  participanteId?: string;
  desde?: string;
  hasta?: string;
};

export type BusquedaDeBitacora = {
  rango: RangoDeDias;
  /** Presentes los dos o ninguno: un tipo sin identificador no es un criterio. */
  agregado?: TipoDeAgregado;
  agregadoId?: string;
  tipo?: TipoDeEvento;
  participanteId?: string;
};

export const esTipoDeAgregado = (
  valor: string | undefined,
): valor is TipoDeAgregado =>
  valor !== undefined &&
  (TIPOS_DE_AGREGADO as readonly string[]).includes(valor);

export const esTipoDeEvento = (
  valor: string | undefined,
): valor is TipoDeEvento =>
  valor !== undefined && (TIPOS_DE_EVENTO as readonly string[]).includes(valor);

const recortado = (valor: string | undefined): string | undefined => {
  const texto = valor?.trim();
  return texto && texto.length > 0 ? texto : undefined;
};

/**
 * Convierte lo que trae la URL en una busqueda ejecutable, o en la lista de
 * motivos por los que no lo es.
 *
 * **Un rango ausente no es un error: es el rango por defecto.** Impedir que se
 * vacie es trabajo del formulario (`required`); un enlace guardado en favoritos
 * o compartido no tiene por que traerlo, y responderle con un error en vez de
 * con los ultimos 30 dias no ayudaria a nadie.
 *
 * Un rango **presente y mal formado** si es un error, y no se sustituye por el
 * defecto en silencio: quien escribio esas fechas espera esas fechas, y
 * mostrarle otras sin decirlo le haria leer la bitacora equivocada.
 */
export const validarBusqueda = (
  crudos: CriteriosCrudos,
  ahora: Date,
):
  | { ok: true; busqueda: BusquedaDeBitacora }
  | { ok: false; motivos: readonly MotivoBusquedaInvalida[] } => {
  const motivos: MotivoBusquedaInvalida[] = [];

  const desde = recortado(crudos.desde);
  const hasta = recortado(crudos.hasta);
  const porDefecto = rangoPorDefecto(ahora);
  const rango: RangoDeDias = {
    desde: desde ?? porDefecto.desde,
    hasta: hasta ?? porDefecto.hasta,
  };

  const agregado = esTipoDeAgregado(crudos.agregado)
    ? crudos.agregado
    : undefined;
  const agregadoId = agregado ? recortado(crudos.agregadoId) : undefined;
  const tipo = esTipoDeEvento(crudos.tipo) ? crudos.tipo : undefined;
  const participanteId = recortado(crudos.participanteId);

  const dias = diasDeNegocioEntre(rango.desde, rango.hasta);
  if (!dias) {
    motivos.push("rango_invalido");
  } else if (!agregadoId && dias.length > MAXIMO_DIAS_DE_RANGO) {
    motivos.push("rango_excedido");
  }

  if (!agregadoId && !tipo && !participanteId) {
    motivos.push("sin_criterio");
  }

  if (motivos.length > 0) return { ok: false, motivos };

  return {
    ok: true,
    busqueda: {
      rango,
      ...(agregado && agregadoId ? { agregado, agregadoId } : {}),
      ...(tipo ? { tipo } : {}),
      ...(participanteId ? { participanteId } : {}),
    },
  };
};
