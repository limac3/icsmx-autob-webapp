// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { procesarOutbox } from "@/lib/correo/procesarOutbox";
import { gsi4, NOMBRES_DE_INDICE } from "@/lib/data/claves";
import type { DepsDeServicio } from "@/lib/data/deps";
import { puedeUsarBackendReal } from "@/utils/backendUtilizable";
import type { Lote } from "@/types/lote";
import { aLote } from "@/lib/convocatorias/mapeo";
import { barridoDeVencimientos } from "./barridoDeVencimientos";

vi.mock("server-only", () => ({}));

/**
 * Ejecuta el barrido **de verdad** contra el sandbox, desde la terminal.
 *
 * **Por que hace falta.** `barridoDeVencimientos` tiene un solo invocador en
 * todo el repositorio: `amplify/barrido/handler.ts`, el Lambda que EventBridge
 * dispara cada cinco minutos en AWS. `npm run dev` levanta Next.js y nada mas,
 * asi que **en local el barrido no corre nunca**: los vencimientos solo se
 * resuelven por la verificacion perezosa cuando alguien mira la fila (D-7), y
 * los cierres tardios de R-11b no se resuelven en absoluto, porque nadie los
 * mira.
 *
 * Eso convertia en inverificable justo lo que no tiene camino alternativo. Con
 * esto, el recorrido completo de R-11b se puede hacer en una sesion:
 *
 *   1. Publicar una convocatoria, adjudicar un lote y concluirla — el lote
 *      sobrevive `ADJUDICADO` y queda inscrito en GSI4 `CIERRE_PENDIENTE`.
 *   2. Dejar vencer el plazo (o acortar `horasLiquidacion` al crearla).
 *   3. `npm run barrido` — el vencimiento devuelve el lote a `EN_OFERTA` y el
 *      cierre tardio lo cierra, en la misma corrida.
 *   4. El vehiculo vuelve a `DISPONIBLE` y se deja incluir en otra
 *      convocatoria.
 *
 * **El informe es el entregable**, no las afirmaciones. Estas solo comprueban
 * que la corrida termino sana; lo que se viene a ver son los contadores y lo
 * que quedo pendiente.
 *
 *   npx ampx sandbox     # en otra terminal, si no esta desplegado
 *   npm run barrido
 */

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

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
const seSolicito = process.env.BARRIDO_LOCAL === "1";

/**
 * Despachar el outbox es **opcional y no viene activado**.
 *
 * `.env.local` trae credenciales de CES reales, y `APP_ENV` sin definir vale
 * `produccion` (D-18), asi que un despacho aqui **manda correo de verdad** a
 * direcciones de verdad. Eso no puede ser el efecto colateral de escribir
 * `npm run barrido` para mirar unos vencimientos.
 *
 *   BARRIDO_OUTBOX=1 npm run barrido          (bash)
 *   $env:BARRIDO_OUTBOX="1"; npm run barrido  (PowerShell)
 */
const CON_OUTBOX = process.env.BARRIDO_OUTBOX === "1";

/** Dias de GSI4 hacia atras. El barrido desplegado usa su omision de 3. */
const DIAS = Number(process.env.BARRIDO_DIAS ?? "3");

const alinear = (etiqueta: string, valor: unknown): string =>
  `  ${etiqueta.padEnd(26)} ${String(valor)}`;

