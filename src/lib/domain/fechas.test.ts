// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  aCampoLocal,
  desdeCampoLocal,
  aIso,
  desdeIso,
  desplazamientoEnMinutos,
  diaDeNegocio,
  diasDeNegocioEntre,
  esDiaDeNegocio,
  esInstanteValido,
  formatearFechaHoraPrecisa,
  sumarDiasDeNegocio,
  formatearCuentaRegresiva,
  formatearEspera,
  formatearFecha,
  formatearFechaHora,
  instanteDesdeHoraDeNegocio,
  partesEnZonaDeNegocio,
  ZONA_HORARIA_NEGOCIO,
} from "./fechas";

// Sin red, sin AWS y sin reloj real: todo instante es un literal.
//
// Los casos de horario de verano son **historicos a proposito**. Mexico dejo
// de observarlo en octubre de 2022, asi que hoy el desplazamiento es -6 fijo;
// probar solo con fechas actuales no distinguiria una implementacion correcta
// de un `-6` cableado. Con 2021 se demuestra que el calculo consulta la base
// de datos IANA.

const instante = (iso: string): Date => {
  const valor = desdeIso(iso);
  if (!valor) throw new Error(`literal de prueba invalido: ${iso}`);
  return valor;
};

describe("ZONA_HORARIA_NEGOCIO", () => {
  it("es America/Mexico_City y nada mas (R-04)", () => {
    expect(ZONA_HORARIA_NEGOCIO).toBe("America/Mexico_City");
  });
});

describe("partesEnZonaDeNegocio", () => {
  it("convierte un instante UTC a hora de pared de Mexico", () => {
    expect(partesEnZonaDeNegocio(instante("2026-09-04T12:00:00Z"))).toEqual({
      anio: 2026,
      mes: 9,
      dia: 4,
      hora: 6,
      minuto: 0,
      segundo: 0,
    });
  });

  it("usa mes 1-12, no el 0-11 de Date", () => {
    const enero = partesEnZonaDeNegocio(instante("2026-01-15T18:00:00Z"));
    expect(enero.mes).toBe(1);
    const diciembre = partesEnZonaDeNegocio(instante("2026-12-15T18:00:00Z"));
    expect(diciembre.mes).toBe(12);
  });

  it("normaliza la medianoche a 0 y no a 24", () => {
    // 06:00Z es exactamente 00:00 en Mexico con desplazamiento -6. Algunas
    // versiones de ICU devuelven "24" con hour12:false.
    expect(partesEnZonaDeNegocio(instante("2026-09-04T06:00:00Z")).hora).toBe(
      0,
    );
  });

  it("aplica el horario de verano historico de 2021", () => {
    // Julio de 2021: Mexico observaba horario de verano, desplazamiento -5.
    expect(partesEnZonaDeNegocio(instante("2021-07-01T12:00:00Z")).hora).toBe(
      7,
    );
    // Enero de 2021: horario estandar, desplazamiento -6.
    expect(partesEnZonaDeNegocio(instante("2021-01-01T12:00:00Z")).hora).toBe(
      6,
    );
  });

  it("rechaza una fecha invalida en vez de devolver NaN", () => {
    expect(() => partesEnZonaDeNegocio(new Date("no es fecha"))).toThrow(
      RangeError,
    );
  });
});

describe("desplazamientoEnMinutos", () => {
  it("es -360 en horario estandar", () => {
    expect(desplazamientoEnMinutos(instante("2026-09-04T12:00:00Z"))).toBe(
      -360,
    );
  });

  it("es -300 durante el horario de verano historico", () => {
    expect(desplazamientoEnMinutos(instante("2021-07-01T12:00:00Z"))).toBe(
      -300,
    );
  });

  it("no lo altera el milisegundo del instante", () => {
    expect(desplazamientoEnMinutos(new Date("2026-09-04T12:00:00.777Z"))).toBe(
      -360,
    );
  });

  it("cambia exactamente en el instante de la transicion de 2021", () => {
    // El retroceso de otono de 2021 ocurrio a las 07:00Z.
    expect(desplazamientoEnMinutos(instante("2021-10-31T06:59:59Z"))).toBe(
      -300,
    );
    expect(desplazamientoEnMinutos(instante("2021-10-31T07:00:00Z"))).toBe(
      -360,
    );
  });
});

