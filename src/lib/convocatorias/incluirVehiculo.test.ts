// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  comandoDe,
  crearClienteFalso,
  type ClienteFalso,
} from "@/utils/clienteDynamoFalso";
import type { ActorUsuario } from "@/types/auditoria";
import type { Convocatoria } from "@/types/convocatoria";
import type { Vehiculo } from "@/types/vehiculo";
import { incluirVehiculo } from "./incluirVehiculo";

vi.mock("server-only", () => ({}));

const AHORA = new Date("2026-09-07T18:30:00.000Z");
const LOTE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Administrar_Convocatorias"],
};

const convocatoria: Convocatoria = {
  convocatoriaId: "C1",
  tipo: "EMPLEADOS",
  descripcionParticipacion: "Abierta al personal.",
  publicadaEn: "2026-10-01T15:00:00.000Z",
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  horasLiquidacion: 48,
  estatus: "BORRADOR",
  creadoEn: "2026-09-01T10:00:00.000Z",
  creadoPor: "P9",
};

const vehiculo: Vehiculo = {
  vehiculoId: "V1",
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 148_320,
  estatus: "DISPONIBLE",
  creadoEn: "2026-08-01T10:00:00.000Z",
  creadoPor: "P9",
  actualizadoEn: "2026-08-01T10:00:00.000Z",
  actualizadoPor: "P9",
};

const deps = (falso: ClienteFalso) => ({
  cliente: falso.cliente,
  ahora: () => AHORA,
  nuevoId: () => LOTE_ID,
});

