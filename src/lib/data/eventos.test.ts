// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { atributosDeEvento, eventoParaTransaccion } from "./eventos";
import { esId, instanteDeId } from "./identificadores";
import { CONDICION_APPEND_ONLY } from "./transacciones";
import { EVENTOS_CON_MOTIVO_OBLIGATORIO } from "@/types/auditoria";

vi.mock("server-only", () => ({}));

const OCURRIDO_EN = new Date("2026-09-05T18:30:00.000Z");

const base = {
  tipo: "VEHICULO_REGISTRADO",
  agregado: "VEHICULO",
  agregadoId: "V1",
  actor: {
    tipo: "USUARIO",
    id: "P1",
    permisos: ["Autob_Administrar_Vehiculos"],
  },
  ocurridoEn: OCURRIDO_EN,
  correlacionId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
} as const;

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("atributos del evento", () => {
  it("registra quien actuo y con que autoridad", () => {
    const atributos = atributosDeEvento(base);

    expect(atributos).toMatchObject({
      tipo: "VEHICULO_REGISTRADO",
      ocurridoEn: "2026-09-05T18:30:00.000Z",
      actorTipo: "USUARIO",
      actorId: "P1",
      actorPermisos: ["Autob_Administrar_Vehiculos"],
      correlacionId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      vehiculoId: undefined,
    });
  });

  it("guarda los permisos vigentes, no una referencia al arreglo del actor", () => {
    // Si guardara la referencia, mutar la sesion despues cambiaria lo que dice
    // la bitacora sobre un acto ya ocurrido.
    const permisos: string[] = ["Autob_Administrar_Vehiculos"];
    const atributos = atributosDeEvento({
      ...base,
      actor: { tipo: "USUARIO", id: "P1", permisos: permisos as never },
    });
    permisos.push("Autob_Auditar");
    expect(atributos.actorPermisos).toEqual(["Autob_Administrar_Vehiculos"]);
  });

  it("el actor SISTEMA no lleva permisos", () => {
    const atributos = atributosDeEvento({
      ...base,
      tipo: "SOLICITUD_VENCIDA",
      agregado: "SOLICITUD",
      actor: { tipo: "SISTEMA" },
    });

    expect(atributos.actorTipo).toBe("SISTEMA");
    expect(atributos.actorId).toBe("SISTEMA");
    // `removeUndefinedValues` lo descarta al escribir; lo que importa es que no
    // se invente una lista vacia, que se leeria como "actuo sin permisos".
    expect(atributos.actorPermisos).toBeUndefined();
  });

  it("el eventoId es un ULID del mismo instante", () => {
    const atributos = atributosDeEvento(base);
    const eventoId = String(atributos.eventoId);

    expect(esId(eventoId)).toBe(true);
    expect(instanteDeId(eventoId)).toEqual(OCURRIDO_EN);
  });

  it("dos eventos del mismo instante tienen identificadores distintos", () => {
    const uno = atributosDeEvento(base);
    const otro = atributosDeEvento(base);
    expect(uno.eventoId).not.toBe(otro.eventoId);
  });

  it("recorta el motivo y descarta el vacio", () => {
    const atributos = atributosDeEvento({
      ...base,
      tipo: "VEHICULO_RETIRADO",
      motivo: "  siniestro total  ",
    });
    expect(atributos.motivo).toBe("siniestro total");
  });

  it("arrastra los identificadores y el estado que apliquen", () => {
    const atributos = atributosDeEvento({
      ...base,
      tipo: "VEHICULO_EDITADO",
      vehiculoId: "V1",
      estadoAnterior: "DISPONIBLE",
      estadoNuevo: "DISPONIBLE",
      datos: { campos: ["kilometraje"] },
    });

    expect(atributos).toMatchObject({
      vehiculoId: "V1",
      estadoAnterior: "DISPONIBLE",
      estadoNuevo: "DISPONIBLE",
      datos: { campos: ["kilometraje"] },
    });
  });
});

