// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crearClienteFalso } from "@/utils/clienteDynamoFalso";
import { leerPerfiles } from "./leerPerfiles";
import { registrarPerfil } from "./registrarPerfil";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const ahora = () => new Date("2026-09-08T18:00:00.000Z");

describe("registrarPerfil", () => {
  it("escribe el perfil en la particion del participante, con la clave de PA-01", async () => {
    const falso = crearClienteFalso();

    await registrarPerfil(
      {
        participanteId: "okta|ana",
        oktaSub: "okta|ana",
        nombre: "Ana Ramírez",
        correo: "ana@example.com",
      },
      { cliente: falso.cliente as never, ahora },
    );

    expect(falso.comandos[0]?.nombre).toBe("PutCommand");
    expect(falso.comandos[0]?.input.Item).toMatchObject({
      PK: "PART#okta|ana",
      SK: "PERFIL",
      GSI1PK: `OKTA#${encodeURIComponent("okta|ana")}`,
      GSI1SK: "PERFIL",
      participanteId: "okta|ana",
      nombre: "Ana Ramírez",
      correo: "ana@example.com",
      actualizadoEn: "2026-09-08T18:00:00.000Z",
    });
  });

  it("sobrescribe sin condicion: el ultimo acceso gana", async () => {
    // No es un item `AUDIT#`, asi que la regla 5 no aplica. Un nombre que
    // cambia en Okta tiene que poder actualizarse.
    const falso = crearClienteFalso();

    await registrarPerfil(
      {
        participanteId: "okta|ana",
        oktaSub: "okta|ana",
        nombre: "Ana",
        correo: "ana@example.com",
      },
      { cliente: falso.cliente as never, ahora },
    );

    expect(falso.comandos[0]?.input.ConditionExpression).toBeUndefined();
  });

  it("no escribe ningun evento de auditoria", async () => {
    // Un evento por acceso ahogaria la bitacora en ruido que nadie auditara,
    // que es lo contrario de lo que este perfil viene a resolver.
    const falso = crearClienteFalso();

    await registrarPerfil(
      {
        participanteId: "okta|ana",
        oktaSub: "okta|ana",
        nombre: "Ana",
        correo: "ana@example.com",
      },
      { cliente: falso.cliente as never, ahora },
    );

    expect(falso.comandos).toHaveLength(1);
    expect(falso.comandos[0]?.nombre).toBe("PutCommand");
  });

  it("conserva el sub real cuando la identidad de negocio es otra", async () => {
    // Ocurre con la impersonacion de desarrollo: la persona simulada sustituye
    // el `participanteId`, pero el `sub` sigue diciendo quien conduce.
    const falso = crearClienteFalso();

    await registrarPerfil(
      {
        participanteId: "dev-auditor",
        oktaSub: "okta|real",
        nombre: "Carla Auditora",
        correo: "carla@autob.invalid",
      },
      { cliente: falso.cliente as never, ahora },
    );

    expect(falso.comandos[0]?.input.Item).toMatchObject({
      PK: "PART#dev-auditor",
      GSI1PK: `OKTA#${encodeURIComponent("okta|real")}`,
    });
  });
});

const perfilCrudo = (participanteId: string, extras = {}) => ({
  PK: `PART#${participanteId}`,
  SK: "PERFIL",
  participanteId,
  nombre: "Ana Ramírez",
  correo: "ana@example.com",
  actualizadoEn: "2026-09-08T18:00:00.000Z",
  ...extras,
});

