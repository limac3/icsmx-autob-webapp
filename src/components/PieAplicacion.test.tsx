// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { obtenerIdiomaDePeticion } from "@/lib/idioma";
import PieAplicacion from "./PieAplicacion";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/idioma", () => ({ obtenerIdiomaDePeticion: vi.fn() }));

const idioma = vi.mocked(obtenerIdiomaDePeticion);

beforeEach(() => {
  idioma.mockReset();
});

describe("PieAplicacion", () => {
  it("traduce el idioma de dos letras al codigo de tres que espera Eden", async () => {
    idioma.mockResolvedValue("es");
    expect((await PieAplicacion()).props.lang).toBe("spa");

    idioma.mockResolvedValue("en");
    expect((await PieAplicacion()).props.lang).toBe("eng");
  });

  it("lee el idioma de la peticion antes de renderizar", async () => {
    // No es cosmetico: `WorkforceFooter` llama a `new Date()`, y en Next.js 16
    // eso exige haber leido antes algo de la peticion. Si esta llamada
    // desaparece, el pie deja de poder renderizarse.
    idioma.mockResolvedValue("es");
    await PieAplicacion();
    expect(idioma).toHaveBeenCalledTimes(1);
  });
});
