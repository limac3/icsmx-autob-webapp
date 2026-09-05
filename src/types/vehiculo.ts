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
