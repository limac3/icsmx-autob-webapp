// Fuente: agent_files/modelo-datos-dynamodb.md secciones 2 y 3.
//
// Constructores de `PK`/`SK` y de las claves de los cuatro GSIs. Ningun otro
// archivo arma una clave concatenando cadenas: es el unico modo de que la
// forma de una clave sea una propiedad del sistema y no una convencion que
// hay que recordar en quince lugares.
//
// Modulo puro. No importa el cliente de DynamoDB ni hace I/O, asi que se
// prueba sin red y sin AWS.

/** Par de claves de la tabla base. */
export type Clave = { PK: string; SK: string };

/**
 * Prefijo de la particion de todo evento de auditoria.
 *
 * **Es la unica fuente de verdad del prefijo, y por una razon de seguridad.**
 * La inmutabilidad de la bitacora la sostiene un `Deny` de IAM condicionado a
 * `dynamodb:LeadingKeys = "AUDIT#*"` (`amplify/permisos.ts`), asi que si esta
 * clave y esa condicion se separaran, el `Deny` dejaria de aplicar **en
 * silencio**: nada fallaria y la bitacora pasaria a ser modificable. Por eso
 * `permisos.ts` construye su condicion importando esta constante, y no
 * repitiendo el literal: no pueden divergir porque son el mismo valor.
 */
export const PREFIJO_PARTICION_AUDITORIA = "AUDIT#";

/**
 * Ambitos de unicidad de los identificadores que teclea una persona.
 *
 * Uno por pregunta distinta, y **no uno compartido**: si el folio de una
 * convocatoria y el numero economico de un vehiculo cayeran en el mismo ambito,
 * un folio `A-1` impediria registrar el vehiculo `A-1`. Son universos separados
 * porque nombran cosas separadas.
 */
export const AMBITOS_DE_IDENTIFICADOR = {
  folioDeConvocatoria: "FOLIO_CONV",
  numeroEconomicoDeVehiculo: "NUMECO_VEH",
  numeroDeSerieDeVehiculo: "SERIE_VEH",
} as const;

export type AmbitoDeIdentificador =
  (typeof AMBITOS_DE_IDENTIFICADOR)[keyof typeof AMBITOS_DE_IDENTIFICADOR];

/**
 * Los identificadores son ULIDs propios y nunca contienen `#`, que es el
 * separador de todas las claves. Verificarlo no es paranoia gratuita: un `#`
 * dentro de un identificador desplazaria el resto de la clave y podria
 * fabricar el centinela de otro participante. Es una invariante estructural,
 * asi que se rompe fuerte en vez de devolver un resultado.
 */
const exigirIdentificador = (valor: string, campo: string): string => {
  if (valor.length === 0) {
    throw new RangeError(`${campo} no puede estar vacio`);
  }
  if (valor.includes("#")) {
    throw new RangeError(
      `${campo} no puede contener "#": es el separador de las claves`,
    );
  }
  return valor;
};

/**
 * Ancho del relleno de ceros del turno. **Diez digitos son la garantia de
 * orden del sistema entero** (decision D-5).
 *
 * Con `SOL#<turno:010d>`, un `Query` con `ScanIndexForward: true` devuelve la
 * fila ya ordenada por turno. No existe ningun punto del codigo donde se pueda
 * ordenar la fila mal, porque nunca se ordena: se lee ordenada. Diez digitos
 * soportan mil millones de solicitudes por lote.
 */
export const ANCHO_TURNO = 10;

/** Ancho del relleno del orden de una fotografia. */
export const ANCHO_ORDEN_FOTO = 4;

const conCeros = (valor: number, ancho: number, campo: string): string => {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new RangeError(
      `${campo} debe ser un entero no negativo, no ${valor}`,
    );
  }
  const texto = String(valor);
  if (texto.length > ancho) {
    // Desbordar el relleno rompe la comparacion lexicografica sin ningun
    // sintoma visible: el turno 10_000_000_000 se ordenaria antes que el 2.
    // El orden de la fila es la promesa central del sistema (R-08), asi que
    // esto no puede degradar en silencio.
    throw new RangeError(
      `${campo} = ${valor} excede ${ancho} digitos y romperia el orden de la clave`,
    );
  }
  return texto.padStart(ancho, "0");
};

