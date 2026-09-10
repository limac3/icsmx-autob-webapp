// @vitest-environment node
import {
  ConditionalCheckFailedException,
  TransactionConflictException,
} from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import { enviarCorreo } from "./clienteCes";
import { MAXIMO_INTENTOS_CORREO, procesarOutbox } from "./procesarOutbox";

vi.mock("server-only", () => ({}));
vi.mock("./clienteCes", () => ({ enviarCorreo: vi.fn() }));

const enviar = vi.mocked(enviarCorreo);

const AHORA = new Date("2026-10-08T15:00:00.000Z");

const mensajeItem = (
  mensajeId: string,
  extra: Record<string, unknown> = {},
) => ({
  PK: `OUTBOX#${mensajeId}`,
  SK: "META",
  mensajeId,
  tipo: "ADJUDICACION",
  destinatario: "p1@example.org",
  creadoEn: "2026-10-08T14:00:00.000Z",
  estatus: "PENDIENTE",
  intentos: 0,
  datos: {
    solicitudId: "L1-2",
    loteId: "L1",
    convocatoriaId: "C1",
    vehiculoId: "V1",
    precio: 180_000,
    venceEn: "2026-10-10T15:00:00.000Z",
  },
  ...extra,
});

const conPendientes = (items: Record<string, unknown>[]) => {
  return (comando: ComandoEnviado): unknown => {
    if (comando.nombre === "QueryCommand") return { Items: items };
    return {};
  };
};

