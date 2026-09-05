// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ESTATUS_CONVOCATORIA, TIPOS_CONVOCATORIA } from "@/types/convocatoria";
import { PERMISOS } from "@/types/identidad";
import { ESTATUS_LOTE } from "@/types/lote";
import { CODIGOS_ERROR } from "@/types/resultado";
import { ESTATUS_SOLICITUD } from "@/types/solicitud";
import { ESTATUS_VEHICULO } from "@/types/vehiculo";
import { MOTIVOS_INVALIDEZ } from "@/lib/domain/vehiculos";
import en from "./en.json";
import es from "./es.json";
import { idiomaPorDefecto, obtenerDiccionario } from "./index";

// Regla 11: no se exponen ENUMs crudos en UI. Un valor sin etiqueta se
// mostraria como `CANCELADA_POR_VENCIMIENTO` al participante, o —peor, si la
// UI usa `?? valor`— pasaria la compuerta sin que nadie lo note.
//
// Esta prueba es la que impide que un estatus nuevo llegue a produccion sin
// traduccion: agregar un valor a `src/types/` sin agregar su etiqueta a los
// dos diccionarios rompe aqui.

const CATALOGOS = {
  permisos: PERMISOS,
  tiposConvocatoria: TIPOS_CONVOCATORIA,
  errores: CODIGOS_ERROR,
  estatusConvocatoria: ESTATUS_CONVOCATORIA,
  estatusVehiculo: ESTATUS_VEHICULO,
  estatusLote: ESTATUS_LOTE,
  estatusSolicitud: ESTATUS_SOLICITUD,
} as const;

// Los motivos de invalidez tambien llegan a pantalla y tambien son claves de
// diccionario. Se comprueban aparte porque el diccionario trae ademas los
// motivos de fotografia, que no salen de un catalogo de tipos.
const MOTIVOS_QUE_DEBEN_TENER_ETIQUETA = MOTIVOS_INVALIDEZ;

const IDIOMAS = { es, en } as const;

type Seccion = keyof typeof CATALOGOS;

const secciones = Object.keys(CATALOGOS) as Seccion[];
const idiomas = Object.keys(IDIOMAS) as (keyof typeof IDIOMAS)[];

describe.each(idiomas)("diccionario %s", (idioma) => {
  const diccionario = IDIOMAS[idioma] as unknown as Record<
    string,
    Record<string, string>
  >;

  it.each(secciones)(
    "traduce todos los valores de %s, sin faltantes ni sobrantes",
    (seccion) => {
      const etiquetas = diccionario[seccion];
      expect(etiquetas, `falta la seccion "${seccion}"`).toBeDefined();
      expect(Object.keys(etiquetas!).sort()).toEqual(
        [...CATALOGOS[seccion]].sort(),
      );
    },
  );

  it("ninguna etiqueta esta vacia", () => {
    for (const seccion of secciones) {
      for (const [valor, etiqueta] of Object.entries(diccionario[seccion]!)) {
        expect(etiqueta.trim(), `${seccion}.${valor}`).not.toBe("");
      }
    }
  });

  it("ninguna etiqueta es el ENUM crudo", () => {
    // Copiar la clave como etiqueta pasaria las dos pruebas anteriores y
    // dejaria `EN_APROBACION` en pantalla igualmente.
    for (const seccion of secciones) {
      for (const [valor, etiqueta] of Object.entries(diccionario[seccion]!)) {
        expect(etiqueta, `${seccion}.${valor}`).not.toBe(valor);
      }
    }
  });
});

describe.each(idiomas)("motivos de invalidez en %s", (idioma) => {
  const diccionario = IDIOMAS[idioma];

  it.each(MOTIVOS_QUE_DEBEN_TENER_ETIQUETA)(
    "traduce el motivo %s",
    (motivo) => {
      const etiqueta = (
        diccionario.validacionVehiculo as Record<string, string>
      )[motivo];
      expect(etiqueta, `falta validacionVehiculo.${motivo}`).toBeTruthy();
      expect(etiqueta).not.toBe(motivo);
    },
  );
});

describe("paridad entre idiomas", () => {
  it("es y en tienen exactamente las mismas claves", () => {
    const clavesDe = (d: unknown): string[] =>
      Object.entries(d as Record<string, unknown>)
        .flatMap(([seccion, valores]) =>
          Object.keys(valores as object).map((clave) => `${seccion}.${clave}`),
        )
        .sort();

    expect(clavesDe(en)).toEqual(clavesDe(es));
  });

  it("las fases de venta estan traducidas en ambos", () => {
    // `FaseDeVenta` vive en src/lib/domain/ventanas.ts y no en src/types/, asi
    // que no entra en la tabla de catalogos; se comprueba aparte para que no
    // quede fuera de la regla 11.
    const fases = [
      "NO_VISIBLE",
      "PUBLICADA_SIN_ABRIR",
      "VENTA_ABIERTA",
      "VENTA_CERRADA",
    ];
    for (const idioma of idiomas) {
      const seccion = (IDIOMAS[idioma] as unknown as Record<string, object>)
        .faseDeVenta;
      expect(Object.keys(seccion).sort()).toEqual([...fases].sort());
    }
  });
});

describe("obtenerDiccionario", () => {
  it("devuelve espanol por defecto (regla 11)", () => {
    expect(idiomaPorDefecto).toBe("es");
    expect(obtenerDiccionario()).toBe(es);
  });

  it("devuelve el idioma pedido", () => {
    expect(obtenerDiccionario("en")).toBe(en);
  });
});
