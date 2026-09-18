// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TIPOS_DE_ACTOR, TIPOS_DE_EVENTO } from "@/types/auditoria";
import {
  ESTATUS_CONVOCATORIA,
  MODALIDADES_ADJUDICACION,
  TIPOS_CONVOCATORIA,
} from "@/types/convocatoria";
import { PERMISOS } from "@/types/identidad";
import { ESTATUS_LOTE } from "@/types/lote";
import { CODIGOS_ERROR } from "@/types/resultado";
import { ESTATUS_SOLICITUD } from "@/types/solicitud";
import { ESTATUS_VEHICULO } from "@/types/vehiculo";
import { MOTIVOS_INVALIDEZ_CONVOCATORIA } from "@/lib/domain/convocatorias";
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
  // Las dos formas de la modalidad. **Ninguna estaba vigilada**: R-23 entro en
  // la Etapa 15 y su catalogo se quedo fuera de esta tabla, asi que una
  // modalidad nueva habria llegado a pantalla sin etiqueta y sin que nada
  // fallara. La `Breve` existe porque la del formulario explica la decision
  // —"gana el turno mas bajo"— y eso, repetido en cada renglon de un listado,
  // es ruido; las dos se comprueban porque las dos llegan a pantalla.
  modalidadesAdjudicacion: MODALIDADES_ADJUDICACION,
  modalidadesAdjudicacionBreve: MODALIDADES_ADJUDICACION,
  errores: CODIGOS_ERROR,
  estatusConvocatoria: ESTATUS_CONVOCATORIA,
  estatusVehiculo: ESTATUS_VEHICULO,
  estatusLote: ESTATUS_LOTE,
  estatusSolicitud: ESTATUS_SOLICITUD,
  // La bitacora de la Etapa 11 muestra el tipo de evento y quien actuo. Las
  // etiquetas se agregan aqui y no alla porque el catalogo de eventos ya esta
  // completo desde la Etapa 5: si esperaran a la pantalla, cada evento escrito
  // entre tanto quedaria sin traduccion y nadie se enteraria hasta verlo.
  tiposDeEvento: TIPOS_DE_EVENTO,
  tiposDeActor: TIPOS_DE_ACTOR,
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

describe.each(idiomas)(
  "motivos de invalidez de convocatoria en %s",
  (idioma) => {
    const diccionario = IDIOMAS[idioma];

    it.each(MOTIVOS_INVALIDEZ_CONVOCATORIA)(
      "traduce el motivo %s",
      (motivo) => {
        const etiqueta = (
          diccionario.validacionConvocatoria as Record<string, string>
        )[motivo];
        expect(etiqueta, `falta validacionConvocatoria.${motivo}`).toBeTruthy();
        expect(etiqueta).not.toBe(motivo);
      },
    );
  },
);

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

// La compuerta "diccionarios completos, sin claves faltantes" de la Etapa 12
// descansa en **dos** mecanismos, y conviene saber cual cubre que:
//
//   1. Las pruebas de arriba, para las etiquetas que salen de un catalogo
//      runtime (`ESTATUS_LOTE`, `TIPOS_DE_EVENTO`...). Un valor nuevo sin
//      etiqueta rompe aqui.
//   2. `npm run typecheck`, para todo lo demas. `index.ts` importa los JSON y
//      conserva sus tipos literales con `satisfies`, asi que indexar el
//      diccionario con una union —`diccionario.errores[error]`,
//      `etiquetas[\`hecho_${evento}\`]`, `etiquetas.comprobaciones[clave]`—
//      obliga a TypeScript a comprobar que **todas** las variantes existen. Se
//      verifico quitando `acciones.hecho_PUBLICAR`: `tsc` responde TS7053.
//
// El segundo mecanismo es silencioso y frágil de una forma concreta: anotar
// `es`/`en` como `Record<string, Record<string, string>>` lo desactivaria por
// completo sin romper ninguna prueba. La comprobacion de abajo existe para eso.
describe("el tipado literal del diccionario, que es la otra mitad de la garantia", () => {
  it("una clave inexistente es error de compilacion y no undefined en pantalla", () => {
    const diccionario = obtenerDiccionario("es");

    // @ts-expect-error -- la clave no existe. Si algun dia esto deja de ser un
    // error, el diccionario se tipo como indice abierto y una etiqueta
    // faltante llegara a pantalla como vacia sin que nada la detenga. Un
    // `@ts-expect-error` que no encuentra error **falla el typecheck**, asi que
    // esa regresion rompe la compuerta en vez de pasar inadvertida.
    const inexistente: unknown = diccionario.acciones.hecho_INVENTADO;

    expect(inexistente).toBeUndefined();
  });
});

