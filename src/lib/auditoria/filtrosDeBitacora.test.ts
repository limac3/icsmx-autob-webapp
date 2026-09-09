import { describe, expect, it } from "vitest";
import type { EventoDTO } from "@/types/auditoria";
import { diasDeNegocioEntre } from "@/lib/domain/fechas";
import {
  eventoCoincideConFiltros,
  MAXIMO_DIAS_DE_RANGO,
  rangoPorDefecto,
  validarBusqueda,
} from "./filtrosDeBitacora";

const evento: EventoDTO = {
  eventoId: "E1",
  tipo: "SOLICITUD_CREADA",
  ocurridoEn: "2026-10-06T10:00:00.000Z",
  actorTipo: "USUARIO",
  actorId: "P1",
  correlacionId: "COR1",
};

describe("eventoCoincideConFiltros", () => {
  it("sin filtros, coincide siempre", () => {
    expect(eventoCoincideConFiltros(evento, {})).toBe(true);
  });

  it("filtra por tipo", () => {
    expect(eventoCoincideConFiltros(evento, { tipo: "SOLICITUD_CREADA" })).toBe(
      true,
    );
    expect(eventoCoincideConFiltros(evento, { tipo: "LOTE_ADJUDICADO" })).toBe(
      false,
    );
  });

  it("filtra por rango de dias, inclusivo en ambos extremos", () => {
    expect(
      eventoCoincideConFiltros(evento, {
        desde: "2026-10-06",
        hasta: "2026-10-06",
      }),
    ).toBe(true);
    expect(eventoCoincideConFiltros(evento, { desde: "2026-10-07" })).toBe(
      false,
    );
    expect(eventoCoincideConFiltros(evento, { hasta: "2026-10-05" })).toBe(
      false,
    );
  });

  it("el dia del evento es el de negocio, no el de UTC", () => {
    // 02:00Z son las 20:00 del dia anterior en Mexico. Con la frontera en la
    // medianoche UTC este evento caeria en el 6, y la lectura global (PA-13),
    // que particiona por `AUDIT#<dia>` de negocio, lo devolveria en el 5:
    // el mismo rango daria dos respuestas segun como se busque.
    const anochecer: EventoDTO = {
      ...evento,
      ocurridoEn: "2026-10-06T02:00:00.000Z",
    };
    expect(
      eventoCoincideConFiltros(anochecer, {
        desde: "2026-10-05",
        hasta: "2026-10-05",
      }),
    ).toBe(true);
    expect(
      eventoCoincideConFiltros(anochecer, {
        desde: "2026-10-06",
        hasta: "2026-10-06",
      }),
    ).toBe(false);
  });

  it("un ocurridoEn ilegible no se afirma dentro del rango", () => {
    const roto: EventoDTO = { ...evento, ocurridoEn: "el martes" };
    expect(eventoCoincideConFiltros(roto, { desde: "2026-10-06" })).toBe(false);
    // Sin rango no hay nada que comparar, y el evento sigue estando.
    expect(eventoCoincideConFiltros(roto, {})).toBe(true);
  });

  it("filtra por participante (actorId)", () => {
    expect(eventoCoincideConFiltros(evento, { participanteId: "P1" })).toBe(
      true,
    );
    expect(eventoCoincideConFiltros(evento, { participanteId: "P2" })).toBe(
      false,
    );
  });
});

describe("rangoPorDefecto", () => {
  it("son 30 dias hacia atras contando hoy", () => {
    // 2026-09-08 18:00Z son las 12:00 del 8 en Mexico.
    const rango = rangoPorDefecto(new Date("2026-09-08T18:00:00.000Z"));
    expect(rango).toEqual({ desde: "2026-08-09", hasta: "2026-09-08" });
  });

  it("el dia final es el de negocio y no el de UTC", () => {
    // 03:00Z del 9 son las 21:00 del 8 en Mexico: para quien busca, hoy es 8.
    const rango = rangoPorDefecto(new Date("2026-09-09T03:00:00.000Z"));
    expect(rango.hasta).toBe("2026-09-08");
  });

  it("cabe dentro del tope, o la pantalla abriria en un estado que ella rechaza", () => {
    const rango = rangoPorDefecto(new Date("2026-09-08T18:00:00.000Z"));
    const dias = diasDeNegocioEntre(rango.desde, rango.hasta);
    expect(dias).toHaveLength(MAXIMO_DIAS_DE_RANGO);
  });
});

