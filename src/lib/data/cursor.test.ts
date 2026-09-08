import { describe, expect, it } from "vitest";
import { codificarCursor, decodificarCursor } from "./cursor";

describe("codificarCursor / decodificarCursor", () => {
  it("sin clave no hay cursor", () => {
    expect(codificarCursor(undefined)).toBeUndefined();
  });

  it("es el inverso exacto de si mismo", () => {
    const clave = { PK: "AUDIT#LOTE#L1", SK: "2026-10-06T10:00:00.000Z#E1" };
    expect(decodificarCursor(codificarCursor(clave))).toEqual(clave);
  });

  it("no es JSON legible a simple vista (opaco, no cifrado)", () => {
    const cursor = codificarCursor({ PK: "X" });
    expect(cursor).not.toContain("PK");
  });

  it("un cursor vacio no decodifica a nada", () => {
    expect(decodificarCursor(undefined)).toBeUndefined();
    expect(decodificarCursor("")).toBeUndefined();
  });

  it("un cursor corrupto se ignora en vez de lanzar", () => {
    expect(decodificarCursor("no-es-base64-json-valido!!!")).toBeUndefined();
  });

  it("un cursor que decodifica a algo que no es un objeto se ignora", () => {
    const cursor = Buffer.from("42", "utf8").toString("base64url");
    expect(decodificarCursor(cursor)).toBeUndefined();
  });
});
