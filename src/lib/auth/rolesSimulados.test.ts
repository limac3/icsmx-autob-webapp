// @vitest-environment node
vi.mock("server-only", () => ({}));

import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PERMISOS } from "@/types/identidad";
import {
  esRol,
  PERMISOS_POR_ROL,
  permisosDeRoles,
  ROLES,
} from "./rolesSimulados";

const RAIZ = join(process.cwd(), "src");

/**
 * El simulador de desarrollo, y los unicos archivos que pueden conocer el
 * concepto de rol:
 *
 * - `rolesSimulados.ts` traduce rol a permisos.
 * - `personasSimuladas.ts` asigna roles a las identidades de prueba.
 * - `eas.ts` lee `DEV_TOOLS_MOCK_ROLES` y llama a la traduccion.
 *
 * **`eas.ts` estaba en la lista desde la Etapa 2.1**, aunque el plan afirmara
 * que el unico archivo era `rolesSimulados.ts`: el `grep` a mano de aquella
 * compuerta no lo delato. Lo que la invariante protege de verdad no es un
 * archivo, es una frontera — el rol no cruza de `src/lib/auth` hacia el
 * negocio (regla 17).
 */
const ARCHIVOS_DEL_SIMULADOR = [
  "lib/auth/rolesSimulados.ts",
  "lib/auth/personasSimuladas.ts",
  "lib/auth/eas.ts",
];

const archivosDeCodigo = (directorio: string): string[] =>
  readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(directorio, entrada.name);
    if (entrada.isDirectory()) return archivosDeCodigo(ruta);
    return /\.tsx?$/.test(entrada.name) ? [ruta] : [];
  });

describe("ROLES y PERMISOS_POR_ROL", () => {
  it("cada rol traduce a permisos que existen en el catalogo", () => {
    const validos = new Set<string>(PERMISOS);
    for (const rol of ROLES) {
      expect(PERMISOS_POR_ROL[rol].length).toBeGreaterThan(0);
      for (const permiso of PERMISOS_POR_ROL[rol]) {
        expect(validos.has(permiso)).toBe(true);
      }
    }
  });

  it("la tabla cubre exactamente los roles declarados, sin sobrantes", () => {
    expect(Object.keys(PERMISOS_POR_ROL).sort()).toEqual([...ROLES].sort());
  });

  it("esRol reconoce los roles y rechaza cualquier otra cosa", () => {
    for (const rol of ROLES) expect(esRol(rol)).toBe(true);
    expect(esRol("ADMIN")).toBe(false);
    expect(esRol("")).toBe(false);
  });

  it("permisosDeRoles une sin duplicar", () => {
    expect(permisosDeRoles(["EMPLEADO", "OTRO_USUARIO"])).toEqual(
      new Set(["Autob_Venta_a_empleados", "Autob_Venta_en_general"]),
    );
    expect(permisosDeRoles([])).toEqual(new Set());
  });
});

describe("invariante: el concepto de rol no sale del simulador", () => {
  // La Etapa 2.1 verificaba esto con un `grep` a mano. Automatizarlo es lo que
  // lo convierte en una compuerta permanente: si manana una pantalla decide
  // "si el rol es ADMINISTRADOR entonces...", esta prueba falla. Es la regla 17
  // — la aplicacion declara que permiso exige cada accion, nunca quien lo
  // tiene.
  it("ningun archivo fuera del simulador importa Rol, ROLES ni PERMISOS_POR_ROL", () => {
    const permitidos = new Set(ARCHIVOS_DEL_SIMULADOR);
    const infractores: string[] = [];

    for (const ruta of archivosDeCodigo(RAIZ)) {
      const relativa = relative(RAIZ, ruta).split(sep).join(posix.sep);
      if (permitidos.has(relativa)) continue;
      // Las propias pruebas del simulador si pueden nombrarlo.
      if (/^lib\/auth\/\w+\.test\.ts$/.test(relativa)) continue;

      const contenido = readFileSync(ruta, "utf8");
      const importaDelSimulador = /from\s+["'][^"']*rolesSimulados["']/.test(
        contenido,
      );
      if (importaDelSimulador) infractores.push(relativa);
    }

    expect(infractores).toEqual([]);
  });

  it("los archivos del simulador existen donde esta prueba dice", () => {
    // Si alguien renombra o mueve uno, el bucle de arriba dejaria de
    // protegerlo sin que ninguna prueba se queje. Esta lo delata.
    const todos = new Set(
      archivosDeCodigo(RAIZ).map((ruta) =>
        relative(RAIZ, ruta).split(sep).join(posix.sep),
      ),
    );
    for (const archivo of ARCHIVOS_DEL_SIMULADOR) {
      expect(todos.has(archivo)).toBe(true);
    }
  });
});