const itemsDeTransaccion = (
  falso: ClienteFalso,
): Record<string, Record<string, Record<string, unknown>>>[] =>
  (comandoDe(falso, "TransactWriteCommand")?.TransactItems ?? []) as Record<
    string,
    Record<string, Record<string, unknown>>
  >[];

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("inclusion correcta", () => {
  it("escribe las cuatro cosas en una sola transaccion", async () => {
    // Un estado intermedio seria incoherente en los cuatro sentidos: centinela
    // sin lote inmoviliza el vehiculo, lote sin centinela permite incluirlo dos
    // veces, vehiculo sin actualizar lo deja listado como DISPONIBLE, y sin
    // evento la bitacora no sabe quien lo incluyo.
    const falso = crearClienteFalso();
    await incluirVehiculo(
      { convocatoria, vehiculo, precio: 180_000, actor },
      deps(falso),
    );

    expect(falso.comandos).toHaveLength(1);
    expect(itemsDeTransaccion(falso)).toHaveLength(5);
  });

  it("crea el centinela de R-10 con attribute_not_exists", async () => {
    // Es lo que convierte "un vehiculo en una sola convocatoria activa" en una
    // garantia atomica en vez de una lectura seguida de una decision.
    const falso = crearClienteFalso();
    await incluirVehiculo(
      { convocatoria, vehiculo, precio: 180_000, actor },
      deps(falso),
    );

    const centinela = itemsDeTransaccion(falso)[0]?.Put;
    expect(centinela?.Item?.PK).toBe("VEH#V1");
    expect(centinela?.Item?.SK).toBe("ACTIVO");
    expect(centinela?.ConditionExpression).toBe("attribute_not_exists(SK)");
  });

  it("el lote nace con el contador en cero", async () => {
    const falso = crearClienteFalso();
    await incluirVehiculo(
      { convocatoria, vehiculo, precio: 180_000, actor },
      deps(falso),
    );

    const lote = itemsDeTransaccion(falso)[1]?.Put?.Item;
    expect(lote?.contadorTurnos).toBe(0);
    expect(lote?.estatus).toBe("EN_OFERTA");
    expect(lote?.PK).toBe("CONV#C1");
    expect(lote?.SK).toBe(`LOTE#${LOTE_ID}`);
    expect(lote?.precio).toBe(180_000);
  });

  it("copia los cinco desnormalizados con el estatus de hoy", async () => {
    // Al incluir, la convocatoria esta en BORRADOR. T8 propaga PUBLICADA
    // despues; copiar aqui el estatus final haria comprable el lote antes de
    // tiempo.
    const falso = crearClienteFalso();
    await incluirVehiculo(
      { convocatoria, vehiculo, precio: 180_000, actor },
      deps(falso),
    );

    const lote = itemsDeTransaccion(falso)[1]?.Put?.Item;
    expect(lote?.estatusConvocatoria).toBe("BORRADOR");
    expect(lote?.inicioVenta).toBe(convocatoria.inicioVenta);
    expect(lote?.finVenta).toBe(convocatoria.finVenta);
    expect(lote?.tipoConvocatoria).toBe("EMPLEADOS");
    expect(lote?.horasLiquidacion).toBe(48);
  });

  it("comprueba que la convocatoria siga en BORRADOR al escribir", async () => {
    const falso = crearClienteFalso();
    await incluirVehiculo(
      { convocatoria, vehiculo, precio: 180_000, actor },
      deps(falso),
    );

    const comprobacion = itemsDeTransaccion(falso)[2]?.ConditionCheck;
    expect(comprobacion?.Key).toEqual({ PK: "CONV#C1", SK: "META" });
    expect(comprobacion?.ConditionExpression).toBe("#estatus = :borrador");
  });

  it("mueve el vehiculo de particion en GSI2", async () => {
    // Sin reescribir las dos claves del indice, el vehiculo seguiria apareciendo
    // en el listado de DISPONIBLE (PA-03) para siempre.
    const falso = crearClienteFalso();
    await incluirVehiculo(
      { convocatoria, vehiculo, precio: 180_000, actor },
      deps(falso),
    );

    const cambio = itemsDeTransaccion(falso)[3]?.Update;
    const valores = cambio?.ExpressionAttributeValues as Record<
      string,
      unknown
    >;
    expect(valores[":destino"]).toBe("EN_CONVOCATORIA");
    expect(valores[":gsi2pk"]).toBe("VEH_ESTATUS#EN_CONVOCATORIA");
    // La fecha del indice es la de creacion del vehiculo, no la de hoy.
    expect(valores[":gsi2sk"]).toBe(`${vehiculo.creadoEn}#V1`);
    expect(valores[":estatusEsperado"]).toBe("DISPONIBLE");
  });

  it("escribe el evento con el lote y el vehiculo", async () => {
    const falso = crearClienteFalso();
    await incluirVehiculo(
      { convocatoria, vehiculo, precio: 180_000, actor },
      deps(falso),
    );

    const evento = itemsDeTransaccion(falso)[4]?.Put?.Item;
    expect(evento?.tipo).toBe("VEHICULO_INCLUIDO");
    expect(evento?.convocatoriaId).toBe("C1");
    expect(evento?.vehiculoId).toBe("V1");
    expect(evento?.loteId).toBe(LOTE_ID);
  });
});

describe("guardas", () => {
  it("rechaza un precio que no es entero sin tocar DynamoDB", async () => {
    const falso = crearClienteFalso();
    const resultado = await incluirVehiculo(
      { convocatoria, vehiculo, precio: 180_000.5, actor },
      deps(falso),
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.detalles).toEqual({ precio: "no_es_entero" });
    }
    expect(falso.comandos).toHaveLength(0);
  });

  it("rechaza un precio de cero", async () => {
    const falso = crearClienteFalso();
    const resultado = await incluirVehiculo(
      { convocatoria, vehiculo, precio: 0, actor },
      deps(falso),
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.detalles).toEqual({ precio: "fuera_de_rango" });
    }
  });

  it("rechaza un vehiculo que no esta DISPONIBLE", async () => {
    // La maquina de estados es la autoridad. Que la guarda de permiso ya lo
    // exija no la hace redundante: una es politica, esta es la maquina.
    const falso = crearClienteFalso();
    const resultado = await incluirVehiculo(
      {
        convocatoria,
        vehiculo: { ...vehiculo, estatus: "VENDIDO" },
        precio: 180_000,
        actor,
      },
      deps(falso),
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
    expect(falso.comandos).toHaveLength(0);
  });
});
