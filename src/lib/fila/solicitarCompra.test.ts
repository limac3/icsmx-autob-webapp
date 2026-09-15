// @vitest-environment node
import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
  TransactionConflictException,
} from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearClienteFalso,
  type ComandoEnviado,
} from "@/utils/clienteDynamoFalso";
import type { ActorUsuario } from "@/types/auditoria";
import type { Lote } from "@/types/lote";
import { adjudicarLote } from "./adjudicarLote";
import { solicitarCompra, __test__ } from "./solicitarCompra";

vi.mock("server-only", () => ({}));
vi.mock("./adjudicarLote", () => ({ adjudicarLote: vi.fn() }));

const adjudicacion = vi.mocked(adjudicarLote);

const AHORA = new Date("2026-10-06T15:00:00.000Z");

const lote: Lote = {
  loteId: "L1",
  convocatoriaId: "C1",
  vehiculoId: "V1",
  precio: 180_000,
  estatus: "EN_OFERTA",
  contadorTurnos: 0,
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  tipoConvocatoria: "EMPLEADOS",
  estatusConvocatoria: "PUBLICADA",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
  creadoEn: "2026-09-02T10:00:00.000Z",
  creadoPor: "P9",
};

const actor: ActorUsuario = {
  tipo: "USUARIO",
  id: "P1",
  permisos: ["Autob_Venta_a_empleados"],
};

/**
 * Hay **dos** contadores sueltos y hay que distinguirlos por su clave: el paso
 * 1 hace `ADD contadorTurnos` sobre el lote y el paso 1b hace
 * `ADD solicitudesCreadas` sobre el item de cupo del participante. Responder a
 * todo `UpdateCommand` con el turno haria que el ordinal llegara indefinido.
 */
const esContadorDeCupo = (comando: ComandoEnviado): boolean =>
  String(
    (comando.input.Key as Record<string, unknown> | undefined)?.SK,
  ).startsWith("CUPO#");

/** El paso 1 devuelve el turno, el paso 1b el ordinal. */
const conTurno =
  (turno: number, ordinal = 1) =>
  (comando: ComandoEnviado): unknown => {
    if (comando.nombre !== "UpdateCommand") return {};
    return esContadorDeCupo(comando)
      ? { Attributes: { solicitudesCreadas: ordinal } }
      : { Attributes: { contadorTurnos: turno } };
  };