describe("validarBusqueda", () => {
  const ahora = new Date("2026-09-08T18:00:00.000Z");

  it("exige al menos un criterio: sin ninguno no se ejecuta", () => {
    const resultado = validarBusqueda({}, ahora);
    expect(resultado.ok).toBe(false);
    expect(resultado.ok === false && resultado.motivos).toContain(
      "sin_criterio",
    );
  });

  it("un tipo de agregado sin identificador no es un criterio", () => {
    // El select de tipo solo acota las opciones del de identificador; por si
    // solo no dice que buscar.
    const resultado = validarBusqueda({ agregado: "LOTE" }, ahora);
    expect(resultado.ok === false && resultado.motivos).toContain(
      "sin_criterio",
    );
  });

  it.each([
    ["identificador", { agregado: "LOTE", agregadoId: "L1" }],
    ["tipo de evento", { tipo: "LOTE_ADJUDICADO" }],
    ["participante", { participanteId: "P1" }],
  ])("basta un %s completo", (_caso, criterios) => {
    expect(validarBusqueda(criterios, ahora).ok).toBe(true);
  });

  it("sin fechas aplica el rango por defecto en vez de fallar", () => {
    // Un enlace guardado en favoritos no tiene por que traerlas.
    const resultado = validarBusqueda({ participanteId: "P1" }, ahora);
    expect(resultado.ok && resultado.busqueda.rango).toEqual({
      desde: "2026-08-09",
      hasta: "2026-09-08",
    });
  });

  it("conserva las fechas que si llegan", () => {
    const resultado = validarBusqueda(
      { participanteId: "P1", desde: "2026-09-01", hasta: "2026-09-03" },
      ahora,
    );
    expect(resultado.ok && resultado.busqueda.rango).toEqual({
      desde: "2026-09-01",
      hasta: "2026-09-03",
    });
  });

  it("rechaza un rango invertido en vez de reordenarlo", () => {
    const resultado = validarBusqueda(
      { participanteId: "P1", desde: "2026-09-05", hasta: "2026-09-01" },
      ahora,
    );
    expect(resultado.ok === false && resultado.motivos).toContain(
      "rango_invalido",
    );
  });

  it("rechaza un dia que no existe, y no lo sustituye por el defecto", () => {
    // Sustituirlo en silencio le mostraria a quien escribio esa fecha una
    // bitacora que no es la que pidio.
    const resultado = validarBusqueda(
      { participanteId: "P1", desde: "2026-02-30", hasta: "2026-03-05" },
      ahora,
    );
    expect(resultado.ok === false && resultado.motivos).toContain(
      "rango_invalido",
    );
  });

  it("acota el rango global al tope de particiones", () => {
    const resultado = validarBusqueda(
      { tipo: "LOTE_ADJUDICADO", desde: "2026-06-01", hasta: "2026-09-08" },
      ahora,
    );
    expect(resultado.ok === false && resultado.motivos).toContain(
      "rango_excedido",
    );
  });

  it("admite exactamente el tope", () => {
    expect(
      validarBusqueda(
        { tipo: "LOTE_ADJUDICADO", desde: "2026-08-09", hasta: "2026-09-08" },
        ahora,
      ).ok,
    ).toBe(true);
  });

  it("con identificador no hay tope: esa lectura es de una sola particion", () => {
    // Es lo que permite que un enlace desde la pantalla de una convocatoria
    // abra su historia completa aunque empiece hace meses.
    const resultado = validarBusqueda(
      {
        agregado: "CONVOCATORIA",
        agregadoId: "C1",
        desde: "2025-01-01",
        hasta: "2026-09-08",
      },
      ahora,
    );
    expect(resultado.ok).toBe(true);
  });

  it("descarta valores que no pertenecen a los catalogos", () => {
    const resultado = validarBusqueda(
      { agregado: "PLANETA", agregadoId: "X1", tipo: "SE_ROMPIO_TODO" },
      ahora,
    );
    // Ni el agregado ni el tipo sobreviven, asi que no queda criterio alguno.
    expect(resultado.ok === false && resultado.motivos).toContain(
      "sin_criterio",
    );
  });

  it("acumula los motivos en vez de reportar solo el primero", () => {
    const resultado = validarBusqueda(
      { desde: "2026-09-05", hasta: "2026-09-01" },
      ahora,
    );
    expect(resultado.ok === false && resultado.motivos).toEqual([
      "rango_invalido",
      "sin_criterio",
    ]);
  });

  it("recorta los espacios de un identificador tecleado", () => {
    const resultado = validarBusqueda(
      { agregado: "LOTE", agregadoId: "  L1  " },
      ahora,
    );
    expect(resultado.ok && resultado.busqueda.agregadoId).toBe("L1");
  });

  it("un identificador de solo espacios no es un criterio", () => {
    const resultado = validarBusqueda(
      { agregado: "LOTE", agregadoId: "   " },
      ahora,
    );
    expect(resultado.ok === false && resultado.motivos).toContain(
      "sin_criterio",
    );
  });
});
