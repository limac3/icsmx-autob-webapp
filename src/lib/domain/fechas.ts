// Fuente: proyecto.md R-04 y regla 9 de CLAUDE.md.
//
// Una sola zona horaria de negocio, un solo formato de persistencia. Todo
// instante se guarda en ISO-8601 UTC y se presenta en `America/Mexico_City`.
// Ninguna decision de negocio mira el reloj del cliente.
//
// Modulo puro: no importa nada de `src/lib/data`, no hace I/O y no lee
// `Date.now()`. El "ahora" siempre llega como argumento — es lo que permite
// probar las fronteras de tiempo de forma determinista (estrategia P-2).

/**
 * Zona horaria de negocio. Unica en todo el sistema.
 *
 * Mexico dejo de observar horario de verano en octubre de 2022, pero el
 * calculo **no** asume un desplazamiento fijo de -6: se resuelve contra la
 * base de datos IANA en cada instante. Fechas anteriores a 2022 —que existen
 * en la bitacora de sistemas previos y en cualquier dato historico que se
 * migre— siguen convirtiendose bien.
 */
export const ZONA_HORARIA_NEGOCIO = "America/Mexico_City";

/** Instante descompuesto en hora de pared de la zona de negocio. */
export type PartesDeFecha = {
  anio: number;
  /** 1-12, no 0-11. El desfase de `Date` es una fuente clasica de error. */
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
};

// Un solo formateador reutilizado: construir un `Intl.DateTimeFormat` es caro
// y esto se invoca por cada fila de cada listado.
const FORMATEADOR_PARTES = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_HORARIA_NEGOCIO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

// ISO-8601 UTC estricto: solo la forma canonica que produce `toISOString()`.
//
// Deliberadamente no se acepta `2026-09-04` ni `2026-09-04T10:00:00-06:00`.
// Un valor sin hora o con desplazamiento propio se interpretaria distinto
// segun quien lo lea, y este formato es tambien el que ordena en las claves
// de DynamoDB: cualquier variante rompe la comparacion lexicografica.
const ISO_8601_UTC =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?Z$/;

export const esInstanteValido = (instante: Date): boolean =>
  !Number.isNaN(instante.getTime());

/**
 * Descompone un instante en su hora de pared de la zona de negocio.
 *
 * Se usa `formatToParts` y no `format` porque la cadena formateada depende
 * del `locale` y del navegador; las partes son datos.
 */
export const partesEnZonaDeNegocio = (instante: Date): PartesDeFecha => {
  if (!esInstanteValido(instante)) {
    throw new RangeError("partesEnZonaDeNegocio recibio una fecha invalida");
  }

  const partes = FORMATEADOR_PARTES.formatToParts(instante);
  const valor = (tipo: Intl.DateTimeFormatPartTypes): number => {
    const parte = partes.find((candidata) => candidata.type === tipo);
    if (!parte) {
      throw new RangeError(`Intl no devolvio la parte "${tipo}"`);
    }
    return Number(parte.value);
  };

  return {
    anio: valor("year"),
    mes: valor("month"),
    dia: valor("day"),
    // A medianoche, `hour12: false` devuelve "24" en algunos entornos ICU en
    // lugar de "00". Normalizarlo aqui evita propagar un 24 que ninguna
    // aritmetica de fechas espera.
    hora: valor("hour") % 24,
    minuto: valor("minute"),
    segundo: valor("second"),
  };
};

/**
 * Minutos de desplazamiento de la zona de negocio respecto de UTC en ese
 * instante concreto. Negativo al oeste de Greenwich: -360 en horario estandar
 * de Mexico, -300 durante el horario de verano historico.
 */
export const desplazamientoEnMinutos = (instante: Date): number => {
  const partes = partesEnZonaDeNegocio(instante);
  const comoSiFueraUtc = Date.UTC(
    partes.anio,
    partes.mes - 1,
    partes.dia,
    partes.hora,
    partes.minuto,
    partes.segundo,
  );
  // El milisegundo no viaja en las partes; se descuenta para que la resta
  // sea multiplo exacto de un minuto.
  const instanteAlSegundo = instante.getTime() - instante.getUTCMilliseconds();
  return (comoSiFueraUtc - instanteAlSegundo) / 60_000;
};