// --- Tabla base -------------------------------------------------------------

export const clave = {
  participante: (participanteId: string): Clave => ({
    PK: `PART#${exigirIdentificador(participanteId, "participanteId")}`,
    SK: "PERFIL",
  }),

  vehiculo: (vehiculoId: string): Clave => ({
    PK: `VEH#${exigirIdentificador(vehiculoId, "vehiculoId")}`,
    SK: "META",
  }),

  /**
   * Fotografia de un vehiculo. El orden va en la clave para que
   * `begins_with(SK, "FOTO#")` las devuelva ya ordenadas, sin ordenar en
   * memoria.
   */
  fotografia: (vehiculoId: string, orden: number, fotoId: string): Clave => ({
    PK: `VEH#${exigirIdentificador(vehiculoId, "vehiculoId")}`,
    SK: `FOTO#${conCeros(orden, ANCHO_ORDEN_FOTO, "orden")}#${exigirIdentificador(fotoId, "fotoId")}`,
  }),

  /**
   * Centinela de vehiculo activo — R-10.
   *
   * Se crea con `attribute_not_exists(SK)` al incluir el vehiculo en una
   * convocatoria, asi que un segundo intento de incluirlo en otra falla **en
   * la base de datos**, sin importar la concurrencia (modelo-datos 4.1).
   */
  centinelaVehiculoActivo: (vehiculoId: string): Clave => ({
    PK: `VEH#${exigirIdentificador(vehiculoId, "vehiculoId")}`,
    SK: "ACTIVO",
  }),

  convocatoria: (convocatoriaId: string): Clave => ({
    PK: `CONV#${exigirIdentificador(convocatoriaId, "convocatoriaId")}`,
    SK: "META",
  }),

  /**
   * Centinela de unicidad de un identificador de negocio — el folio de una
   * convocatoria, el numero economico o el numero de serie de un vehiculo.
   *
   * **Convierte "no puede haber dos" en una garantia de la base de datos.** Se
   * crea con `attribute_not_exists(PK)` dentro de la misma transaccion que la
   * entidad, asi que un segundo alta con el mismo valor falla **en DynamoDB**,
   * sin importar la concurrencia. Comprobarlo leyendo antes de escribir seria el
   * "leer y luego decidir" que prohibe la regla 6, y dos altas simultaneas
   * pasarian las dos.
   *
   * Su particion es el **valor**, no la entidad, porque es lo unico que dos
   * registros distintos comparten cuando estan duplicados. De ahi salen dos
   * propiedades gratis: es tambien el indice de busqueda —encontrar un vehiculo
   * por su numero economico es un `GetItem`— y el renombrado es atomico, con un
   * `Delete` del viejo y un `Put` del nuevo en una transaccion.
   *
   * El valor llega **ya normalizado** (`prepararIdentificadorDeNegocio`): en
   * mayusculas y recortado. Sin eso, `"ab-1"` y `"AB-1"` serian dos centinelas
   * distintos y el duplicado se colaria.
   */
  centinelaDeIdentificador: (
    ambito: AmbitoDeIdentificador,
    valorNormalizado: string,
  ): Clave => ({
    PK: `${ambito}#${exigirIdentificador(valorNormalizado, "identificadorDeNegocio")}`,
    SK: "CENTINELA",
  }),

  /**
   * Lote: un vehiculo dentro de una convocatoria concreta. Cuelga de la
   * convocatoria para que PA-04 la lea entera con sus lotes en una sola
   * `Query`.
   */
  lote: (convocatoriaId: string, loteId: string): Clave => ({
    PK: `CONV#${exigirIdentificador(convocatoriaId, "convocatoriaId")}`,
    SK: `LOTE#${exigirIdentificador(loteId, "loteId")}`,
  }),

  /**
   * Solicitud de compra. `solicitadoEn` **no participa en la clave**: es
   * imposible ordenar la fila por tiempo aunque alguien lo intente (R-08).
   */
  solicitud: (loteId: string, turno: number): Clave => ({
    PK: `LOTE#${exigirIdentificador(loteId, "loteId")}`,
    SK: `SOL#${conCeros(turno, ANCHO_TURNO, "turno")}`,
  }),

  /**
   * Centinela de fila — R-07. Impide dos solicitudes vivas del mismo
   * participante en el mismo lote, incluso ante un doble clic o dos pestanas.
   *
   * Sirve ademas de acceso directo (PA-08): "¿ya estoy en esta fila y en que
   * lugar?" es un `GetItem`, no un recorrido.
   */
  centinelaFila: (loteId: string, participanteId: string): Clave => ({
    PK: `LOTE#${exigirIdentificador(loteId, "loteId")}`,
    SK: `PART#${exigirIdentificador(participanteId, "participanteId")}`,
  }),

  /**
   * Reserva de turno — mecanismo de R18.
   *
   * Marca que un turno ya se entrego y su solicitud **todavia no es visible**
   * en la fila. Se crea antes de pedir el turno y se borra dentro de la misma
   * transaccion que hace visible la solicitud, asi que su presencia cubre la
   * ventana entera; la adjudicacion se abstiene mientras exista alguna.
   *
   * Es un item propio y no un atributo del lote **por concurrencia**: dentro de
   * una `TransactWriteItems`, escribir el item del lote hace que N solicitudes
   * simultaneas se cancelen entre si con `TransactionConflict`. Con un item por
   * intento no hay dos transacciones que toquen el mismo item.
   *
   * Vive en la particion del lote y ordena antes que `SOL#` y despues que
   * `PART#`, de modo que ninguna consulta existente de la fila la ve.
   */
  reservaDeTurno: (loteId: string, reservaId: string): Clave => ({
    PK: `LOTE#${exigirIdentificador(loteId, "loteId")}`,
    SK: `RESERVA#${exigirIdentificador(reservaId, "reservaId")}`,
  }),

  /**
   * Item de cupo de participacion — R-09 y R-22 (modelo-datos 4.3).
   *
   * Lleva los dos contadores de un participante **en una convocatoria**:
   * `solicitudesCreadas`, que solo crece y entrega el `ordenEnConvocatoria`, y
   * `cupoConsumido`, que sube al adjudicar y baja al perder la adjudicacion.
   *
   * **No es un centinela**, aunque sustituya a uno: un centinela existe o no
   * existe, y estos son contadores. Lo que si comparte con ellos es lo que
   * importa — convierte una regla de negocio en una garantia atomica, con la
   * condicion del propio `ADD`, sin leer antes de decidir (regla 6).
   *
   * **Solo lo escribe su propio participante**, asi que no es una particion
   * caliente compartida: es lo contrario del `ConditionCheck` sobre la
   * convocatoria que T1 tuvo que retirar por cancelar entre 5 y 7 de cada 10
   * solicitudes concurrentes.
   */
  cupoDeParticipante: (
    participanteId: string,
    convocatoriaId: string,
  ): Clave => ({
    PK: `PART#${exigirIdentificador(participanteId, "participanteId")}`,
    SK: `CUPO#${exigirIdentificador(convocatoriaId, "convocatoriaId")}`,
  }),

  /**
   * Evento de auditoria. Append-only: todo `Put` lleva ademas
   * `attribute_not_exists(PK)`, porque IAM no puede impedir la sobrescritura
   * (regla 5 de CLAUDE.md).
   *
   * `ocurridoEn` va primero en la `SK` para que la bitacora de un agregado se
   * lea en orden cronologico; `eventoId` la desempata cuando dos eventos
   * comparten milisegundo.
   */
  evento: (
    agregado: TipoDeAgregado,
    agregadoId: string,
    ocurridoEn: string,
    eventoId: string,
  ): Clave => ({
    PK: `${PREFIJO_PARTICION_AUDITORIA}${agregado}#${exigirIdentificador(agregadoId, "agregadoId")}`,
    SK: `${exigirIdentificador(ocurridoEn, "ocurridoEn")}#${exigirIdentificador(eventoId, "eventoId")}`,
  }),

  /**
   * Solo la particion de la bitacora de un agregado — PA-12. Existe por la
   * misma razon que `gsi2.particionDeEstatus`: para consultar la particion
   * entera sin inventar un `ocurridoEn` y un `eventoId` de relleno.
   */
  particionDeEvento: (
    agregado: TipoDeAgregado,
    agregadoId: string,
  ): { PK: string } => ({
    PK: `${PREFIJO_PARTICION_AUDITORIA}${agregado}#${exigirIdentificador(agregadoId, "agregadoId")}`,
  }),

  /**
   * Prefijo de **todas** las particiones de bitacora de un tipo de agregado,
   * para un `begins_with(PK, ...)`.
   *
   * Lo usa PA-13 cuando hay que acotar una lectura por dia a un solo tipo de
   * registro: el tipo vive en la `PK` de la tabla base y no en ningun atributo,
   * asi que es la unica forma de filtrarlo sin traer el dia entero. El `#`
   * final no es cosmetico — sin el, `VEHICULO` tambien casaria con un tipo
   * futuro que empezara igual.
   */
  prefijoDeParticionDeEvento: (agregado: TipoDeAgregado): string =>
    `${PREFIJO_PARTICION_AUDITORIA}${agregado}#`,

  mensaje: (mensajeId: string): Clave => ({
    PK: `OUTBOX#${exigirIdentificador(mensajeId, "mensajeId")}`,
    SK: "META",
  }),
} as const;

