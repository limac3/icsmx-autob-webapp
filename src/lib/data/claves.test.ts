// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ANCHO_ORDEN_FOTO,
  ANCHO_TURNO,
  clave,
  gsi1,
  gsi2,
  gsi3,
  gsi4,
  identificadorDeSolicitud,
  loteYTurnoDesdeIdentificador,
  NOMBRES_DE_INDICE,
  PREFIJO,
  TIPOS_DE_AGREGADO,
  turnoDesdeClave,
} from "./claves";

// Re-derivado a mano de agent_files/modelo-datos-dynamodb.md seccion 2.1. La
// prueba no lee los constructores para armar lo esperado: si compartiera la
// fuente con lo que prueba, un cambio de formato pasaria inadvertido.

describe("claves de la tabla base", () => {
  it.each([
    ["participante", clave.participante("P1"), "PART#P1", "PERFIL"],
    ["vehiculo", clave.vehiculo("V1"), "VEH#V1", "META"],
    ["fotografia", clave.fotografia("V1", 3, "F9"), "VEH#V1", "FOTO#0003#F9"],
    [
      "centinela de vehiculo activo",
      clave.centinelaVehiculoActivo("V1"),
      "VEH#V1",
      "ACTIVO",
    ],
    ["convocatoria", clave.convocatoria("C1"), "CONV#C1", "META"],
    ["lote", clave.lote("C1", "L1"), "CONV#C1", "LOTE#L1"],
    ["solicitud", clave.solicitud("L1", 7), "LOTE#L1", "SOL#0000000007"],
    [
      "centinela de fila",
      clave.centinelaFila("L1", "P1"),
      "LOTE#L1",
      "PART#P1",
    ],
    [
      "centinela de adjudicacion",
      clave.centinelaAdjudicacion("P1"),
      "PART#P1",
      "ADJUDICACION_ACTIVA",
    ],
    [
      "evento",
      clave.evento("SOLICITUD", "S1", "2026-09-15T15:00:00.000Z", "E1"),
      "AUDIT#SOLICITUD#S1",
      "2026-09-15T15:00:00.000Z#E1",
    ],
    ["mensaje", clave.mensaje("M1"), "OUTBOX#M1", "META"],
  ])("%s", (_nombre, producida, PK, SK) => {
    expect(producida).toEqual({ PK, SK });
  });

  it("el lote cuelga de la convocatoria, para que PA-04 sea una sola Query", () => {
    const convocatoria = clave.convocatoria("C1");
    const lote = clave.lote("C1", "L1");
    expect(lote.PK).toBe(convocatoria.PK);
    expect(lote.SK.startsWith(PREFIJO.lote)).toBe(true);
  });

  it("la fotografia y el centinela cuelgan del vehiculo", () => {
    expect(clave.fotografia("V1", 0, "F1").PK).toBe(clave.vehiculo("V1").PK);
    expect(clave.centinelaVehiculoActivo("V1").PK).toBe(
      clave.vehiculo("V1").PK,
    );
  });

  it("la solicitud y el centinela de fila cuelgan del lote", () => {
    expect(clave.solicitud("L1", 1).PK).toBe(
      clave.centinelaFila("L1", "P1").PK,
    );
  });
});

