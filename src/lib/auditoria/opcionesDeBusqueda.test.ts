// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { obtenerDiccionario } from "@/dictionaries";
import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import { construirOpciones } from "./opcionesDeBusqueda";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const diccionario = obtenerDiccionario("es");

const RANGO = { desde: "2026-09-08", hasta: "2026-09-08" };

/**
 * Un evento tal como lo devuelve un sondeo de GSI7 u GSI8, con la clave de
 * ordenamiento del indice: es lo que el recorrido necesita para saltar el grupo.
 */
const eventoDeIndice = (entrada: {
  eventoId: string;
  agregado: string;
  agregadoId: string;
  actorId?: string;
  extras?: Record<string, unknown>;
}) => {
  const ocurridoEn = "2026-09-08T18:00:00.000Z";
  const actorId = entrada.actorId ?? "okta|ana";
  return {
    PK: `AUDIT#${entrada.agregado}#${entrada.agregadoId}`,
    SK: `${ocurridoEn}#${entrada.eventoId}`,
    eventoId: entrada.eventoId,
    tipo: "SOLICITUD_CREADA",
    ocurridoEn,
    actorTipo: "USUARIO",
    actorId,
    correlacionId: "COR1",
    diaPK: "DIA#2026-09-08",
    agregadoSK: `${entrada.agregado}#${entrada.agregadoId}#${ocurridoEn}#${entrada.eventoId}`,
    actorSK: `ACTOR#${actorId}#${ocurridoEn}#${entrada.eventoId}`,
    ...entrada.extras,
  };
};

/**
 * Cliente que responde a las dos clases de lectura que hace este modulo: los
 * sondeos de indice (`Query`) y la resolucion de etiquetas (`BatchGet`).
 *
 * Los sondeos se responden **una sola vez por indice**: el segundo devuelve
 * vacio y el recorrido termina. Asi la prueba no tiene que simular el salto
 * —eso lo cubre `valoresConActividad.test.ts`— y se concentra en las etiquetas.
 */
const clienteDeOpciones = (entrada: {
  identificadores?: readonly Record<string, unknown>[];
  participantes?: readonly Record<string, unknown>[];
  items?: readonly Record<string, unknown>[];
}) => {
  const pendientes = new Map<string, readonly Record<string, unknown>[]>([
    ["agregadoSK", entrada.identificadores ?? []],
    ["actorSK", entrada.participantes ?? []],
  ]);

  return crearClienteFalso({
    responder: (comando: ComandoEnviado) => {
      if (comando.nombre === "QueryCommand") {
        const atributo = String(comando.input.KeyConditionExpression).includes(
          "agregadoSK",
        )
          ? "agregadoSK"
          : "actorSK";
        const siguiente = pendientes.get(atributo) ?? [];
        pendientes.set(atributo, siguiente.slice(1));
        return { Items: siguiente.slice(0, 1) };
      }

      const peticion = comando.input.RequestItems as Record<
        string,
        { Keys: { PK: string; SK: string }[] }
      >;
      const claves = peticion["tabla-de-prueba"]?.Keys ?? [];
      return {
        Responses: {
          "tabla-de-prueba": (entrada.items ?? []).filter((item) =>
            claves.some((c) => c.PK === item.PK && c.SK === item.SK),
          ),
        },
      };
    },
  });
};

const cliente = (falso: ReturnType<typeof crearClienteFalso>) => ({
  cliente: falso.cliente as never,
});

const VEHICULO = {
  PK: "VEH#V1",
  SK: "META",
  vehiculoId: "V1",
  numeroEconomico: "VEH-020",
  numeroDeSerie: "3N6AD33A9KK870001",
  marca: "Nissan",
  version: "Versa Sense",
  modelo: 2019,
};

const CONVOCATORIA = {
  PK: "CONV#C1",
  SK: "META",
  convocatoriaId: "C1",
  folio: "CONV-2026-001",
  nombre: "Venta de octubre",
  tipo: "EMPLEADOS",
  inicioVenta: "2026-03-12T16:00:00.000Z",
};

const LOTE = {
  PK: "CONV#C1",
  SK: "LOTE#L1",
  loteId: "L1",
  convocatoriaId: "C1",
  vehiculoId: "V1",
};