/** Agregados que llevan bitacora (trazabilidad-auditoria.md). */
export const TIPOS_DE_AGREGADO = [
  "VEHICULO",
  "CONVOCATORIA",
  "LOTE",
  "SOLICITUD",
] as const;

export type TipoDeAgregado = (typeof TIPOS_DE_AGREGADO)[number];

// --- Prefijos, para condiciones `begins_with` -------------------------------

export const PREFIJO = {
  fotografia: "FOTO#",
  lote: "LOTE#",
  solicitud: "SOL#",
  centinelaFila: "PART#",
  reservaDeTurno: "RESERVA#",
} as const;

/**
 * Turno a partir de la `SK` de una solicitud, o `undefined` si la clave no es
 * de una solicitud.
 *
 * Se lee de la clave y no del atributo `turno` a proposito: la clave es lo que
 * define el orden, asi que es la unica fuente que no puede desincronizarse.
 */
export const turnoDesdeClave = (sk: string): number | undefined => {
  if (!sk.startsWith(PREFIJO.solicitud)) return undefined;
  const digitos = sk.slice(PREFIJO.solicitud.length);
  if (digitos.length !== ANCHO_TURNO || !/^\d+$/.test(digitos))
    return undefined;
  return Number(digitos);
};

/**
 * Identificador de negocio de una solicitud: `<loteId>-<turno>`.
 *
 * No es una clave, pero vive aqui por la misma razon que ellas: **es el
 * `agregadoId` de la bitacora** (`AUDIT#SOLICITUD#<solicitudId>`), asi que no
 * puede contener `#` y su forma tiene que ser una sola en todo el sistema. Un
 * evento anclado a un identificador distinto del que usa la pantalla deja la
 * historia de esa solicitud partida en dos, y como la bitacora es append-only,
 * partida para siempre.
 *
 * Se **deriva** del lote y del turno en vez de generarse: los dos ya
 * identifican la solicitud sin ambiguedad —hay un solo turno por lote (D-5)— y
 * un identificador derivado no puede desincronizarse de su clave.
 */
