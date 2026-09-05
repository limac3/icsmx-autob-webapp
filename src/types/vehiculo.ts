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

/** Una fotografia de la galeria, en `VEH#<id> / FOTO#<orden>#<fotoId>`. */
export type Fotografia = {
  fotoId: string;
  vehiculoId: string;
  /** Posicion en la galeria. Va en la clave, asi que la Query ya las ordena. */
  orden: number;
  /** Ruta en S3. **Nunca** una URL firmada: esas se generan por peticion. */
  claveS3: string;
  contentType: string;
  bytes: number;
  descripcion?: string;
  subidaEn: string;
  subidaPor: string;
};

/** Lo que devuelve PA-02: el vehiculo y su galeria en una sola lectura. */
export type VehiculoConFotografias = Vehiculo & {
  fotografias: readonly Fotografia[];
};