describe("motivo obligatorio", () => {
  it.each(EVENTOS_CON_MOTIVO_OBLIGATORIO)("%s exige motivo", (tipo) => {
    expect(() => atributosDeEvento({ ...base, tipo })).toThrow(/exige motivo/);
  });

  it.each(EVENTOS_CON_MOTIVO_OBLIGATORIO)(
    "%s rechaza un motivo en blanco",
    (tipo) => {
      // Un motivo de espacios pasaria una comprobacion de "esta presente" y
      // dejaria la bitacora igual de muda que si faltara.
      expect(() => atributosDeEvento({ ...base, tipo, motivo: "   " })).toThrow(
        /exige motivo/,
      );
    },
  );

  it("acepta el evento cuando el motivo viene", () => {
    expect(
      atributosDeEvento({
        ...base,
        tipo: "VEHICULO_RETIRADO",
        motivo: "baja por siniestro",
      }).motivo,
    ).toBe("baja por siniestro");
  });

  it("un evento sin motivo obligatorio no lo inventa", () => {
    expect(atributosDeEvento(base).motivo).toBeUndefined();
  });
});

describe("la bitacora ya no se escribe en GSI2", () => {
  it("no lleva ninguna clave de GSI2", () => {
    // El acceso cronologico paso a GSI5..GSI9. Mientras la clave vieja se
    // escribiera, GSI2 duplicaba cada evento —su proyeccion es ALL— y cobraba
    // una escritura de indice por evento para un patron que ya nadie lee.
    const atributos = atributosDeEvento(base);

    expect(atributos.GSI2PK).toBeUndefined();
    expect(atributos.GSI2SK).toBeUndefined();
  });

  it("el dia y el mes de los indices nuevos son de negocio, no de UTC", () => {
    // 2026-09-06T04:00Z son las 22:00 del 5 de septiembre en Mexico. El auditor
    // que pide "todo lo del 5" tiene que encontrarlo ahi.
    const atributos = atributosDeEvento({
      ...base,
      ocurridoEn: new Date("2026-09-06T04:00:00.000Z"),
    });

    expect(atributos.diaPK).toBe("DIA#2026-09-05");
    expect(atributos.mesPK).toBe("MES#2026-09");
  });

  it("ordena cronologicamente dentro de la particion del mes", () => {
    const temprano = atributosDeEvento({
      ...base,
      ocurridoEn: new Date("2026-09-05T14:00:00.000Z"),
    });
    const tarde = atributosDeEvento({
      ...base,
      ocurridoEn: new Date("2026-09-05T15:00:00.000Z"),
    });

    expect(String(temprano.cronoSK) < String(tarde.cronoSK)).toBe(true);
    expect(temprano.mesPK).toBe(tarde.mesPK);
  });

  it("la clave cronologica repite el instante y el identificador del evento", () => {
    const atributos = atributosDeEvento(base);
    expect(atributos.cronoSK).toBe(
      `${String(atributos.ocurridoEn)}#${String(atributos.eventoId)}`,
    );
  });
});

describe("eventoParaTransaccion", () => {
  it("ancla el evento en la particion de su agregado", () => {
    const item = eventoParaTransaccion(base);
    const put = "Put" in item.item ? item.item.Put : undefined;

    expect(put?.Item).toMatchObject({
      PK: "AUDIT#VEHICULO#V1",
      tipo: "VEHICULO_REGISTRADO",
    });
    expect(String(put?.Item?.SK)).toBe(
      `${String(put?.Item?.ocurridoEn)}#${String(put?.Item?.eventoId)}`,
    );
  });

  it("lleva siempre la condicion append-only", () => {
    // Sin ella la bitacora no es append-only: un `Put` con la misma clave
    // reemplaza el item completo, e IAM no lo puede impedir porque la regla 4
    // obliga a permitir `PutItem`.
    const item = eventoParaTransaccion(base);
    const put = "Put" in item.item ? item.item.Put : undefined;
    expect(put?.ConditionExpression).toBe(CONDICION_APPEND_ONLY);
  });

  it("declara que significa que falle su condicion", () => {
    const item = eventoParaTransaccion(base);
    expect(item.siFalla).toBe("conflicto_concurrencia");
    expect(item.descripcion).toContain("AUDIT#VEHICULO#V1");
  });

  it("propaga el fallo de motivo obligatorio antes de construir nada", () => {
    expect(() =>
      eventoParaTransaccion({ ...base, tipo: "VEHICULO_RETIRADO" }),
    ).toThrow(/exige motivo/);
  });
});