export const identificadorDeSolicitud = (
  loteId: string,
  turno: number,
): string =>
  `${exigirIdentificador(loteId, "loteId")}-${String(
    conCerosVerificado(turno),
  )}`;

/** El turno de un identificador de solicitud debe ser un entero no negativo. */
const conCerosVerificado = (turno: number): number => {
  if (!Number.isInteger(turno) || turno < 0) {
    throw new RangeError(`turno debe ser un entero no negativo, no ${turno}`);
  }
  return turno;
};

/**
 * Inverso exacto de `identificadorDeSolicitud`: recupera `loteId` y `turno`
 * del identificador de negocio, o `undefined` si no tiene esa forma.
 *
 * Lo necesita tesoreria (`subirComprobante`, `avalarPago`, `rechazarPago`):
 * `api-contracts.md` les entrega solo `solicitudId`, y no hay ningun patron
 * de acceso que lea una solicitud sin conocer de antemano su `loteId`. En vez
 * de inventar un indice nuevo, se recupera del identificador mismo — es
 * exactamente la garantia que documenta `identificadorDeSolicitud`: los dos
 * componentes ya identifican la solicitud sin ambiguedad.
 *
 * Se divide por el **ultimo** `-`: un `loteId` real es un ULID (alfabeto de
 * Crockford, sin guion), asi que el separador nunca es ambiguo. `turno` viaja
 * sin relleno de ceros en el identificador (a diferencia de la `SK` de la
 * tabla base), asi que se exige que sean solo digitos.
 */
