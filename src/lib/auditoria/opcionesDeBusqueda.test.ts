// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { obtenerDiccionario } from "@/dictionaries";
import { crearClienteFalso } from "@/utils/clienteDynamoFalso";
import type { EventoDTO } from "@/types/auditoria";
import { construirOpciones, MAXIMO_DE_OPCIONES } from "./opcionesDeBusqueda";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const diccionario = obtenerDiccionario("es");

const evento = (cambios: Partial<EventoDTO> = {}): EventoDTO => ({
  eventoId: "E1",
  tipo: "SOLICITUD_CREADA",
  ocurridoEn: "2026-09-08T18:00:00.000Z",
  actorTipo: "USUARIO",
  actorId: "okta|ana",
  correlacionId: "COR1",
  ...cambios,
});

/**
 * Responde a cada `BatchGetCommand` con los items cuya clave se pidio. Es lo
 * que permite afirmar sobre las etiquetas sin depender del orden en que el
 * servicio despache sus lecturas paralelas.
 */
const clienteConItems = (items: readonly Record<string, unknown>[]) =>
  crearClienteFalso({
    responder: (comando) => {
      const peticion = comando.input.RequestItems as Record<
        string,
        { Keys: { PK: string; SK: string }[] }
      >;
      const claves = peticion["tabla-de-prueba"]?.Keys ?? [];
      return {
        Responses: {
          "tabla-de-prueba": items.filter((item) =>
            claves.some(
              (clave) => clave.PK === item.PK && clave.SK === item.SK,
            ),
          ),
        },
      };
    },
  });

const VEHICULO = {
  PK: "VEH#V1",
  SK: "META",
  vehiculoId: "V1",
  marca: "Nissan",
  version: "Versa Sense",
  modelo: 2019,
};