const SOLICITUD = {
  PK: "LOTE#L1",
  SK: "SOL#0000000007",
  solicitudId: "L1-7",
  loteId: "L1",
  participanteId: "okta|ana",
};

const PERFIL = {
  PK: "PART#okta|ana",
  SK: "PERFIL",
  participanteId: "okta|ana",
  nombre: "Ana Ramírez",
  correo: "ana@example.com",
  actualizadoEn: "2026-09-08T18:00:00.000Z",
};

describe("etiquetas que dicen algo", () => {
  it("el vehiculo se nombra con su marca, version, modelo y numero economico", async () => {
    // El numero economico es como la organizacion lo nombra, y es la mitad del
    // objetivo de la Etapa 11.2: antes la opcion terminaba en un identificador
    // generado que no le decia nada a nadie.
    const falso = clienteDeOpciones({
      identificadores: [
        eventoDeIndice({
          eventoId: "E1",
          agregado: "VEHICULO",
          agregadoId: "V1",
        }),
      ],
      items: [VEHICULO],
    });

    const resultado = await construirOpciones(
      { ...RANGO, agregado: "VEHICULO", diccionario },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.identificadores).toEqual([
      {
        valor: "V1",
        etiqueta: "Nissan · Versa Sense · 2019 · VEH-020 · V1",
      },
    ]);
  });

  it("la convocatoria se nombra con su nombre corto y su folio", async () => {
    // Antes eran el tipo y la fecha de inicio, que decian menos y ocupaban mas.
    const falso = clienteDeOpciones({
      identificadores: [
        eventoDeIndice({
          eventoId: "E1",
          agregado: "CONVOCATORIA",
          agregadoId: "C1",
        }),
      ],
      items: [CONVOCATORIA],
    });

    const resultado = await construirOpciones(
      { ...RANGO, agregado: "CONVOCATORIA", diccionario },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.identificadores[0]?.etiqueta).toBe(
      "Venta de octubre · CONV-2026-001 · C1",
    );
  });

  it("el lote se nombra con su vehiculo y su convocatoria", async () => {
    // La clave de un lote cuelga de su convocatoria, asi que el sondeo tiene que
    // traer el `convocatoriaId` o el lote no se puede ni leer.
    const falso = clienteDeOpciones({
      identificadores: [
        eventoDeIndice({
          eventoId: "E1",
          agregado: "LOTE",
          agregadoId: "L1",
          extras: { convocatoriaId: "C1", loteId: "L1" },
        }),
      ],
      items: [LOTE, VEHICULO, CONVOCATORIA],
    });

    const resultado = await construirOpciones(
      { ...RANGO, agregado: "LOTE", diccionario },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.identificadores[0]?.etiqueta).toBe(
      "Nissan · Versa Sense · 2019 · VEH-020 · Venta de octubre · CONV-2026-001 · L1",
    );
  });

  it("la solicitud se nombra con su vehiculo, su turno y su participante", async () => {
    const falso = clienteDeOpciones({
      identificadores: [
        eventoDeIndice({
          eventoId: "E1",
          agregado: "SOLICITUD",
          agregadoId: "L1-7",
          extras: { convocatoriaId: "C1", loteId: "L1", solicitudId: "L1-7" },
        }),
      ],
      items: [LOTE, VEHICULO, SOLICITUD, PERFIL],
    });

    const resultado = await construirOpciones(
      { ...RANGO, agregado: "SOLICITUD", diccionario },
      cliente(falso),
    );

    const etiqueta = resultado.ok
      ? resultado.data.identificadores[0]?.etiqueta
      : "";
    expect(etiqueta).toContain("Nissan");
    expect(etiqueta).toContain("VEH-020");
    expect(etiqueta).toContain("7");
    expect(etiqueta).toContain("Ana Ramírez");
  });

  it("cae al identificador crudo cuando la entidad ya no existe", async () => {
    // Un vehiculo retirado de la tabla sigue teniendo historia en la bitacora.
    // Mostrar su identificador es mostrar el dato que hay; ocultarlo escondería
    // eventos que si se pueden consultar.
    const falso = clienteDeOpciones({
      identificadores: [
        eventoDeIndice({
          eventoId: "E1",
          agregado: "VEHICULO",
          agregadoId: "V9",
        }),
      ],
      items: [],
    });

    const resultado = await construirOpciones(
      { ...RANGO, agregado: "VEHICULO", diccionario },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.identificadores).toEqual([
      { valor: "V9", etiqueta: "V9" },
    ]);
  });
});