export const loteYTurnoDesdeIdentificador = (
  solicitudId: string,
): { loteId: string; turno: number } | undefined => {
  const indice = solicitudId.lastIndexOf("-");
  if (indice <= 0) return undefined;

  const loteId = solicitudId.slice(0, indice);
  const turnoTexto = solicitudId.slice(indice + 1);
  if (!/^\d+$/.test(turnoTexto)) return undefined;

  return { loteId, turno: Number(turnoTexto) };
};

// --- Indices secundarios ----------------------------------------------------

/** GSI1 — identidad alterna. PA-01: `oktaSub` -> `participanteId`. */
export const gsi1 = {
  participantePorOkta: (
    oktaSub: string,
  ): { GSI1PK: string; GSI1SK: string } => ({
    // El `sub` de Okta lo emite el proveedor y no es un ULID nuestro: puede
    // traer cualquier caracter, `#` incluido. Se codifica en lugar de
    // rechazarse, porque no esta en nuestras manos cambiarlo.
    GSI1PK: `OKTA#${encodeURIComponent(oktaSub)}`,
    GSI1SK: "PERFIL",
  }),
} as const;

/**
 * GSI2 — listados por estatus. Un solo indice para cinco accesos sobre
 * entidades distintas (PA-03, PA-05, PA-06, PA-11, PA-13).
 */
export const gsi2 = {
  /**
   * `<TIPO>_ESTATUS#<estatus>` con `<fecha>#<id>` de ordenamiento.
   *
   * En PA-05 la fecha es `publicadaEn`, y por eso el gating triple es una
   * consulta y no un filtro: `GSI2SK <= ahora` aplica la segunda condicion de
   * R-01 **dentro** de la lectura. Lo que no se recupera no puede filtrarse
   * mal despues.
   */
  porEstatus: (
    tipo: "VEH" | "CONV" | "SOL",
    estatus: string,
    fecha: string,
    id: string,
  ): { GSI2PK: string; GSI2SK: string } => ({
    GSI2PK: `${tipo}_ESTATUS#${exigirIdentificador(estatus, "estatus")}`,
    GSI2SK: `${exigirIdentificador(fecha, "fecha")}#${exigirIdentificador(id, "id")}`,
  }),

  /**
   * Solo la particion, para consultar un estatus entero (PA-03, PA-06, PA-11).
   *
   * Existe para que quien consulta no tenga que inventar una fecha y un
   * identificador de relleno solo para quedarse con la `GSI2PK`. Ese atajo
   * ademas no funciona: `porEstatus` rechaza los valores vacios, precisamente
   * para que nadie construya una clave a medias.
   */
  particionDeEstatus: (
    tipo: "VEH" | "CONV" | "SOL",
    estatus: string,
  ): { GSI2PK: string } => ({
    GSI2PK: `${tipo}_ESTATUS#${exigirIdentificador(estatus, "estatus")}`,
  }),

  /**
   * Cota superior para PA-05: el mayor `GSI2SK` posible con fecha `<= fecha`.
   *
   * `GSI2SK` es `<fecha>#<id>`, asi que comparar `GSI2SK <= fecha` a secas
   * excluiria por error los items publicados en el mismo instante:
   * `"...Z#01AB" <= "...Z"` es falso, porque la cadena con sufijo ordena
   * despues que su propio prefijo. El sufijo agregado es U+FFFF, mayor que
   * cualquier caracter del alfabeto de ULID (Crockford: digitos y mayusculas
   * sin I/L/O/U, todo por debajo de `Z`), asi que ningun id real lo alcanza
   * y la comparacion queda inclusiva en la fecha, tal como exige R-01.
   */
  cotaSuperiorPorFecha: (fecha: string): string =>
    `${exigirIdentificador(fecha, "fecha")}#${String.fromCharCode(0xffff)}`,
} as const;

