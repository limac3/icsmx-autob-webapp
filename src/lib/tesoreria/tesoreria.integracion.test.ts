// @vitest-environment node
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { clave } from "@/lib/data/claves";
import type { DepsDeServicio } from "@/lib/data/deps";
import { solicitarCompra } from "@/lib/fila/solicitarCompra";
import type { ActorUsuario } from "@/types/auditoria";
import type { Lote } from "@/types/lote";
import { avalarPago } from "./avalarPago";
import { listarPendientesVerificacion } from "./listarPendientesVerificacion";
import { rechazarPago } from "./rechazarPago";
import { puedeUsarBackendReal } from "@/utils/backendUtilizable";
import {
  subirComprobante,
  type DepsSubirComprobante,
} from "./subirComprobante";

vi.mock("server-only", () => ({}));

/**
 * T3, T4 y T6 contra DynamoDB y S3 reales — la regresion permanente de la
 * Etapa 9, sobre el codigo de produccion.
 *
 * Mismo criterio que `fila.integracion.test.ts`: un doble del cliente solo
 * comprobaria que el doble coincide consigo mismo. Lo que solo puede
 * decidirse aqui:
 *
 *  - que el comprobante quede de verdad en S3 antes de que la condicion de
 *    T3 lo acepte;
 *  - que `avalarPago` deje el lote y el vehiculo `VENDIDO` y retire los dos
 *    centinelas;
 *  - que `rechazarPago` reasigne al siguiente turno vivo con su propio plazo;
 *  - que PA-11 (la bandeja) encuentre lo que subio el comprobante y deje de
 *    verlo en cuanto se dictamina.
 *
 * **Se omite —no falla— sin `amplify_outputs.json` ni credenciales**, igual
 * que el resto de la suite de integracion.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type SalidasAutob = {
  tabla?: string;
  bucket?: string;
  rolComputoSsr?: string;
};

const RUTA_SALIDAS = join(process.cwd(), "amplify_outputs.json");

const leerSalidas = (): SalidasAutob | null => {
  if (!existsSync(RUTA_SALIDAS)) return null;
  const salidas = JSON.parse(readFileSync(RUTA_SALIDAS, "utf8")) as {
    custom?: { autob?: SalidasAutob };
  };
  return salidas.custom?.autob ?? null;
};

const salidas = leerSalidas();
const hayBackend = puedeUsarBackendReal(salidas) && Boolean(salidas?.bucket);

const HORAS_LIQUIDACION = 48;
const CORRIDA = randomUUID().slice(0, 8);

const actorDe = (participanteId: string): ActorUsuario => ({
  tipo: "USUARIO",
  id: participanteId,
  permisos: ["Autob_Operar_Tesoreria"],
});

describe.skipIf(!hayBackend)("tesoreria contra DynamoDB y S3 reales", () => {
  let dynamo: DynamoDBClient;
  let cliente: DynamoDBDocumentClient;
  let s3: S3Client;
  let deps: DepsDeServicio;
  let depsConS3: DepsSubirComprobante;
  const particionesCreadas = new Set<string>();
  const objetosDeS3 = new Set<string>();

  beforeAll(async () => {
    vi.stubEnv("AUTOB_TABLE_NAME", salidas!.tabla!);
    vi.stubEnv("AUTOB_MEDIA_BUCKET", salidas!.bucket!);

    // El rol real de computo SSR, no las credenciales del desarrollador: la
    // prueba ejerce la politica IAM que corre en produccion (grantPut sobre
    // `comprobantes/*` y el `Deny` de borrado incluidos).
    const sesion = await new STSClient({}).send(
      new AssumeRoleCommand({
        RoleArn: salidas!.rolComputoSsr!,
        RoleSessionName: "prueba-tesoreria-etapa9",
        DurationSeconds: 3600,
      }),
    );
    const credenciales = sesion.Credentials;
    if (!credenciales?.AccessKeyId || !credenciales.SecretAccessKey) {
      throw new Error(
        "STS no devolvio credenciales para el rol de computo SSR.",
      );
    }
    const paquete = {
      accessKeyId: credenciales.AccessKeyId,
      secretAccessKey: credenciales.SecretAccessKey,
      sessionToken: credenciales.SessionToken,
    };

    dynamo = new DynamoDBClient({ credentials: paquete });
    cliente = DynamoDBDocumentClient.from(dynamo, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: false,
      },
      unmarshallOptions: { wrapNumbers: false },
    });
    s3 = new S3Client({ credentials: paquete });
    deps = { cliente };
    depsConS3 = { cliente, s3 };
  });

  afterAll(async () => {
    // Los `AUDIT#` no se purgan (el rol tiene denegado `DeleteItem` sobre
    // ellos). Los comprobantes de S3 tampoco: la misma politica niega
    // `s3:DeleteObject` sobre `comprobantes/*` — intentar borrarlos fallaria,
    // y es la garantia de la Etapa 9, no un descuido de esta prueba.
    await Promise.all(
      [...particionesCreadas].map(async (pk) => {
        const items = await cliente.send(
          new QueryCommand({
            TableName: process.env.AUTOB_TABLE_NAME,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": pk },
            ConsistentRead: true,
          }),
        );
        await Promise.all(
          (items.Items ?? []).map(async (item) =>
            cliente.send(
              new DeleteCommand({
                TableName: process.env.AUTOB_TABLE_NAME,
                Key: { PK: item.PK, SK: item.SK },
              }),
            ),
          ),
        );
      }),
    );
    void objetosDeS3; // dejados a proposito en S3; ver comentario arriba.
    dynamo?.destroy();
    s3?.destroy();
    vi.unstubAllEnvs();
  });

  const participante = (nombre: string): string => {
    const id = `e9-${nombre}-${CORRIDA}`;
    particionesCreadas.add(clave.centinelaAdjudicacion(id).PK);
    return id;
  };

  /** Convocatoria publicada, venta abierta, un lote con su vehiculo. */
  const crearEscenario = async (): Promise<Lote> => {
    const tabla = process.env.AUTOB_TABLE_NAME;
    const sufijo = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const convocatoriaId = `e9-conv-${sufijo}`;
    const loteId = `e9-lote-${sufijo}`;
    const vehiculoId = `e9-veh-${sufijo}`;
    const ahora = new Date();

    const ventana = {
      publicadaEn: new Date(ahora.getTime() - 7_200_000).toISOString(),
      inicioVenta: new Date(ahora.getTime() - 3_600_000).toISOString(),
      finVenta: new Date(ahora.getTime() + 86_400_000).toISOString(),
    };

    await cliente.send(
      new PutCommand({
        TableName: tabla,
        Item: {
          ...clave.convocatoria(convocatoriaId),
          estatus: "PUBLICADA",
          tipo: "EMPLEADOS",
          ...ventana,
        },
      }),
    );
    await cliente.send(
      new PutCommand({
        TableName: tabla,
        Item: {
          ...clave.vehiculo(vehiculoId),
          vehiculoId,
          marca: "Nissan",
          version: "NP300",
          modelo: 2019,
          kilometraje: 120_000,
          estatus: "EN_CONVOCATORIA",
          convocatoriaId,
          creadoEn: ventana.publicadaEn,
          creadoPor: "ADMIN",
        },
      }),
    );
    // T7 lo crea al incluir el vehiculo en la convocatoria (R-10); esta
    // prueba arma el escenario a mano y tiene que crearlo igual, porque
    // `avalarPago` lo retira al vender (modelo-datos 4.1).
    await cliente.send(
      new PutCommand({
        TableName: tabla,
        Item: { ...clave.centinelaVehiculoActivo(vehiculoId), convocatoriaId },
      }),
    );

    const lote: Lote = {
      loteId,
      convocatoriaId,
      vehiculoId,
      precio: 180_000,
      estatus: "EN_OFERTA",
      contadorTurnos: 0,
      inicioVenta: ventana.inicioVenta,
      finVenta: ventana.finVenta,
      tipoConvocatoria: "EMPLEADOS",
      estatusConvocatoria: "PUBLICADA",
      horasLiquidacion: HORAS_LIQUIDACION,
      creadoEn: ventana.publicadaEn,
      creadoPor: "ADMIN",
    };

    await cliente.send(
      new PutCommand({
        TableName: tabla,
        Item: { ...clave.lote(convocatoriaId, loteId), ...lote },
      }),
    );

    particionesCreadas.add(clave.convocatoria(convocatoriaId).PK);
    particionesCreadas.add(clave.vehiculo(vehiculoId).PK);
    particionesCreadas.add(clave.solicitud(loteId, 0).PK);
    return lote;
  };

  const leerSolicitud = async (loteId: string, turno: number) => {
    const salida = await cliente.send(
      new GetCommand({
        TableName: process.env.AUTOB_TABLE_NAME,
        Key: clave.solicitud(loteId, turno),
        ConsistentRead: true,
      }),
    );
    if (!salida.Item) throw new Error("solicitud no encontrada");
    return salida.Item as Record<string, unknown> & {
      solicitudId: string;
      loteId: string;
      convocatoriaId: string;
      participanteId: string;
      turno: number;
      estatus: string;
    };
  };

  const leerLote = async (lote: Lote) => {
    const salida = await cliente.send(
      new GetCommand({
        TableName: process.env.AUTOB_TABLE_NAME,
        Key: clave.lote(lote.convocatoriaId, lote.loteId),
        ConsistentRead: true,
      }),
    );
    return salida.Item ?? {};
  };

  const leerVehiculo = async (vehiculoId: string) => {
    const salida = await cliente.send(
      new GetCommand({
        TableName: process.env.AUTOB_TABLE_NAME,
        Key: clave.vehiculo(vehiculoId),
        ConsistentRead: true,
      }),
    );
    return salida.Item ?? {};
  };

  const leerBitacora = async (loteId: string) => {
    const salida = await cliente.send(
      new QueryCommand({
        TableName: process.env.AUTOB_TABLE_NAME,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `AUDIT#LOTE#${loteId}` },
        ConsistentRead: true,
      }),
    );
    return (salida.Items ?? []).map((item) => String(item.tipo));
  };

  const archivo = {
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "image/jpeg" as const,
  };

  it("T3 -> T4: sube el comprobante, lo avala, y el lote y el vehiculo quedan VENDIDO", async () => {
    const lote = await crearEscenario();
    const participanteId = participante("aval");
    const correoTitular = `${participanteId}@example.org`;

    const registro = await solicitarCompra(
      { lote, participanteId, actor: actorDe(participanteId), correoTitular },
      deps,
    );
    if (!registro.ok) throw new Error("se esperaba entrar a la fila");
    expect(registro.data.adjudicacion.estado).toBe("adjudicado");

    const itemAdjudicada = await leerSolicitud(
      lote.loteId,
      registro.data.turno,
    );
    expect(itemAdjudicada.estatus).toBe("ADJUDICADA");

    const subida = await subirComprobante(
      {
        solicitud: {
          solicitudId: itemAdjudicada.solicitudId,
          loteId: itemAdjudicada.loteId,
          convocatoriaId: itemAdjudicada.convocatoriaId,
          participanteId: itemAdjudicada.participanteId,
          turno: itemAdjudicada.turno,
          estatus: "ADJUDICADA",
          solicitadoEn: String(itemAdjudicada.solicitadoEn),
          venceEn: String(itemAdjudicada.venceEn),
        },
        archivo,
        actor: actorDe(participanteId),
      },
      depsConS3,
    );
    if (!subida.ok)
      throw new Error(`se esperaba EN_VERIFICACION: ${subida.error}`);
    expect(subida.data.estatus).toBe("EN_VERIFICACION");

    const itemEnVerificacion = await leerSolicitud(
      lote.loteId,
      registro.data.turno,
    );
    expect(itemEnVerificacion.estatus).toBe("EN_VERIFICACION");
    expect(itemEnVerificacion.comprobanteClaveS3).toBeTruthy();
    objetosDeS3.add(String(itemEnVerificacion.comprobanteClaveS3));
    // GSI4 (vencimiento) se retiro: el reloj se detuvo.
    expect(itemEnVerificacion.GSI4PK).toBeUndefined();

    // La bandeja de tesoreria (PA-11) encuentra la solicitud recien subida.
    const bandeja = await listarPendientesVerificacion(deps);
    if (!bandeja.ok) throw new Error("se esperaba leer la bandeja");
    expect(bandeja.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          solicitudId: itemEnVerificacion.solicitudId,
          correoTitular,
        }),
      ]),
    );

    const loteAdjudicado = (await leerLote(lote)) as Lote;
    const aval = await avalarPago(
      {
        lote: loteAdjudicado,
        solicitud: {
          solicitudId: itemEnVerificacion.solicitudId,
          loteId: itemEnVerificacion.loteId,
          participanteId: itemEnVerificacion.participanteId,
          turno: itemEnVerificacion.turno,
          estatus: "EN_VERIFICACION",
          solicitadoEn: String(itemEnVerificacion.solicitadoEn),
        },
        actor: actorDe("OP1"),
      },
      deps,
    );
    if (!aval.ok) throw new Error(`se esperaba avalar el pago: ${aval.error}`);
    expect(aval.data.estatus).toBe("VENDIDA");

    const loteFinal = await leerLote(lote);
    expect(loteFinal.estatus).toBe("VENDIDO");
    const vehiculoFinal = await leerVehiculo(lote.vehiculoId);
    expect(vehiculoFinal.estatus).toBe("VENDIDO");

    // La bandeja ya no lo muestra: se dictamino.
    const bandejaDespues = await listarPendientesVerificacion(deps);
    if (!bandejaDespues.ok) throw new Error("se esperaba leer la bandeja");
    expect(
      bandejaDespues.data.some(
        (p) => p.solicitudId === itemEnVerificacion.solicitudId,
      ),
    ).toBe(false);

    const eventos = await leerBitacora(lote.loteId);
    expect(eventos).toEqual(
      expect.arrayContaining([
        "SOLICITUD_CREADA",
        "LOTE_ADJUDICADO",
        "COMPROBANTE_CARGADO",
        "PAGO_AVALADO",
      ]),
    );
  });

  it("T6: rechaza el pago y reasigna al siguiente turno vivo con un plazo propio", async () => {
    const lote = await crearEscenario();
    const ganador = participante("rechazo-a");
    const siguiente = participante("rechazo-b");

    const primero = await solicitarCompra(
      { lote, participanteId: ganador, actor: actorDe(ganador) },
      deps,
    );
    if (!primero.ok) throw new Error("se esperaba entrar a la fila");
    expect(primero.data.adjudicacion.estado).toBe("adjudicado");

    const segundo = await solicitarCompra(
      { lote, participanteId: siguiente, actor: actorDe(siguiente) },
      deps,
    );
    if (!segundo.ok) throw new Error("se esperaba entrar a la fila");
    // El lote ya esta adjudicado al primero; el segundo se forma detras.
    expect(segundo.data.adjudicacion.estado).not.toBe("adjudicado");

    const itemGanador = await leerSolicitud(lote.loteId, primero.data.turno);

    const subida = await subirComprobante(
      {
        solicitud: {
          solicitudId: itemGanador.solicitudId,
          loteId: itemGanador.loteId,
          participanteId: itemGanador.participanteId,
          turno: itemGanador.turno,
          estatus: "ADJUDICADA",
          solicitadoEn: String(itemGanador.solicitadoEn),
          venceEn: String(itemGanador.venceEn),
        },
        archivo,
        actor: actorDe(ganador),
      },
      depsConS3,
    );
    if (!subida.ok)
      throw new Error(`se esperaba EN_VERIFICACION: ${subida.error}`);
    objetosDeS3.add(
      String(
        (await leerSolicitud(lote.loteId, primero.data.turno))
          .comprobanteClaveS3,
      ),
    );

    const loteAdjudicado = (await leerLote(lote)) as Lote;
    const itemEnVerificacion = await leerSolicitud(
      lote.loteId,
      primero.data.turno,
    );

    const rechazo = await rechazarPago(
      {
        lote: loteAdjudicado,
        solicitud: {
          solicitudId: itemEnVerificacion.solicitudId,
          loteId: itemEnVerificacion.loteId,
          participanteId: itemEnVerificacion.participanteId,
          turno: itemEnVerificacion.turno,
          estatus: "EN_VERIFICACION",
          solicitadoEn: String(itemEnVerificacion.solicitadoEn),
        },
        motivo: "El comprobante no coincide con el monto",
        actor: actorDe("OP1"),
      },
      deps,
    );
    if (!rechazo.ok)
      throw new Error(`se esperaba rechazar el pago: ${rechazo.error}`);
    expect(rechazo.data.estatus).toBe("RECHAZADA_POR_TESORERIA");
    expect(rechazo.data.reasignacion).toMatchObject({
      estado: "adjudicado",
      turno: segundo.data.turno,
    });

    const itemRechazado = await leerSolicitud(lote.loteId, primero.data.turno);
    expect(itemRechazado.estatus).toBe("RECHAZADA_POR_TESORERIA");
    expect(itemRechazado.motivoRechazo).toBe(
      "El comprobante no coincide con el monto",
    );

    const itemSiguiente = await leerSolicitud(lote.loteId, segundo.data.turno);
    expect(itemSiguiente.estatus).toBe("ADJUDICADA");

    const loteFinal = await leerLote(lote);
    expect(loteFinal.adjudicacionActual).toBe(itemSiguiente.solicitudId);

    const eventos = await leerBitacora(lote.loteId);
    expect(eventos).toEqual(
      expect.arrayContaining(["PAGO_RECHAZADO", "LOTE_ADJUDICADO"]),
    );
  });
});
