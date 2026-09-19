// @vitest-environment node
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { clave, gsi4, NOMBRES_DE_INDICE } from "@/lib/data/claves";
import type { DepsDeServicio } from "@/lib/data/deps";
import type { Lote } from "@/types/lote";
import { adjudicarLote } from "./adjudicarLote";
import { solicitarCompra } from "./solicitarCompra";
import { vencerYReasignar } from "./vencerYReasignar";
import { backendParaRegresion } from "@/utils/backendUtilizable";

vi.mock("server-only", () => ({}));

/**
 * T5 (`vencerYReasignar`) contra DynamoDB real — Etapa 10. La regresion
 * permanente de la regla 16 para este motor de escritura condicional nuevo:
 * cubre el reasignado, la fila agotada **con la liberacion del vehiculo**
 * (la correccion sobre `modelo-datos-dynamodb.md` de esta etapa) y la
 * concurrencia entre el barrido y la verificacion perezosa compitiendo por la
 * misma vencida.
 *
 * Mismo patron que `fila.integracion.test.ts` (Etapa 8): se omite sin
 * `amplify_outputs.json` ni credenciales, y se asume el rol real de computo
 * SSR para ejercer la politica IAM de produccion.
 */

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

type SalidasAutob = { tabla?: string; rolComputoSsr?: string };

const RUTA_SALIDAS = join(process.cwd(), "amplify_outputs.json");

const leerSalidas = (): SalidasAutob | null => {
  if (!existsSync(RUTA_SALIDAS)) return null;
  const salidas = JSON.parse(readFileSync(RUTA_SALIDAS, "utf8")) as {
    custom?: { autob?: SalidasAutob };
  };
  return salidas.custom?.autob ?? null;
};

const salidas = leerSalidas();
const hayBackend = backendParaRegresion(salidas, "vencimiento y reasignacion");

const REPETICIONES = Number(process.env.FILA_REPETICIONES ?? "2");
const HORAS_LIQUIDACION = 1;
const CORRIDA = randomUUID().slice(0, 8);