describe("aIso y desdeIso", () => {
  it("hacen ida y vuelta sin perder informacion", () => {
    const original = "2026-09-04T12:34:56.789Z";
    expect(aIso(instante(original))).toBe(original);
  });

  it("aIso produce siempre la forma canonica con Z", () => {
    expect(aIso(new Date(Date.UTC(2026, 8, 4, 12, 0, 0)))).toBe(
      "2026-09-04T12:00:00.000Z",
    );
  });

  it("desdeIso acepta la forma canonica con y sin milisegundos", () => {
    expect(desdeIso("2026-09-04T12:00:00Z")).toBeInstanceOf(Date);
    expect(desdeIso("2026-09-04T12:00:00.000Z")).toBeInstanceOf(Date);
  });

  it.each([
    ["solo fecha", "2026-09-04"],
    ["con desplazamiento propio", "2026-09-04T12:00:00-06:00"],
    ["sin zona", "2026-09-04T12:00:00"],
    ["con espacio en vez de T", "2026-09-04 12:00:00Z"],
    ["vacio", ""],
    ["texto libre", "manana a las 5"],
    ["30 de febrero", "2026-02-30T00:00:00Z"],
    ["31 de abril", "2026-04-31T00:00:00Z"],
    ["29 de febrero en anio no bisiesto", "2026-02-29T00:00:00Z"],
    ["mes 13", "2026-13-01T00:00:00Z"],
    ["hora 25", "2026-09-04T25:00:00Z"],
  ])("desdeIso rechaza %s", (_caso, texto) => {
    expect(desdeIso(texto)).toBeUndefined();
  });

  it("acepta el 29 de febrero de un anio bisiesto", () => {
    expect(desdeIso("2028-02-29T00:00:00Z")).toBeInstanceOf(Date);
  });

  it("rechazar lo no canonico protege el orden de las claves", () => {
    // `<fecha>#<id>` en GSI2SK y `<venceEn>` en GSI4SK se comparan
    // lexicograficamente. Una variante con desplazamiento propio ordenaria
    // distinto que su equivalente en Z aunque representen el mismo instante.
    expect(desdeIso("2026-09-04T06:00:00-06:00")).toBeUndefined();
    expect(desdeIso("2026-09-04T12:00:00Z")).toBeInstanceOf(Date);
  });

  it("aIso rechaza una fecha invalida", () => {
    expect(() => aIso(new Date(NaN))).toThrow(RangeError);
  });
});

describe("esInstanteValido", () => {
  it("distingue una fecha utilizable de una invalida", () => {
    expect(esInstanteValido(new Date("2026-09-04T00:00:00Z"))).toBe(true);
    expect(esInstanteValido(new Date(NaN))).toBe(false);
  });
});

describe("diaDeNegocio", () => {
  it("da el dia de Mexico, no el de UTC", () => {
    // 2026-09-05 02:00Z son las 20:00 del dia 4 en Mexico. Un dia UTC mandaria
    // este vencimiento a la particion del 5 y el operador que busca "los
    // vencimientos del 4" no lo encontraria.
    expect(diaDeNegocio(instante("2026-09-05T02:00:00Z"))).toBe("2026-09-04");
  });

  it("cambia de dia a las 06:00Z, que es la medianoche de Mexico", () => {
    expect(diaDeNegocio(instante("2026-09-04T05:59:59Z"))).toBe("2026-09-03");
    expect(diaDeNegocio(instante("2026-09-04T06:00:00Z"))).toBe("2026-09-04");
  });

  it("rellena mes y dia con ceros para que ordene lexicograficamente", () => {
    expect(diaDeNegocio(instante("2026-01-05T18:00:00Z"))).toBe("2026-01-05");
  });

  it("los dias sucesivos ordenan como cadenas", () => {
    const dias = [
      diaDeNegocio(instante("2026-01-09T18:00:00Z")),
      diaDeNegocio(instante("2026-01-10T18:00:00Z")),
      diaDeNegocio(instante("2026-02-01T18:00:00Z")),
    ];
    expect([...dias].sort()).toEqual(dias);
  });

  it("cruza el fin de ano correctamente", () => {
    // 2027-01-01 03:00Z son las 21:00 del 31 de diciembre en Mexico.
    expect(diaDeNegocio(instante("2027-01-01T03:00:00Z"))).toBe("2026-12-31");
  });
});