describe("las siete claves de los indices de la bitacora (GSI5 a GSI9)", () => {
  // 18:30Z del 5 de septiembre son las 12:30 del 5 en Mexico, asi que dia y mes
  // de negocio son `2026-09-05` y `2026-09`.
  const atributos = () => atributosDeEvento(base);

  it("escribe las siete, desde el primer evento", () => {
    // No es exhaustividad por gusto: a un evento append-only no se le pueden
    // anadir atributos despues, asi que uno que hoy no se escriba es una
    // pregunta que nunca se podra responder sobre los eventos de hoy.
    const a = atributos();
    for (const nombre of [
      "mesPK",
      "tipoPK",
      "diaPK",
      "actorMesPK",
      "cronoSK",
      "agregadoSK",
      "actorSK",
    ]) {
      expect(a[nombre], `falta ${nombre}`).toBeDefined();
    }
  });

  it("las particiones se calculan en hora de negocio, no en UTC", () => {
    const a = atributos();
    expect(a.mesPK).toBe("MES#2026-09");
    expect(a.diaPK).toBe("DIA#2026-09-05");
    expect(a.tipoPK).toBe("TIPO#VEHICULO_REGISTRADO#2026-09");
    expect(a.actorMesPK).toBe("ACTOR#P1#2026-09");
  });

  it("el mes se recorta del dia, asi que nunca se contradicen", () => {
    // 03:00Z del 1 de enero son las 21:00 del 31 de diciembre en Mexico. Si el
    // mes se calculara aparte, este evento caeria en el dia de diciembre y en
    // el mes de enero, y la consulta por mes no lo encontraria.
    const a = atributosDeEvento({
      ...base,
      ocurridoEn: new Date("2027-01-01T03:00:00.000Z"),
    });
    expect(a.diaPK).toBe("DIA#2026-12-31");
    expect(a.mesPK).toBe("MES#2026-12");
    expect(String(a.mesPK)).toBe(`MES#${String(a.diaPK).slice(4, 11)}`);
  });

  it("las claves de ordenamiento llevan el instante completo, con milisegundos", () => {
    const a = atributos();
    expect(a.cronoSK).toBe(
      `${OCURRIDO_EN.toISOString()}#${String(a.eventoId)}`,
    );
    expect(a.agregadoSK).toBe(`VEHICULO#V1#${String(a.cronoSK)}`);
    expect(a.actorSK).toBe(`ACTOR#P1#${String(a.cronoSK)}`);
  });

  it("un evento del SISTEMA se indexa bajo el actor SISTEMA", () => {
    // No es un punto caliente —cae en la misma particion del dia que el resto—
    // y de paso regala "que hizo el barrido el dia D" como condicion de clave.
    const a = atributosDeEvento({
      ...base,
      tipo: "SOLICITUD_VENCIDA",
      agregado: "LOTE",
      agregadoId: "L1",
      actor: { tipo: "SISTEMA" },
    });
    expect(a.actorSK).toBe(`ACTOR#SISTEMA#${String(a.cronoSK)}`);
    expect(a.actorMesPK).toBe("ACTOR#SISTEMA#2026-09");
  });

  it("el item sigue por debajo del minimo facturable de 1 KB", () => {
    // Los siete atributos suman ~340 B sobre un evento de ~400 B. Mientras el
    // item redondee a 1 KB, **cuestan cero WCU**; si lo pasara, cada evento
    // empezaria a costar el doble. Se mide sobre la suma de nombres y valores,
    // que es como DynamoDB factura.
    const a = atributosDeEvento({
      ...base,
      datos: { turno: 7, solicitadoEn: OCURRIDO_EN.toISOString() },
      loteId: "01ARZ3NDEK",
      convocatoriaId: "01ARZ3NDEL",
      solicitudId: "01ARZ3NDEK-7",
      estadoAnterior: "EN_FILA",
      estadoNuevo: "ADJUDICADA",
    });
    const bytes = Object.entries(a).reduce(
      (suma, [nombre, valor]) =>
        suma + nombre.length + JSON.stringify(valor ?? "").length,
      0,
    );
    expect(bytes).toBeLessThan(1024);
  });
});