describe.skipIf(!hayBackend)(
  "T5 — vencer y reasignar contra DynamoDB real",
  () => {
    let dynamo: DynamoDBClient;
    let cliente: DynamoDBDocumentClient;
    let deps: DepsDeServicio;
    const particionesCreadas = new Set<string>();

    beforeAll(async () => {
      vi.stubEnv("AUTOB_TABLE_NAME", salidas!.tabla!);

      const sesion = await new STSClient({}).send(
        new AssumeRoleCommand({
          RoleArn: salidas!.rolComputoSsr!,
          RoleSessionName: "prueba-vencimiento-etapa10",
          DurationSeconds: 3600,
        }),
      );

      const credenciales = sesion.Credentials;
      if (!credenciales?.AccessKeyId || !credenciales.SecretAccessKey) {
        throw new Error(
          "STS no devolvio credenciales para el rol de computo SSR.",
        );
      }

      dynamo = new DynamoDBClient({
        credentials: {
          accessKeyId: credenciales.AccessKeyId,
          secretAccessKey: credenciales.SecretAccessKey,
          sessionToken: credenciales.SessionToken,
        },
      });
      cliente = DynamoDBDocumentClient.from(dynamo, {
        marshallOptions: {
          removeUndefinedValues: true,
          convertClassInstanceToMap: false,
        },
        unmarshallOptions: { wrapNumbers: false },
      });
      deps = { cliente };
    });

    afterAll(async () => {
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
      dynamo?.destroy();
      vi.unstubAllEnvs();
    });

    const participante = (nombre: string): string => {
      const id = `e10-${nombre}-${CORRIDA}-${randomUUID().slice(0, 6)}`;
      particionesCreadas.add(clave.participante(id).PK);
      return id;
    };

    /** Convocatoria publicada con la venta abierta y un lote con su vehiculo. */
    const crearEscenario = async (): Promise<Lote> => {
      const tabla = process.env.AUTOB_TABLE_NAME;
      const sufijo = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      const convocatoriaId = `e10-conv-${sufijo}`;
      const loteId = `e10-lote-${sufijo}`;
      const vehiculoId = `e10-veh-${sufijo}`;
      const ahora = new Date();

      const ventana = {
        publicadaEn: new Date(ahora.getTime() - 14_400_000).toISOString(),
        // La venta abre 4 h antes de "ahora": deja hueco para que T1 se registre
        // "en el pasado" (2 h antes, ver `solicitarEnElPasado`) y aun quede
        // dentro de la ventana, con su plazo de 1 h ya vencido para cuando
        // corre la prueba.
        inicioVenta: new Date(ahora.getTime() - 14_400_000).toISOString(),
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
        limiteAdjudicaciones: 1,
        limiteSolicitudes: 3,
        modalidadAdjudicacion: "AUTOMATICA",
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
      // **`LOTE#<loteId>`, que es donde viven las solicitudes.** Aqui decia
      // `clave.lote(convocatoriaId, loteId).PK`, que parece lo mismo y no lo
      // es: el lote cuelga de la convocatoria, asi que esa `PK` es
      // `CONV#<convocatoriaId>` — la misma que la linea de arriba ya agrego. La
      // fila entera se quedaba sin borrar, y como esta prueba fabrica
      // adjudicaciones **a punto de vencer**, sus solicitudes conservaban las
      // claves de GSI4 apuntando a una convocatoria ya eliminada. El barrido
      // desplegado las recogia cada cinco minutos, no podia leer su
      // convocatoria y las contaba como error: 145 errores por corrida, para
      // siempre, con `vencimientos-sin-resolver` encendida sin que nada
      // estuviera mal en produccion. Las demas pruebas de integracion ya
      // registraban esta particion; esta era la unica que no.
      particionesCreadas.add(clave.solicitud(loteId, 0).PK);

      return lote;
    };

    /** T1, con `ahora` ya en el pasado para que su plazo nazca vencido. */
    const solicitarEnElPasado = async (
      lote: Lote,
      participanteId: string,
      correoTitular?: string,
    ) => {
      // 2 h en el pasado: dentro de la ventana de venta (que abre 4 h antes de
      // "ahora"), y con `venceEn = eso + 1 h` ya pasado para el "ahora" real.
      const haceDosHoras = () => new Date(Date.now() - 7_200_000);
      return solicitarCompra(
        {
          lote,
          participanteId,
          actor: { tipo: "USUARIO", id: participanteId, permisos: [] },
          correoTitular,
        },
        { ...deps, ahora: haceDosHoras },
      );
    };

    const leerSolicitud = async (loteId: string, turno: number) => {
      const salida = await cliente.send(
        new GetCommand({
          TableName: process.env.AUTOB_TABLE_NAME,
          Key: clave.solicitud(loteId, turno),
          ConsistentRead: true,
        }),
      );
      return salida.Item;
    };

    const leerLote = async (lote: Lote) => {
      const salida = await cliente.send(
        new GetCommand({
          TableName: process.env.AUTOB_TABLE_NAME,
          Key: clave.lote(lote.convocatoriaId, lote.loteId),
          ConsistentRead: true,
        }),
      );
      return salida.Item;
    };

    const leerVehiculo = async (vehiculoId: string) => {
      const salida = await cliente.send(
        new GetCommand({
          TableName: process.env.AUTOB_TABLE_NAME,
          Key: clave.vehiculo(vehiculoId),
          ConsistentRead: true,
        }),
      );
      return salida.Item;
    };

    it("cierra al vencido, reasigna al siguiente turno vivo y encola su correo", async () => {
      const lote = await crearEscenario();
      const p1 = participante("p1");
      const p2 = participante("p2");

      const r1 = await solicitarEnElPasado(lote, p1);
      if (!r1.ok) throw new Error(`T1(p1) fallo: ${r1.error}`);
      const r2 = await solicitarEnElPasado(
        lote,
        p2,
        `${p2}@integracion.example.org`,
      );
      if (!r2.ok) throw new Error(`T1(p2) fallo: ${r2.error}`);

      const solicitudVencidaItem = await leerSolicitud(
        lote.loteId,
        r1.data.turno,
      );
      expect(solicitudVencidaItem?.estatus).toBe("ADJUDICADA");

      const desenlace = await vencerYReasignar(
        {
          lote,
          solicitudVencida: solicitudVencidaItem as never,
          detectadoPor: "BARRIDO",
        },
        deps,
      );

      expect(desenlace).toMatchObject({
        estado: "reasignado",
        turno: r2.data.turno,
      });

      const vencida = await leerSolicitud(lote.loteId, r1.data.turno);
      expect(vencida?.estatus).toBe("CANCELADA_POR_VENCIMIENTO");
      expect(vencida?.GSI4PK).toBeUndefined();

      const nueva = await leerSolicitud(lote.loteId, r2.data.turno);
      expect(nueva?.estatus).toBe("ADJUDICADA");

      const loteActualizado = await leerLote(lote);
      expect(loteActualizado?.adjudicacionActual).toBe(nueva?.solicitudId);

      // El vehiculo sigue RESERVADO: solo cambio de dueno, no de estatus.
      const vehiculo = await leerVehiculo(lote.vehiculoId);
      expect(vehiculo?.estatus).toBe("RESERVADO");

      // El correo de p2 quedo encolado (D-6): busca el mensaje en GSI4.
      const outbox = await cliente.send(
        new QueryCommand({
          TableName: process.env.AUTOB_TABLE_NAME,
          IndexName: NOMBRES_DE_INDICE.trabajoPendiente,
          KeyConditionExpression: "GSI4PK = :pk",
          ExpressionAttributeValues: {
            ":pk": gsi4.outboxPendiente("relleno").GSI4PK,
          },
        }),
      );
      const mensaje = (outbox.Items ?? []).find(
        (item) =>
          (item.datos as { solicitudId?: string } | undefined)?.solicitudId ===
          nueva?.solicitudId,
      );
      expect(mensaje).toMatchObject({
        destinatario: `${p2}@integracion.example.org`,
        estatus: "PENDIENTE",
      });
      if (mensaje)
        particionesCreadas.add(clave.mensaje(String(mensaje.mensajeId)).PK);

      // Los dos eventos comparten correlacionId (trazabilidad-auditoria 2.2).
      const bitacora = await cliente.send(
        new QueryCommand({
          TableName: process.env.AUTOB_TABLE_NAME,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": `AUDIT#LOTE#${lote.loteId}` },
        }),
      );
      const eventos = bitacora.Items ?? [];
      const vencidaEvento = eventos.find((e) => e.tipo === "SOLICITUD_VENCIDA");
      const adjudicadoEvento = eventos.find(
        (e) =>
          e.tipo === "LOTE_ADJUDICADO" && e.solicitudId === nueva?.solicitudId,
      );
      expect(vencidaEvento?.correlacionId).toBe(
        adjudicadoEvento?.correlacionId,
      );
      expect(vencidaEvento).toMatchObject({
        datos: { detectadoPor: "BARRIDO" },
      });
    });

    it("fila agotada: libera lote y vehiculo, y un nuevo participante puede adjudicarse despues", async () => {
      const lote = await crearEscenario();
      const p1 = participante("p1");

      const r1 = await solicitarEnElPasado(lote, p1);
      if (!r1.ok) throw new Error(`T1(p1) fallo: ${r1.error}`);

      const solicitudVencidaItem = await leerSolicitud(
        lote.loteId,
        r1.data.turno,
      );

      const desenlace = await vencerYReasignar(
        {
          lote,
          solicitudVencida: solicitudVencidaItem as never,
          detectadoPor: "BARRIDO",
        },
        deps,
      );
      expect(desenlace).toEqual({ estado: "fila_agotada" });

      const loteAgotado = await leerLote(lote);
      expect(loteAgotado?.estatus).toBe("EN_OFERTA");
      expect(loteAgotado?.adjudicacionActual).toBeUndefined();

      // La correccion de esta etapa: sin liberar el vehiculo, este lote quedaria
      // huerfano para siempre en cuanto alguien mas se forme.
      const vehiculoLiberado = await leerVehiculo(lote.vehiculoId);
      expect(vehiculoLiberado?.estatus).toBe("EN_CONVOCATORIA");

      const p2 = participante("p2");
      const loteActualizado: Lote = { ...lote, estatus: "EN_OFERTA" };
      const r2 = await solicitarCompra(
        {
          lote: loteActualizado,
          participanteId: p2,
          actor: { tipo: "USUARIO", id: p2, permisos: [] },
        },
        deps,
      );
      if (!r2.ok) throw new Error(`T1(p2) fallo: ${r2.error}`);
      expect(r2.data.adjudicacion).toMatchObject({ estado: "adjudicado" });
    });

    it.each(Array.from({ length: REPETICIONES }, (_, i) => i))(
      "concurrencia (%i): N intentos simultaneos de vencer la misma solicitud producen un solo desenlace real (regla 16)",
      async () => {
        const lote = await crearEscenario();
        const p1 = participante("p1");
        const p2 = participante("p2");

        const r1 = await solicitarEnElPasado(lote, p1);
        if (!r1.ok) throw new Error(`T1(p1) fallo: ${r1.error}`);
        const r2 = await solicitarEnElPasado(lote, p2);
        if (!r2.ok) throw new Error(`T1(p2) fallo: ${r2.error}`);

        const solicitudVencidaItem = await leerSolicitud(
          lote.loteId,
          r1.data.turno,
        );

        const intentos = await Promise.all(
          Array.from({ length: 6 }, async () =>
            vencerYReasignar(
              {
                lote,
                solicitudVencida: solicitudVencidaItem as never,
                detectadoPor: "BARRIDO",
              },
              deps,
            ),
          ),
        );

        const reales = intentos.filter((r) => r.estado === "reasignado");
        const noVigentes = intentos.filter((r) => r.estado === "no_vigente");

        expect(reales).toHaveLength(1);
        expect(noVigentes).toHaveLength(5);

        const vencida = await leerSolicitud(lote.loteId, r1.data.turno);
        expect(vencida?.estatus).toBe("CANCELADA_POR_VENCIMIENTO");
      },
    );

    it("RECUPERACION_POR_BARRIDO: adjudica un lote EN_OFERTA huerfano con fila viva", async () => {
      // Reproduce el crash que describe el callout de T5b: la solicitud y su
      // centinela de fila ya existen (T1 paso 2), pero nadie llego a intentar
      // adjudicar — el proceso murio justo ahi. Se escribe a mano en vez de
      // llamar a `solicitarCompra`, que siempre intenta adjudicar despues.
      const lote = await crearEscenario();
      const p1 = participante("p1");
      const tabla = process.env.AUTOB_TABLE_NAME;

      await cliente.send(
        new PutCommand({
          TableName: tabla,
          Item: {
            ...clave.solicitud(lote.loteId, 1),
            solicitudId: `${lote.loteId}-1`,
            loteId: lote.loteId,
            convocatoriaId: lote.convocatoriaId,
            participanteId: p1,
            turno: 1,
            estatus: "EN_FILA",
            solicitadoEn: new Date().toISOString(),
          },
        }),
      );
      await cliente.send(
        new PutCommand({
          TableName: tabla,
          Item: {
            ...clave.centinelaFila(lote.loteId, p1),
            solicitudId: `${lote.loteId}-1`,
            turno: 1,
          },
        }),
      );

      const desenlace = await adjudicarLote(
        {
          lote: { ...lote, contadorTurnos: 1 },
          motivo: "RECUPERACION_POR_BARRIDO",
        },
        deps,
      );
      expect(desenlace).toMatchObject({ estado: "adjudicado", turno: 1 });

      const loteRecuperado = await leerLote(lote);
      expect(loteRecuperado?.adjudicacionActual).toBe(`${lote.loteId}-1`);

      const evento = (
        await cliente.send(
          new QueryCommand({
            TableName: tabla,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": `AUDIT#LOTE#${lote.loteId}` },
          }),
        )
      ).Items?.find((e) => e.tipo === "LOTE_ADJUDICADO");
      expect(evento).toMatchObject({
        datos: { motivoAdjudicacion: "RECUPERACION_POR_BARRIDO" },
      });
    });
  },
);