/** GSI3 — por participante. PA-09: mis solicitudes. */
export const gsi3 = {
  solicitudDeParticipante: (
    participanteId: string,
    solicitadoEn: string,
    loteId: string,
  ): { GSI3PK: string; GSI3SK: string } => ({
    GSI3PK: `PART#${exigirIdentificador(participanteId, "participanteId")}`,
    // Aqui `solicitadoEn` si ordena, y es correcto: esta lista es "mis
    // solicitudes por fecha", una vista personal. El orden de la **fila**, que
    // es lo que R-08 protege, sigue viniendo del turno en la tabla base.
    GSI3SK: `SOL#${exigirIdentificador(solicitadoEn, "solicitadoEn")}#${exigirIdentificador(loteId, "loteId")}`,
  }),
} as const;

/**
 * GSI4 — trabajo pendiente. **Disperso a proposito**: sus claves solo existen
 * mientras el item requiere atencion, asi que el indice contiene exactamente
 * el trabajo pendiente y el barrido no filtra nada.
 *
 * Subir el comprobante las elimina: es la implementacion literal de "una vez
 * en verificacion, el plazo deja de correr". La demora de tesoreria no puede
 * vencer al participante porque el item deja de ser visible para el barrido.
 */
export const gsi4 = {
  /**
   * PA-10 — adjudicaciones por vencer. La particion se reparte **por dia** y
   * no por una clave fija: con una sola clave, todo el trabajo pendiente del
   * sistema caeria en una particion (riesgo R12).
   *
   * `dia` se calcula con `diaDeNegocio` de `src/lib/domain/fechas.ts`, en hora
   * de Mexico. El barrido recorre varios dias por diseno (runbooks R-1), asi
   * que la frontera del dia no es un punto de correccion.
   */
  vencimiento: (
    dia: string,
    venceEn: string,
  ): { GSI4PK: string; GSI4SK: string } => ({
    GSI4PK: `VENCE#${exigirIdentificador(dia, "dia")}`,
    GSI4SK: exigirIdentificador(venceEn, "venceEn"),
  }),

  /** PA-14 — correos pendientes. */
  outboxPendiente: (creadoEn: string): { GSI4PK: string; GSI4SK: string } => ({
    GSI4PK: "OUTBOX_PENDIENTE",
    GSI4SK: exigirIdentificador(creadoEn, "creadoEn"),
  }),
} as const;

/**
 * GSI5 a GSI9 — la bitacora, uno por pregunta del auditor.
 *
 * **Las claves llevan nombre semantico y no `GSI5PK`**, a diferencia de los
 * cuatro indices anteriores. La convencion generica esta justificada donde el
 * indice esta sobrecargado —GSI2 sirve cinco entidades distintas—, pero estos
 * cinco tienen un solo proposito cada uno, y el nombre hace evidente la
 * propiedad que sostiene el diseno: **un vehiculo no tiene `mesPK`, asi que no
 * esta en ese indice**. Los GSIs son dispersos, de modo que los items de
 * negocio no pagan ninguna escritura por estos cinco.
 *
 * `mesPK`, `diaPK` y `actorMesPK` reparten la escritura; `cronoSK`,
 * `agregadoSK` y `actorSK` deciden que se puede acotar como condicion de clave
 * en vez de filtrar en memoria. Un mismo atributo sirve a varios indices a la
 * vez —`cronoSK` a tres, `diaPK` a dos—, que es lo que mantiene el item de
 * evento por debajo del minimo facturable de 1 KB.
 */
