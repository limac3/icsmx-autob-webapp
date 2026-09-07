// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DatosConvocatoria } from "@/types/convocatoria";
import {
  LIMITES_CONVOCATORIA,
  normalizarDatosConvocatoria,
  revisarDatosConvocatoria,
  revisarEnvioAAprobacion,
  validarDatosConvocatoria,
} from "./convocatorias";

const VALIDA: DatosConvocatoria = {
  tipo: "EMPLEADOS",
  descripcionParticipacion: "Abierta al personal de flotilla.",
  publicadaEn: "2026-03-01T15:00:00.000Z",
  inicioVenta: "2026-03-05T15:00:00.000Z",
  finVenta: "2026-03-12T15:00:00.000Z",
  horasLiquidacion: 48,
};

const con = (cambios: Partial<DatosConvocatoria>): DatosConvocatoria => ({
  ...VALIDA,
  ...cambios,
});

describe("revisarDatosConvocatoria", () => {
  it("acepta una convocatoria bien formada", () => {
    expect(revisarDatosConvocatoria(VALIDA)).toEqual({});
  });

  it("devuelve todos los errores de una vez, no solo el primero", () => {
    // Quien captura merece la lista completa en un envio. Si esto se rompe, el
    // formulario obliga a descubrir los errores de uno en uno.
    const errores = revisarDatosConvocatoria(
      con({
        descripcionParticipacion: "   ",
        finVenta: "",
        horasLiquidacion: 0,
      }),
    );

    expect(errores).toEqual({
      descripcionParticipacion: "requerido",
      finVenta: "requerido",
      horasLiquidacion: "fuera_de_rango",
    });
  });

  it("rechaza una descripcion de puros espacios", () => {
    expect(
      revisarDatosConvocatoria(con({ descripcionParticipacion: "\t \n" })),
    ).toEqual({ descripcionParticipacion: "requerido" });
  });

  it("rechaza una descripcion que pasa del limite", () => {
    const larga = "x".repeat(LIMITES_CONVOCATORIA.descripcionParticipacion + 1);
    expect(
      revisarDatosConvocatoria(con({ descripcionParticipacion: larga })),
    ).toEqual({ descripcionParticipacion: "muy_largo" });
  });

  it("acepta una descripcion justo en el limite", () => {
    const justa = "x".repeat(LIMITES_CONVOCATORIA.descripcionParticipacion);
    expect(
      revisarDatosConvocatoria(con({ descripcionParticipacion: justa })),
    ).toEqual({});
  });

  it("rechaza un tipo que no esta en el catalogo", () => {
    const errores = revisarDatosConvocatoria(
      con({ tipo: "JUBILADOS" as DatosConvocatoria["tipo"] }),
    );
    expect(errores.tipo).toBe("requerido");
  });
});

describe("fechas (R-14)", () => {
  it("rechaza una fecha que no existe en el calendario", () => {
    // El parser de V8 desborda el 30 de febrero a 2 de marzo en silencio; sin
    // esto, un finVenta mal capturado alargaria la venta dos dias
    // (desafios-implementacion.md seccion 16).
    expect(
      revisarDatosConvocatoria(con({ finVenta: "2026-02-30T15:00:00.000Z" })),
    ).toEqual({ finVenta: "fecha_invalida" });
  });

  it("rechaza publicar despues de abrir la venta", () => {
    const errores = revisarDatosConvocatoria(
      con({ publicadaEn: "2026-03-06T15:00:00.000Z" }),
    );
    // El error se marca en la fecha posterior, que es la que se mueve para
    // arreglarlo.
    expect(errores).toEqual({ inicioVenta: "orden_de_fechas" });
  });

  it("acepta publicar en el mismo instante en que abre la venta", () => {
    // R-14 dice `publicadaEn <= inicioVenta`: el limite es inclusivo.
    expect(
      revisarDatosConvocatoria(con({ publicadaEn: VALIDA.inicioVenta })),
    ).toEqual({});
  });

  it("rechaza una venta que cierra en el mismo instante en que abre", () => {
    // Aqui el limite es estricto: `inicioVenta < finVenta`. Una ventana de
    // duracion cero no admitiria ninguna solicitud.
    expect(
      revisarDatosConvocatoria(con({ finVenta: VALIDA.inicioVenta })),
    ).toEqual({ finVenta: "orden_de_fechas" });
  });

  it("rechaza una venta que cierra antes de abrir", () => {
    expect(
      revisarDatosConvocatoria(con({ finVenta: "2026-03-04T15:00:00.000Z" })),
    ).toEqual({ finVenta: "orden_de_fechas" });
  });

  it("rechaza una fecha con desplazamiento propio en vez de UTC", () => {
    // Es deliberado: `2026-03-05T09:00:00-06:00` lo interpreta distinto cada
    // lector y rompe la comparacion lexicografica de las claves. La conversion
    // desde la hora de pared que teclea el administrador la hace
    // `instanteDesdeHoraDeNegocio` en el adaptador del formulario, no aqui:
    // al dominio le llega el instante ya en UTC (R-04).
    expect(
      revisarDatosConvocatoria(
        con({ inicioVenta: "2026-03-05T09:00:00.000-06:00" }),
      ),
    ).toEqual({ inicioVenta: "fecha_invalida" });
  });

  it("no inventa un error de orden cuando la fecha ni siquiera es valida", () => {
    // Con `inicioVenta` sin parsear no hay nada que comparar: marcar ademas un
    // `orden_de_fechas` mandaria a corregir un campo que esta bien.
    const errores = revisarDatosConvocatoria(
      con({ inicioVenta: "no-es-una-fecha" }),
    );
    expect(errores).toEqual({ inicioVenta: "fecha_invalida" });
  });
});

