// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { obtenerVehiculo } from "./obtenerVehiculo";
import { comandoDe, crearClienteFalso } from "@/utils/clienteDynamoFalso";

vi.mock("server-only", () => ({}));

const meta = {
  PK: "VEH#V1",
  SK: "META",
  vehiculoId: "V1",
  marca: "Nissan",
  version: "NP300",
  modelo: 2019,
  kilometraje: 148_320,
  estatus: "DISPONIBLE",
  creadoEn: "2026-01-10T10:00:00.000Z",
  creadoPor: "P0",
  actualizadoEn: "2026-02-01T10:00:00.000Z",
  actualizadoPor: "P1",
};

const foto = (orden: string, fotoId: string) => ({
  PK: "VEH#V1",
  SK: `FOTO#${orden}#${fotoId}`,
  fotoId,
  vehiculoId: "V1",
  orden: Number(orden),
  claveS3: `vehiculos/V1/${fotoId}.jpg`,
  contentType: "image/jpeg",
  bytes: 120_000,
  subidaEn: "2026-01-10T10:05:00.000Z",
  subidaPor: "P0",
});

beforeEach(() => {
  vi.stubEnv("AUTOB_TABLE_NAME", "tabla-de-prueba");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lectura de la particion", () => {
  it("lee vehiculo y galeria con una sola Query", async () => {
    // Partirla en `GetItem` mas `Query` permitiria mostrar un vehiculo con la
    // galeria de otro instante. El modelo cuelga las fotografias del vehiculo
    // justamente para que sea una sola lectura (PA-02).
    const falso = crearClienteFalso({
      respuestas: [{ Items: [meta, foto("0001", "F1")] }],
    });

    await obtenerVehiculo("V1", { cliente: falso.cliente });

    expect(falso.comandos.map((c) => c.nombre)).toEqual(["QueryCommand"]);
    expect(comandoDe(falso, "QueryCommand")).toMatchObject({
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": "VEH#V1" },
    });
  });

  it("devuelve el vehiculo con sus fotografias", async () => {
    const falso = crearClienteFalso({
      respuestas: [{ Items: [meta, foto("0001", "F1"), foto("0002", "F2")] }],
    });

    const resultado = await obtenerVehiculo("V1", { cliente: falso.cliente });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.data).toMatchObject({ vehiculoId: "V1", marca: "Nissan" });
    expect(resultado.data.fotografias.map((f) => f.fotoId)).toEqual([
      "F1",
      "F2",
    ]);
  });

  it("conserva el orden que trae la clave, sin reordenar en memoria", async () => {
    // El orden va con ceros a la izquierda en la SK, asi que la Query ya las
    // devuelve ordenadas. Si el servicio ordenara aqui, un error de construccion
    // de claves quedaria oculto en vez de expuesto.
    const falso = crearClienteFalso({
      respuestas: [{ Items: [meta, foto("0001", "F1"), foto("0010", "F10")] }],
    });

    const resultado = await obtenerVehiculo("V1", { cliente: falso.cliente });
    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.fotografias.map((f) => f.fotoId)).toEqual([
      "F1",
      "F10",
    ]);
  });

  it("ignora items de la particion que no son ni META ni fotografia", async () => {
    const falso = crearClienteFalso({
      respuestas: [
        { Items: [meta, { PK: "VEH#V1", SK: "ACTIVO", convocatoriaId: "C1" }] },
      ],
    });

    const resultado = await obtenerVehiculo("V1", { cliente: falso.cliente });
    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.fotografias).toEqual([]);
  });
});

describe("ausencias", () => {
  it("devuelve not_found si la particion esta vacia", async () => {
    const falso = crearClienteFalso({ respuestas: [{ Items: [] }] });
    await expect(
      obtenerVehiculo("V1", { cliente: falso.cliente }),
    ).resolves.toEqual({ ok: false, error: "not_found" });
  });

  it("devuelve not_found si hay fotografias pero no META", async () => {
    const falso = crearClienteFalso({
      respuestas: [{ Items: [foto("0001", "F1")] }],
    });
    await expect(
      obtenerVehiculo("V1", { cliente: falso.cliente }),
    ).resolves.toEqual({ ok: false, error: "not_found" });
  });

  it("devuelve not_found si el item META esta incompleto", async () => {
    // Un item al que le falta un campo indispensable no se puede presentar; se
    // trata como ausente en vez de romper la pantalla con datos a medias.
    const falso = crearClienteFalso({
      respuestas: [{ Items: [{ ...meta, marca: undefined }] }],
    });
    await expect(
      obtenerVehiculo("V1", { cliente: falso.cliente }),
    ).resolves.toEqual({ ok: false, error: "not_found" });
  });

  it("descarta una fotografia corrupta sin perder las demas", async () => {
    const falso = crearClienteFalso({
      respuestas: [
        {
          Items: [
            meta,
            { ...foto("0001", "F1"), claveS3: undefined },
            foto("0002", "F2"),
          ],
        },
      ],
    });

    const resultado = await obtenerVehiculo("V1", { cliente: falso.cliente });
    if (!resultado.ok) throw new Error("se esperaba exito");
    expect(resultado.data.fotografias.map((f) => f.fotoId)).toEqual(["F2"]);
  });
});
