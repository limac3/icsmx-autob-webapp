// @vitest-environment node
vi.mock("server-only", () => ({}));

import { describe, expect, it, vi } from "vitest";
import { PERMISOS } from "@/types/identidad";
import {
  buscarPersonaSimulada,
  permisosDePersona,
  PERSONAS_SIMULADAS,
} from "./personasSimuladas";
import { PERMISOS_POR_ROL, ROLES } from "./rolesSimulados";

describe("roster de personas simuladas", () => {
  it("los ids son unicos: la cookie no puede quedar ambigua", () => {
    const ids = PERSONAS_SIMULADAS.map((persona) => persona.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("los participanteId son unicos: dos personas no pueden ser el mismo actor", () => {
    const ids = PERSONAS_SIMULADAS.map((persona) => persona.participanteId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todo participanteId lleva el prefijo dev-, para que la bitacora lo delate", () => {
    for (const persona of PERSONAS_SIMULADAS) {
      expect(persona.participanteId).toMatch(/^dev-/);
    }
  });

  it("ningun participanteId lleva #, que es el separador de claves de DynamoDB", () => {
    for (const persona of PERSONAS_SIMULADAS) {
      expect(persona.participanteId).not.toContain("#");
    }
  });

  it("todo correo esta en un dominio .invalid: un envio accidental no alcanza a nadie", () => {
    for (const persona of PERSONAS_SIMULADAS) {
      expect(persona.correo).toMatch(/@[\w.-]+\.invalid$/);
    }
  });

  it("cada rol del simulador esta representado por alguna persona", () => {
    const cubiertos = new Set(
      PERSONAS_SIMULADAS.flatMap((persona) => persona.roles),
    );
    expect([...cubiertos].sort()).toEqual([...ROLES].sort());
  });

  it("entre todas las personas se alcanza el catalogo completo de permisos", () => {
    // Si un permiso no lo tiene nadie, hay una pantalla que no se puede
    // recorrer en local y el roster esta incompleto.
    const alcanzables = new Set(
      PERSONAS_SIMULADAS.flatMap((persona) => [...permisosDePersona(persona)]),
    );
    expect([...alcanzables].sort()).toEqual([...PERMISOS].sort());
  });

  it("hay al menos dos participantes de venta distintos: sin eso no hay fila", () => {
    const compradores = PERSONAS_SIMULADAS.filter((persona) => {
      const permisos = permisosDePersona(persona);
      return (
        permisos.has("Autob_Venta_a_empleados") ||
        permisos.has("Autob_Venta_en_general")
      );
    });
    expect(compradores.length).toBeGreaterThanOrEqual(2);
  });

  it("quien administra convocatorias no es quien las aprueba: sin eso no hay dictamen", () => {
    // `convocatoria:aprobar` deniega `self_approval`. Si el roster no separa
    // las dos capacidades en dos identidades, el flujo de aprobacion sigue
    // siendo inalcanzable y este archivo no sirve de nada.
    const administra = PERSONAS_SIMULADAS.filter((persona) =>
      permisosDePersona(persona).has("Autob_Administrar_Convocatorias"),
    );
    const aprueba = PERSONAS_SIMULADAS.filter((persona) =>
      permisosDePersona(persona).has("Autob_Aprobar_Convocatorias"),
    );

    expect(administra.length).toBeGreaterThan(0);
    expect(aprueba.length).toBeGreaterThan(0);
    for (const uno of administra) {
      for (const otro of aprueba) {
        expect(uno.participanteId).not.toBe(otro.participanteId);
      }
    }
  });

  it("hay alguien sin Autob_Venta_a_empleados, para ejercer la tercera pata del gating", () => {
    const soloPublico = PERSONAS_SIMULADAS.filter((persona) => {
      const permisos = permisosDePersona(persona);
      return (
        permisos.has("Autob_Venta_en_general") &&
        !permisos.has("Autob_Venta_a_empleados")
      );
    });
    expect(soloPublico.length).toBeGreaterThan(0);
  });
});

describe("buscarPersonaSimulada", () => {
  it("encuentra a cada persona por su id", () => {
    for (const persona of PERSONAS_SIMULADAS) {
      expect(buscarPersonaSimulada(persona.id)).toEqual(persona);
    }
  });

  it("devuelve undefined ante un id que no existe", () => {
    expect(buscarPersonaSimulada("no-existe")).toBeUndefined();
    expect(buscarPersonaSimulada("")).toBeUndefined();
  });
});

describe("permisosDePersona", () => {
  it("traduce con la misma tabla del simulador de EAS", () => {
    for (const persona of PERSONAS_SIMULADAS) {
      const esperados = new Set(
        persona.roles.flatMap((rol) => PERMISOS_POR_ROL[rol]),
      );
      expect(permisosDePersona(persona)).toEqual(esperados);
    }
  });
});