// Los documentos de `agent_files/` y los comentarios del codigo se escriben sin
// acentos; los diccionarios **no**, porque son el texto que lee el usuario. El
// riesgo concreto no es teclear mal: es copiar una frase de un documento a una
// etiqueta y arrastrar la convencion equivocada. Estas son las palabras del
// dominio en las que eso ya paso una vez.
const SIN_ACENTO_PROHIBIDAS = [
  // Las terminadas en -cion y -sion llevan limite al final: su **plural** se
  // escribe sin acento y es correcto ("condicion" mal, "condiciones" bien).
  ["anio", "año"],
  ["vehiculo", "vehículo"],
  [String.raw`aplicacion\b`, "aplicación"],
  [String.raw`sesion\b`, "sesión"],
  [String.raw`accion\b`, "acción"],
  [String.raw`operacion\b`, "operación"],
  ["catalogo", "catálogo"],
  ["busqueda", "búsqueda"],
  ["fotografia", "fotografía"],
  [String.raw`version\b`, "versión"],
  [String.raw`condicion\b`, "condición"],
  [String.raw`identificacion\b`, "identificación"],
  [String.raw`especificacion\b`, "especificación"],
  ["mecanica", "mecánica"],
  ["estetico", "estético"],
  ["bitacora", "bitácora"],
  ["publico", "público"],
  ["tesoreria", "tesorería"],
  ["numero", "número"],
  ["maximo", "máximo"],
  ["minimo", "mínimo"],
  ["galeria", "galería"],
  [String.raw`aprobacion\b`, "aprobación"],
  [String.raw`verificacion\b`, "verificación"],
  [String.raw`adjudicacion\b`, "adjudicación"],
  ["proximamente", "próximamente"],
  ["automatico", "automático"],
  ["imagenes", "imágenes"],
  ["unica", "única"],
  ["todavia", "todavía"],
  ["vacio", "vacío"],
  // Con limite al final: "ninguna" es correcto sin acento, "ningun" no.
  [String.raw`ningun\b`, "ningún"],
] as const;

/** Solo los valores: las claves son identificadores y van sin acento. */
const valoresDe = (nodo: unknown): string[] =>
  typeof nodo === "string"
    ? [nodo]
    : Object.values(nodo as Record<string, unknown>).flatMap(valoresDe);

describe("ortografia del diccionario en espanol", () => {
  it.each(SIN_ACENTO_PROHIBIDAS)("no deja %s sin acentuar", (mal, correcta) => {
    // `String.raw` y no una plantilla normal: en una plantilla `\b` es el
    // caracter de retroceso, no el limite de palabra, y el patron nunca
    // coincidiria con nada.
    const patron = new RegExp(String.raw`\b` + mal, "i");
    const culpables = valoresDe(es).filter((texto) => patron.test(texto));

    expect(culpables, `deberia escribirse "${correcta}"`).toEqual([]);
  });

  it("ninguna etiqueta se quedo sin traducir del ingles", () => {
    // Un valor identico en los dos idiomas suele ser una etiqueta que se copio
    // y nunca se tradujo. Se listan las coincidencias legitimas —nombres
    // propios y palabras iguales en ambos idiomas— para que una nueva salte.
    const IGUALES_A_PROPOSITO = new Set([
      "Cargando…",
      "Subiendo…",
      "Estatus",
      "Principal",
      "Borrador",
      "Actor",
      // `modalidadesAdjudicacionBreve.MANUAL`. La forma larga si difiere
      // ("una persona decide" / "a person decides"); es la breve la que
      // coincide, y coincide de verdad.
      "Manual",
    ]);

    const aplanar = (nodo: unknown, prefijo = ""): [string, string][] =>
      typeof nodo === "string"
        ? [[prefijo, nodo]]
        : Object.entries(nodo as Record<string, unknown>).flatMap(
            ([clave, valor]) =>
              aplanar(valor, prefijo ? `${prefijo}.${clave}` : clave),
          );

    const enIngles = new Map(aplanar(en));
    const sospechosas = aplanar(es)
      .filter(([ruta, valor]) => enIngles.get(ruta) === valor)
      .filter(([, valor]) => !IGUALES_A_PROPOSITO.has(valor))
      .map(([ruta, valor]) => `${ruta}: ${valor}`);

    expect(sospechosas).toEqual([]);
  });
});
