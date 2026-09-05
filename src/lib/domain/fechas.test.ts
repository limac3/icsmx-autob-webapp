// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  aIso,
  desdeIso,
  desplazamientoEnMinutos,
  diaDeNegocio,
  esInstanteValido,
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