const itemsDe = (falso: ReturnType<typeof crearClienteFalso>, nombre: string) =>
  falso.comandos.filter((c) => c.nombre === nombre);

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("procesarOutbox — exito", () => {
  it("marca ENVIADO, retira GSI4 y escribe CORREO_ENVIADO", async () => {
    enviar.mockResolvedValue({ ok: true, idExterno: "MSG-1" });
    const falso = crearClienteFalso({
      responder: conPendientes([mensajeItem("M1")]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado).toEqual({
      enviados: 1,
      fallidosPermanentes: 0,
      reintentaraDespues: 0,
      enVuelo: 0,
      sinPresupuesto: 0,
      // `creadoEn` de la plantilla es una hora antes de `AHORA`.
      antiguedadMaximaMin: 60,
    });

    const transaccion = itemsDe(falso, "TransactWriteCommand")[0]?.input
      .TransactItems as Record<string, Record<string, unknown>>[];
    expect(transaccion[0]?.Update).toMatchObject({
      Key: { PK: "OUTBOX#M1", SK: "META" },
      // Condiciona a la adquisicion de esta corrida, no a `PENDIENTE`: para
      // cuando se llega aqui, el mensaje ya paso a `ENVIANDO`.
      ConditionExpression: "estatus = :enviando",
    });
    expect(String(transaccion[0]?.Update?.UpdateExpression)).toContain(
      "REMOVE GSI4PK, GSI4SK, leaseHasta",
    );
    expect(transaccion[1]?.Put?.Item).toMatchObject({
      tipo: "CORREO_ENVIADO",
      solicitudId: "L1-2",
      loteId: "L1",
      datos: { mensajeId: "M1", idExterno: "MSG-1" },
    });
  });
});

describe("procesarOutbox — fallo transitorio", () => {
  it("solo incrementa intentos, sin transaccion ni evento", async () => {
    enviar.mockResolvedValue({
      ok: false,
      error: "timeout",
      reintentable: true,
    });
    const falso = crearClienteFalso({
      responder: conPendientes([mensajeItem("M1")]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado).toEqual({
      enviados: 0,
      fallidosPermanentes: 0,
      reintentaraDespues: 1,
      enVuelo: 0,
      sinPresupuesto: 0,
      antiguedadMaximaMin: 60,
    });
    expect(itemsDe(falso, "TransactWriteCommand")).toHaveLength(0);

    // Dos `Update` sueltos: el que adquiere y el que devuelve el mensaje a
    // `PENDIENTE`. El segundo es el que anota el intento.
    const updates = itemsDe(falso, "UpdateCommand");
    expect(updates).toHaveLength(2);

    const devolucion = updates[1];
    expect(devolucion?.input).toMatchObject({
      Key: { PK: "OUTBOX#M1", SK: "META" },
      ConditionExpression: "estatus = :enviando",
    });
    expect(devolucion?.input.ExpressionAttributeValues).toMatchObject({
      ":intentos": 1,
      ":error": "timeout",
      ":pendiente": "PENDIENTE",
    });
    // Suelta el plazo: el mensaje vuelve a estar disponible en la corrida
    // siguiente, no cuando venza la adquisicion.
    expect(String(devolucion?.input.UpdateExpression)).toContain(
      "REMOVE leaseHasta",
    );
  });

  it("un conflicto de transaccion al devolverlo a PENDIENTE no aborta la corrida", async () => {
    // El item del mensaje **si** participa en transacciones (`marcarEnviado` y
    // `marcarFallido`), asi que dos corridas solapadas del barrido pueden
    // chocar: una resolviendo el mensaje por transaccion, la otra devolviendolo
    // a `PENDIENTE` con este `UpdateItem` suelto. Dejar escapar la excepcion
    // abortaria el resto del outbox por no poder escribir un contador.
    enviar.mockResolvedValue({
      ok: false,
      error: "timeout",
      reintentable: true,
    });
    let updates = 0;
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "QueryCommand") {
          return { Items: [mensajeItem("M1")] };
        }
        if (comando.nombre === "UpdateCommand") {
          updates += 1;
          // El primero es la adquisicion y tiene que funcionar; el conflicto se
          // provoca en la devolucion, que es donde vive el helper tolerante.
          if (updates > 1) {
            throw new TransactionConflictException({
              message: "Transaction is ongoing for the item",
              $metadata: {},
            });
          }
        }
        return {};
      },
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado.reintentaraDespues).toBe(1);
  });

  it("al agotar MAXIMO_INTENTOS_CORREO, un fallo reintentable se vuelve permanente", async () => {
    enviar.mockResolvedValue({
      ok: false,
      error: "timeout",
      reintentable: true,
    });
    const falso = crearClienteFalso({
      responder: conPendientes([
        mensajeItem("M1", { intentos: MAXIMO_INTENTOS_CORREO - 1 }),
      ]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado.fallidosPermanentes).toBe(1);
    const transaccion = itemsDe(falso, "TransactWriteCommand")[0]?.input
      .TransactItems as Record<string, Record<string, unknown>>[];
    expect(transaccion[1]?.Put?.Item).toMatchObject({
      tipo: "CORREO_FALLIDO",
      motivo: "timeout",
    });
  });
});

describe("procesarOutbox — fallo no reintentable", () => {
  it("un 401/4xx se vuelve CORREO_FALLIDO de inmediato, sin esperar los reintentos", async () => {
    enviar.mockResolvedValue({
      ok: false,
      error: "CES respondio 401: credenciales",
      reintentable: false,
    });
    const falso = crearClienteFalso({
      responder: conPendientes([mensajeItem("M1")]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado.fallidosPermanentes).toBe(1);
    // El unico `Update` suelto es la adquisicion: no se devuelve a `PENDIENTE`,
    // porque un 401 no se reintenta.
    expect(itemsDe(falso, "UpdateCommand")).toHaveLength(1);
    const transaccion = itemsDe(falso, "TransactWriteCommand")[0]?.input
      .TransactItems as Record<string, Record<string, unknown>>[];
    expect(transaccion[0]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":intentos": 1,
    });
  });
});

describe("procesarOutbox — varios mensajes", () => {
  it("procesa cada mensaje pendiente de forma independiente", async () => {
    enviar
      .mockResolvedValueOnce({ ok: true, idExterno: "MSG-1" })
      .mockResolvedValueOnce({
        ok: false,
        error: "timeout",
        reintentable: true,
      });
    const falso = crearClienteFalso({
      responder: conPendientes([mensajeItem("M1"), mensajeItem("M2")]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado).toEqual({
      enviados: 1,
      fallidosPermanentes: 0,
      reintentaraDespues: 1,
      enVuelo: 0,
      sinPresupuesto: 0,
      antiguedadMaximaMin: 60,
    });
  });
});

describe("procesarOutbox — dos corridas solapadas (regla 16)", () => {
  // El barrido corre cada 5 min y puede tardar hasta 300 s, asi que dos
  // corridas se solapan y leen la misma lista. Antes las dos llamaban a CES y
  // solo una lograba el `Update` a `ENVIADO`: la bitacora quedaba correcta y el
  // participante recibia dos correos. Estas pruebas exigen un solo envio.
  //
  // El doble de `crearClienteFalso` captura comandos sin evaluar condiciones,
  // asi que aqui se modela lo minimo: el estatus del item y la condicion de la
  // adquisicion. Es la misma leccion de `desafios-implementacion.md` 51 — un
  // doble que captura no valida expresiones — aplicada a proposito.
  const outboxCompartido = (mensajeId: string) => {
    let estatus = "PENDIENTE";

    return (comando: ComandoEnviado): unknown => {
      if (comando.nombre === "QueryCommand") {
        return { Items: [mensajeItem(mensajeId, { estatus })] };
      }

      if (comando.nombre === "UpdateCommand") {
        const condicion = String(comando.input.ConditionExpression);
        const adquiere = condicion.includes(":pendiente");

        if (adquiere && estatus !== "PENDIENTE") {
          throw new ConditionalCheckFailedException({
            message: "The conditional request failed",
            $metadata: {},
          });
        }
        estatus = adquiere ? "ENVIANDO" : "PENDIENTE";
      }

      return {};
    };
  };

  it("solo una de las dos llama a CES", async () => {
    enviar.mockResolvedValue({ ok: true, idExterno: "MSG-1" });
    const responder = outboxCompartido("M1");
    const deps = () => ({
      cliente: crearClienteFalso({ responder }).cliente,
      ahora: () => AHORA,
    });

    const [primera, segunda] = await Promise.all([
      procesarOutbox(deps()),
      procesarOutbox(deps()),
    ]);

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(primera.enviados + segunda.enviados).toBe(1);
    expect(primera.enVuelo + segunda.enVuelo).toBe(1);
  });

  it("la que pierde la adquisicion no lo cuenta como fallo", async () => {
    // `enVuelo` existe para esto: sin un contador propio, la corrida que pierde
    // parece no haber hecho nada o —peor— parece haber fallado.
    enviar.mockResolvedValue({ ok: true, idExterno: "MSG-1" });
    const responder = outboxCompartido("M1");
    const deps = () => ({
      cliente: crearClienteFalso({ responder }).cliente,
      ahora: () => AHORA,
    });

    const [primera, segunda] = await Promise.all([
      procesarOutbox(deps()),
      procesarOutbox(deps()),
    ]);

    for (const corrida of [primera, segunda]) {
      expect(corrida.fallidosPermanentes).toBe(0);
      expect(corrida.reintentaraDespues).toBe(0);
    }
  });

  it("no toca un mensaje que otra corrida tiene adquirido con plazo vigente", async () => {
    // Se salta antes de intentar la escritura: la condicion lo impediria igual,
    // pero preguntar primero ahorra un `Update` por mensaje en el caso que el
    // solapamiento hace frecuente.
    enviar.mockResolvedValue({ ok: true, idExterno: "MSG-1" });
    const falso = crearClienteFalso({
      responder: conPendientes([
        mensajeItem("M1", {
          estatus: "ENVIANDO",
          leaseHasta: new Date(AHORA.getTime() + 60_000).toISOString(),
        }),
      ]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado.enVuelo).toBe(1);
    expect(enviar).not.toHaveBeenCalled();
    expect(itemsDe(falso, "UpdateCommand")).toHaveLength(0);
  });

  it("retoma un mensaje cuyo plazo ya vencio: la corrida que lo tenia murio", async () => {
    enviar.mockResolvedValue({ ok: true, idExterno: "MSG-1" });
    const falso = crearClienteFalso({
      responder: conPendientes([
        mensajeItem("M1", {
          estatus: "ENVIANDO",
          leaseHasta: new Date(AHORA.getTime() - 1000).toISOString(),
        }),
      ]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado.enviados).toBe(1);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it("la adquisicion admite PENDIENTE o un plazo vencido, y nada mas", async () => {
    enviar.mockResolvedValue({ ok: true, idExterno: "MSG-1" });
    const falso = crearClienteFalso({
      responder: conPendientes([mensajeItem("M1")]),
    });

    await procesarOutbox({ cliente: falso.cliente, ahora: () => AHORA });

    const adquisicion = itemsDe(falso, "UpdateCommand")[0];
    expect(adquisicion?.input.ConditionExpression).toBe(
      "#estatus = :pendiente OR (#estatus = :enviando AND leaseHasta <= :ahora)",
    );
    expect(adquisicion?.input.ExpressionAttributeValues).toMatchObject({
      ":enviando": "ENVIANDO",
      ":pendiente": "PENDIENTE",
    });
  });
});

describe("procesarOutbox — antiguedad del pendiente mas viejo", () => {
  // Es el numero que alimenta la alarma "correos en el outbox mas antiguos que
  // un umbral". Los contadores no sirven para eso: un CES caido deja
  // `reintentaraDespues` en un valor pequeno y constante, igual con dos
  // minutos de retraso que con dos dias.

  it("mide desde el primero de la lista, que PA-14 devuelve como el mas viejo", async () => {
    enviar.mockResolvedValue({
      ok: false,
      error: "timeout",
      reintentable: true,
    });
    const falso = crearClienteFalso({
      responder: conPendientes([
        mensajeItem("M1", { creadoEn: "2026-10-06T15:00:00.000Z" }),
        mensajeItem("M2", { creadoEn: "2026-10-08T14:30:00.000Z" }),
      ]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado.antiguedadMaximaMin).toBe(2 * 24 * 60);
  });

  it("sin pendientes, es cero y no NaN", async () => {
    const falso = crearClienteFalso({ responder: conPendientes([]) });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado.antiguedadMaximaMin).toBe(0);
  });

  it("un creadoEn en el futuro se acota a cero, no a un negativo", async () => {
    // Un negativo no dispararia jamas una alarma de umbral, asi que un reloj
    // torcido o un dato sembrado a mano dejaria el outbox sin vigilancia.
    enviar.mockResolvedValue({
      ok: false,
      error: "timeout",
      reintentable: true,
    });
    const falso = crearClienteFalso({
      responder: conPendientes([
        mensajeItem("M1", { creadoEn: "2026-10-09T15:00:00.000Z" }),
      ]),
    });

    const resultado = await procesarOutbox({
      cliente: falso.cliente,
      ahora: () => AHORA,
    });

    expect(resultado.antiguedadMaximaMin).toBe(0);
  });
});