const deps = (cliente: unknown) => ({
  cliente: cliente as never,
  ahora: () => AHORA,
  nuevoId: () => "R1",
});

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
  adjudicacion.mockResolvedValue({
    estado: "fila_agotada",
    turnosRevisados: 0,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

/** Cancela la transaccion por el centinela de fila: ya estaba en la fila. */
const rechazoDeCentinela =
  () =>
  (comando: ComandoEnviado): unknown => {
    if (comando.nombre === "UpdateCommand") {
      return esContadorDeCupo(comando)
        ? { Attributes: { solicitudesCreadas: 1 } }
        : { Attributes: { contadorTurnos: 2 } };
    }
    if (comando.nombre !== "TransactWriteCommand") return {};
    throw new TransactionCanceledException({
      message: "cancelada",
      $metadata: {},
      CancellationReasons: [
        { Code: "None" },
        { Code: "ConditionalCheckFailed" },
        { Code: "None" },
        { Code: "None" },
      ],
    });
  };

describe("el orden de las escrituras — R18 y R-22", () => {
  it("anota la reserva ANTES de pedir el turno", async () => {
    // **Es la garantia entera de R18.** Al reves —contador y despues reserva—
    // queda abierta la ventana en la que el turno existe y la fila no lo ve, y
    // el prototipo demostro que ahi el turno 2 gana el vehiculo del turno 1.
    const falso = crearClienteFalso({ responder: conTurno(1) });

    await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    expect(falso.comandos.map((c) => c.nombre)).toEqual([
      "PutCommand",
      "UpdateCommand",
      "UpdateCommand",
      "TransactWriteCommand",
    ]);
    expect(falso.comandos[0]?.input.Item).toMatchObject({
      PK: "LOTE#L1",
      SK: "RESERVA#R1",
      anotadaEn: AHORA.toISOString(),
    });
  });

  it("el ordinal se pide DESPUES del turno, no antes (R-22)", async () => {
    // Un `ADD` no se puede deshacer, y este ordinal **cuenta contra un tope**:
    // quemarlo le costaria una participacion a quien no hizo nada mal. Pedido
    // despues, la ventana de venta y el estado del lote ya los valido la
    // condicion del contador de turnos, y lo unico que aun puede fallar es una
    // carrera genuina.
    const falso = crearClienteFalso({ responder: conTurno(1) });

    await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    const [contador, ordinal] = falso.comandos.filter(
      (c) => c.nombre === "UpdateCommand",
    );
    expect(contador?.input.UpdateExpression).toBe("ADD contadorTurnos :uno");
    expect(ordinal?.input.Key).toEqual({ PK: "PART#P1", SK: "CUPO#C1" });
    expect(ordinal?.input.UpdateExpression).toBe("ADD solicitudesCreadas :uno");
    // Sin condicion: el tope no rechaza, cancela despues. Condicionarlo aqui
    // convertiria el exceso en un rechazo silencioso y perderia la constancia
    // que el negocio pidio.
    expect(ordinal?.input.ConditionExpression).toBeUndefined();
  });

  it("si el turno se rechaza, el ordinal no se llega a gastar", async () => {
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "UpdateCommand" && !esContadorDeCupo(comando)) {
          throw new ConditionalCheckFailedException({
            message: "venta cerrada",
            $metadata: {},
          });
        }
        return {};
      },
    });

    await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    const ordinales = falso.comandos.filter(
      (c) => c.nombre === "UpdateCommand" && esContadorDeCupo(c),
    );
    expect(ordinales).toHaveLength(0);
  });

  it("el turno sale del contador atomico, no del cliente ni del reloj", async () => {
    const falso = crearClienteFalso({ responder: conTurno(7) });

    const resultado = await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.turno).toBe(7);
    expect(resultado.data.solicitudId).toBe("L1-7");
    expect(falso.comandos[1]?.input).toMatchObject({
      UpdateExpression: "ADD contadorTurnos :uno",
      ReturnValues: "UPDATED_NEW",
    });
  });

  it("un contador que no devuelve el turno rompe fuerte en vez de inventarlo", async () => {
    // Escribir una solicitud sin turno cierto romperia el orden de la fila, que
    // es la promesa central del sistema. No hay degradacion elegante posible.
    const falso = crearClienteFalso({ responder: () => ({}) });

    await expect(
      solicitarCompra(
        { lote, participanteId: "P1", actor },
        deps(falso.cliente),
      ),
    ).rejects.toThrow(/no devolvio el turno/);
  });
});

describe("condicion del paso 1", () => {
  it("un lote ADJUDICADO sigue admitiendo fila (R-17)", async () => {
    // Exigir `EN_OFERTA` cerraria la fila en la primera adjudicacion y dejaria
    // sin sentido `miPosicion`, `tamanoFila` y la reasignacion de R-15.
    expect(__test__.CONDICION_LOTE_ADMITE_FILA).toContain(":adjudicado");
    expect(__test__.CONDICION_LOTE_ADMITE_FILA).toContain(":enOferta");
  });

  it("exige convocatoria publicada y ventana de venta abierta", async () => {
    const falso = crearClienteFalso({ responder: conTurno(1) });
    await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    expect(falso.comandos[1]?.input).toMatchObject({
      ConditionExpression: __test__.CONDICION_LOTE_ADMITE_FILA,
      ExpressionAttributeValues: {
        ":publicada": "PUBLICADA",
        ":ahora": AHORA.toISOString(),
      },
    });
  });

  it("reproduce la ventana semiabierta de ventanas.ts", () => {
    // `inicioVenta <= ahora AND finVenta > ahora`. Si la condicion de DynamoDB
    // y el dominio usaran distinta inclusividad, la UI ofreceria un boton que
    // la base de datos rechaza.
    expect(__test__.CONDICION_LOTE_ADMITE_FILA).toContain(
      "inicioVenta <= :ahora AND finVenta > :ahora",
    );
  });
});

