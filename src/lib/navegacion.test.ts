// @vitest-environment node
vi.mock("server-only", () => ({}));

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import en from "@/dictionaries/en.json";
import es from "@/dictionaries/es.json";
import { PERMISOS, type Permiso } from "@/types/identidad";
import { __test__ } from "./auth/permisos";
import {
  ENTRADAS_DE_NAVEGACION,
  entradasVisibles,
  type IdDeNavegacion,
} from "./navegacion";

const { CATALOGO_ACCIONES } = __test__;

const con = (...valores: Permiso[]) => new Set(valores);
const ids = (permisos: ReadonlySet<Permiso>): IdDeNavegacion[] =>
  entradasVisibles(permisos).map((entrada) => entrada.id);

describe("entradasVisibles", () => {
  it("sin permisos no muestra ninguna entrada", () => {
    expect(ids(con())).toEqual([]);
  });

  it("un permiso de venta abre el catalogo del participante y nada mas", () => {
    expect(ids(con("Autob_Venta_en_general"))).toEqual(["convocatorias"]);
    expect(ids(con("Autob_Venta_a_empleados"))).toEqual(["convocatorias"]);
  });

  it("administrar vehiculos abre solo su catalogo", () => {
    expect(ids(con("Autob_Administrar_Vehiculos"))).toEqual(["vehiculos"]);
  });

  it("administrar convocatorias abre el catalogo de vehiculos y el de convocatorias", () => {
    // `vehiculo:ver-catalogo` lo concede tambien este permiso: quien arma una
    // convocatoria necesita ver que vehiculos hay (permission-matrix seccion 2).
    expect(ids(con("Autob_Administrar_Convocatorias"))).toEqual([
      "vehiculos",
      "convocatoriasAdmin",
    ]);
  });

  it("aprobar convocatorias abre la bandeja de aprobaciones, no la administracion de alta", () => {
    const visibles = ids(con("Autob_Aprobar_Convocatorias"));
    expect(visibles).toContain("aprobaciones");
    expect(visibles).toContain("convocatoriasAdmin");
    // Ve el listado administrativo (`ver-administracion` lo concede), pero no
    // el catalogo del participante: aprobar no es un permiso de venta.
    expect(visibles).not.toContain("convocatorias");
  });

  it("tesoreria abre su bandeja y ninguna pantalla administrativa", () => {
    expect(ids(con("Autob_Operar_Tesoreria"))).toEqual(["tesoreria"]);
  });

  it("auditar abre lo que puede mirar, sin la bandeja de alta de vehiculos propia", () => {
    // `Autob_Auditar` concede `vehiculo:ver-catalogo`,
    // `convocatoria:ver-administracion`, `tesoreria:ver-bandeja` y
    // `auditoria:ver-bitacora`.
    expect(ids(con("Autob_Auditar"))).toEqual([
      "vehiculos",
      "convocatoriasAdmin",
      "tesoreria",
      "auditoria",
    ]);
  });

  it("conserva el orden declarado, no el orden de los permisos", () => {
    const todos = new Set<Permiso>(PERMISOS);
    expect(ids(todos)).toEqual(
      ENTRADAS_DE_NAVEGACION.map((entrada) => entrada.id),
    );
  });

  it("con todos los permisos se ve todo el menu", () => {
    expect(ids(new Set<Permiso>(PERMISOS))).toHaveLength(
      ENTRADAS_DE_NAVEGACION.length,
    );
  });
});

describe("catalogo de navegacion", () => {
  it("toda entrada apunta a una accion que existe en el catalogo de permisos", () => {
    for (const entrada of ENTRADAS_DE_NAVEGACION) {
      expect(CATALOGO_ACCIONES[entrada.accion]).toBeDefined();
    }
  });

  it("ninguna entrada usa una accion con guarda contextual", () => {
    // Es la invariante que hace correcto comprobar solo la capacidad. Una
    // accion guardada, evaluada sin recurso, denegaria siempre (regla 18) — el
    // enlace quedaria oculto para todo el mundo, incluido quien si puede.
    const conGuarda = ENTRADAS_DE_NAVEGACION.filter(
      (entrada) => "guarda" in CATALOGO_ACCIONES[entrada.accion],
    ).map((entrada) => `${entrada.id} -> ${entrada.accion}`);

    expect(conGuarda).toEqual([]);
  });

  it("los ids y los href son unicos", () => {
    const listaIds = ENTRADAS_DE_NAVEGACION.map((entrada) => entrada.id);
    const hrefs = ENTRADAS_DE_NAVEGACION.map((entrada) => entrada.href);
    expect(new Set(listaIds).size).toBe(listaIds.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("todo href corresponde a una ruta que existe", () => {
    // Un enlace del menu hacia una ruta inexistente es un 404 ofrecido por la
    // propia aplicacion. Se comprueba contra el arbol de `src/app`.
    const faltantes = ENTRADAS_DE_NAVEGACION.filter((entrada) => {
      const ruta = join(
        process.cwd(),
        "src",
        "app",
        ...entrada.href.split("/").filter(Boolean),
        "page.tsx",
      );
      return !existsSync(ruta);
    }).map((entrada) => entrada.href);

    expect(faltantes).toEqual([]);
  });

  it("toda entrada tiene etiqueta en los dos diccionarios (regla 11)", () => {
    for (const entrada of ENTRADAS_DE_NAVEGACION) {
      expect(es.navegacion[entrada.id]).toBeTruthy();
      expect(en.navegacion[entrada.id]).toBeTruthy();
      // Nunca el id crudo como etiqueta de respaldo.
      expect(es.navegacion[entrada.id]).not.toBe(entrada.id);
      expect(en.navegacion[entrada.id]).not.toBe(entrada.id);
    }
  });
});