/**
 * `<ocurridoEn>#<eventoId>` — el mismo valor que la `SK` de la tabla base.
 *
 * Se repite como atributo propio porque tres indices lo necesitan de clave de
 * ordenamiento, y un GSI no puede usar la `SK` de la tabla base como suya. Que
 * coincidan no es casualidad: los dos ordenan por instante y desempatan por
 * identificador, que es la unica forma de que la bitacora se lea siempre igual.
 */
const cronoSK = (ocurridoEn: string, eventoId: string): string =>
  `${exigirIdentificador(ocurridoEn, "ocurridoEn")}#${exigirIdentificador(eventoId, "eventoId")}`;

const diaPK = (dia: string): string => `DIA#${exigirIdentificador(dia, "dia")}`;

export const bitacora = {
  /**
   * `mesPK` y `cronoSK` — **atributos sin indice**, escritos a proposito.
   *
   * Iban a ser la clave de un GSI5 cronologico que se borro por no tener
   * lector: la pantalla exige al menos un criterio y los tres tienen su propio
   * indice, asi que nadie pregunta por el rango a secas.
   *
   * Se siguen escribiendo porque **lo irreversible son los atributos, no los
   * indices**. A un evento append-only no se le pueden agregar despues —IAM
   * deniega `UpdateItem` y `attribute_not_exists(PK)` rechaza un `Put` de
   * reemplazo—, asi que un atributo que hoy no se escribe es una pregunta que
   * nunca se podra responder sobre los eventos de hoy. El indice se crea cuando
   * aparezca el lector, y su relleno vera todo lo ya escrito.
   *
   * `cronoSK` **si** se usa: es la clave de ordenamiento de GSI6 y GSI9.
   */
  cronologico: (
    mes: string,
    ocurridoEn: string,
    eventoId: string,
  ): { mesPK: string; cronoSK: string } => ({
    mesPK: `MES#${exigirIdentificador(mes, "mes")}`,
    cronoSK: cronoSK(ocurridoEn, eventoId),
  }),

  /** GSI6 — un tipo de evento en el rango. El mes acota la particion. */
  porTipoDeEvento: (tipo: string, mes: string): { tipoPK: string } => ({
    tipoPK: `TIPO#${exigirIdentificador(tipo, "tipo")}#${exigirIdentificador(mes, "mes")}`,
  }),

  /**
   * GSI7 — los agregados con actividad en un dia.
   *
   * `agregadoSK` agrupa **por valor antes que por tiempo**, y eso es
   * deliberado: es lo que permite obtener los identificadores distintos de un
   * dia saltando de grupo en grupo con `ExclusiveStartKey`, en vez de leer
   * todos sus eventos. `diaPK` y no `mesPK` porque una opcion "activa en el mes
   * pero no en el rango" devolveria una tabla vacia, y evitar eso es la razon
   * de existir de esas listas.
   */
  porAgregadoDelDia: (
    dia: string,
    agregado: TipoDeAgregado,
    agregadoId: string,
    ocurridoEn: string,
    eventoId: string,
  ): { diaPK: string; agregadoSK: string } => ({
    diaPK: diaPK(dia),
    agregadoSK: `${agregado}#${exigirIdentificador(agregadoId, "agregadoId")}#${cronoSK(ocurridoEn, eventoId)}`,
  }),

  /** GSI8 — las personas con actividad en un dia. Mismo salto que GSI7. */
  porActorDelDia: (
    dia: string,
    actorId: string,
    ocurridoEn: string,
    eventoId: string,
  ): { diaPK: string; actorSK: string } => ({
    diaPK: diaPK(dia),
    actorSK: `ACTOR#${exigirIdentificador(actorId, "actorId")}#${cronoSK(ocurridoEn, eventoId)}`,
  }),

  /**
   * GSI9 — lo que una persona firmo, con el rango en la clave de ordenamiento.
   *
   * Por mes y no por dia: con un rango de 90 dias, la version por dia costaria
   * hasta 90 `Query` y esta cuesta 1-4. Aqui el mes no arriesga nada, porque el
   * rango se acota con `cronoSK` dentro de la particion.
   */
  porActor: (actorId: string, mes: string): { actorMesPK: string } => ({
    actorMesPK: `ACTOR#${exigirIdentificador(actorId, "actorId")}#${exigirIdentificador(mes, "mes")}`,
  }),

  /** Prefijo de un agregado dentro de `agregadoSK`, para el salto de GSI7. */
  prefijoDeAgregado: (agregado: TipoDeAgregado): string => `${agregado}#`,

  /** Prefijo de una persona dentro de `actorSK`, para el salto de GSI8. */
  prefijoDeActor: (actorId: string): string =>
    `ACTOR#${exigirIdentificador(actorId, "actorId")}#`,

  // --- Las particiones, para leer ------------------------------------------
  //
  // Los constructores de arriba arman la clave **completa** de un evento que se
  // escribe; estos arman solo la particion que un lector consulta. Van en el
  // mismo objeto y no en cada servicio por la misma razon que
  // `gsi2.particionDeEstatus`: si un lector concatenara su propia particion,
  // cambiar el prefijo de escritura dejaria de romper la compilacion y pasaria
  // a devolver **cero resultados en silencio**, que es la peor forma de fallar
  // que tiene una bitacora.

  /** GSI6 — un tipo de evento en un mes. */
  particionDeTipo: (tipo: string, mes: string): { tipoPK: string } => ({
    tipoPK: `TIPO#${exigirIdentificador(tipo, "tipo")}#${exigirIdentificador(mes, "mes")}`,
  }),

  /** GSI7 y GSI8 — un dia. Las dos comparten particion y difieren en la `SK`. */
  particionDelDia: (dia: string): { diaPK: string } => ({ diaPK: diaPK(dia) }),

  /** GSI9 — lo que una persona firmo en un mes. */
  particionDeActor: (actorId: string, mes: string): { actorMesPK: string } => ({
    actorMesPK: `ACTOR#${exigirIdentificador(actorId, "actorId")}#${exigirIdentificador(mes, "mes")}`,
  }),

  /**
   * Cota del grupo de un agregado, para saltarlo con `ExclusiveStartKey`.
   *
   * `"LOTE#<id>"` ordena **estrictamente antes** que `"LOTE#<id>#<crono>"`
   * —cualquier cadena ordena antes que ella misma con sufijo—, asi que en una
   * lectura descendente esta cota deja atras el grupo entero. Es lo que permite
   * enumerar los identificadores distintos de un dia con una consulta por
   * valor, en vez de leer todos sus eventos. Verificado contra DynamoDB real:
   * 10 lotes distintos en 11 consultas, contra 110 eventos sin el salto.
   */
  cotaDeGrupoDeAgregado: (
    agregado: TipoDeAgregado,
    agregadoId: string,
  ): string => `${agregado}#${exigirIdentificador(agregadoId, "agregadoId")}`,

  /** Lo mismo para el grupo de una persona en `actorSK`. */
  cotaDeGrupoDeActor: (actorId: string): string =>
    `ACTOR#${exigirIdentificador(actorId, "actorId")}`,
} as const;

/**
 * Compara dos claves **como las compara DynamoDB**: por punto de codigo.
 *
 * Existe porque `String.prototype.localeCompare` no sirve para esto y lo
 * parece. Usa la colacion del idioma: ignora diferencias de mayusculas, trata
 * la puntuacion aparte y puede invertir el orden de dos claves respecto del
 * byte a byte que hace la tabla. Cualquier ordenamiento en memoria que afirme
 * reproducir el orden de una `SK` —para unir dos lecturas, o para reordenar una
 * particion que el indice entrego agrupada— tiene que usar esta, o el auditor
 * vera un orden que la tabla no tiene.
 *
 * Se descubrio en el simulador de indice de `valoresConActividad.test.ts`, que
 * con `localeCompare` se contradecia con su propio cursor y perdia valores.
 */
export const comparandoClaves = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export const NOMBRES_DE_INDICE = {
  identidadAlterna: "GSI1",
  porEstatus: "GSI2",
  porParticipante: "GSI3",
  trabajoPendiente: "GSI4",
  porTipoDeEvento: "GSI6",
  porAgregadoDelDia: "GSI7",
  porActorDelDia: "GSI8",
  porActor: "GSI9",
} as const;
