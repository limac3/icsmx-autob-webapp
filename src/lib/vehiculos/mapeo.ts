import "server-only";

// Traduccion entre el item crudo de DynamoDB y el registro tipado.
//
// Vive aparte de los servicios porque los cinco lo necesitan y porque es el
// unico lugar donde un item puede estar mal formado: todo lo que sale de
// DynamoDB es `Record<string, unknown>`, y afirmarle un tipo con `as` seria
// mentirle al compilador sobre datos que pudo escribir una version anterior del
// codigo o una correccion manual.

import {
  ESTATUS_VEHICULO,
  type EstatusVehiculo,
  type Fotografia,
  type Vehiculo,
} from "@/types/vehiculo";

const texto = (valor: unknown): string | undefined =>
  typeof valor === "string" && valor.length > 0 ? valor : undefined;

const entero = (valor: unknown): number | undefined =>
  typeof valor === "number" && Number.isInteger(valor) ? valor : undefined;

const esEstatus = (valor: unknown): valor is EstatusVehiculo =>
  typeof valor === "string" &&
  (ESTATUS_VEHICULO as readonly string[]).includes(valor);

/**
 * Convierte un item en un vehiculo, o devuelve `undefined` si le falta algo
 * indispensable.
 *
 * Devolver `undefined` y no lanzar es deliberado: un item corrupto entre mil
 * debe desaparecer del listado, no tumbar la pantalla entera. Quien lee un
 * vehiculo concreto convierte ese `undefined` en `not_found`, que es lo que de
 * verdad le pasa a quien consulta.
 */
export const aVehiculo = (
  item: Record<string, unknown>,
): Vehiculo | undefined => {
  const vehiculoId = texto(item.vehiculoId);
  const numeroEconomico = texto(item.numeroEconomico);
  const numeroDeSerie = texto(item.numeroDeSerie);
  const marca = texto(item.marca);
  const version = texto(item.version);
  const modelo = entero(item.modelo);
  const kilometraje = entero(item.kilometraje);
  const creadoEn = texto(item.creadoEn);
  const creadoPor = texto(item.creadoPor);

  if (
    !vehiculoId ||
    // Los dos son obligatorios: un vehiculo sin numero economico no se puede
    // identificar en el inventario, y ademas tendria su centinela huerfano.
    !numeroEconomico ||
    !numeroDeSerie ||
    !marca ||
    !version ||
    modelo === undefined ||
    kilometraje === undefined ||
    !creadoEn ||
    !creadoPor ||
    !esEstatus(item.estatus)
  ) {
    return undefined;
  }

  return {
    vehiculoId,
    numeroEconomico,
    numeroDeSerie,
    marca,
    version,
    modelo,
    kilometraje,
    estatus: item.estatus,
    creadoEn,
    creadoPor,
    // Un item escrito antes de que existiera el campo no tiene por que perderse:
    // se cae de vuelta a la creacion, que es cierta.
    actualizadoEn: texto(item.actualizadoEn) ?? creadoEn,
    actualizadoPor: texto(item.actualizadoPor) ?? creadoPor,
    nivelEquipamiento: texto(item.nivelEquipamiento),
    especificacionMecanica: texto(item.especificacionMecanica),
    condicionesMecanicas: texto(item.condicionesMecanicas),
    detallesEsteticos: texto(item.detallesEsteticos),
    fotografiaPrincipalId: texto(item.fotografiaPrincipalId),
    convocatoriaId: texto(item.convocatoriaId),
    motivoRetiro: texto(item.motivoRetiro),
  };
};

export const aFotografia = (
  item: Record<string, unknown>,
): Fotografia | undefined => {
  const fotoId = texto(item.fotoId);
  const vehiculoId = texto(item.vehiculoId);
  const claveS3 = texto(item.claveS3);
  const contentType = texto(item.contentType);
  const orden = entero(item.orden);
  const subidaEn = texto(item.subidaEn);
  const subidaPor = texto(item.subidaPor);

  if (
    !fotoId ||
    !vehiculoId ||
    !claveS3 ||
    !contentType ||
    orden === undefined ||
    !subidaEn ||
    !subidaPor
  ) {
    return undefined;
  }

  return {
    fotoId,
    vehiculoId,
    orden,
    claveS3,
    contentType,
    bytes: entero(item.bytes) ?? 0,
    descripcion: texto(item.descripcion),
    subidaEn,
    subidaPor,
  };
};