describe("leerPerfiles", () => {
  it("resuelve varios identificadores en una sola peticion", async () => {
    const falso = crearClienteFalso({
      responder: () => ({
        Responses: {
          "tabla-de-prueba": [
            perfilCrudo("okta|ana"),
            perfilCrudo("okta|beto"),
          ],
        },
      }),
    });

    const resultado = await leerPerfiles(["okta|ana", "okta|beto"], {
      cliente: falso.cliente as never,
    });

    expect(falso.comandos).toHaveLength(1);
    expect(falso.comandos[0]?.nombre).toBe("BatchGetCommand");
    expect(resultado.ok && resultado.data.size).toBe(2);
    expect(resultado.ok && resultado.data.get("okta|ana")?.nombre).toBe(
      "Ana Ramírez",
    );
  });

  it("no pide dos veces el mismo identificador", async () => {
    const falso = crearClienteFalso({
      responder: () => ({ Responses: { "tabla-de-prueba": [] } }),
    });

    await leerPerfiles(["okta|ana", "okta|ana", "okta|ana"], {
      cliente: falso.cliente as never,
    });

    const peticion = falso.comandos[0]?.input.RequestItems as Record<
      string,
      { Keys: unknown[] }
    >;
    expect(peticion["tabla-de-prueba"]?.Keys).toHaveLength(1);
  });

  it("sin identificadores no consulta nada", async () => {
    const falso = crearClienteFalso();

    const resultado = await leerPerfiles([], {
      cliente: falso.cliente as never,
    });

    expect(resultado.ok && resultado.data.size).toBe(0);
    expect(falso.comandos).toHaveLength(0);
  });

  it("descarta un identificador con # en vez de lanzar", async () => {
    // `clave.participante` lanza ante un `#`, y con razon. Pero aqui la
    // entrada son `actorId` leidos de la bitacora: uno mal formado entre
    // cientos no puede tumbar la pantalla del auditor.
    const falso = crearClienteFalso({
      responder: () => ({
        Responses: { "tabla-de-prueba": [perfilCrudo("okta|ana")] },
      }),
    });

    const resultado = await leerPerfiles(["okta|ana", "roto#roto", ""], {
      cliente: falso.cliente as never,
    });

    const peticion = falso.comandos[0]?.input.RequestItems as Record<
      string,
      { Keys: unknown[] }
    >;
    expect(peticion["tabla-de-prueba"]?.Keys).toHaveLength(1);
    expect(resultado.ok && resultado.data.size).toBe(1);
  });

  it("un perfil que no existe simplemente no esta en el mapa", async () => {
    const falso = crearClienteFalso({
      responder: () => ({ Responses: { "tabla-de-prueba": [] } }),
    });

    const resultado = await leerPerfiles(["okta|antiguo"], {
      cliente: falso.cliente as never,
    });

    expect(resultado.ok && resultado.data.has("okta|antiguo")).toBe(false);
  });

  it("un perfil sin nombre no rompe: los claims de Okta son opcionales", async () => {
    const falso = crearClienteFalso({
      responder: () => ({
        Responses: {
          "tabla-de-prueba": [
            { ...perfilCrudo("okta|ana"), nombre: undefined },
          ],
        },
      }),
    });

    const resultado = await leerPerfiles(["okta|ana"], {
      cliente: falso.cliente as never,
    });

    expect(resultado.ok && resultado.data.get("okta|ana")).toMatchObject({
      nombre: "",
      correo: "ana@example.com",
    });
  });

  it("reintenta las claves que DynamoDB devuelve sin procesar", async () => {
    let llamadas = 0;
    const falso = crearClienteFalso({
      responder: () => {
        llamadas += 1;
        return llamadas === 1
          ? {
              Responses: { "tabla-de-prueba": [] },
              UnprocessedKeys: {
                "tabla-de-prueba": {
                  Keys: [{ PK: "PART#okta|ana", SK: "PERFIL" }],
                },
              },
            }
          : {
              Responses: { "tabla-de-prueba": [perfilCrudo("okta|ana")] },
            };
      },
    });

    const resultado = await leerPerfiles(["okta|ana"], {
      cliente: falso.cliente as never,
    });

    expect(llamadas).toBe(2);
    expect(resultado.ok && resultado.data.size).toBe(1);
  });

  it("no reintenta para siempre: la pantalla no se puede quedar colgada", async () => {
    const falso = crearClienteFalso({
      responder: () => ({
        Responses: { "tabla-de-prueba": [] },
        UnprocessedKeys: {
          "tabla-de-prueba": { Keys: [{ PK: "PART#okta|ana", SK: "PERFIL" }] },
        },
      }),
    });

    const resultado = await leerPerfiles(["okta|ana"], {
      cliente: falso.cliente as never,
    });

    expect(falso.comandos).toHaveLength(3);
    // Lo que se pierde es la etiqueta, no el hecho: el identificador crudo
    // sigue estando disponible para quien presenta.
    expect(resultado.ok && resultado.data.size).toBe(0);
  });

  it("trocea de 100 en 100, que es el tope del protocolo", async () => {
    const falso = crearClienteFalso({
      responder: () => ({ Responses: { "tabla-de-prueba": [] } }),
    });

    const ids = Array.from({ length: 250 }, (_, i) => `okta|${i}`);
    await leerPerfiles(ids, { cliente: falso.cliente as never });

    expect(falso.comandos).toHaveLength(3);
    const tamanos = falso.comandos.map((comando) => {
      const peticion = comando.input.RequestItems as Record<
        string,
        { Keys: unknown[] }
      >;
      return peticion["tabla-de-prueba"]?.Keys.length;
    });
    expect(tamanos.sort((a, b) => (b ?? 0) - (a ?? 0))).toEqual([100, 100, 50]);
  });
});
