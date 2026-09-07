import "server-only";

// Las dependencias inyectables son las mismas para toda caracteristica y viven
// en `src/lib/data/deps.ts`. Este archivo solo conserva el nombre local con el
// que ya las importan los nueve servicios de vehiculo.

export {
  clienteDe,
  resolver,
  type DepsResueltas,
  type DepsDeServicio as DepsDeVehiculos,
} from "@/lib/data/deps";
export type { ActorUsuario } from "@/types/auditoria";