describe("instanteDesdeHoraDeNegocio", () => {
  it("convierte una hora de pared en el instante UTC correspondiente", () => {
    const resultado = instanteDesdeHoraDeNegocio({
      anio: 2026,
      mes: 9,
      dia: 10,
      hora: 8,
      minuto: 0,
    });
    expect(resultado && aIso(resultado)).toBe("2026-09-10T14:00:00.000Z");
  });

  it("hace ida y vuelta con partesEnZonaDeNegocio", () => {
    const pared = { anio: 2026, mes: 3, dia: 15, hora: 23, minuto: 45 };
    const convertido = instanteDesdeHoraDeNegocio(pared);
    expect(convertido).toBeDefined();
    expect(partesEnZonaDeNegocio(convertido!)).toMatchObject(pared);
  });

  it("usa el desplazamiento vigente y no uno fijo", () => {
    // Misma hora de pared, dos anios distintos: en 2021 habia horario de
    // verano en julio, en 2026 ya no.
    const en2021 = instanteDesdeHoraDeNegocio({
      anio: 2021,
      mes: 7,
      dia: 1,
      hora: 12,
      minuto: 0,
    });
    const en2026 = instanteDesdeHoraDeNegocio({
      anio: 2026,
      mes: 7,
      dia: 1,
      hora: 12,
      minuto: 0,
    });
    expect(en2021 && aIso(en2021)).toBe("2021-07-01T17:00:00.000Z");
    expect(en2026 && aIso(en2026)).toBe("2026-07-01T18:00:00.000Z");
  });

  it("devuelve undefined para una hora que el salto de primavera se llevo", () => {
    // El 4 de abril de 2021 el reloj de Mexico salto de 01:59 a 03:00: las
    // 02:00 de ese dia no existieron. Devolver el instante mas cercano seria
    // fijarle al administrador una publicacion que no pidio.
    expect(
      instanteDesdeHoraDeNegocio({
        anio: 2021,
        mes: 4,
        dia: 4,
        hora: 2,
        minuto: 0,
      }),
    ).toBeUndefined();
    expect(
      instanteDesdeHoraDeNegocio({
        anio: 2021,
        mes: 4,
        dia: 4,
        hora: 2,
        minuto: 59,
      }),
    ).toBeUndefined();
  });

  it("acepta las horas que si existen alrededor del salto", () => {
    const antes = instanteDesdeHoraDeNegocio({
      anio: 2021,
      mes: 4,
      dia: 4,
      hora: 1,
      minuto: 59,
    });
    const despues = instanteDesdeHoraDeNegocio({
      anio: 2021,
      mes: 4,
      dia: 4,
      hora: 3,
      minuto: 0,
    });
    expect(antes && aIso(antes)).toBe("2021-04-04T07:59:00.000Z");
    expect(despues && aIso(despues)).toBe("2021-04-04T08:00:00.000Z");
  });

  it("en una hora repetida elige la primera ocurrencia", () => {
    // El 31 de octubre de 2021 la 01:00 de Mexico ocurrio dos veces: a las
    // 06:00Z y a las 07:00Z. Se elige la primera, la que no llega despues de
    // lo que el usuario pidio.
    const resultado = instanteDesdeHoraDeNegocio({
      anio: 2021,
      mes: 10,
      dia: 31,
      hora: 1,
      minuto: 0,
    });
    expect(resultado && aIso(resultado)).toBe("2021-10-31T06:00:00.000Z");
  });

  it("la medianoche de negocio es la frontera del dia", () => {
    const medianoche = instanteDesdeHoraDeNegocio({
      anio: 2026,
      mes: 9,
      dia: 4,
      hora: 0,
      minuto: 0,
    });
    expect(medianoche && aIso(medianoche)).toBe("2026-09-04T06:00:00.000Z");
    expect(medianoche && diaDeNegocio(medianoche)).toBe("2026-09-04");
  });
});

