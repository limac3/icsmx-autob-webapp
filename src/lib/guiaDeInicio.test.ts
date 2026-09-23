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
  BLOQUES_DE_GUIA,
  bloquesVisibles,
  type IdDeBloqueDeGuia,
} from "./guiaDeInicio";

const { CATALOGO_ACCIONES } = __test__;

const con = (...valores: Permiso[]) => new Set(valores);
const ids = (permisos: ReadonlySet<Permiso>): IdDeBloqueDeGuia[] =>
  bloquesVisibles(permisos).map((bloque) => bloque.id);

describe("bloquesVisibles", () => {
  it("sin permisos no muestra ningun bloque", () => {
    expect(ids(con())).toEqual([]);
  });

  it("un permiso de venta explica formarse y pagar, y nada mas", () => {
    const delParticipante: IdDeBloqueDeGuia[] = ["comprar", "pagar"];
    expect(ids(con("Autob_Venta_en_general"))).toEqual(delParticipante);
    expect(ids(con("Autob_Venta_a_empleados"))).toEqual(delParticipante);
  });

  it("administrar vehiculos explica el alta, no la convocatoria", () => {
    expect(ids(con("Autob_Administrar_Vehiculos"))).toEqual(["vehiculos"]);
  });

  it("administrar convocatorias no explica como dar de alta un vehiculo", () => {
    // Ve el catalogo de vehiculos —`vehiculo:ver-catalogo` se lo concede,
    // porque lo necesita para armar una convocatoria— pero no da de alta
    // ninguno. La guia cuelga de `vehiculo:crear` justamente para no
    // explicarle un alta que no puede hacer.
    expect(ids(con("Autob_Administrar_Convocatorias"))).toEqual(["publicar"]);
  });

  it("aprobar convocatorias explica el dictamen, no la publicacion", () => {
    expect(ids(con("Autob_Aprobar_Convocatorias"))).toEqual(["dictaminar"]);
  });

  it("tesoreria explica la verificacion del pago", () => {
    expect(ids(con("Autob_Operar_Tesoreria"))).toEqual(["verificarPagos"]);
  });

  it("adjudicar explica la adjudicacion manual", () => {
    expect(ids(con("Autob_Adjudicar_Convocatorias"))).toEqual(["adjudicar"]);
  });

  it("auditar solo lee sobre auditoria, aunque vea cuatro bandejas", () => {
    // **La diferencia con el menu, y la razon de ser de este catalogo.**
    // `Autob_Auditar` concede capacidad sobre `vehiculo:ver-catalogo`,
    // `convocatoria:ver-administracion`, `tesoreria:ver-bandeja` y
    // `adjudicacion:ver-bandeja`, asi que el menu le muestra esas cuatro
    // secciones — correctamente, porque las ve en lectura. Si la guia colgara
    // de esas mismas acciones, le explicaria como publicar una convocatoria y
    // como avalar un pago, dos cosas que no puede hacer.
    expect(ids(con("Autob_Auditar"))).toEqual(["auditar"]);
  });

  it("conserva el orden declarado, no el orden de los permisos", () => {
    const todos = new Set<Permiso>(PERMISOS);
    expect(ids(todos)).toEqual(BLOQUES_DE_GUIA.map((bloque) => bloque.id));
  });
});

describe("catalogo de la guia", () => {
  it("todo bloque apunta a una accion que existe en el catalogo de permisos", () => {
    for (const bloque of BLOQUES_DE_GUIA) {
      expect(CATALOGO_ACCIONES[bloque.accion]).toBeDefined();
    }
  });

  it("los ids son unicos", () => {
    const listaIds = BLOQUES_DE_GUIA.map((bloque) => bloque.id);
    expect(new Set(listaIds).size).toBe(listaIds.length);
  });

  it("todo href corresponde a una ruta que existe", () => {
    const faltantes = BLOQUES_DE_GUIA.filter((bloque) => {
      const ruta = join(
        process.cwd(),
        "src",
        "app",
        ...bloque.href.split("/").filter(Boolean),
        "page.tsx",
      );
      return !existsSync(ruta);
    }).map((bloque) => bloque.href);

    expect(faltantes).toEqual([]);
  });

  it("todo bloque tiene titulo, pasos y enlace en los dos diccionarios (regla 11)", () => {
    for (const bloque of BLOQUES_DE_GUIA) {
      for (const diccionario of [es, en]) {
        const texto = diccionario.inicio.bloques[bloque.id];
        expect(texto).toBeDefined();
        expect(texto.titulo).toBeTruthy();
        expect(texto.enlace).toBeTruthy();
        expect(texto.pasos.length).toBeGreaterThan(0);
        for (const paso of texto.pasos) expect(paso).toBeTruthy();
      }
    }
  });

  it("ningun diccionario tiene texto para un bloque que ya no existe", () => {
    // El fallo que esta prueba busca es el contrario al de arriba: quitar un
    // bloque del catalogo y dejar su texto huerfano no rompe nada, y a la
    // siguiente lectura nadie sabe si sobra o si falta el bloque.
    const declarados = BLOQUES_DE_GUIA.map((bloque) => bloque.id).sort();
    for (const diccionario of [es, en]) {
      expect(Object.keys(diccionario.inicio.bloques).sort()).toEqual(
        declarados,
      );
    }
  });
});
