// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Se simulan las cuatro lecturas y no el cliente de DynamoDB: cada una ya
// tiene su prueba contra el cliente falso, y lo que aqui se afirma es otra
// cosa — **a quien se le consulta que**. Con un cliente falso, "no se consulto
// la bandeja de tesoreria" se confundiria con "la consulta no devolvio nada".
const listarMisSolicitudes = vi.fn();
const listarConvocatoriasVisibles = vi.fn();
const listarConvocatorias = vi.fn();
const listarPendientesVerificacion = vi.fn();

vi.mock("@/lib/fila/listarMisSolicitudes", () => ({
  listarMisSolicitudes: (...args: unknown[]) => listarMisSolicitudes(...args),
}));
vi.mock("@/lib/convocatorias/listarConvocatoriasVisibles", () => ({
  listarConvocatoriasVisibles: (...args: unknown[]) =>
    listarConvocatoriasVisibles(...args),
}));
vi.mock("@/lib/convocatorias/listarConvocatorias", () => ({
  listarConvocatorias: (...args: unknown[]) => listarConvocatorias(...args),
}));
vi.mock("@/lib/tesoreria/listarPendientesVerificacion", () => ({
  listarPendientesVerificacion: (...args: unknown[]) =>
    listarPendientesVerificacion(...args),
}));

import { resumenDeInicio } from "./resumenDeInicio";
import type { Permiso } from "@/types/identidad";
import { exito, fallo } from "@/types/resultado";

const AHORA = new Date("2026-09-23T18:00:00.000Z");

const convocar = (permisos: Permiso[]) =>
  resumenDeInicio({
    participanteId: "P1",
    permisos: new Set(permisos),
    tiposPermitidos: ["EMPLEADOS"],
    ahora: AHORA,
  });

beforeEach(() => {
  vi.clearAllMocks();
  listarMisSolicitudes.mockResolvedValue(
    exito({ solicitudes: [], truncada: false }),
  );
  listarConvocatoriasVisibles.mockResolvedValue(exito([]));
  listarConvocatorias.mockResolvedValue(exito([]));
  listarPendientesVerificacion.mockResolvedValue(exito([]));
});

describe("resumenDeInicio — a quien se le consulta que", () => {
  it("sin permisos no consulta nada", () => {
    // El caso que hace visible el costo: una sesion recien creada, sin
    // accesos, no debe disparar cuatro consultas para no mostrar nada.
    return convocar([]).then((resultado) => {
      expect(resultado).toEqual(
        exito({ siguientePaso: undefined, pendientes: [] }),
      );
      expect(listarMisSolicitudes).not.toHaveBeenCalled();
      expect(listarConvocatoriasVisibles).not.toHaveBeenCalled();
      expect(listarConvocatorias).not.toHaveBeenCalled();
      expect(listarPendientesVerificacion).not.toHaveBeenCalled();
    });
  });

  it("quien compra lee sus solicitudes y el catalogo, ninguna bandeja", async () => {
    await convocar(["Autob_Venta_a_empleados"]);

    expect(listarMisSolicitudes).toHaveBeenCalledWith("P1", {});
    expect(listarConvocatoriasVisibles).toHaveBeenCalledWith(
      ["EMPLEADOS"],
      AHORA,
      {},
    );
    expect(listarConvocatorias).not.toHaveBeenCalled();
    expect(listarPendientesVerificacion).not.toHaveBeenCalled();
  });

  it("el auditor no tiene pendientes en ninguna bandeja, y no se le consulta", async () => {
    // Ve las cuatro bandejas en lectura —`tesoreria:ver-bandeja` y
    // `adjudicacion:ver-bandeja` se lo conceden— pero no decide en ninguna.
    // Las lecturas cuelgan de la accion que **decide**, por eso no se paga
    // ninguna consulta por mostrarle un pendiente que no es suyo.
    const resultado = await convocar(["Autob_Auditar"]);

    expect(resultado).toEqual(
      exito({ siguientePaso: undefined, pendientes: [] }),
    );
    expect(listarConvocatorias).not.toHaveBeenCalled();
    expect(listarPendientesVerificacion).not.toHaveBeenCalled();
  });
});