describe("compensacion cuando el turno no se entrega", () => {
  const rechazado =
    () =>
    (comando: ComandoEnviado): unknown => {
      if (comando.nombre !== "UpdateCommand") return {};
      throw new ConditionalCheckFailedException({
        message: "condicion",
        $metadata: {},
      });
    };

  it("borra la reserva que ya no corresponde a ningun turno", async () => {
    const falso = crearClienteFalso({ responder: rechazado() });

    await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    const borrado = falso.comandos.find((c) => c.nombre === "DeleteCommand");
    expect(borrado?.input.Key).toEqual({ PK: "LOTE#L1", SK: "RESERVA#R1" });
  });

  it("un lote vendido responde lote_no_disponible", async () => {
    const falso = crearClienteFalso({ responder: rechazado() });

    const resultado = await solicitarCompra(
      { lote: { ...lote, estatus: "VENDIDO" }, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "lote_no_disponible" });
  });

  it("una venta que todavia no abre responde invalid_state", async () => {
    const falso = crearClienteFalso({ responder: rechazado() });

    const resultado = await solicitarCompra(
      {
        lote: { ...lote, inicioVenta: "2026-10-20T15:00:00.000Z" },
        participanteId: "P1",
        actor,
      },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "invalid_state" });
  });

  it("un lote que segun lo leido si admitia fila es una carrera", async () => {
    const falso = crearClienteFalso({ responder: rechazado() });

    const resultado = await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "conflicto_concurrencia" });
  });
});

describe("el paso 1 choca con la transaccion de T2 sobre el mismo lote", () => {
  // Lo encontro la prueba de carga de la Etapa 12 y **no** es teorico: el `ADD
  // contadorTurnos` es la unica escritura del sistema que ocurre fuera de
  // transaccion sobre un item que si esta en otras —el de T2—, y en
  // `inicioVenta` los dos caminos se cruzan de forma rutinaria.
  //
  // Antes de la correccion la excepcion escapaba de `solicitarCompra` y el
  // participante veia un error del servidor en lugar de un "reintenta".

  const enConflicto =
    () =>
    (comando: ComandoEnviado): unknown => {
      if (comando.nombre !== "UpdateCommand") return {};
      throw new TransactionConflictException({
        message: "Transaction is ongoing for the item",
        $metadata: {},
      });
    };

  it("responde conflicto_concurrencia, no una excepcion", async () => {
    const falso = crearClienteFalso({ responder: enConflicto() });

    const resultado = await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "conflicto_concurrencia" });
  });

  it("no lo confunde con un rechazo de negocio", async () => {
    // Un lote vendido responde `lote_no_disponible` cuando falla **la
    // condicion**; con un conflicto de transaccion sobre el mismo lote, decirle
    // eso al participante seria falso: el lote sigue en juego.
    const falso = crearClienteFalso({ responder: enConflicto() });

    const resultado = await solicitarCompra(
      { lote: { ...lote, estatus: "VENDIDO" }, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "conflicto_concurrencia" });
  });

  it("libera la reserva igual que cualquier otro rechazo del paso 1", async () => {
    // Sin esto, un conflicto dejaria la reserva en pie hasta el umbral y
    // detendria las adjudicaciones ajenas de ese lote sin ninguna razon.
    const falso = crearClienteFalso({ responder: enConflicto() });

    await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    const borrado = falso.comandos.find((c) => c.nombre === "DeleteCommand");
    expect(borrado?.input.Key).toEqual({ PK: "LOTE#L1", SK: "RESERVA#R1" });
  });
});