const CONVOCATORIA = {
  PK: "CONV#C1",
  SK: "META",
  convocatoriaId: "C1",
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

describe("construirOpciones", () => {
  it("ofrece solo lo que tiene actividad en el rango", async () => {
    // Es la garantia de la pantalla: elegir cualquier opcion devuelve algo.
    const falso = clienteConItems([VEHICULO, PERFIL]);

    const resultado = await construirOpciones(
      {
        eventos: [evento({ agregado: "VEHICULO", agregadoId: "V1" })],
        agregado: "VEHICULO",
        diccionario,
      },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok && resultado.data.identificadores).toHaveLength(1);
    expect(resultado.ok && resultado.data.identificadores[0]?.valor).toBe("V1");
  });

  it("nombra un vehiculo por marca, version y modelo", async () => {
    const falso = clienteConItems([VEHICULO, PERFIL]);

    const resultado = await construirOpciones(
      {
        eventos: [evento({ agregado: "VEHICULO", agregadoId: "V1" })],
        agregado: "VEHICULO",
        diccionario,
      },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok && resultado.data.identificadores[0]?.etiqueta).toBe(
      "Nissan · Versa Sense · 2019 · V1",
    );
  });

  it("nombra una convocatoria por su tipo traducido y su fecha", async () => {
    // La convocatoria no tiene nombre en el modelo: tipo y fecha es todo lo
    // que la distingue de otra.
    const falso = clienteConItems([CONVOCATORIA, PERFIL]);

    const resultado = await construirOpciones(
      {
        eventos: [evento({ agregado: "CONVOCATORIA", agregadoId: "C1" })],
        agregado: "CONVOCATORIA",
        diccionario,
      },
      { cliente: falso.cliente as never },
    );

    const etiqueta = resultado.ok
      ? resultado.data.identificadores[0]?.etiqueta
      : "";
    expect(etiqueta).toContain(diccionario.tiposConvocatoria.EMPLEADOS);
    expect(etiqueta).toContain("C1");
  });

  it("nombra un lote con su vehiculo, resolviendo la cadena lote -> vehiculo", async () => {
    const falso = clienteConItems([LOTE, VEHICULO, CONVOCATORIA, PERFIL]);

    const resultado = await construirOpciones(
      {
        eventos: [
          evento({
            agregado: "LOTE",
            agregadoId: "L1",
            convocatoriaId: "C1",
            loteId: "L1",
          }),
        ],
        agregado: "LOTE",
        diccionario,
      },
      { cliente: falso.cliente as never },
    );

    const etiqueta = resultado.ok
      ? resultado.data.identificadores[0]?.etiqueta
      : "";
    expect(etiqueta).toContain("Nissan");
    expect(etiqueta).toContain("L1");
  });

  it("nombra una solicitud con el vehiculo, el turno y quien la pidio", async () => {
    // Es la opcion que nadie podria teclear: su identificador es derivado
    // (`<loteId>-<turno>`) y no aparece en ninguna otra pantalla.
    const falso = clienteConItems([
      SOLICITUD,
      LOTE,
      VEHICULO,
      CONVOCATORIA,
      PERFIL,
    ]);

    const resultado = await construirOpciones(
      {
        eventos: [
          evento({
            agregado: "SOLICITUD",
            agregadoId: "L1-7",
            loteId: "L1",
            convocatoriaId: "C1",
            solicitudId: "L1-7",
          }),
        ],
        agregado: "SOLICITUD",
        diccionario,
      },
      { cliente: falso.cliente as never },
    );

    const etiqueta = resultado.ok
      ? resultado.data.identificadores[0]?.etiqueta
      : "";
    expect(etiqueta).toContain("Nissan");
    expect(etiqueta).toContain("7");
    expect(etiqueta).toContain("Ana Ramírez");
  });

  it("presenta a los participantes por nombre y correo, con su identificador", async () => {
    const falso = clienteConItems([PERFIL]);

    const resultado = await construirOpciones(
      { eventos: [evento()], diccionario },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok && resultado.data.participantes[0]).toEqual({
      valor: "okta|ana",
      etiqueta: "Ana Ramírez · ana@example.com · okta|ana",
    });
  });

  it("un participante sin perfil se presenta con su identificador crudo", async () => {
    // Normal y no un fallo: el perfil se escribe al iniciar sesion, y la
    // bitacora tiene eventos anteriores a que eso existiera.
    const falso = clienteConItems([]);

    const resultado = await construirOpciones(
      { eventos: [evento({ actorId: "okta|antiguo" })], diccionario },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok && resultado.data.participantes[0]?.etiqueta).toBe(
      "okta|antiguo",
    );
    expect(resultado.ok && resultado.data.nombresDeActor.size).toBe(0);
  });

  it("no ofrece al SISTEMA como participante", async () => {
    // No es una persona a la que rastrear, y ofrecerlo llenaria el select con
    // la opcion mas inutil de todas.
    const falso = clienteConItems([]);

    const resultado = await construirOpciones(
      {
        eventos: [
          evento({
            actorTipo: "SISTEMA",
            actorId: "SISTEMA",
            tipo: "SOLICITUD_VENCIDA",
          }),
        ],
        diccionario,
      },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok && resultado.data.participantes).toHaveLength(0);
  });

  it("sin tipo de registro elegido no ofrece identificadores, pero si participantes", async () => {
    // El select de identificador depende del tipo; el de participante no.
    const falso = clienteConItems([PERFIL]);

    const resultado = await construirOpciones(
      {
        eventos: [evento({ agregado: "VEHICULO", agregadoId: "V1" })],
        diccionario,
      },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok && resultado.data.identificadores).toHaveLength(0);
    expect(resultado.ok && resultado.data.participantes).toHaveLength(1);
  });

  it("no mezcla agregados de otro tipo en el select", async () => {
    const falso = clienteConItems([VEHICULO, PERFIL]);

    const resultado = await construirOpciones(
      {
        eventos: [
          evento({ agregado: "VEHICULO", agregadoId: "V1" }),
          evento({
            eventoId: "E2",
            agregado: "CONVOCATORIA",
            agregadoId: "C1",
          }),
        ],
        agregado: "VEHICULO",
        diccionario,
      },
      { cliente: falso.cliente as never },
    );

    expect(
      resultado.ok && resultado.data.identificadores.map((o) => o.valor),
    ).toEqual(["V1"]);
  });

  it("ordena por actividad mas reciente primero", async () => {
    const falso = clienteConItems([PERFIL]);

    const resultado = await construirOpciones(
      {
        eventos: [
          evento({
            eventoId: "E1",
            agregado: "VEHICULO",
            agregadoId: "V-VIEJO",
            ocurridoEn: "2026-09-01T18:00:00.000Z",
          }),
          evento({
            eventoId: "E2",
            agregado: "VEHICULO",
            agregadoId: "V-NUEVO",
            ocurridoEn: "2026-09-08T18:00:00.000Z",
          }),
        ],
        agregado: "VEHICULO",
        diccionario,
      },
      { cliente: falso.cliente as never },
    );

    expect(
      resultado.ok && resultado.data.identificadores.map((o) => o.valor),
    ).toEqual(["V-NUEVO", "V-VIEJO"]);
  });

  it("acota la lista: un select de miles de opciones no se puede usar", async () => {
    const muchos = Array.from({ length: MAXIMO_DE_OPCIONES + 10 }, (_, i) =>
      evento({
        eventoId: `E${i}`,
        agregado: "VEHICULO",
        agregadoId: `V${i}`,
      }),
    );
    const falso = clienteConItems([PERFIL]);

    const resultado = await construirOpciones(
      { eventos: muchos, agregado: "VEHICULO", diccionario },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok && resultado.data.identificadores).toHaveLength(
      MAXIMO_DE_OPCIONES,
    );
  });

  it("sin eventos no consulta nada", async () => {
    const falso = clienteConItems([]);

    const resultado = await construirOpciones(
      { eventos: [], agregado: "VEHICULO", diccionario },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok).toBe(true);
    expect(falso.comandos).toHaveLength(0);
  });

  it("una entidad que ya no existe deja la opcion con su identificador, no la esconde", async () => {
    // Un vehiculo borrado a mano no puede hacer desaparecer su historia: la
    // bitacora es append-only y el evento sigue ahi.
    const falso = clienteConItems([PERFIL]);

    const resultado = await construirOpciones(
      {
        eventos: [evento({ agregado: "VEHICULO", agregadoId: "V-FANTASMA" })],
        agregado: "VEHICULO",
        diccionario,
      },
      { cliente: falso.cliente as never },
    );

    expect(resultado.ok && resultado.data.identificadores[0]).toEqual({
      valor: "V-FANTASMA",
      etiqueta: "V-FANTASMA",
    });
  });
});

describe("las dos listas salen de lecturas distintas", () => {
  it("**los identificadores salen de la lectura acotada al tipo**, no de la general", async () => {
    // El defecto reportado: la lectura general la puede consumir entera un
    // tipo con mucho volumen, y entonces los demas aparecen como "sin
    // actividad en este rango" siendo falso. Aqui la lectura general no trae
    // **ningun** evento de vehiculo y la acotada si: la opcion debe aparecer.
    const falso = clienteConItems([VEHICULO, PERFIL]);

    const resultado = await construirOpciones(
      {
        eventos: [evento({ agregado: "LOTE", agregadoId: "L1", loteId: "L1" })],
        eventosDelAgregado: [
          evento({ eventoId: "E2", agregado: "VEHICULO", agregadoId: "V1" }),
        ],
        agregado: "VEHICULO",
        diccionario,
      },
      { cliente: falso.cliente as never },
    );

    expect(
      resultado.ok && resultado.data.identificadores.map((o) => o.valor),
    ).toEqual(["V1"]);
  });

  it("los participantes salen de la lectura general: no dependen del tipo elegido", async () => {
    const falso = clienteConItems([PERFIL]);

    const resultado = await construirOpciones(
      {
        // Quien firma esta solo en la lectura general.
        eventos: [evento({ actorId: "okta|ana" })],
        eventosDelAgregado: [
          evento({
            eventoId: "E2",
            agregado: "VEHICULO",
            agregadoId: "V1",
            actorTipo: "SISTEMA",
            actorId: "SISTEMA",
          }),
        ],
        agregado: "VEHICULO",
        diccionario,
      },
      { cliente: falso.cliente as never },
    );

    expect(
      resultado.ok && resultado.data.participantes.map((o) => o.valor),
    ).toEqual(["okta|ana"]);
  });

  it("sin lectura acotada cae a la general, que es el caso sin tipo elegido", async () => {
    const falso = clienteConItems([VEHICULO, PERFIL]);

    const resultado = await construirOpciones(
      {
        eventos: [evento({ agregado: "VEHICULO", agregadoId: "V1" })],
        agregado: "VEHICULO",
        diccionario,
      },
      { cliente: falso.cliente as never },
    );

    expect(
      resultado.ok && resultado.data.identificadores.map((o) => o.valor),
    ).toEqual(["V1"]);
  });
});
