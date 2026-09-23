// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  calcularSiguientePaso,
  type ConvocatoriaParaSiguientePaso,
  type SolicitudParaSiguientePaso,
} from "./siguientePaso";

const AHORA = new Date("2026-09-23T18:00:00.000Z");

const solicitud = (
  extra: Partial<SolicitudParaSiguientePaso> = {},
): SolicitudParaSiguientePaso => ({
  solicitudId: "SOL1",
  convocatoriaId: "CONV1",
  loteId: "LOTE1",
  marca: "Nissan",
  modelo: 2019,
  grupo: "REQUIERE_ATENCION",
  venceEn: "2026-09-24T18:00:00.000Z",
  ...extra,
});

const convocatoria = (
  extra: Partial<ConvocatoriaParaSiguientePaso> = {},
): ConvocatoriaParaSiguientePaso => ({
  convocatoriaId: "CONV1",
  nombre: "Renovacion 2026",
  inicioVenta: "2026-09-23T17:00:00.000Z",
  finVenta: "2026-09-25T17:00:00.000Z",
  cantidadDeLotes: 4,
  ...extra,
});

const calcular = (
  solicitudes: SolicitudParaSiguientePaso[],
  convocatorias: ConvocatoriaParaSiguientePaso[],
  truncada = false,
) =>
  calcularSiguientePaso({ solicitudes, truncada, convocatorias, ahora: AHORA });

describe("calcularSiguientePaso", () => {
  it("sin nada que hacer no devuelve ningun paso", () => {
    expect(calcular([], [])).toBeUndefined();
  });

  it("el plazo corriendo gana a la venta abierta", () => {
    // Es la prioridad que justifica la pantalla: la venta abierta se puede
    // atender mañana, el plazo no.
    const paso = calcular([solicitud()], [convocatoria()]);

    expect(paso?.tipo).toBe("PLAZO_CORRIENDO");
  });

  it("entre varios plazos manda el que vence antes, no el mas reciente", () => {
    const paso = calcular(
      [
        solicitud({
          solicitudId: "SOL_NUEVA",
          loteId: "LOTE_NUEVO",
          venceEn: "2026-09-26T18:00:00.000Z",
        }),
        solicitud({
          solicitudId: "SOL_VIEJA",
          loteId: "LOTE_VIEJO",
          venceEn: "2026-09-24T06:00:00.000Z",
        }),
      ],
      [],
    );

    expect(paso).toMatchObject({
      tipo: "PLAZO_CORRIENDO",
      loteId: "LOTE_VIEJO",
    });
  });

  it("solo cuenta como plazo lo que requiere atencion", () => {
    // `REQUIERE_ATENCION` es "ADJUDICADA con el plazo todavia corriendo". Una
    // adjudicada con el plazo ya vencido cae en `ACTIVA` y no tiene nada que
    // ofrecer: no se puede subir el comprobante.
    const paso = calcular(
      [solicitud({ grupo: "ACTIVA" }), solicitud({ grupo: "HISTORICA" })],
      [],
    );

    expect(paso).toBeUndefined();
  });

  it("una solicitud sin venceEn no arma una cuenta regresiva", () => {
    expect(calcular([solicitud({ venceEn: undefined })], [])).toBeUndefined();
  });

  it("con la lista truncada avisa del plazo pero no dice cual vence antes", () => {
    // `listarMisSolicitudes` recorta a las 100 mas recientes, asi que una mas
    // vieja que quedo fuera pudo tener un vencimiento anterior. Nombrar una
    // seria afirmar algo que el dato no sostiene, y sobre un plazo eso cuesta
    // un vehiculo.
    const paso = calcular([solicitud()], [], true);

    expect(paso).toEqual({ tipo: "PLAZO_CORRIENDO_SIN_PRECISAR" });
  });

  it("con la lista truncada y sin ningun plazo vivo sigue de largo", () => {
    const paso = calcular(
      [solicitud({ grupo: "HISTORICA" })],
      [convocatoria()],
      true,
    );

    expect(paso?.tipo).toBe("VENTA_ABIERTA");
  });

  it("una sola venta abierta se nombra, con cuantos vehiculos tiene", () => {
    expect(calcular([], [convocatoria()])).toEqual({
      tipo: "VENTA_ABIERTA",
      convocatoriaId: "CONV1",
      nombre: "Renovacion 2026",
      cantidadDeLotes: 4,
    });
  });

  it("con varias abiertas se cuentan en vez de elegir una", () => {
    const paso = calcular(
      [],
      [convocatoria(), convocatoria({ convocatoriaId: "CONV2" })],
    );

    expect(paso).toEqual({ tipo: "VARIAS_VENTAS_ABIERTAS", cantidad: 2 });
  });

  it("sin ninguna abierta anuncia la proxima apertura, la mas cercana", () => {
    const paso = calcular(
      [],
      [
        convocatoria({
          convocatoriaId: "CONV_LEJOS",
          nombre: "Diciembre",
          inicioVenta: "2026-12-01T17:00:00.000Z",
          finVenta: "2026-12-05T17:00:00.000Z",
        }),
        convocatoria({
          convocatoriaId: "CONV_CERCA",
          nombre: "Octubre",
          inicioVenta: "2026-10-01T17:00:00.000Z",
          finVenta: "2026-10-05T17:00:00.000Z",
        }),
      ],
    );

    expect(paso).toEqual({
      tipo: "PROXIMA_APERTURA",
      nombre: "Octubre",
      inicioVenta: "2026-10-01T17:00:00.000Z",
    });
  });

  it("una venta ya cerrada no se anuncia como proxima", () => {
    const paso = calcular(
      [],
      [
        convocatoria({
          inicioVenta: "2026-09-01T17:00:00.000Z",
          finVenta: "2026-09-05T17:00:00.000Z",
        }),
      ],
    );

    expect(paso).toBeUndefined();
  });

  it("en el instante exacto de la apertura la venta ya esta abierta", () => {
    // Misma frontera semiabierta que `ventaAbierta` y que el paso 1 de T1. Si
    // esta pantalla usara otra inclusividad, diria "abre en 0 segundos" cuando
    // la base de datos ya acepta solicitudes.
    const paso = calcularSiguientePaso({
      solicitudes: [],
      truncada: false,
      convocatorias: [
        convocatoria({
          inicioVenta: AHORA.toISOString(),
          finVenta: "2026-09-25T17:00:00.000Z",
        }),
      ],
      ahora: AHORA,
    });

    expect(paso?.tipo).toBe("VENTA_ABIERTA");
  });

  it("una convocatoria con fechas ilegibles se omite en vez de contarse", () => {
    const paso = calcular([], [convocatoria({ inicioVenta: "no es fecha" })]);

    expect(paso).toBeUndefined();
  });
});
