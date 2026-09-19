import { describe, expect, it } from "vitest";

import { ESTATUS_SOLICITUD, esEstadoVivo } from "@/types/solicitud";
import {
  agruparMiSolicitud,
  ordenDeMisSolicitudes,
  type OrdenableComoMiSolicitud,
} from "./misSolicitudes";

describe("agruparMiSolicitud", () => {
  it("una adjudicacion con el plazo corriendo encabeza la pantalla", () => {
    expect(
      agruparMiSolicitud({ estatus: "ADJUDICADA", plazoVencido: false }),
    ).toBe("REQUIERE_ATENCION");
  });

  it("una adjudicacion con el plazo vencido deja de requerir atencion", () => {
    // Ya no se puede subir el comprobante (T3 condiciona a `venceEn > :ahora`),
    // asi que pedirle atencion a alguien seria pedirle algo imposible.
    expect(
      agruparMiSolicitud({ estatus: "ADJUDICADA", plazoVencido: true }),
    ).toBe("ACTIVA");
  });

  it("y tampoco es historica: su transicion todavia no se ha escrito", () => {
    expect(
      agruparMiSolicitud({ estatus: "ADJUDICADA", plazoVencido: true }),
    ).not.toBe("HISTORICA");
  });

  it.each(["EN_FILA", "CONGELADA", "EN_VERIFICACION"] as const)(
    "%s es activa: no hay nada que hacer, pero sigue viva",
    (estatus) => {
      expect(agruparMiSolicitud({ estatus, plazoVencido: false })).toBe(
        "ACTIVA",
      );
    },
  );

  it.each([
    "VENDIDA",
    "CANCELADA_POR_VENCIMIENTO",
    "RECHAZADA_POR_TESORERIA",
    "CANCELADA_POR_PARTICIPANTE",
    "CANCELADA_POR_LIMITE",
    "NO_ADJUDICADA",
  ] as const)("%s es historica", (estatus) => {
    expect(agruparMiSolicitud({ estatus, plazoVencido: false })).toBe(
      "HISTORICA",
    );
  });

  // Exhaustividad: un estatus nuevo tiene que caer en algun grupo a proposito,
  // no por el `return` de abajo. `as const satisfies` no lo garantiza —
  // comprueba que cada elemento sea valido, no que esten todos (seccion 47 de
  // `desafios-implementacion.md`).
  it("todo estatus del catalogo cae en el grupo que le corresponde por vitalidad", () => {
    for (const estatus of ESTATUS_SOLICITUD) {
      const grupo = agruparMiSolicitud({ estatus, plazoVencido: false });
      expect(grupo).toBe(
        estatus === "ADJUDICADA"
          ? "REQUIERE_ATENCION"
          : esEstadoVivo(estatus)
            ? "ACTIVA"
            : "HISTORICA",
      );
    }
  });
});

describe("ordenDeMisSolicitudes", () => {
  const fila = (
    grupo: OrdenableComoMiSolicitud["grupo"],
    solicitadoEn: string,
    venceEn?: string,
  ): OrdenableComoMiSolicitud => ({
    grupo,
    solicitadoEn,
    ...(venceEn ? { venceEn } : {}),
  });

  it("los grupos salen en orden, sin importar las fechas", () => {
    const desordenadas = [
      fila("HISTORICA", "2026-09-19T00:00:00.000Z"),
      fila("ACTIVA", "2026-09-01T00:00:00.000Z"),
      fila(
        "REQUIERE_ATENCION",
        "2026-08-01T00:00:00.000Z",
        "2026-09-20T00:00:00.000Z",
      ),
    ];

    expect(
      [...desordenadas].sort(ordenDeMisSolicitudes).map((f) => f.grupo),
    ).toEqual(["REQUIERE_ATENCION", "ACTIVA", "HISTORICA"]);
  });

  it("el plazo que vence antes va arriba, aunque sea la solicitud mas vieja", () => {
    // Es el caso que motiva el comparador: la mas antigua es la urgente.
    const vieja = fila(
      "REQUIERE_ATENCION",
      "2026-09-01T00:00:00.000Z",
      "2026-09-20T06:00:00.000Z",
    );
    const nueva = fila(
      "REQUIERE_ATENCION",
      "2026-09-18T00:00:00.000Z",
      "2026-09-25T06:00:00.000Z",
    );

    expect([nueva, vieja].sort(ordenDeMisSolicitudes)).toEqual([vieja, nueva]);
  });

  it("sin plazo de por medio manda lo mas reciente", () => {
    const antigua = fila("ACTIVA", "2026-09-01T00:00:00.000Z");
    const reciente = fila("ACTIVA", "2026-09-18T00:00:00.000Z");

    expect([antigua, reciente].sort(ordenDeMisSolicitudes)).toEqual([
      reciente,
      antigua,
    ]);
  });
});
