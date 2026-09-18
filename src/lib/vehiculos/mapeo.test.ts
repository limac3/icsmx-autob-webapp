// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { aFotografia } from "./mapeo";
import { NOMBRES_DE_VARIANTE } from "@/types/vehiculo";
import { fotografiaDePrueba } from "@/utils/fotografiaDePrueba";

vi.mock("server-only", () => ({}));

/** Item crudo, como sale de DynamoDB: `Record<string, unknown>`. */
const item = (
  cambios: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...fotografiaDePrueba("F1", 1),
  ...cambios,
});

describe("aFotografia", () => {
  it("mapea un item completo con sus tres variantes", () => {
    const foto = aFotografia(item());

    expect(foto?.fotoId).toBe("F1");
    expect(Object.keys(foto?.variantes ?? {})).toEqual([
      ...NOMBRES_DE_VARIANTE,
    ]);
    expect(foto?.variantes.min).toEqual({
      claveS3: "vehiculos/V1/F1-min.webp",
      ancho: 480,
      alto: 360,
      bytes: 480,
    });
  });
});

describe("variantes ausentes o rotas — regla 15", () => {
  // **Aqui es donde se aplica la regla 15, y el detalle importa.** La tentacion
  // es rellenar lo que falte con un `?? 0`, como el `bytes ?? 0` que si existe
  // arriba para un campo que no afecta a la maquetacion. Con el ancho seria
  // justo el fallback silencioso que la regla prohibe: `ancho: 0` produce un
  // `width="0"` en la pagina, rompe la maquetacion y no deja rastro de por que.
  //
  // Desaparecer del listado es ruidoso a la vista y silencioso en la consola,
  // que es el comportamiento que `mapeo.ts` ya eligio para un item sin
  // `claveS3`: un item corrupto entre mil no debe tumbar la galeria.

  it("sin el campo de variantes, el item no se puede renderizar", () => {
    expect(aFotografia(item({ variantes: undefined }))).toBeUndefined();
  });

  it("con el campo presente pero vacio, tampoco", () => {
    expect(aFotografia(item({ variantes: {} }))).toBeUndefined();
  });

  it.each([...NOMBRES_DE_VARIANTE])(
    "si falta la variante %s se descarta el item entero",
    (faltante) => {
      const variantes = { ...fotografiaDePrueba("F1", 1).variantes } as Record<
        string,
        unknown
      >;
      delete variantes[faltante];

      expect(aFotografia(item({ variantes }))).toBeUndefined();
    },
  );

  it("un ancho de cero se descarta en vez de pasar como valido", () => {
    // El caso que el `?? 0` habria dejado entrar.
    const variantes = {
      ...fotografiaDePrueba("F1", 1).variantes,
      min: { claveS3: "vehiculos/V1/F1-min.webp", ancho: 0, alto: 0, bytes: 1 },
    };

    expect(aFotografia(item({ variantes }))).toBeUndefined();
  });

  it("una variante sin clave de S3 se descarta", () => {
    const variantes = {
      ...fotografiaDePrueba("F1", 1).variantes,
      med: { claveS3: "", ancho: 1280, alto: 960, bytes: 100 },
    };

    expect(aFotografia(item({ variantes }))).toBeUndefined();
  });

  it.each([null, "no es un mapa", 42, []])(
    "un campo de variantes que es %j se descarta",
    (valor) => {
      expect(aFotografia(item({ variantes: valor }))).toBeUndefined();
    },
  );
});
