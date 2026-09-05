import "server-only";
import type { Permiso } from "@/types/identidad";

/**
 * **Simulacion de desarrollo. No forma parte del camino de produccion.**
 *
 * EAS no expone roles: responde un booleano por permiso
 * (`agent_files/identidad-autorizacion.md` seccion 4). Pero el equipo razona en
 * roles, asi que en desarrollo se elige un rol y esta tabla lo traduce a
 * permisos. Es la traduccion que en produccion hace EAS con sus propias reglas.
 *
 * **Este es el unico archivo del sistema donde sobrevive el concepto de rol.**
 * Ningun otro modulo debe importar `Rol` ni `ROLES`; la compuerta de la Etapa
 * 2.1 lo verifica. Si un rol aparece en `src/lib/<feature>` o en una pantalla,
 * es que se filtro politica organizacional al codigo.
 *
 * Solo lo usa `eas.ts`, y solo despues de `exigirModoSeguro()`.
 */
export const ROLES = [
  "ADMINISTRADOR",
  "APROBADOR_CONVOCATORIA",
  "EMPLEADO",
  "OTRO_USUARIO",
  "OPERADOR_TESORERIA",
  "AUDITOR_CUMPLIMIENTO",
] as const;

export type Rol = (typeof ROLES)[number];

/**
 * Traduccion literal de la seccion 8 de `agent_files/permission-matrix.md`.
 *
 * Que un `ADMINISTRADOR` no reciba permisos de venta es una **conveniencia de
 * desarrollo** que imita la configuracion vigente de EAS, no una regla de
 * negocio programada. Si la organizacion decide que quien administra tambien
 * compra, se cambia en EAS y aqui solo se ajusta la simulacion.
 */
export const PERMISOS_POR_ROL: Readonly<Record<Rol, readonly Permiso[]>> = {
  ADMINISTRADOR: [
    "Autob_Administrar_Vehiculos",
    "Autob_Administrar_Convocatorias",
  ],
  APROBADOR_CONVOCATORIA: ["Autob_Aprobar_Convocatorias"],
  EMPLEADO: ["Autob_Venta_a_empleados", "Autob_Venta_en_general"],
  OTRO_USUARIO: ["Autob_Venta_en_general"],
  OPERADOR_TESORERIA: ["Autob_Operar_Tesoreria"],
  AUDITOR_CUMPLIMIENTO: ["Autob_Auditar"],
};

const ROLES_VALIDOS = new Set<string>(ROLES);

export const esRol = (valor: string): valor is Rol => ROLES_VALIDOS.has(valor);

export const permisosDeRoles = (roles: readonly Rol[]): Set<Permiso> =>
  new Set(roles.flatMap((rol) => PERMISOS_POR_ROL[rol]));