describe("horas de liquidacion", () => {
  it("rechaza cero, que dejaria la solicitud vencida al nacer", () => {
    expect(revisarDatosConvocatoria(con({ horasLiquidacion: 0 }))).toEqual({
      horasLiquidacion: "fuera_de_rango",
    });
  });

  it("rechaza un valor negativo", () => {
    expect(revisarDatosConvocatoria(con({ horasLiquidacion: -1 }))).toEqual({
      horasLiquidacion: "fuera_de_rango",
    });
  });

  it("rechaza un valor con decimales", () => {
    expect(revisarDatosConvocatoria(con({ horasLiquidacion: 4.5 }))).toEqual({
      horasLiquidacion: "no_es_entero",
    });
  });

  it("rechaza NaN, que es lo que produce un campo numerico vacio", () => {
    expect(
      revisarDatosConvocatoria(con({ horasLiquidacion: Number.NaN })),
    ).toEqual({ horasLiquidacion: "no_es_entero" });
  });

  it.each([
    LIMITES_CONVOCATORIA.horasLiquidacionMinimo,
    LIMITES_CONVOCATORIA.horasLiquidacionMaximo,
  ])("acepta el limite %i", (horas) => {
    expect(revisarDatosConvocatoria(con({ horasLiquidacion: horas }))).toEqual(
      {},
    );
  });

  it("rechaza justo por encima del maximo", () => {
    expect(
      revisarDatosConvocatoria(
        con({
          horasLiquidacion: LIMITES_CONVOCATORIA.horasLiquidacionMaximo + 1,
        }),
      ),
    ).toEqual({ horasLiquidacion: "fuera_de_rango" });
  });
});

describe("normalizarDatosConvocatoria", () => {
  it("recorta la descripcion", () => {
    const normalizada = normalizarDatosConvocatoria(
      con({ descripcionParticipacion: "  Con espacios  " }),
    );
    expect(normalizada.descripcionParticipacion).toBe("Con espacios");
  });

  it("deja las fechas en la forma canonica, con milisegundos", () => {
    // `desdeIso` admite la forma sin milisegundos, pero se guarda siempre la
    // canonica de `toISOString()`: es la que ordena en las claves de DynamoDB,
    // y dos capturas del mismo instante tienen que guardarse identicas para
    // poder compararse como cadenas.
    const normalizada = normalizarDatosConvocatoria(
      con({ inicioVenta: "2026-03-05T15:00:00Z" }),
    );
    expect(normalizada.inicioVenta).toBe("2026-03-05T15:00:00.000Z");
  });
});

describe("validarDatosConvocatoria", () => {
  it("devuelve los datos normalizados cuando son validos", () => {
    const revision = validarDatosConvocatoria(
      con({ descripcionParticipacion: "  Para empleados  " }),
    );
    expect(revision.ok).toBe(true);
    if (revision.ok) {
      expect(revision.datos.descripcionParticipacion).toBe("Para empleados");
    }
  });

  it("no normaliza nada cuando hay errores", () => {
    const revision = validarDatosConvocatoria(con({ horasLiquidacion: 0 }));
    expect(revision.ok).toBe(false);
    if (!revision.ok) {
      expect(revision.errores.horasLiquidacion).toBe("fuera_de_rango");
    }
  });
});

describe("revisarEnvioAAprobacion", () => {
  it("exige al menos un lote", () => {
    expect(
      revisarEnvioAAprobacion({ datos: VALIDA, cantidadDeLotes: 0 }),
    ).toEqual({ lotes: "sin_lotes" });
  });

  it("acepta una convocatoria completa con un lote", () => {
    expect(
      revisarEnvioAAprobacion({ datos: VALIDA, cantidadDeLotes: 1 }),
    ).toEqual({});
  });

  it("acumula la falta de lotes con los errores de los datos", () => {
    // Mandar a aprobacion es la ultima puerta antes de que otra persona
    // dictamine: tiene que quejarse de todo lo que falta, no de lo primero.
    const errores = revisarEnvioAAprobacion({
      datos: con({ horasLiquidacion: 0 }),
      cantidadDeLotes: 0,
    });
    expect(errores).toEqual({
      horasLiquidacion: "fuera_de_rango",
      lotes: "sin_lotes",
    });
  });
});

describe("la descripcion pasa por la revision de HTML", () => {
  it("rechaza marcado que no se admite", () => {
    // La revision vive en `htmlDeDescripcion.ts` y tiene sus propias pruebas.
    // Esta comprueba el **cableado**: sin ella, desconectar la llamada dejaria
    // pasar un script al almacenamiento y ninguna prueba se quejaria.
    const errores = revisarDatosConvocatoria(
      con({ descripcionParticipacion: "<p>hola</p><script>alert(1)</script>" }),
    );
    expect(errores.descripcionParticipacion).toBe("etiqueta_no_admitida");
  });

  it("acepta el marcado que produce el editor", () => {
    expect(
      revisarDatosConvocatoria(
        con({
          descripcionParticipacion:
            "<p>Abierta al <strong>personal</strong>.</p>",
        }),
      ),
    ).toEqual({});
  });
});
