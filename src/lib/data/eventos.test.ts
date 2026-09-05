// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { atributosDeEvento, eventoParaTransaccion } from "./eventos";
import { esUlid, instanteDeUlid } from "./identificadores";
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

    expect(esUlid(eventoId)).toBe(true);
    expect(instanteDeUlid(eventoId)).toEqual(OCURRIDO_EN);
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

describe("claves de la bitacora del dia (GSI2)", () => {
  it("usa el dia de negocio y no el de UTC", () => {
    // 2026-09-06T04:00Z son las 22:00 del 5 de septiembre en Mexico. El auditor
    // que pide "todo lo del 5" tiene que encontrarlo ahi.
    const atributos = atributosDeEvento({
      ...base,
      ocurridoEn: new Date("2026-09-06T04:00:00.000Z"),
    });

    expect(atributos.GSI2PK).toBe("AUDIT#2026-09-05");
  });

  it("ordena cronologicamente dentro del dia", () => {
    const temprano = atributosDeEvento({
      ...base,
      ocurridoEn: new Date("2026-09-05T14:00:00.000Z"),
    });
    const tarde = atributosDeEvento({
      ...base,
      ocurridoEn: new Date("2026-09-05T15:00:00.000Z"),
    });

    expect(String(temprano.GSI2SK) < String(tarde.GSI2SK)).toBe(true);
    expect(temprano.GSI2PK).toBe(tarde.GSI2PK);
  });

  it("la clave del indice repite el instante y el identificador del evento", () => {
    const atributos = atributosDeEvento(base);
    expect(atributos.GSI2SK).toBe(
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