describe("participantes", () => {
  it("se nombran con nombre, correo e identificador", async () => {
    const falso = clienteDeOpciones({
      participantes: [
        eventoDeIndice({
          eventoId: "E1",
          agregado: "LOTE",
          agregadoId: "L1",
          actorId: "okta|ana",
        }),
      ],
      items: [PERFIL],
    });

    const resultado = await construirOpciones(
      { ...RANGO, diccionario },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.participantes).toEqual([
      {
        valor: "okta|ana",
        etiqueta: "Ana Ramírez · ana@example.com · okta|ana",
      },
    ]);
  });

  it("sin perfil se muestra el identificador, que es el dato que hay", async () => {
    // Normal y no un fallo: el perfil se escribe al iniciar sesion, y la
    // bitacora tiene eventos anteriores a que eso existiera.
    const falso = clienteDeOpciones({
      participantes: [
        eventoDeIndice({
          eventoId: "E1",
          agregado: "LOTE",
          agregadoId: "L1",
          actorId: "okta|sinperfil",
        }),
      ],
      items: [],
    });

    const resultado = await construirOpciones(
      { ...RANGO, diccionario },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.participantes[0]?.etiqueta).toBe(
      "okta|sinperfil",
    );
  });

  it("devuelve los nombres de actor que la tabla de resultados necesita", async () => {
    // Salen de la **misma** lectura de perfiles que las opciones: la columna de
    // actor necesita exactamente lo que el select ya resolvio.
    const falso = clienteDeOpciones({
      participantes: [
        eventoDeIndice({
          eventoId: "E1",
          agregado: "LOTE",
          agregadoId: "L1",
          actorId: "okta|ana",
        }),
      ],
      items: [PERFIL],
    });

    const resultado = await construirOpciones(
      { ...RANGO, diccionario },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.nombresDeActor.get("okta|ana")).toBe(
      "Ana Ramírez · ana@example.com",
    );
  });
});

describe("las dos listas son independientes", () => {
  it("sin tipo de registro no hay identificadores, pero si participantes", async () => {
    // Y sobre todo: **no se consulta GSI7**. El select de identificadores no
    // tiene de que tipo hablar todavia.
    const falso = clienteDeOpciones({
      participantes: [
        eventoDeIndice({
          eventoId: "E1",
          agregado: "LOTE",
          agregadoId: "L1",
        }),
      ],
      items: [PERFIL],
    });

    const resultado = await construirOpciones(
      { ...RANGO, diccionario },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.identificadores).toEqual([]);
    expect(resultado.ok && resultado.data.participantes).toHaveLength(1);
    expect(
      falso.comandos
        .filter((c) => c.nombre === "QueryCommand")
        .map((c) => c.input.IndexName),
    ).not.toContain("GSI7");
  });

  it("un tipo de registro con mucho volumen no vacia el select de personas", async () => {
    // Es el defecto que reporto el usuario. Antes las dos listas se derivaban de
    // una lectura compartida con un tope, y el tipo mas voluminoso consumia el
    // cupo: los demas aparecian como "sin actividad en este rango" siendo falso.
    // Ahora son dos lecturas con particiones distintas y no pueden competir.
    const falso = clienteDeOpciones({
      identificadores: [
        eventoDeIndice({ eventoId: "E1", agregado: "LOTE", agregadoId: "L1" }),
      ],
      participantes: [
        eventoDeIndice({
          eventoId: "E2",
          agregado: "LOTE",
          agregadoId: "L1",
          actorId: "okta|ana",
        }),
      ],
      items: [LOTE, VEHICULO, CONVOCATORIA, PERFIL],
    });

    const resultado = await construirOpciones(
      { ...RANGO, agregado: "LOTE", diccionario },
      cliente(falso),
    );

    expect(resultado.ok && resultado.data.identificadores).toHaveLength(1);
    expect(resultado.ok && resultado.data.participantes).toHaveLength(1);
  });

  it("propaga el rechazo de un rango invalido", async () => {
    const falso = clienteDeOpciones({});
    const resultado = await construirOpciones(
      { desde: "2026-09-08", hasta: "2026-09-06", diccionario },
      cliente(falso),
    );

    expect(resultado.ok).toBe(false);
  });
});
