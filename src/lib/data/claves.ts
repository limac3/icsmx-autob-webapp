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
   * Centinela de adjudicacion activa — R-09. **Este centinela, y no el estado
   * `CONGELADA`, es lo que garantiza una sola adjudicacion por participante**
   * (modelo-datos 4.3).
   */
  centinelaAdjudicacion: (participanteId: string): Clave => ({
    PK: `PART#${exigirIdentificador(participanteId, "participanteId")}`,
    SK: "ADJUDICACION_ACTIVA",
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
    PK: `AUDIT#${agregado}#${exigirIdentificador(agregadoId, "agregadoId")}`,
    SK: `${exigirIdentificador(ocurridoEn, "ocurridoEn")}#${exigirIdentificador(eventoId, "eventoId")}`,
  }),

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

  /** PA-13 — bitacora cronologica global. `dia` viene de `diaDeNegocio`. */
  bitacoraDelDia: (
    dia: string,
    ocurridoEn: string,
    eventoId: string,
  ): { GSI2PK: string; GSI2SK: string } => ({
    GSI2PK: `AUDIT#${exigirIdentificador(dia, "dia")}`,
    GSI2SK: `${exigirIdentificador(ocurridoEn, "ocurridoEn")}#${exigirIdentificador(eventoId, "eventoId")}`,
  }),
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

export const NOMBRES_DE_INDICE = {
  identidadAlterna: "GSI1",
  porEstatus: "GSI2",
  porParticipante: "GSI3",
  trabajoPendiente: "GSI4",
} as const;