describe.skipIf(!seSolicito || !hayBackend)(
  "barrido — ejecucion local contra el sandbox",
  () => {
    let cliente: DynamoDBDocumentClient;
    let deps: DepsDeServicio;

    beforeAll(async () => {
      vi.stubEnv("AUTOB_TABLE_NAME", salidas!.tabla!);

      // El rol real de computo SSR, igual que las demas pruebas de
      // integracion. El barrido desplegado tiene el suyo propio, pero
      // `amplify/permisos.ts` les da a los dos exactamente la misma politica
      // sobre la tabla ("se aplica igual al rol de computo SSR y al de la
      // funcion de barrido"), y este es el que publican las salidas. Correr con
      // las credenciales de quien desarrolla no probaria ninguna politica.
      const sesion = await new STSClient({}).send(
        new AssumeRoleCommand({
          RoleArn: salidas!.rolComputoSsr!,
          RoleSessionName: "barrido-local",
          DurationSeconds: 3600,
        }),
      );

      const credenciales = sesion.Credentials;
      if (!credenciales?.AccessKeyId || !credenciales.SecretAccessKey) {
        throw new Error(
          "STS no devolvio credenciales para el rol de computo SSR.",
        );
      }

      cliente = DynamoDBDocumentClient.from(
        new DynamoDBClient({
          credentials: {
            accessKeyId: credenciales.AccessKeyId,
            secretAccessKey: credenciales.SecretAccessKey,
            sessionToken: credenciales.SessionToken,
          },
        }),
        { marshallOptions: { removeUndefinedValues: true } },
      );
      deps = { cliente };
    });

    /** Lo que sigue inscrito como cierre pendiente, tras la corrida. */
    const leerCierresPendientes = async (): Promise<Lote[]> => {
      const salida = await cliente.send(
        new QueryCommand({
          TableName: process.env.AUTOB_TABLE_NAME,
          IndexName: NOMBRES_DE_INDICE.trabajoPendiente,
          KeyConditionExpression: "GSI4PK = :pk",
          ExpressionAttributeValues: {
            ":pk": gsi4.cierrePendiente("relleno", "relleno").GSI4PK,
          },
        }),
      );
      const lotes: Lote[] = [];
      for (const item of salida.Items ?? []) {
        const lote = aLote(item);
        if (lote) lotes.push(lote);
      }
      return lotes;
    };

    it("ejecuta el barrido y publica su informe", async () => {
      const inicio = Date.now();
      const resultado = await barridoDeVencimientos(
        { diasHaciaAtras: DIAS },
        deps,
      );
      const duracion = Date.now() - inicio;

      const pendientes = await leerCierresPendientes();

      const lineas = [
        "",
        "  BARRIDO — corrida local contra el sandbox",
        `  tabla: ${salidas!.tabla}`,
        "",
        alinear("vencimientos resueltos", resultado.vencimientosResueltos),
        alinear("vencimientos abstenidos", resultado.vencimientosAbstenidos),
        alinear("lotes recuperados", resultado.lotesRecuperados),
        alinear("filas cerradas", resultado.filasCerradas),
        alinear("lotes liberados (R-11b)", resultado.lotesLiberados),
        alinear("errores", resultado.errores),
        alinear("duracion", `${duracion} ms`),
        "",
        `  CIERRE_PENDIENTE: ${pendientes.length} lote(s) inscritos`,
        ...pendientes.map(
          (lote) =>
            `    ${lote.loteId}  ${lote.estatus.padEnd(11)} veh ${lote.vehiculoId}`,
        ),
      ];

      if (resultado.errores > 0) {
        lineas.push(
          "",
          `  ⚠ ${resultado.errores} vencidas sin resolver.`,
          "    En AWS esto mantiene encendida `vencimientos-sin-resolver`.",
          "    Causa mas probable en un sandbox: solicitudes huerfanas de una",
          "    prueba de integracion cuya convocatoria ya se borro — conservan",
          "    sus claves de GSI4 y el barrido no puede leer su convocatoria.",
          "    Ver runbooks.md R-1; distinguirlas es mirar el prefijo del",
          "    `convocatoriaId` de la particion `VENCE#<dia>`.",
        );
      }

      if (!CON_OUTBOX) {
        lineas.push(
          "",
          "  outbox: omitido. BARRIDO_OUTBOX=1 lo despacha — manda correo real.",
        );
      }
      console.log(lineas.join("\n"));

      // **`errores` se publica, no se afirma.** Es tentador exigir cero, y
      // seria correcto en una tabla limpia; aqui haria inservible la
      // herramienta justo cuando mas se necesita. Un sandbox acumula restos de
      // las pruebas de integracion —solicitudes cuyas convocatorias se
      // borraron—, y con esa afirmacion la corrida fallaria siempre por algo
      // que no es un defecto del barrido, hasta que alguien dejara de mirarla.
      // El informe los pone arriba y con su causa mas probable; quien opera
      // decide.

      // Esto si es una afirmacion, y es la unica que corresponde: un lote
      // inscrito como cierre pendiente que **ya** volvio a `EN_OFERTA` tenia
      // que haberse cerrado en esta misma corrida. Si sobrevive, el vehiculo
      // sigue atrapado y el mecanismo de R-11b no esta haciendo su trabajo
      // (runbooks.md R-15).
      expect(pendientes.filter((lote) => lote.estatus === "EN_OFERTA")).toEqual(
        [],
      );
    });

    it.skipIf(!CON_OUTBOX)("despacha el outbox", async () => {
      const resultado = await procesarOutbox(deps);

      console.log(
        [
          "",
          "  OUTBOX",
          alinear("enviados", resultado.enviados),
          alinear("cancelados", resultado.cancelados),
          alinear("fallidos permanentes", resultado.fallidosPermanentes),
          alinear("reintentara despues", resultado.reintentaraDespues),
          "",
        ].join("\n"),
      );

      expect(resultado.fallidosPermanentes).toBe(0);
    });
  },
);