/** Serializa a la unica forma que se persiste (R-04). */
export const aIso = (instante: Date): string => {
  if (!esInstanteValido(instante)) {
    throw new RangeError("aIso recibio una fecha invalida");
  }
  return instante.toISOString();
};

/**
 * Frontera de entrada: convierte lo que viene de DynamoDB, de un formulario o
 * de una URL en un instante.
 *
 * Devuelve `undefined` en lugar de lanzar porque el dato puede venir de
 * afuera, y quien lo recibe debe poder responder `validation_failed`
 * (estrategia 3.1) en vez de romperse.
 */
export const desdeIso = (texto: string): Date | undefined => {
  const partes = ISO_8601_UTC.exec(texto);
  if (!partes) return undefined;

  const instante = new Date(texto);
  if (!esInstanteValido(instante)) return undefined;

  // Verificacion de ida y vuelta, y no solo `Number.isNaN`.
  //
  // El parser de V8 **desborda el dia en silencio**: `2026-02-30T00:00:00Z` no
  // es una fecha invalida sino el 2 de marzo. Un `finVenta` mal capturado
  // alargaria la ventana de venta dos dias sin que nadie lo notara. Que el
  // instante vuelva a producir los mismos componentes es lo unico que lo
  // detecta. (El mes si lo rechaza el parser, pero depender de esa asimetria
  // seria fragil.)
  const [, anio, mes, dia, hora, minuto, segundo] = partes;
  const coincide =
    instante.getUTCFullYear() === Number(anio) &&
    instante.getUTCMonth() + 1 === Number(mes) &&
    instante.getUTCDate() === Number(dia) &&
    instante.getUTCHours() === Number(hora) &&
    instante.getUTCMinutes() === Number(minuto) &&
    instante.getUTCSeconds() === Number(segundo);

  return coincide ? instante : undefined;
};

const conCeros = (valor: number, ancho: number): string =>
  String(valor).padStart(ancho, "0");

/**
 * Dia calendario de negocio, `yyyy-mm-dd`.
 *
 * Es la clave de particion de `VENCE#<dia>` en GSI4 y de `AUDIT#<dia>` en
 * GSI2. Se calcula en **hora de negocio y no en UTC** a proposito: quien lee
 * esas claves es una persona —el operador que sigue R-1 de `runbooks.md`, el
 * auditor que pide "todo lo del 4 de septiembre"— y un dia UTC mandaria un
 * vencimiento de las 18:00 de Mexico a la particion del dia siguiente.
 *
 * El costo es que la frontera del dia no coincide con la de UTC, pero el
 * barrido ya recorre varios dias por diseno (`runbooks.md` R-1, paso 3), asi
 * que ninguna correccion depende de que la particion sea exacta: el dia solo
 * reparte carga (riesgo R12).
 */
export const diaDeNegocio = (instante: Date): string => {
  const { anio, mes, dia } = partesEnZonaDeNegocio(instante);
  return `${conCeros(anio, 4)}-${conCeros(mes, 2)}-${conCeros(dia, 2)}`;
};

/**
 * Hora de pared tal como la teclea una persona en un formulario. No es un
 * instante: `2026-04-05 02:00` puede no existir o existir dos veces.
 */
export type HoraDeNegocio = {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
};

/**
 * Convierte una hora de pared de la zona de negocio en el instante UTC que le
 * corresponde. Es la direccion que necesita el formulario de convocatoria: el
 * administrador escribe "publicar el 10 de septiembre a las 08:00" pensando en
 * hora de Mexico, y lo que se persiste es UTC.
 *
 * Devuelve `undefined` si esa hora de pared **no existe** — el salto de
 * primavera se lleva una hora completa del calendario. Devolver el instante
 * mas cercano seria adivinar por el usuario una fecha de publicacion que no
 * pidio; es preferible que el formulario lo rechace.
 *
 * En una hora **repetida** (retroceso de otono) devuelve la primera de las dos
 * ocurrencias, la que aun esta en horario de verano. Cualquiera de las dos es
 * defendible; se elige la primera por ser la que respeta "no antes de lo que
 * el usuario pidio".
 */