describe("resumenDeInicio — bandejas", () => {
  it("cuenta las convocatorias que esperan dictamen", async () => {
    listarConvocatorias.mockResolvedValue(
      exito([{ convocatoriaId: "C1" }, { convocatoriaId: "C2" }]),
    );

    const resultado = await convocar(["Autob_Aprobar_Convocatorias"]);

    expect(listarConvocatorias).toHaveBeenCalledWith(
      { estatus: ["EN_APROBACION"] },
      {},
    );
    expect(resultado.ok && resultado.data.pendientes).toEqual([
      { id: "aprobaciones", href: "/aprobaciones", cantidad: 2 },
    ]);
  });

  it("cuenta los pagos que esperan verificacion", async () => {
    listarPendientesVerificacion.mockResolvedValue(
      exito([{ solicitudId: "S1" }]),
    );

    const resultado = await convocar(["Autob_Operar_Tesoreria"]);

    expect(resultado.ok && resultado.data.pendientes).toEqual([
      { id: "tesoreria", href: "/tesoreria/verificacion", cantidad: 1 },
    ]);
  });

  it("una bandeja vacia no se menciona", async () => {
    const resultado = await convocar([
      "Autob_Aprobar_Convocatorias",
      "Autob_Operar_Tesoreria",
    ]);

    expect(resultado.ok && resultado.data.pendientes).toEqual([]);
  });

  it("adjudicacion se anuncia sin numero, y solo si hay algo manual en curso", async () => {
    // El conteo exacto obligaria a recorrer los lotes y consultar el tamano de
    // cada fila, que es lo que cuesta la bandeja entera. Contar convocatorias
    // manuales y llamarlo "pendientes" seria mentir: una manual sin nadie
    // formado no espera ninguna decision.
    listarConvocatorias.mockResolvedValue(
      exito([
        { convocatoriaId: "C1", modalidadAdjudicacion: "MANUAL" },
        { convocatoriaId: "C2", modalidadAdjudicacion: "AUTOMATICA" },
      ]),
    );

    const resultado = await convocar(["Autob_Adjudicar_Convocatorias"]);

    expect(listarConvocatorias).toHaveBeenCalledWith(
      { estatus: ["PUBLICADA"] },
      {},
    );
    expect(resultado.ok && resultado.data.pendientes).toEqual([
      { id: "adjudicacion", href: "/adjudicacion" },
    ]);
  });

  it("sin ninguna convocatoria manual publicada no se anuncia la bandeja", async () => {
    listarConvocatorias.mockResolvedValue(
      exito([{ convocatoriaId: "C2", modalidadAdjudicacion: "AUTOMATICA" }]),
    );

    const resultado = await convocar(["Autob_Adjudicar_Convocatorias"]);

    expect(resultado.ok && resultado.data.pendientes).toEqual([]);
  });
});

describe("resumenDeInicio — fallos", () => {
  it("una lectura fallida tumba el resumen entero, no solo su linea", async () => {
    // Un home que muestra la bandeja de tesoreria y calla que no pudo leer los
    // plazos propios es exactamente el fallback silencioso que la regla 15
    // prohibe: quien mira concluiria que no debe nada.
    listarMisSolicitudes.mockResolvedValue(fallo("dependencia_no_disponible"));
    listarPendientesVerificacion.mockResolvedValue(
      exito([{ solicitudId: "S1" }]),
    );

    const resultado = await convocar([
      "Autob_Venta_a_empleados",
      "Autob_Operar_Tesoreria",
    ]);

    expect(resultado.ok).toBe(false);
    expect(resultado.ok === false && resultado.error).toBe(
      "dependencia_no_disponible",
    );
  });
});

describe("resumenDeInicio — siguiente paso", () => {
  it("compone el paso con lo que devolvieron las dos lecturas del participante", async () => {
    listarConvocatoriasVisibles.mockResolvedValue(
      exito([
        {
          convocatoriaId: "CONV1",
          nombre: "Renovacion 2026",
          inicioVenta: "2026-09-23T17:00:00.000Z",
          finVenta: "2026-09-25T17:00:00.000Z",
          cantidadDeLotes: 3,
        },
      ]),
    );

    const resultado = await convocar(["Autob_Venta_a_empleados"]);

    expect(resultado.ok && resultado.data.siguientePaso).toEqual({
      tipo: "VENTA_ABIERTA",
      convocatoriaId: "CONV1",
      nombre: "Renovacion 2026",
      cantidadDeLotes: 3,
    });
  });
});