describe("la transaccion que hace visible la solicitud", () => {
  const transaccionDe = (falso: ReturnType<typeof crearClienteFalso>) =>
    falso.comandos.find((c) => c.nombre === "TransactWriteCommand")?.input
      .TransactItems as Record<string, Record<string, unknown>>[];

  it("escribe solicitud, centinela, evento y retiro de reserva, en ese orden", async () => {
    // El orden fija la prioridad del diagnostico: `traducirCancelacion` se
    // queda con el primer motivo distinto de `None`, asi que "ya estabas en la
    // fila" gana sobre "tu reserva se dio por muerta".
    const falso = crearClienteFalso({ responder: conTurno(3) });
    await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    const items = transaccionDe(falso);
    expect(items.map((item) => Object.keys(item)[0])).toEqual([
      "Put",
      "Put",
      "Put",
      "Delete",
    ]);
    expect(items[0]?.Put?.Item).toMatchObject({
      PK: "LOTE#L1",
      SK: "SOL#0000000003",
      turno: 3,
      estatus: "EN_FILA",
      participanteId: "P1",
      solicitudId: "L1-3",
    });
    expect(items[1]?.Put?.Item).toMatchObject({ PK: "LOTE#L1", SK: "PART#P1" });
    expect(items[1]?.Put?.ConditionExpression).toBe("attribute_not_exists(SK)");
    expect(items[3]?.Delete?.Key).toEqual({ PK: "LOTE#L1", SK: "RESERVA#R1" });
    expect(items[3]?.Delete?.ConditionExpression).toBe("attribute_exists(SK)");
  });

  it("el evento viaja en la misma transaccion y es append-only (reglas 4 y 5)", async () => {
    const falso = crearClienteFalso({ responder: conTurno(3) });
    await solicitarCompra(
      { lote, participanteId: "P1", actor, tamanoFilaAlMomento: 2 },
      deps(falso.cliente),
    );

    const evento = transaccionDe(falso)[2]?.Put;
    expect(evento?.ConditionExpression).toBe("attribute_not_exists(PK)");
    expect(evento?.Item).toMatchObject({
      // Anclado al lote: la historia completa del lote se reconstruye con una
      // sola `Query` (trazabilidad-auditoria 2.1).
      PK: "AUDIT#LOTE#L1",
      tipo: "SOLICITUD_CREADA",
      actorId: "P1",
      solicitudId: "L1-3",
      estadoNuevo: "EN_FILA",
      datos: {
        turno: 3,
        solicitadoEn: AHORA.toISOString(),
        tamanoFilaAlMomento: 2,
      },
    });
  });

  it("la solicitud lleva las claves de GSI3, para PA-09", async () => {
    const falso = crearClienteFalso({ responder: conTurno(3) });
    await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    expect(transaccionDe(falso)[0]?.Put?.Item).toMatchObject({
      GSI3PK: "PART#P1",
      GSI3SK: `SOL#${AHORA.toISOString()}#L1`,
    });
  });

  it("`solicitadoEn` no aparece en ninguna clave de la tabla base (R-08)", async () => {
    const falso = crearClienteFalso({ responder: conTurno(3) });
    await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    const item = transaccionDe(falso)[0]?.Put?.Item as Record<string, string>;
    expect(item.SK).not.toContain(AHORA.toISOString());
    expect(item.PK).not.toContain(AHORA.toISOString());
  });
});

describe("adjudicacion despues de entrar a la fila", () => {
  it("se intenta siempre, no solo si la fila parecia vacia", async () => {
    // Con la abstencion por reservas, "solo si estaba vacia" produce un
    // bloqueo: A se abstiene porque B esta en vuelo y B no intenta porque la
    // fila no estaba vacia. Nadie adjudica hasta el barrido.
    const falso = crearClienteFalso({ responder: conTurno(5) });

    await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    expect(adjudicacion).toHaveBeenCalledTimes(1);
    expect(adjudicacion.mock.calls[0]?.[0]).toMatchObject({
      motivo: "PRIMERA_ADJUDICACION",
    });
  });

  it("no se intenta si la solicitud no llego a escribirse", async () => {
    const falso = crearClienteFalso({ responder: rechazoDeCentinela() });

    const resultado = await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    expect(resultado.ok).toBe(false);
    expect(adjudicacion).not.toHaveBeenCalled();
  });
});

describe("paso 0 — una reserva repetida no se sobrescribe", () => {
  it("rechaza con conflicto_concurrencia y **sin pedir el turno**", async () => {
    // Es la propiedad que importa: el rechazo ocurre antes del `ADD`, asi que
    // no consume un turno y no deja hueco en la fila. Si se sobrescribiera la
    // reserva ajena, su ventana quedaria sin marcar y una adjudicacion podria
    // coronar a un turno mayor — R18 otra vez.
    const falso = crearClienteFalso({
      responder: (comando) => {
        if (comando.nombre === "PutCommand") {
          throw new ConditionalCheckFailedException({
            message: "la reserva ya existe",
            $metadata: {},
          });
        }
        return {};
      },
    });

    const resultado = await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    expect(resultado).toEqual({ ok: false, error: "conflicto_concurrencia" });
    // Ningun `UpdateCommand`: el contador de turnos no se toco.
    expect(falso.comandos.map((c) => c.nombre)).toEqual(["PutCommand"]);
  });
});