describe("orden de la fila — la garantia de D-5", () => {
  it("rellena el turno a diez digitos", () => {
    expect(clave.solicitud("L1", 1).SK).toBe("SOL#0000000001");
    expect(clave.solicitud("L1", 9_999_999_999).SK).toBe("SOL#9999999999");
  });

  it("el orden lexicografico de las claves es el orden numerico del turno", () => {
    // Es toda la promesa del diseno: `Query` con `ScanIndexForward: true`
    // devuelve la fila ya ordenada, y no existe ningun punto del codigo donde
    // se pueda ordenar mal, porque nunca se ordena.
    const turnos = [1, 2, 9, 10, 11, 99, 100, 101, 1000, 123_456_789];
    const claves = turnos.map((turno) => clave.solicitud("L1", turno).SK);
    expect([...claves].sort()).toEqual(claves);
  });

  it("el orden aguanta huecos, que el diseno acepta", () => {
    // Si el paso 1 de T1 tiene exito y el paso 2 falla, el turno consumido no
    // se reutiliza. La equidad depende del orden relativo, no de la
    // contiguidad.
    const conHuecos = [1, 5, 6, 40, 41, 900];
    const claves = conHuecos.map((turno) => clave.solicitud("L1", turno).SK);
    expect([...claves].sort()).toEqual(claves);
  });

  it("rechaza un turno que desborda el relleno", () => {
    // Sin esta comprobacion el turno 10_000_000_000 se ordenaria antes que el
    // 2, y el orden de la fila —que es la promesa central del sistema (R-08)—
    // se romperia sin ningun sintoma visible.
    expect(() => clave.solicitud("L1", 10_000_000_000)).toThrow(RangeError);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rechaza el turno %s",
    (turno) => {
      expect(() => clave.solicitud("L1", turno)).toThrow(RangeError);
    },
  );

  it("acepta el turno 0", () => {
    // El contador arranca en cero y `ADD` devuelve el valor ya incrementado,
    // asi que el turno 0 no deberia darse; aun asi es un entero valido y
    // rechazarlo seria una regla que este archivo no tiene por que imponer.
    expect(clave.solicitud("L1", 0).SK).toBe("SOL#0000000000");
  });

  it("ANCHO_TURNO son diez digitos", () => {
    expect(ANCHO_TURNO).toBe(10);
  });
});

describe("identificadorDeSolicitud", () => {
  it("es <loteId>-<turno>, sin relleno de ceros", () => {
    expect(identificadorDeSolicitud("L1", 7)).toBe("L1-7");
    expect(identificadorDeSolicitud("L1", 0)).toBe("L1-0");
  });

  it("rechaza un turno invalido, igual que clave.solicitud", () => {
    expect(() => identificadorDeSolicitud("L1", -1)).toThrow(RangeError);
    expect(() => identificadorDeSolicitud("L1", 1.5)).toThrow(RangeError);
  });
});

describe("loteYTurnoDesdeIdentificador — inverso de identificadorDeSolicitud", () => {
  it("hace ida y vuelta con identificadorDeSolicitud", () => {
    for (const [loteId, turno] of [
      ["L1", 1],
      ["01K4X9QZ8T7YF3M2N5P6R8S9V0", 42],
      ["L1", 0],
    ] as const) {
      expect(
        loteYTurnoDesdeIdentificador(identificadorDeSolicitud(loteId, turno)),
      ).toEqual({ loteId, turno });
    }
  });

  it("divide por el ultimo separador, no por el primero", () => {
    // Tesoreria es quien necesita esto: `subirComprobante`, `avalarPago` y
    // `rechazarPago` reciben solo `solicitudId` (api-contracts.md seccion 5) y
    // no hay ningun patron de acceso que lea una solicitud sin conocer antes
    // su loteId.
    expect(loteYTurnoDesdeIdentificador("L1-7")).toEqual({
      loteId: "L1",
      turno: 7,
    });
  });

  it("devuelve undefined para lo que no tiene esa forma", () => {
    expect(
      loteYTurnoDesdeIdentificador("sin-separador-numerico"),
    ).toBeUndefined();
    expect(loteYTurnoDesdeIdentificador("L1-siete")).toBeUndefined();
    expect(loteYTurnoDesdeIdentificador("-7")).toBeUndefined();
    expect(loteYTurnoDesdeIdentificador("7")).toBeUndefined();
  });
});

describe("reserva de turno — el mecanismo de R18", () => {
  it("vive en la particion del lote, junto a la fila", () => {
    expect(clave.reservaDeTurno("L1", "r-9")).toEqual({
      PK: "LOTE#L1",
      SK: "RESERVA#r-9",
    });
    expect(clave.reservaDeTurno("L1", "r-9").PK).toBe(
      clave.solicitud("L1", 1).PK,
    );
  });

  it("ordena entre el centinela de fila y las solicitudes", () => {
    // No es cosmetico. La consulta de la fila (PA-07) usa
    // `begins_with(SK, "SOL#")`, asi que las reservas tienen que quedar fuera
    // de ese rango; y al leer la particion entera aparecen **antes** que las
    // solicitudes, que es el orden que la adjudicacion necesita para no
    // perderse una solicitud que se confirma entre las dos lecturas.
    const claves = [
      clave.centinelaFila("L1", "P1").SK,
      clave.reservaDeTurno("L1", "r1").SK,
      clave.solicitud("L1", 1).SK,
    ];
    expect([...claves].sort()).toEqual(claves);
  });

  it("ninguna reserva se cuela en el rango de la fila", () => {
    expect(clave.reservaDeTurno("L1", "r1").SK).not.toMatch(
      new RegExp(`^${PREFIJO.solicitud}`),
    );
    expect(
      turnoDesdeClave(clave.reservaDeTurno("L1", "r1").SK),
    ).toBeUndefined();
  });

  it("rechaza un identificador de reserva con separador", () => {
    expect(() => clave.reservaDeTurno("L1", "r#1")).toThrow(RangeError);
  });
});

describe("turnoDesdeClave", () => {
  it("hace ida y vuelta con clave.solicitud", () => {
    for (const turno of [0, 1, 42, 9_999_999_999]) {
      expect(turnoDesdeClave(clave.solicitud("L1", turno).SK)).toBe(turno);
    }
  });

  it("devuelve undefined para una SK que no es de solicitud", () => {
    expect(turnoDesdeClave("PART#P1")).toBeUndefined();
    expect(turnoDesdeClave("META")).toBeUndefined();
    expect(turnoDesdeClave("LOTE#L1")).toBeUndefined();
  });

  it("rechaza un relleno de ancho equivocado", () => {
    // Una SK con menos digitos ordenaria distinto; leerla como turno valido
    // ocultaria un item escrito por codigo viejo o por una herramienta manual.
    expect(turnoDesdeClave("SOL#7")).toBeUndefined();
    expect(turnoDesdeClave("SOL#00000000007")).toBeUndefined();
  });

  it("rechaza digitos que no lo son", () => {
    expect(turnoDesdeClave("SOL#00000000ab")).toBeUndefined();
  });
});

describe("orden de las fotografias", () => {
  it("rellena a cuatro digitos y ordena lexicograficamente", () => {
    expect(ANCHO_ORDEN_FOTO).toBe(4);
    const ordenes = [0, 1, 2, 10, 11, 100];
    const claves = ordenes.map(
      (orden) => clave.fotografia("V1", orden, "F").SK,
    );
    expect([...claves].sort()).toEqual(claves);
  });

  it("todas empiezan con el prefijo que las agrupa", () => {
    expect(
      clave.fotografia("V1", 0, "F1").SK.startsWith(PREFIJO.fotografia),
    ).toBe(true);
  });

  it("rechaza un orden que desborda", () => {
    expect(() => clave.fotografia("V1", 10_000, "F1")).toThrow(RangeError);
  });
});

describe("validacion de identificadores", () => {
  it("rechaza un identificador con el separador de claves", () => {
    // Un `#` dentro de un identificador desplaza el resto de la clave. Con
    // `centinelaFila("L1", "P1#X")` se podria fabricar la clave del centinela
    // de otro participante y saltarse R-07.
    expect(() => clave.centinelaFila("L1", "P1#X")).toThrow(/#/);
    expect(() => clave.participante("a#b")).toThrow(RangeError);
    expect(() => clave.lote("C#1", "L1")).toThrow(RangeError);
  });

  it("nombra el campo que viene mal", () => {
    expect(() => clave.lote("C1", "L#1")).toThrow(/loteId/);
    expect(() => clave.fotografia("V#1", 0, "F1")).toThrow(/vehiculoId/);
  });

  it("rechaza un identificador vacio", () => {
    expect(() => clave.vehiculo("")).toThrow(RangeError);
    expect(() => clave.convocatoria("")).toThrow(RangeError);
  });

  it("acepta un ULID, que es la forma real de los identificadores", () => {
    const ulid = "01K4X9QZ8T7YF3M2N5P6R8S9V0";
    expect(clave.participante(ulid)).toEqual({
      PK: `PART#${ulid}`,
      SK: "PERFIL",
    });
  });
});

describe("bitacora", () => {
  it.each(TIPOS_DE_AGREGADO)(
    "agrupa los eventos de %s por agregado",
    (tipo) => {
      const primero = clave.evento(
        tipo,
        "A1",
        "2026-09-15T15:00:00.000Z",
        "E1",
      );
      const segundo = clave.evento(
        tipo,
        "A1",
        "2026-09-15T16:00:00.000Z",
        "E2",
      );
      expect(primero.PK).toBe(segundo.PK);
      expect(primero.PK).toBe(`AUDIT#${tipo}#A1`);
    },
  );

  it("ordena la bitacora de un agregado cronologicamente", () => {
    // `ocurridoEn` va primero en la SK justamente para esto; `eventoId` solo
    // desempata cuando dos eventos comparten milisegundo.
    const claves = [
      "2026-09-15T15:00:00.000Z",
      "2026-09-15T15:00:00.001Z",
      "2026-09-16T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    ].map((ocurridoEn) => clave.evento("LOTE", "L1", ocurridoEn, "E").SK);
    expect([...claves].sort()).toEqual(claves);
  });

  it("dos eventos del mismo milisegundo no colisionan", () => {
    const a = clave.evento("LOTE", "L1", "2026-09-15T15:00:00.000Z", "E1");
    const b = clave.evento("LOTE", "L1", "2026-09-15T15:00:00.000Z", "E2");
    expect(a.SK).not.toBe(b.SK);
  });

  it("particionDeEvento es la misma PK que evento, sin inventar SK (PA-12)", () => {
    const evento = clave.evento("LOTE", "L1", "2026-09-15T15:00:00.000Z", "E1");
    expect(clave.particionDeEvento("LOTE", "L1")).toEqual({ PK: evento.PK });
  });

  it("los cuatro agregados con bitacora son los del documento", () => {
    expect([...TIPOS_DE_AGREGADO]).toEqual([
      "VEHICULO",
      "CONVOCATORIA",
      "LOTE",
      "SOLICITUD",
    ]);
  });
});

describe("GSI1 — identidad alterna", () => {
  it("traduce oktaSub a la clave de particion", () => {
    expect(gsi1.participantePorOkta("00u1abc")).toEqual({
      GSI1PK: "OKTA#00u1abc",
      GSI1SK: "PERFIL",
    });
  });

  it("codifica un sub con caracteres que romperian la clave", () => {
    // El `sub` lo emite Okta y no es un ULID nuestro: puede traer cualquier
    // caracter. Se codifica en lugar de rechazarse, porque no esta en nuestras
    // manos cambiarlo.
    const { GSI1PK } = gsi1.participantePorOkta("auth0|abc#def");
    expect(GSI1PK).not.toContain("#def");
    expect(GSI1PK).toBe("OKTA#auth0%7Cabc%23def");
  });

  it("dos subs distintos no colisionan tras codificarse", () => {
    expect(gsi1.participantePorOkta("a#b").GSI1PK).not.toBe(
      gsi1.participantePorOkta("a%23b").GSI1PK,
    );
  });
});

describe("GSI2 — listados por estatus", () => {
  it("arma la clave de PA-05, convocatorias visibles", () => {
    expect(
      gsi2.porEstatus("CONV", "PUBLICADA", "2026-09-10T14:00:00.000Z", "C1"),
    ).toEqual({
      GSI2PK: "CONV_ESTATUS#PUBLICADA",
      GSI2SK: "2026-09-10T14:00:00.000Z#C1",
    });
  });

  it("la fecha ordena, y por eso el gating es consulta y no filtro", () => {
    // `GSI2SK <= ahora` aplica la segunda pata de R-01 **dentro** de la
    // lectura. Lo que no se recupera no puede filtrarse mal despues.
    const claves = [
      "2026-09-01T00:00:00.000Z",
      "2026-09-10T14:00:00.000Z",
      "2026-12-31T23:59:59.000Z",
    ].map((fecha) => gsi2.porEstatus("CONV", "PUBLICADA", fecha, "C").GSI2SK);
    expect([...claves].sort()).toEqual(claves);
  });

  it("separa los tres tipos de entidad en particiones distintas", () => {
    const claves = new Set(
      (["VEH", "CONV", "SOL"] as const).map(
        (tipo) =>
          gsi2.porEstatus(tipo, "X", "2026-01-01T00:00:00.000Z", "1").GSI2PK,
      ),
    );
    expect(claves.size).toBe(3);
  });

  it("arma la bitacora cronologica global de PA-13", () => {
    expect(
      gsi2.bitacoraDelDia("2026-09-15", "2026-09-15T15:00:00.000Z", "E1"),
    ).toEqual({
      GSI2PK: "AUDIT#2026-09-15",
      GSI2SK: "2026-09-15T15:00:00.000Z#E1",
    });
  });
});

describe("GSI2 — particion de un estatus completo", () => {
  it("da la misma particion que la clave completa", () => {
    // Si divergieran, el listado consultaria una particion en la que nadie
    // escribe y devolveria siempre vacio, sin error.
    expect(gsi2.particionDeEstatus("VEH", "DISPONIBLE").GSI2PK).toBe(
      gsi2.porEstatus("VEH", "DISPONIBLE", "2026-09-05T00:00:00.000Z", "V1")
        .GSI2PK,
    );
  });

  it.each(["VEH", "CONV", "SOL"] as const)("cubre el tipo %s", (tipo) => {
    expect(gsi2.particionDeEstatus(tipo, "X").GSI2PK).toBe(`${tipo}_ESTATUS#X`);
  });

  it("no inventa una clave de ordenamiento", () => {
    // Devolver un `GSI2SK` de relleno invitaria a usarlo en una condicion de
    // rango, que es justo lo que esta consulta no hace.
    expect(gsi2.particionDeEstatus("VEH", "DISPONIBLE")).not.toHaveProperty(
      "GSI2SK",
    );
  });

  it("rechaza un estatus con separador", () => {
    expect(() => gsi2.particionDeEstatus("VEH", "DIS#PONIBLE")).toThrow(
      RangeError,
    );
  });
});

describe("GSI2 — cota superior de PA-05", () => {
  it("incluye un item publicado exactamente en el instante de la cota", () => {
    // El caso que un `GSI2SK <= ahora` a secas se equivocaria: la fecha exacta
    // con cualquier id debe seguir siendo `<=` que la cota.
    const ahora = "2026-09-10T14:00:00.000Z";
    const sk = gsi2.porEstatus("CONV", "PUBLICADA", ahora, "C1").GSI2SK;
    expect(sk <= gsi2.cotaSuperiorPorFecha(ahora)).toBe(true);
  });

  it("excluye un item publicado un milisegundo despues", () => {
    const sk = gsi2.porEstatus(
      "CONV",
      "PUBLICADA",
      "2026-09-10T14:00:00.001Z",
      "C1",
    ).GSI2SK;
    expect(sk <= gsi2.cotaSuperiorPorFecha("2026-09-10T14:00:00.000Z")).toBe(
      false,
    );
  });

  it("es mayor que cualquier id del alfabeto de ULID a esa fecha", () => {
    const ahora = "2026-09-10T14:00:00.000Z";
    const cota = gsi2.cotaSuperiorPorFecha(ahora);
    for (const letra of "0123456789ABCDEFGHJKMNPQRSTVWXYZ") {
      expect(
        gsi2.porEstatus("CONV", "PUBLICADA", ahora, letra.repeat(26)).GSI2SK <=
          cota,
      ).toBe(true);
    }
  });
});

describe("GSI3 — mis solicitudes", () => {
  it("agrupa por participante y ordena por fecha", () => {
    expect(
      gsi3.solicitudDeParticipante("P1", "2026-09-15T15:00:00.000Z", "L1"),
    ).toEqual({
      GSI3PK: "PART#P1",
      GSI3SK: "SOL#2026-09-15T15:00:00.000Z#L1",
    });
  });

  it("aqui solicitadoEn si ordena, y no contradice R-08", () => {
    // Esta es una vista personal por fecha. El orden de la **fila**, que es lo
    // que R-08 protege, sigue viniendo del turno en la tabla base — donde
    // `solicitadoEn` no participa en ninguna clave.
    expect(clave.solicitud("L1", 7).SK).not.toContain("2026");
  });
});

describe("GSI4 — trabajo pendiente", () => {
  it("particiona los vencimientos por dia", () => {
    expect(gsi4.vencimiento("2026-09-17", "2026-09-17T16:30:00.000Z")).toEqual({
      GSI4PK: "VENCE#2026-09-17",
      GSI4SK: "2026-09-17T16:30:00.000Z",
    });
  });

  it("reparte la carga en vez de concentrarla en una particion", () => {
    // Con una clave fija, todo el trabajo pendiente del sistema caeria en una
    // sola particion (riesgo R12).
    const dias = ["2026-09-16", "2026-09-17", "2026-09-18"];
    const particiones = new Set(
      dias.map((dia) => gsi4.vencimiento(dia, `${dia}T00:00:00.000Z`).GSI4PK),
    );
    expect(particiones.size).toBe(3);
  });

  it("ordena los vencimientos del dia para que GSI4SK <= ahora funcione", () => {
    const claves = [
      "2026-09-17T00:00:00.000Z",
      "2026-09-17T16:30:00.000Z",
      "2026-09-17T23:59:59.000Z",
    ].map((venceEn) => gsi4.vencimiento("2026-09-17", venceEn).GSI4SK);
    expect([...claves].sort()).toEqual(claves);
  });

  it("el outbox usa una particion fija, que si es correcta ahi", () => {
    // El volumen de correo pendiente es de otro orden de magnitud y se drena
    // continuamente; no hay riesgo de particion caliente.
    expect(gsi4.outboxPendiente("2026-09-15T15:00:00.000Z")).toEqual({
      GSI4PK: "OUTBOX_PENDIENTE",
      GSI4SK: "2026-09-15T15:00:00.000Z",
    });
  });

  it("los vencimientos y el outbox no comparten particion", () => {
    expect(gsi4.vencimiento("2026-09-17", "x").GSI4PK).not.toBe(
      gsi4.outboxPendiente("x").GSI4PK,
    );
  });
});

describe("nombres de indice", () => {
  it("coinciden con los que crea amplify/tabla.ts", () => {
    expect(Object.values(NOMBRES_DE_INDICE)).toEqual([
      "GSI1",
      "GSI2",
      "GSI3",
      "GSI4",
    ]);
  });
});