export const instanteDesdeHoraDeNegocio = (
  pared: HoraDeNegocio,
): Date | undefined => {
  const comoSiFueraUtc = Date.UTC(
    pared.anio,
    pared.mes - 1,
    pared.dia,
    pared.hora,
    pared.minuto,
    0,
  );

  // Dos pasadas. La primera usa el desplazamiento vigente en el instante
  // equivocado (el de la hora de pared leida como UTC); la segunda lo recalcula
  // ya sobre el candidato, que es lo que corrige los dias de cambio de horario.
  const primera = new Date(
    comoSiFueraUtc - desplazamientoEnMinutos(new Date(comoSiFueraUtc)) * 60_000,
  );
  const candidato = new Date(
    comoSiFueraUtc - desplazamientoEnMinutos(primera) * 60_000,
  );

  // Verificacion en vez de confianza: si el candidato no vuelve a producir la
  // hora de pared pedida, esa hora no existe en el calendario local.
  const verificacion = partesEnZonaDeNegocio(candidato);
  const coincide =
    verificacion.anio === pared.anio &&
    verificacion.mes === pared.mes &&
    verificacion.dia === pared.dia &&
    verificacion.hora === pared.hora &&
    verificacion.minuto === pared.minuto;

  return coincide ? candidato : undefined;
};

const FORMATEADOR_FECHA_HORA = new Intl.DateTimeFormat("es-MX", {
  timeZone: ZONA_HORARIA_NEGOCIO,
  dateStyle: "medium",
  timeStyle: "short",
});

const FORMATEADOR_FECHA = new Intl.DateTimeFormat("es-MX", {
  timeZone: ZONA_HORARIA_NEGOCIO,
  dateStyle: "medium",
});

/**
 * Presentacion. El unico lugar donde una fecha deja de ser UTC.
 *
 * No se prueba la cadena exacta: depende de la version de ICU y afirmarla
 * volveria fragil la compuerta. Lo que si se prueba es que el instante cae en
 * el dia y la hora de negocio correctos, con `partesEnZonaDeNegocio`.
 */
export const formatearFechaHora = (instante: Date): string =>
  FORMATEADOR_FECHA_HORA.format(instante);

export const formatearFecha = (instante: Date): string =>
  FORMATEADOR_FECHA.format(instante);

// --- Campos `datetime-local` -----------------------------------------------
//
// Un `<input type="datetime-local">` no tiene zona: entrega `YYYY-MM-DDTHH:mm`
// y el navegador lo pinta con **la hora del reloj de quien captura**. Estas dos
// funciones son la frontera que convierte ese texto sin zona en el instante que
// corresponde en hora de negocio, y de vuelta.
//
// Sin ellas, un administrador en Tijuana capturando "08:00" guardaria un
// instante distinto que uno en Ciudad de Mexico capturando lo mismo, para un
// dato que decide cuando abre una venta.

// Los segundos son opcionales: `TimeInput` entrega `HH:mm`, pero un navegador
// con `step` en segundos puede anadir `:ss`. Se aceptan y se descartan — una
// ventana de venta no se decide por segundos.
const CAMPO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;

/**
 * Interpreta el valor de un `datetime-local` **como hora de negocio**.
 *
 * Devuelve `undefined` si el texto no tiene la forma esperada o si esa hora de
 * pared no existe —el salto de primavera se lleva una hora del calendario—, y
 * en ese caso el formulario debe rechazarla en vez de adivinar cual quiso decir.
 */
export const desdeCampoLocal = (valor: string): Date | undefined => {
  const partes = CAMPO_LOCAL.exec(valor.trim());
  if (!partes) return undefined;

  const [, anio, mes, dia, hora, minuto] = partes;
  return instanteDesdeHoraDeNegocio({
    anio: Number(anio),
    mes: Number(mes),
    dia: Number(dia),
    hora: Number(hora),
    minuto: Number(minuto),
  });
};

/**
 * El valor con el que se rellena un `datetime-local` al editar: la hora de
 * pared **de negocio** que corresponde a ese instante.
 */
