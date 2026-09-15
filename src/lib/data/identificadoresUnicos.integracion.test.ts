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
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { crearConvocatoria } from "@/lib/convocatorias/crearConvocatoria";
import { editarConvocatoria } from "@/lib/convocatorias/editarConvocatoria";
import { crearVehiculo } from "@/lib/vehiculos/crearVehiculo";
import { AMBITOS_DE_IDENTIFICADOR, clave } from "@/lib/data/claves";
import type { DepsDeServicio } from "@/lib/data/deps";
import type { ActorUsuario } from "@/types/auditoria";
import type { Convocatoria, DatosConvocatoria } from "@/types/convocatoria";
import type { DatosVehiculo } from "@/types/vehiculo";
import { puedeUsarBackendReal } from "@/utils/backendUtilizable";

vi.mock("server-only", () => ({}));

/**
 * Unicidad de los identificadores de negocio contra DynamoDB real.
 *
 * Lo que **solo** se puede decidir aqui: que la unicidad la impone la base de
 * datos y no la aplicacion. Un doble del cliente aceptaria cualquier
 * `ConditionExpression` que se le escriba —incluso una que DynamoDB rechace, o
 * una que no excluya nada— y la prueba comprobaria que el doble coincide
 * consigo mismo. Dos altas simultaneas con el mismo folio son justo el caso
 * que una lectura previa no puede cubrir (regla 6).
 *
 * Tambien se ejerce el renombrado, que es una transaccion de tres items:
 * reservar el nuevo, liberar el viejo y actualizar la entidad. Lo que se
 * verifica no es que la escritura ocurra, sino que el folio viejo **queda
 * libre de verdad** para otra convocatoria.
 *
 * **Se omite —no falla— sin `amplify_outputs.json` ni credenciales**, igual que
 * el resto de la suite de integracion.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

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
const hayBackend = puedeUsarBackendReal(salidas);

/** Sufijo por corrida: la tabla del sandbox conserva lo de las anteriores. */
const CORRIDA =
  `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`.toUpperCase();

const actorConvocatorias: ActorUsuario = {
  tipo: "USUARIO",
  id: "eb-operador",
  permisos: ["Autob_Administrar_Convocatorias"],
};

const actorVehiculos: ActorUsuario = {
  tipo: "USUARIO",
  id: "eb-operador",
  permisos: ["Autob_Administrar_Vehiculos"],
};

const datosDeConvocatoria = (folio: string): DatosConvocatoria => ({
  folio,
  nombre: "Prueba de unicidad",
  tipo: "EMPLEADOS",
  descripcionParticipacion: "<p>Abierta al personal.</p>",
  publicadaEn: "2026-10-01T15:00:00.000Z",
  inicioVenta: "2026-10-05T15:00:00.000Z",
  finVenta: "2026-10-12T15:00:00.000Z",
  horasLiquidacion: 48,
  limiteAdjudicaciones: 1,
  limiteSolicitudes: 3,
  modalidadAdjudicacion: "AUTOMATICA",
});

const datosDeVehiculo = (
  numeroEconomico: string,
  numeroDeSerie: string,
): DatosVehiculo => ({
  numeroEconomico,
  numeroDeSerie,
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 100_000,
});

