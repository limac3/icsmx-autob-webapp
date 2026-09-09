// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { aEventoDTO, agregadoDeParticion } from "./mapeo";

vi.mock("server-only", () => ({}));

const item = (
  extras: Partial<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  PK: "AUDIT#LOTE#L1",
  SK: "2026-10-06T10:00:00.000Z#E1",
  eventoId: "E1",
  tipo: "SOLICITUD_CREADA",
  ocurridoEn: "2026-10-06T10:00:00.000Z",
  actorTipo: "USUARIO",
  actorId: "P1",
  actorPermisos: ["Autob_Venta_a_empleados"],
  correlacionId: "COR1",
  convocatoriaId: "C1",
  loteId: "L1",
  solicitudId: "L1-1",
  estadoNuevo: "EN_FILA",
  datos: { turno: 1, solicitadoEn: "2026-10-06T10:00:00.000Z" },
  ...extras,
});

describe("aEventoDTO", () => {
  it("traduce un item completo", () => {
    expect(aEventoDTO(item())).toEqual({
      eventoId: "E1",
      tipo: "SOLICITUD_CREADA",
      ocurridoEn: "2026-10-06T10:00:00.000Z",
      agregado: "LOTE",
      agregadoId: "L1",
      actorTipo: "USUARIO",
      actorId: "P1",
      actorPermisos: ["Autob_Venta_a_empleados"],
      correlacionId: "COR1",
      convocatoriaId: "C1",
      loteId: "L1",
      solicitudId: "L1-1",
      estadoNuevo: "EN_FILA",
      datos: { turno: 1, solicitadoEn: "2026-10-06T10:00:00.000Z" },
    });
  });

  it("un actor SISTEMA no trae actorPermisos", () => {
    const evento = aEventoDTO(
      item({
        actorTipo: "SISTEMA",
        actorId: "SISTEMA",
        actorPermisos: undefined,
      }),
    );
    expect(evento?.actorPermisos).toBeUndefined();
  });

  it.each([
    ["eventoId", { eventoId: undefined }],
    ["tipo desconocido", { tipo: "ALGO_INEXISTENTE" }],
    ["ocurridoEn", { ocurridoEn: undefined }],
    ["actorTipo desconocido", { actorTipo: "ROBOT" }],
    ["actorId", { actorId: undefined }],
    ["correlacionId", { correlacionId: undefined }],
  ])("sin %s se omite en vez de fabricarse a medias", (_nombre, extras) => {
    expect(aEventoDTO(item(extras))).toBeUndefined();
  });

  it("completa datos.turno desde el solicitudId cuando el evento no lo trae (PAGO_AVALADO)", () => {
    const evento = aEventoDTO(
      item({
        tipo: "PAGO_AVALADO",
        solicitudId: "L1-7",
        estadoNuevo: "VENDIDA",
        datos: { nota: "Comprobante en orden" },
      }),
    );
    expect(evento?.datos).toEqual({ nota: "Comprobante en orden", turno: 7 });
  });

  it("completa datos.turno aunque el evento no traiga datos en absoluto (PAGO_RECHAZADO)", () => {
    const evento = aEventoDTO(
      item({
        tipo: "PAGO_RECHAZADO",
        solicitudId: "L1-3",
        motivo: "Comprobante ilegible",
        datos: undefined,
      }),
    );
    expect(evento?.datos).toEqual({ turno: 3 });
  });

  it("no toca datos.turno si el evento ya lo trae", () => {
    const evento = aEventoDTO(item({ solicitudId: "L1-99" }));
    expect(evento?.datos).toEqual({
      turno: 1,
      solicitadoEn: "2026-10-06T10:00:00.000Z",
    });
  });

  it("sin campos opcionales no los inventa", () => {
    const evento = aEventoDTO({
      eventoId: "E1",
      tipo: "FILA_AGOTADA",
      ocurridoEn: "2026-10-06T10:00:00.000Z",
      actorTipo: "SISTEMA",
      actorId: "SISTEMA",
      correlacionId: "COR1",
    });
    expect(evento).toEqual({
      eventoId: "E1",
      tipo: "FILA_AGOTADA",
      ocurridoEn: "2026-10-06T10:00:00.000Z",
      actorTipo: "SISTEMA",
      actorId: "SISTEMA",
      correlacionId: "COR1",
    });
  });
});

describe("agregadoDeParticion", () => {
  it("parte AUDIT#<agregado>#<id> en sus dos componentes", () => {
    expect(agregadoDeParticion("AUDIT#LOTE#L1")).toEqual({
      agregado: "LOTE",
      agregadoId: "L1",
    });
  });

  it("acepta el identificador derivado de una solicitud", () => {
    // `<loteId>-<turno>` lleva guion, no `#`, asi que la clave sigue teniendo
    // exactamente tres partes.
    expect(agregadoDeParticion("AUDIT#SOLICITUD#01K4Z-7")).toEqual({
      agregado: "SOLICITUD",
      agregadoId: "01K4Z-7",
    });
  });

  it.each([
    ["otra particion del modelo", "LOTE#L1"],
    ["sin identificador", "AUDIT#LOTE#"],
    ["sin agregado", "AUDIT##L1"],
    ["un agregado que no existe", "AUDIT#PLANETA#L1"],
    ["con una parte de mas", "AUDIT#LOTE#L1#EXTRA"],
    ["vacia", ""],
  ])("no interpreta %s", (_caso, pk) => {
    expect(agregadoDeParticion(pk)).toBeUndefined();
  });

  it("no interpreta lo que no es una cadena", () => {
    expect(agregadoDeParticion(undefined)).toBeUndefined();
    expect(agregadoDeParticion(42)).toBeUndefined();
  });
});

describe("aEventoDTO y su particion", () => {
  it("un evento sabe de que agregado es historia", () => {
    expect(aEventoDTO(item())).toMatchObject({
      agregado: "LOTE",
      agregadoId: "L1",
    });
  });

  it("sin PK legible, el evento sigue siendo valido pero sin agregado", () => {
    // PA-12 no necesita esos campos: quien pregunta por una particion ya sabe
    // de que agregado pregunto.
    const evento = aEventoDTO({ ...item(), PK: undefined });
    expect(evento?.eventoId).toBe("E1");
    expect(evento?.agregado).toBeUndefined();
    expect(evento?.agregadoId).toBeUndefined();
  });
});