describe("formateo para presentacion", () => {
  // No se afirma la cadena exacta: depende de la version de ICU y afirmarla
  // volveria fragil la compuerta. Se afirma que presenta en hora de negocio,
  // que es la propiedad que R-04 exige.
  it("presenta en hora de Mexico y no en UTC", () => {
    const texto = formatearFechaHora(instante("2026-09-05T02:00:00Z"));
    expect(texto).toContain("2026");
    // 02:00Z son las 20:00 del dia 4 en Mexico.
    expect(texto).toMatch(/\b4\b/);
    expect(texto).not.toMatch(/\b5\b/);
  });

  it("formatearFecha omite la hora", () => {
    const texto = formatearFecha(instante("2026-09-04T18:00:00Z"));
    expect(texto).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("campos datetime-local", () => {
  it("interpreta la hora de pared como hora de negocio, no como UTC", () => {
    // Septiembre: Mexico ya no observa horario de verano desde octubre de 2022,
    // asi que el centro esta en UTC-6 todo el ano.
    expect(desdeCampoLocal("2026-09-10T08:00")?.toISOString()).toBe(
      "2026-09-10T14:00:00.000Z",
    );
  });

  it("da la vuelta completa sin perder el instante", () => {
    const original = "2026-09-10T08:00";
    const instante = desdeCampoLocal(original);
    expect(instante).toBeDefined();
    expect(aCampoLocal(instante!)).toBe(original);
  });

  it("rellena el campo con la hora de negocio y no con UTC", () => {
    // El mismo instante que arriba: si se formateara en UTC diria 14:00.
    expect(aCampoLocal(new Date("2026-09-10T14:00:00.000Z"))).toBe(
      "2026-09-10T08:00",
    );
  });

  it("rechaza un texto que no tiene la forma del campo", () => {
    expect(desdeCampoLocal("")).toBeUndefined();
    expect(desdeCampoLocal("2026-09-10")).toBeUndefined();
    expect(desdeCampoLocal("2026-09-10T08:00:00Z")).toBeUndefined();
  });

  it("rechaza una fecha que no existe en el calendario", () => {
    expect(desdeCampoLocal("2026-02-30T08:00")).toBeUndefined();
  });

  it("respeta el horario de verano historico", () => {
    // Abril de 2021, cuando Mexico todavia lo observaba: el centro estaba en
    // UTC-5. Sin esto, un `-6` cableado pasaria las pruebas de hoy y fallaria
    // con cualquier fecha anterior a octubre de 2022.
    expect(desdeCampoLocal("2021-04-10T08:00")?.toISOString()).toBe(
      "2021-04-10T13:00:00.000Z",
    );
  });
});

describe("campos datetime-local con segundos", () => {
  it("acepta los segundos que anade algun navegador y los descarta", () => {
    expect(desdeCampoLocal("2026-09-10T08:00:00")?.toISOString()).toBe(
      "2026-09-10T14:00:00.000Z",
    );
  });
});

describe("formatearEspera", () => {
  const ahora = new Date("2026-09-07T18:00:00.000Z");
  const hace = (ms: number): Date => new Date(ahora.getTime() - ms);

  const MINUTO = 60_000;
  const HORA = 60 * MINUTO;
  const DIA = 24 * HORA;

  it("cuenta en dias cuando el intervalo pasa de un dia", () => {
    expect(formatearEspera(hace(3 * DIA), ahora, "es")).toBe("hace 3 días");
  });

  it("cuenta en horas por debajo de un dia", () => {
    // "hace 0 dias" no le dice nada a quien revisa una bandeja por antiguedad.
    expect(formatearEspera(hace(5 * HORA), ahora, "es")).toBe("hace 5 horas");
  });

  it("cuenta en minutos por debajo de una hora", () => {
    expect(formatearEspera(hace(20 * MINUTO), ahora, "es")).toBe(
      "hace 20 minutos",
    );
  });

  it("no redondea hacia arriba: 47 horas siguen siendo un dia", () => {
    // Truncar y no redondear es deliberado. Decir "hace 2 dias" de algo que
    // lleva 47 horas exagera la espera justo donde se decide a que atender
    // primero.
    expect(formatearEspera(hace(47 * HORA), ahora, "es")).toBe("hace 1 día");
  });

  it("no usa palabras de calendario que no comprobo", () => {
    // Con `numeric: "auto"` esto diria "ayer", y en la pared fue anteayer:
    // el calculo son milisegundos transcurridos, no dias del calendario.
    expect(formatearEspera(hace(47 * HORA), ahora, "es")).not.toBe("ayer");
  });

  it("cambia de unidad justo en el limite", () => {
    expect(formatearEspera(hace(DIA), ahora, "es")).toBe("hace 1 día");
    expect(formatearEspera(hace(DIA - 1), ahora, "es")).toBe("hace 23 horas");
  });

  it("traduce al idioma que se le pide", () => {
    expect(formatearEspera(hace(3 * DIA), ahora, "en")).toBe("3 days ago");
  });

  it("dice que un instante futuro esta por venir, en vez de fingir que paso", () => {
    // Una fecha mal capturada no debe leerse como una espera larga.
    const futuro = new Date(ahora.getTime() + 2 * HORA);
    expect(formatearEspera(futuro, ahora, "es")).toBe("dentro de 2 horas");
  });
});

describe("formatearCuentaRegresiva", () => {
  const MINUTO = 60;
  const HORA = 60 * MINUTO;
  const DIA = 24 * HORA;

  it("muestra dias y horas cuando faltan mas de 24 horas", () => {
    expect(formatearCuentaRegresiva(2 * DIA + 4 * HORA, "es")).toBe("2 d 4 h");
  });

  it("muestra horas y minutos por debajo de un dia", () => {
    expect(formatearCuentaRegresiva(5 * HORA + 30 * MINUTO, "es")).toBe(
      "5 h 30 min",
    );
  });

  it("muestra solo minutos por debajo de una hora", () => {
    expect(formatearCuentaRegresiva(45 * MINUTO, "es")).toBe("45 min");
  });

  it("cambia de unidad justo en el limite de un dia", () => {
    expect(formatearCuentaRegresiva(DIA, "es")).toBe("1 d 0 h");
    expect(formatearCuentaRegresiva(DIA - 1, "es")).toBe("23 h 59 min");
  });

  it("nunca es negativo: un objetivo ya pasado se trata como cero", () => {
    expect(formatearCuentaRegresiva(-30, "es")).toBe("0 min");
  });

  it("trunca segundos sueltos en vez de redondear hacia arriba", () => {
    // 59 segundos no deben adelantar la cuenta a "1 min": mostrar un minuto
    // que en realidad todavia no se cumple invitaria a actuar antes de tiempo.
    expect(formatearCuentaRegresiva(59, "es")).toBe("0 min");
  });

  it("traduce al idioma que se le pide", () => {
    expect(formatearCuentaRegresiva(2 * DIA + 4 * HORA, "en")).toBe(
      "2 days 4 hr",
    );
  });
});

describe("esDiaDeNegocio", () => {
  it("acepta un dia que existe", () => {
    expect(esDiaDeNegocio("2026-09-08")).toBe(true);
  });

  it("rechaza un dia que el calendario no tiene", () => {
    // El parser de V8 lo desbordaria al 2 de marzo en silencio, que es el
    // mismo defecto que `desdeIso` corrige con la verificacion de ida y vuelta.
    expect(esDiaDeNegocio("2026-02-30")).toBe(false);
  });

  it("acepta el 29 de febrero de un ano bisiesto y lo rechaza si no lo es", () => {
    expect(esDiaDeNegocio("2024-02-29")).toBe(true);
    expect(esDiaDeNegocio("2026-02-29")).toBe(false);
  });

  it("rechaza cualquier forma que no sea yyyy-mm-dd", () => {
    expect(esDiaDeNegocio("2026-9-8")).toBe(false);
    expect(esDiaDeNegocio("2026-09-08T00:00:00.000Z")).toBe(false);
    expect(esDiaDeNegocio("")).toBe(false);
    expect(esDiaDeNegocio("ayer")).toBe(false);
  });
});

describe("sumarDiasDeNegocio", () => {
  it("avanza y retrocede dias del calendario", () => {
    expect(sumarDiasDeNegocio("2026-09-08", 1)).toBe("2026-09-09");
    expect(sumarDiasDeNegocio("2026-09-08", -30)).toBe("2026-08-09");
  });

  it("cruza el fin de mes y el fin de ano", () => {
    expect(sumarDiasDeNegocio("2026-01-31", 1)).toBe("2026-02-01");
    expect(sumarDiasDeNegocio("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDiasDeNegocio("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("cuenta el dia bisiesto", () => {
    expect(sumarDiasDeNegocio("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("no se desplaza en el dia de un cambio de horario historico", () => {
    // Mexico adelanto el reloj el 4 de abril de 2021: ese dia duro 23 horas.
    // Sumar milisegundos habria devuelto el 4 en vez del 5.
    expect(sumarDiasDeNegocio("2021-04-04", 1)).toBe("2021-04-05");
    // Y retrocedio el 31 de octubre de 2021, un dia de 25 horas.
    expect(sumarDiasDeNegocio("2021-10-31", 1)).toBe("2021-11-01");
  });

  it("devuelve undefined si el dia de partida no existe", () => {
    expect(sumarDiasDeNegocio("2026-02-30", 1)).toBeUndefined();
  });
});

describe("diasDeNegocioEntre", () => {
  it("incluye los dos extremos", () => {
    expect(diasDeNegocioEntre("2026-09-06", "2026-09-08")).toEqual([
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
    ]);
  });

  it("un rango de un solo dia devuelve ese dia", () => {
    expect(diasDeNegocioEntre("2026-09-08", "2026-09-08")).toEqual([
      "2026-09-08",
    ]);
  });

  it("devuelve los dias en orden ascendente, que es lo que hace que la bitacora global quede cronologica sin ordenar", () => {
    const dias = diasDeNegocioEntre("2026-08-30", "2026-09-02");
    expect(dias).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ]);
  });

  it("no pierde ni repite dias en un rango con cambio de horario historico", () => {
    const dias = diasDeNegocioEntre("2021-10-30", "2021-11-02");
    expect(dias).toEqual([
      "2021-10-30",
      "2021-10-31",
      "2021-11-01",
      "2021-11-02",
    ]);
    expect(new Set(dias).size).toBe(dias?.length);
  });

  it("cuenta exactamente 31 dias para un rango de 31 dias", () => {
    expect(diasDeNegocioEntre("2026-08-09", "2026-09-08")).toHaveLength(31);
  });

  it("devuelve undefined si el rango esta invertido", () => {
    expect(diasDeNegocioEntre("2026-09-08", "2026-09-06")).toBeUndefined();
  });

  it("devuelve undefined si un extremo no es un dia valido", () => {
    expect(diasDeNegocioEntre("2026-02-30", "2026-03-05")).toBeUndefined();
    expect(diasDeNegocioEntre("2026-03-01", "no-es-un-dia")).toBeUndefined();
  });
});

describe("formatearFechaHoraPrecisa", () => {
  it("conserva el milisegundo, que es toda la resolucion que el dato tiene", () => {
    const texto = formatearFechaHoraPrecisa(
      new Date("2026-09-08T22:03:07.045Z"),
    );
    expect(texto).toContain("045");
    expect(texto).toContain("07.045");
  });

  it("presenta en hora de negocio y no en UTC", () => {
    // 22:03 UTC son las 16:03 en Mexico (UTC-6).
    const instante = new Date("2026-09-08T22:03:07.045Z");
    const { hora } = partesEnZonaDeNegocio(instante);
    expect(formatearFechaHoraPrecisa(instante)).toContain(`${hora}:03:07.045`);
    expect(hora).toBe(16);
  });

  it("usa reloj de 24 horas: sin a. m./p. m. que ocupe columna", () => {
    const texto = formatearFechaHoraPrecisa(
      new Date("2026-09-08T22:03:07.045Z"),
    );
    expect(texto).not.toMatch(/[ap]\.?\s?m/i);
  });

  it("rellena a tres digitos un milisegundo de un solo digito", () => {
    // Sin relleno, ".5" ordenaria despues de ".45" a la vista de quien lee.
    expect(
      formatearFechaHoraPrecisa(new Date("2026-09-08T22:03:07.005Z")),
    ).toContain("07.005");
  });
});