describe.skipIf(!hayBackend)(
  "unicidad de los identificadores de negocio contra DynamoDB real",
  () => {
    let dynamo: DynamoDBClient;
    let cliente: DynamoDBDocumentClient;
    let deps: DepsDeServicio;
    const particionesCreadas = new Set<string>();

    beforeAll(async () => {
      vi.stubEnv("AUTOB_TABLE_NAME", salidas!.tabla!);

      // El rol real de computo SSR, no las credenciales del desarrollador: la
      // transaccion tiene que pasar la misma politica IAM que corre en
      // produccion, incluido el `Deny` sobre los items `AUDIT#`.
      const sesion = await new STSClient({}).send(
        new AssumeRoleCommand({
          RoleArn: salidas!.rolComputoSsr!,
          RoleSessionName: "prueba-identificadores-etapaB",
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
      // Los `AUDIT#` no se purgan: el rol tiene denegado `DeleteItem` sobre
      // ellos, y esa es la garantia de la Etapa 11, no un descuido de aqui.
      await Promise.all(
        [...particionesCreadas].map(async (pk) => {
          const leidos = await cliente.send(
            new QueryCommand({
              TableName: process.env.AUTOB_TABLE_NAME,
              KeyConditionExpression: "PK = :pk",
              ExpressionAttributeValues: { ":pk": pk },
              ConsistentRead: true,
            }),
          );
          await Promise.all(
            (leidos.Items ?? []).map(async (item) =>
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

    /** Registra las particiones a purgar y devuelve el identificador interno. */
    const anotarConvocatoria = (convocatoriaId: string, folio: string) => {
      particionesCreadas.add(clave.convocatoria(convocatoriaId).PK);
      particionesCreadas.add(
        clave.centinelaDeIdentificador(
          AMBITOS_DE_IDENTIFICADOR.folioDeConvocatoria,
          folio,
        ).PK,
      );
    };

    const centinela = async (valor: string) =>
      (
        await cliente.send(
          new GetCommand({
            TableName: process.env.AUTOB_TABLE_NAME,
            Key: clave.centinelaDeIdentificador(
              AMBITOS_DE_IDENTIFICADOR.folioDeConvocatoria,
              valor,
            ),
            ConsistentRead: true,
          }),
        )
      ).Item;

    it("la segunda alta con el mismo folio la rechaza la base de datos", async () => {
      const folio = `EB-FOLIO-${CORRIDA}`;
      const primera = await crearConvocatoria(
        { datos: datosDeConvocatoria(folio), actor: actorConvocatorias },
        deps,
      );
      expect(primera.ok).toBe(true);
      if (!primera.ok) return;
      anotarConvocatoria(primera.data.convocatoriaId, folio);

      const segunda = await crearConvocatoria(
        { datos: datosDeConvocatoria(folio), actor: actorConvocatorias },
        deps,
      );

      expect(segunda).toEqual({
        ok: false,
        error: "validation_failed",
        detalles: { folio: "duplicado" },
      });
    });

    it("colisionan dos capturas que solo difieren en espacios y mayusculas", async () => {
      // Es lo que hace real la unicidad: sin normalizar antes de armar la
      // clave, "  eb-x  " y "EB-X" serian dos centinelas distintos y la
      // garantia seria una creencia.
      const folio = `EB-CASO-${CORRIDA}`;
      const primera = await crearConvocatoria(
        { datos: datosDeConvocatoria(folio), actor: actorConvocatorias },
        deps,
      );
      expect(primera.ok).toBe(true);
      if (!primera.ok) return;
      anotarConvocatoria(primera.data.convocatoriaId, folio);

      const segunda = await crearConvocatoria(
        {
          datos: datosDeConvocatoria(`  ${folio.toLowerCase()}  `),
          actor: actorConvocatorias,
        },
        deps,
      );

      expect(segunda).toEqual({
        ok: false,
        error: "validation_failed",
        detalles: { folio: "duplicado" },
      });
    });

    it("rechaza por separado el numero economico y el de serie repetidos", async () => {
      // El indice del item que cancela es lo unico que distingue cual de los
      // dos se repitio; sin el, la pantalla solo podria decir "revisa los
      // datos".
      const economico = `EB-ECO-${CORRIDA}`;
      const serie = `EB-SERIE-${CORRIDA}`;
      const primero = await crearVehiculo(
        { datos: datosDeVehiculo(economico, serie), actor: actorVehiculos },
        deps,
      );
      expect(primero.ok).toBe(true);
      if (!primero.ok) return;
      particionesCreadas.add(clave.vehiculo(primero.data.vehiculoId).PK);
      particionesCreadas.add(
        clave.centinelaDeIdentificador(
          AMBITOS_DE_IDENTIFICADOR.numeroEconomicoDeVehiculo,
          economico,
        ).PK,
      );
      particionesCreadas.add(
        clave.centinelaDeIdentificador(
          AMBITOS_DE_IDENTIFICADOR.numeroDeSerieDeVehiculo,
          serie,
        ).PK,
      );

      await expect(
        crearVehiculo(
          {
            datos: datosDeVehiculo(economico, `${serie}-B`),
            actor: actorVehiculos,
          },
          deps,
        ),
      ).resolves.toEqual({
        ok: false,
        error: "validation_failed",
        detalles: { numeroEconomico: "duplicado" },
      });

      await expect(
        crearVehiculo(
          {
            datos: datosDeVehiculo(`${economico}-B`, serie),
            actor: actorVehiculos,
          },
          deps,
        ),
      ).resolves.toEqual({
        ok: false,
        error: "validation_failed",
        detalles: { numeroDeSerie: "duplicado" },
      });
    });

    it("renombrar el folio libera el viejo y lo deja usable por otra convocatoria", async () => {
      const viejo = `EB-VIEJO-${CORRIDA}`;
      const nuevo = `EB-NUEVO-${CORRIDA}`;
      const creada = await crearConvocatoria(
        { datos: datosDeConvocatoria(viejo), actor: actorConvocatorias },
        deps,
      );
      expect(creada.ok).toBe(true);
      if (!creada.ok) return;
      anotarConvocatoria(creada.data.convocatoriaId, viejo);
      anotarConvocatoria(creada.data.convocatoriaId, nuevo);

      const actual: Convocatoria = {
        ...datosDeConvocatoria(viejo),
        convocatoriaId: creada.data.convocatoriaId,
        estatus: "BORRADOR",
        creadoEn: new Date().toISOString(),
        creadoPor: actorConvocatorias.id,
      };

      const renombrada = await editarConvocatoria(
        { actual, cambios: { folio: nuevo }, actor: actorConvocatorias },
        deps,
      );
      expect(renombrada.ok).toBe(true);

      // El nuevo quedo reservado y apunta a la misma convocatoria; el viejo
      // desaparecio. Si el renombrado no fuera atomico, aqui se veria uno de
      // los dos estados intermedios.
      expect(await centinela(nuevo)).toMatchObject({
        convocatoriaId: creada.data.convocatoriaId,
      });
      expect(await centinela(viejo)).toBeUndefined();

      // Y el folio viejo vuelve a estar disponible: es lo que hace que
      // corregir un typo no consuma el valor para siempre.
      const otra = await crearConvocatoria(
        { datos: datosDeConvocatoria(viejo), actor: actorConvocatorias },
        deps,
      );
      expect(otra.ok).toBe(true);
      if (otra.ok) anotarConvocatoria(otra.data.convocatoriaId, viejo);
    });

    it("el ancla de la bitacora no se mueve al renombrar", async () => {
      // Es la razon de que el identificador humano sea un atributo y no la
      // clave: la historia se lee entera por el identificador interno, antes y
      // despues del cambio de folio (misma decision que D-15).
      const viejo = `EB-ANCLA-${CORRIDA}`;
      const creada = await crearConvocatoria(
        { datos: datosDeConvocatoria(viejo), actor: actorConvocatorias },
        deps,
      );
      expect(creada.ok).toBe(true);
      if (!creada.ok) return;
      const { convocatoriaId } = creada.data;
      anotarConvocatoria(convocatoriaId, viejo);
      anotarConvocatoria(convocatoriaId, `${viejo}-R`);

      await editarConvocatoria(
        {
          actual: {
            ...datosDeConvocatoria(viejo),
            convocatoriaId,
            estatus: "BORRADOR",
            creadoEn: new Date().toISOString(),
            creadoPor: actorConvocatorias.id,
          },
          cambios: { folio: `${viejo}-R` },
          actor: actorConvocatorias,
        },
        deps,
      );

      const bitacora = await cliente.send(
        new QueryCommand({
          TableName: process.env.AUTOB_TABLE_NAME,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: {
            ":pk": clave.particionDeEvento("CONVOCATORIA", convocatoriaId).PK,
          },
          ConsistentRead: true,
        }),
      );

      expect((bitacora.Items ?? []).map((item) => item.tipo).sort()).toEqual([
        "CONVOCATORIA_CREADA",
        "CONVOCATORIA_EDITADA",
      ]);
    });
  },
);