describe("tope de solicitudes por convocatoria — R-22", () => {
  it("dentro del tope, la solicitud se queda en la fila e intenta adjudicar", async () => {
    const falso = crearClienteFalso({ responder: conTurno(1, 3) });

    const resultado = await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.ordenEnConvocatoria).toBe(3);
    expect(resultado.data.canceladaPorLimite).toBe(false);
    expect(adjudicacion).toHaveBeenCalled();
    // Una sola transaccion: la que hace visible la solicitud.
    expect(
      falso.comandos.filter((c) => c.nombre === "TransactWriteCommand"),
    ).toHaveLength(1);
  });

  it("al exceder el tope, la solicitud SE CREA y despues se cancela", async () => {
    // **Es lo que el negocio pidio literalmente**: "se cancelaran las que
    // excedan... dejando constancia de dicha participacion". Rechazarla antes
    // no dejaria rastro del intento, y ademas seria leer-y-decidir sobre un
    // item compartido, que es la causa medida de cancelaciones masivas por
    // `TransactionConflict`.
    const falso = crearClienteFalso({ responder: conTurno(1, 4) });

    const resultado = await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.ordenEnConvocatoria).toBe(4);
    expect(resultado.data.canceladaPorLimite).toBe(true);

    const transacciones = falso.comandos.filter(
      (c) => c.nombre === "TransactWriteCommand",
    );
    expect(transacciones).toHaveLength(2);

    // La primera la crea...
    const creacion = transacciones[0]?.input.TransactItems as Record<
      string,
      Record<string, unknown>
    >[];
    expect(creacion[0]?.Put?.Item).toMatchObject({
      SK: "SOL#0000000001",
      estatus: "EN_FILA",
      ordenEnConvocatoria: 4,
    });

    // ...y la segunda la cancela, con su evento y retirando el centinela de
    // fila, para que el participante no gaste su lugar de R-07 en este lote.
    const cancelacion = transacciones[1]?.input.TransactItems as Record<
      string,
      Record<string, unknown>
    >[];
    expect(cancelacion[0]?.Update).toMatchObject({
      Key: { PK: "LOTE#L1", SK: "SOL#0000000001" },
      ConditionExpression: "#estatus = :enFila",
    });
    expect(cancelacion[0]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":destino": "CANCELADA_POR_LIMITE",
    });
    expect(cancelacion[1]?.Delete?.Key).toEqual({
      PK: "LOTE#L1",
      SK: "PART#P1",
    });
    expect(cancelacion[2]?.Put?.Item).toMatchObject({
      tipo: "SOLICITUD_CANCELADA_POR_LIMITE",
      estadoAnterior: "EN_FILA",
      estadoNuevo: "CANCELADA_POR_LIMITE",
      datos: { turno: 1, ordenEnConvocatoria: 4, limiteSolicitudes: 3 },
    });
  });

  it("cancelada por tope, no se intenta adjudicar", async () => {
    // No tiene sentido competir por el lote con una solicitud que acaba de
    // salir de la fila.
    const falso = crearClienteFalso({ responder: conTurno(1, 9) });

    await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    expect(adjudicacion).not.toHaveBeenCalled();
  });

  it("el ordinal exacto del tope todavia entra: el limite es inclusivo", async () => {
    const falso = crearClienteFalso({ responder: conTurno(1, 3) });

    const resultado = await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.canceladaPorLimite).toBe(false);
  });

  it("si la solicitud ya gano el lote, la cancelacion por tope no la toca", async () => {
    // Entre crear y cancelar cabe una adjudicacion. La condicion
    // `#estatus = :enFila` es lo que impide arrebatarle el vehiculo a quien
    // acaba de recibirlo; el tope se aplicara a su siguiente intento.
    const falso = crearClienteFalso({ responder: conTurno(1, 4) });

    await solicitarCompra(
      { lote, participanteId: "P1", actor },
      deps(falso.cliente),
    );

    const cancelacion = falso.comandos.filter(
      (c) => c.nombre === "TransactWriteCommand",
    )[1]?.input.TransactItems as Record<string, Record<string, unknown>>[];

    expect(cancelacion[0]?.Update?.ConditionExpression).toBe(
      "#estatus = :enFila",
    );
  });
});
