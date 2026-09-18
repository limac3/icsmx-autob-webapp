// Fuente: agent_files/proyecto.md secciones 4.1 y 5.2.

/**
 * Estatus del vehiculo.
 *
 * `VENDIDO` es terminal. `DISPONIBLE` es el estado que habilita la reoferta
 * (R-11): al concluir una convocatoria, lo no vendido vuelve aqui y un
 * administrador puede incluirlo en otra — decision explicita, nunca
 * automatica.
 *
 * `RESERVADO` refleja que el lote del vehiculo esta adjudicado y su
 * participante tiene un plazo corriendo.
 */
export type EstatusVehiculo =
  "DISPONIBLE" | "EN_CONVOCATORIA" | "RESERVADO" | "VENDIDO" | "RETIRADO";

export const ESTATUS_VEHICULO = [
  "DISPONIBLE",
  "EN_CONVOCATORIA",
  "RESERVADO",
  "VENDIDO",
  "RETIRADO",
] as const satisfies readonly EstatusVehiculo[];

/**
 * Datos que captura un administrador.
 *
 * No incluye `estatus` ni fotografias: el estatus lo mueve la maquina de
 * estados y las fotografias tienen sus propias acciones (`api-contracts.md`
 * seccion 2). Las reglas de validacion viven en `src/lib/domain/vehiculos.ts`.
 */
export type DatosVehiculo = {
  /**
   * Numero economico: la etiqueta con la que la organizacion identifica el
   * activo. **Lo teclea el operador y es unico**, garantizado por un centinela
   * (`clave.centinelaDeIdentificador`).
   *
   * No es la clave del item ni el ancla de la bitacora — eso sigue siendo el
   * `vehiculoId` interno—, y por eso **se puede corregir** sin partir la
   * historia. Misma division que D-15 para `participanteId`.
   */
  numeroEconomico: string;
  /** Numero de serie del fabricante. Tambien unico, con su propio centinela. */
  numeroDeSerie: string;
  marca: string;
  version: string;
  /** Anio del modelo, no una fecha. */
  modelo: number;
  kilometraje: number;
  nivelEquipamiento?: string;
  especificacionMecanica?: string;
  condicionesMecanicas?: string;
  detallesEsteticos?: string;
};

/** Campos de `DatosVehiculo`, para recorrerlos sin escribirlos dos veces. */
export const CAMPOS_VEHICULO = [
  "numeroEconomico",
  "numeroDeSerie",
  "marca",
  "version",
  "modelo",
  "kilometraje",
  "nivelEquipamiento",
  "especificacionMecanica",
  "condicionesMecanicas",
  "detallesEsteticos",
] as const satisfies readonly (keyof DatosVehiculo)[];

/** El registro completo, tal como vive en `VEH#<id> / META`. */
export type Vehiculo = DatosVehiculo & {
  vehiculoId: string;
  estatus: EstatusVehiculo;
  creadoEn: string;
  creadoPor: string;
  actualizadoEn: string;
  actualizadoPor: string;
  /**
   * Fotografia que representa al vehiculo en listados y tarjetas. Se conserva
   * en el item del vehiculo —y no como un atributo de la fotografia— para que
   * el listado no tenga que leer la galeria de cada uno.
   */
  fotografiaPrincipalId?: string;
  /** Convocatoria activa, mientras el vehiculo esta `EN_CONVOCATORIA`. */
  convocatoriaId?: string;
  motivoRetiro?: string;
};

/**
 * Anchos de las tres variantes que se generan al subir una fotografia, y a que
 * superficie sirve cada una.
 *
 * Calculados contra el CSS y contra los componentes de Eden:
 *
 * - `min` (480): la tira de `MediaThumbnailGallery`, que dibuja 100x100 px, y
 *   la celda de la galeria de administracion, de 14 a 21 rem.
 * - `med` (1280): la tarjeta del catalogo en telefono, donde `eden-grid` le da
 *   el ancho completo (una columna en movil), y el visor ampliado en telefono.
 * - `max` (2048): la tarjeta del catalogo en escritorio y el visor ampliado.
 *
 * **Viven aqui y no junto al normalizador** a proposito: ese modulo importa
 * `sharp`, y los componentes que consumen `Fotografia` son de cliente. Un
 * `import` en esa direccion arrastraria una dependencia nativa al navegador.
 */
export const ANCHOS_DE_VARIANTE = {
  min: 480,
  med: 1280,
  max: 2048,
} as const;

export type NombreDeVariante = keyof typeof ANCHOS_DE_VARIANTE;

/** Del mas chico al mas grande, que es el orden que pide un `srcSet`. */
export const NOMBRES_DE_VARIANTE = [
  "min",
  "med",
  "max",
] as const satisfies readonly NombreDeVariante[];

/** Una variante renderizable de una fotografia. */
export type VarianteImagen = {
  /** Ruta en S3. **Nunca** una URL firmada. */
  claveS3: string;
  /**
   * Medidos, no derivados de `ANCHOS_DE_VARIANTE`: la normalizacion no agranda,
   * asi que un original de 400 px produce tres variantes de 400. Guardar la
   * constante dejaria a las vistas emitiendo un `width` que miente.
   */
  ancho: number;
  alto: number;
  bytes: number;
};

/** Una fotografia de la galeria, en `VEH#<id> / FOTO#<orden>#<fotoId>`. */
export type Fotografia = {
  fotoId: string;
  vehiculoId: string;
  /** Posicion en la galeria. Va en la clave, asi que la Query ya las ordena. */
  orden: number;
  /**
   * Ruta en S3 del objeto principal — la variante `max`. **Nunca** una URL
   * firmada: esas se generan por peticion.
   *
   * Se conserva aparte de `variantes` para que borrar, firmar y auditar sigan
   * teniendo una sola nocion de "la clave de esta fotografia".
   */
  claveS3: string;
  contentType: string;
  bytes: number;
  /**
   * Las tres variantes, **siempre las tres**.
   *
   * Es un `Record` completo y no un arreglo porque un arreglo permitiria
   * representar "tengo `min` y `max` pero no `med`", un estado que no queremos
   * poder escribir ni tener que manejar al leer.
   */
  variantes: Readonly<Record<NombreDeVariante, VarianteImagen>>;
  descripcion?: string;
  subidaEn: string;
  subidaPor: string;
};

/** Lo que devuelve PA-02: el vehiculo y su galeria en una sola lectura. */
export type VehiculoConFotografias = Vehiculo & {
  fotografias: readonly Fotografia[];
};
