import "server-only";
import { PERMISOS, type Permiso } from "@/types/identidad";
import { consultarPermisosEas } from "./easAdapter";
import { exigirModoSeguro, obtenerModoDevTools } from "./devMode";
import { esRol, permisosDeRoles, type Rol } from "./rolesSimulados";

const PERMISOS_VALIDOS = new Set<string>(PERMISOS);

// MOCK_USERS/FULL: permisos simulados, para desarrollar sin acceso a EAS. La
// diferencia entre MOCK_USERS y FULL (impersonacion interactiva sobre una
// sesion real de Okta, ver agent_files/identidad-autorizacion.md 4.1) todavia
// no tiene UI: por ahora ambos modos se resuelven igual.
//
// Dos vias, en este orden de precedencia:
//
// 1. DEV_TOOLS_MOCK_PERMISOS — permisos sueltos, para casos borde que ningun
//    rol representa (por ejemplo, tesoreria sin auditoria).
// 2. DEV_TOOLS_MOCK_ROLES — roles, que se traducen con la tabla de
//    rolesSimulados.ts. Es la via comoda y la que imita a EAS.
const permisosDesdeEnv = (): Set<Permiso> => {
  const crudoPermisos = process.env.DEV_TOOLS_MOCK_PERMISOS;
  if (crudoPermisos) {
    const permisos = crudoPermisos
      .split(",")
      .map((valor) => valor.trim())
      .filter((valor): valor is Permiso => PERMISOS_VALIDOS.has(valor));
    if (permisos.length > 0) return new Set(permisos);
  }

  const crudoRoles = process.env.DEV_TOOLS_MOCK_ROLES;
  if (!crudoRoles) return permisosDeRoles(["ADMINISTRADOR"]);

  const roles = crudoRoles
    .split(",")
    .map((valor) => valor.trim())
    .filter((valor): valor is Rol => esRol(valor));
  return permisosDeRoles(roles.length > 0 ? roles : ["ADMINISTRADOR"]);
};

export const obtenerPermisos = async (
  oktaSub: string,
): Promise<Set<Permiso>> => {
  const modo = obtenerModoDevTools();
  if (modo === "OFF") return consultarPermisosEas(oktaSub);

  exigirModoSeguro(modo);
  return permisosDesdeEnv();
};