export const aCampoLocal = (instante: Date): string => {
  const { anio, mes, dia, hora, minuto } = partesEnZonaDeNegocio(instante);
  return (
    `${conCeros(anio, 4)}-${conCeros(mes, 2)}-${conCeros(dia, 2)}` +
    `T${conCeros(hora, 2)}:${conCeros(minuto, 2)}`
  );
};

const MINUTO_EN_MS = 60_000;
const HORA_EN_MS = 60 * MINUTO_EN_MS;
const DIA_EN_MS = 24 * HORA_EN_MS;

/**
 * Cuanto lleva esperando algo, en palabras: "hace 3 dias", "hace 2 horas".
 *
 * **La unidad se elige por magnitud.** "Hace 0 dias" no le dice nada a quien
 * revisa una bandeja por antiguedad, y "hace 73 horas" obliga a dividir de
 * cabeza; la unidad util cambia con el tamano del intervalo.
 *
 * Se calcula **en el servidor** y con el instante como argumento. Dejarselo al
 * navegador mostraria una espera distinta a cada persona segun su reloj, para un
 * dato con el que se decide a que atender primero.
 *
 * Un instante en el futuro —una convocatoria con la fecha mal capturada— da un
 * intervalo negativo, y `Intl` lo dice tal cual ("dentro de 2 horas") en vez de
 * fingir que ya paso.
 *
 * **`numeric: "always"` y no `"auto"`.** Con `"auto"`, `Intl` sustituye los
 * intervalos de uno por palabras de calendario —"ayer", "hoy"— que afirman algo
 * que este calculo nunca comprobo: son milisegundos transcurridos, no dias del
 * calendario. Algo de hace 47 horas trunca a un dia y saldria como "ayer"
 * cuando en la pared fue anteayer.
 */
export const formatearEspera = (
  desde: Date,
  ahora: Date,
  idioma: string,
): string => {
  const relativo = new Intl.RelativeTimeFormat(idioma, { numeric: "always" });
  const transcurrido = ahora.getTime() - desde.getTime();

  if (Math.abs(transcurrido) >= DIA_EN_MS) {
    return relativo.format(-Math.trunc(transcurrido / DIA_EN_MS), "day");
  }
  if (Math.abs(transcurrido) >= HORA_EN_MS) {
    return relativo.format(-Math.trunc(transcurrido / HORA_EN_MS), "hour");
  }
  return relativo.format(-Math.trunc(transcurrido / MINUTO_EN_MS), "minute");
};

/**
 * Cuenta regresiva a un instante futuro, en dias y horas o en horas y minutos.
 *
 * **Solo dos unidades**, las mas significativas: "2 d 4 h" o "4 h 30 min", no
 * "2 d 4 h 12 min 5 s". Es una cuenta regresiva de pantalla, no un cronometro;
 * mostrar el segundo obligaria a decrementarla cada segundo tambien en la
 * pared del reloj y no aporta nada que el participante vaya a actuar sobre eso.
 *
 * El formato de cada unidad sale de `Intl`, igual que `formatearPrecio` y
 * `formatearEspera`: no hay una palabra en espanol ni en ingles escrita a mano
 * en este archivo. Recibe **segundos ya calculados** y no dos `Date`, porque
 * quien la llama es un componente cliente que decrementa un contador propio
 * (regla de UX: "el cliente solo decrementa"; el servidor decide con su propio
 * reloj cuando la venta abre de verdad).
 */
export const formatearCuentaRegresiva = (
  segundosRestantes: number,
  idioma: string,
): string => {
  const segundos = Math.max(0, Math.trunc(segundosRestantes));
  const dias = Math.floor(segundos / 86_400);
  const horas = Math.floor((segundos % 86_400) / 3_600);
  const minutos = Math.floor((segundos % 3_600) / 60);

  const unidad = (valor: number, unit: "day" | "hour" | "minute"): string =>
    new Intl.NumberFormat(idioma, {
      style: "unit",
      unit,
      unitDisplay: "short",
    }).format(valor);

  if (dias > 0) return `${unidad(dias, "day")} ${unidad(horas, "hour")}`;
  if (horas > 0) return `${unidad(horas, "hour")} ${unidad(minutos, "minute")}`;
  return unidad(minutos, "minute");
};
