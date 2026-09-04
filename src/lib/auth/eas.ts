import "server-only";
import { ROLES, type Rol } from "@/types/identidad";
import { consultarRolesEas } from "./easAdapter";
import { exigirModoSeguro, obtenerModoDevTools } from "./devMode";

const ROLES_VALIDOS = new Set<string>(ROLES);

// MOCK_USERS/FULL: roles fijos configurables por variable de entorno, para
// desarrollar sin acceso a EAS. La diferencia entre MOCK_USERS y FULL
// (impersonacion interactiva de rol sobre una sesion real de Okta, ver
// agent_files/identidad-autorizacion.md 4.1) todavia no tiene UI: por ahora
// ambos modos se resuelven igual. Construir esa UI queda para cuando exista
// una pantalla real que la necesite.
const rolesSimuladosDesdeEnv = (): Rol[] => {
  const crudo = process.env.DEV_TOOLS_MOCK_ROLES;
  if (!crudo) return ["ADMINISTRADOR"];
  const roles = crudo
    .split(",")
    .map((valor) => valor.trim())
    .filter((valor): valor is Rol => ROLES_VALIDOS.has(valor));
  return roles.length > 0 ? roles : ["ADMINISTRADOR"];
};

export const obtenerRoles = async (oktaSub: string): Promise<Rol[]> => {
  const modo = obtenerModoDevTools();
  if (modo === "OFF") return consultarRolesEas(oktaSub);

  exigirModoSeguro(modo);
  return rolesSimuladosDesdeEnv();
};
