// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ESTATUS_CONVOCATORIA } from "@/types/convocatoria";
import { ESTATUS_LOTE } from "@/types/lote";
import { ESTATUS_SOLICITUD } from "@/types/solicitud";
import { ESTATUS_VEHICULO } from "@/types/vehiculo";
import {
  esEstadoTerminal,
  esTransicionValida,
  ESTATUS_INICIAL_CONVOCATORIA,
  ESTATUS_INICIAL_LOTE,
  ESTATUS_INICIAL_SOLICITUD,
  ESTATUS_INICIAL_VEHICULO,
  eventosDisponibles,
  MAQUINAS,
  transicion,
  type NombreDeMaquina,
} from "./transiciones";

// Las tablas se re-derivan a mano de agent_files/proyecto.md seccion 5, no se
// leen de MAQUINAS: el objetivo es detectar cuando el codigo y el documento se
// separan, asi que la prueba no puede compartir la fuente con lo que prueba.
// Es el mismo criterio que usa permisos.test.ts con la matriz.

type Caso = [origen: string, evento: string, destino: string];

const CONVOCATORIA_ESPERADA: Caso[] = [
  ["BORRADOR", "ENVIAR_A_APROBACION", "EN_APROBACION"],
  ["BORRADOR", "OCULTAR", "OCULTA"],
  ["EN_APROBACION", "APROBAR", "APROBADA"],
  ["EN_APROBACION", "RECHAZAR", "BORRADOR"],
  ["EN_APROBACION", "OCULTAR", "OCULTA"],
  ["APROBADA", "PUBLICAR", "PUBLICADA"],
  ["APROBADA", "OCULTAR", "OCULTA"],
  ["PUBLICADA", "CONCLUIR", "CONCLUIDA"],
  ["PUBLICADA", "OCULTAR", "OCULTA"],
  ["OCULTA", "REACTIVAR", "BORRADOR"],
];

const VEHICULO_ESPERADO: Caso[] = [
  ["DISPONIBLE", "INCLUIR_EN_CONVOCATORIA", "EN_CONVOCATORIA"],
  ["DISPONIBLE", "RETIRAR_DEL_CATALOGO", "RETIRADO"],
  ["EN_CONVOCATORIA", "RETIRAR_DE_CONVOCATORIA", "DISPONIBLE"],
  ["EN_CONVOCATORIA", "ADJUDICAR_SU_LOTE", "RESERVADO"],
  ["EN_CONVOCATORIA", "CONCLUIR_SIN_VENTA", "DISPONIBLE"],
  ["RESERVADO", "LIBERAR", "EN_CONVOCATORIA"],
  ["RESERVADO", "AVALAR_PAGO", "VENDIDO"],
];

const LOTE_ESPERADO: Caso[] = [
  ["EN_OFERTA", "ADJUDICAR", "ADJUDICADO"],
  ["EN_OFERTA", "CONCLUIR_CONVOCATORIA", "NO_VENDIDO"],
  ["EN_OFERTA", "RETIRAR", "RETIRADO"],
  ["ADJUDICADO", "LIBERAR", "EN_OFERTA"],
  ["ADJUDICADO", "AVALAR_PAGO", "VENDIDO"],
];

const SOLICITUD_ESPERADA: Caso[] = [
  ["EN_FILA", "ADJUDICAR", "ADJUDICADA"],
  ["EN_FILA", "CANCELAR", "CANCELADA_POR_PARTICIPANTE"],
  ["EN_FILA", "CONGELAR", "CONGELADA"],
  ["EN_FILA", "NO_ADJUDICAR", "NO_ADJUDICADA"],
  ["CONGELADA", "DESCONGELAR", "EN_FILA"],
  ["CONGELADA", "CANCELAR", "CANCELADA_POR_PARTICIPANTE"],
  ["CONGELADA", "NO_ADJUDICAR", "NO_ADJUDICADA"],
  ["ADJUDICADA", "SUBIR_COMPROBANTE", "EN_VERIFICACION"],
  ["ADJUDICADA", "VENCER_PLAZO", "CANCELADA_POR_VENCIMIENTO"],
  ["ADJUDICADA", "CANCELAR", "CANCELADA_POR_PARTICIPANTE"],
  ["EN_VERIFICACION", "AVALAR_PAGO", "VENDIDA"],
  ["EN_VERIFICACION", "RECHAZAR_PAGO", "RECHAZADA_POR_TESORERIA"],
];

const ESPERADO: Record<NombreDeMaquina, Caso[]> = {
  convocatoria: CONVOCATORIA_ESPERADA,
  vehiculo: VEHICULO_ESPERADO,
  lote: LOTE_ESPERADO,
  solicitud: SOLICITUD_ESPERADA,
};

const ESTADOS: Record<NombreDeMaquina, readonly string[]> = {
  convocatoria: ESTATUS_CONVOCATORIA,
  vehiculo: ESTATUS_VEHICULO,
  lote: ESTATUS_LOTE,
  solicitud: ESTATUS_SOLICITUD,
};

const NOMBRES = Object.keys(ESPERADO) as NombreDeMaquina[];

/* eslint-disable @typescript-eslint/no-explicit-any -- las pruebas recorren
   las cuatro maquinas de forma generica; los tipos por maquina se verifican en
   los casos nominales de cada `describe`. */
const transicionSuelta = (maquina: NombreDeMaquina, o: string, e: string) =>
  transicion(maquina as any, o as any, e as any);

describe.each(NOMBRES)("maquina de %s", (maquina) => {
  const casos = ESPERADO[maquina];

  it.each(casos)("%s + %s = %s", (origen, evento, destino) => {
    expect(transicionSuelta(maquina, origen, evento)).toBe(destino);
  });

  it("no admite ninguna transicion fuera de la tabla del documento", () => {
    // La comprobacion inversa. Sin ella, agregar una salida de mas al codigo
    // pasaria inadvertida: los casos nominales solo verifican que lo declarado
    // funcione, no que no haya nada extra.
    const declaradas = casos.map(([o, e]) => `${o}+${e}`).sort();
    const enElCodigo = Object.entries(MAQUINAS[maquina]).flatMap(
      ([origen, salidas]) =>
        Object.keys(salidas as object).map((evento) => `${origen}+${evento}`),
    );
    expect(enElCodigo.sort()).toEqual(declaradas);
  });

  it("declara todos los estatus del tipo, sin faltantes ni sobrantes", () => {
    // El `Record<Estado, ...>` ya lo obliga en tiempo de compilacion; esto lo
    // afirma tambien en ejecucion, para que un `as` mal puesto no lo desactive.
    expect(Object.keys(MAQUINAS[maquina]).sort()).toEqual(
      [...ESTADOS[maquina]].sort(),
    );
  });

  it("todo destino es un estatus valido del tipo", () => {
    for (const [, , destino] of casos) {
      expect(ESTADOS[maquina]).toContain(destino);
    }
  });

  it("una transicion inexistente devuelve undefined, no un destino inventado", () => {
    expect(
      transicionSuelta(maquina, casos[0]![0], "EVENTO_QUE_NO_EXISTE"),
    ).toBe(undefined);
    expect(
      transicionSuelta(maquina, "ESTADO_QUE_NO_EXISTE", casos[0]![1]),
    ).toBe(undefined);
  });
});

describe("estados iniciales", () => {
  it("coinciden con las filas sin origen de proyecto.md seccion 5", () => {
    expect(ESTATUS_INICIAL_CONVOCATORIA).toBe("BORRADOR");
    expect(ESTATUS_INICIAL_VEHICULO).toBe("DISPONIBLE");
    expect(ESTATUS_INICIAL_LOTE).toBe("EN_OFERTA");
    expect(ESTATUS_INICIAL_SOLICITUD).toBe("EN_FILA");
  });

  it("ninguno es terminal: una entidad recien creada siempre puede avanzar", () => {
    expect(esEstadoTerminal("convocatoria", ESTATUS_INICIAL_CONVOCATORIA)).toBe(
      false,
    );
    expect(esEstadoTerminal("vehiculo", ESTATUS_INICIAL_VEHICULO)).toBe(false);
    expect(esEstadoTerminal("lote", ESTATUS_INICIAL_LOTE)).toBe(false);
    expect(esEstadoTerminal("solicitud", ESTATUS_INICIAL_SOLICITUD)).toBe(
      false,
    );
  });
});

describe("alcanzabilidad", () => {
  it.each(NOMBRES)(
    "en %s todo estado es alcanzable desde el inicial",
    (maquina) => {
      // Un estado inalcanzable es una fila muerta del documento o un error de
      // transcripcion. Se recorre el grafo en anchura desde el estado inicial.
      const inicial: string = {
        convocatoria: ESTATUS_INICIAL_CONVOCATORIA,
        vehiculo: ESTATUS_INICIAL_VEHICULO,
        lote: ESTATUS_INICIAL_LOTE,
        solicitud: ESTATUS_INICIAL_SOLICITUD,
      }[maquina];

      const visitados = new Set<string>([inicial]);
      const pendientes: string[] = [inicial];
      while (pendientes.length > 0) {
        const actual = pendientes.shift()!;
        for (const evento of eventosDisponibles(
          maquina as any,
          actual as any,
        )) {
          const destino = transicionSuelta(maquina, actual, evento);
          if (destino && !visitados.has(destino)) {
            visitados.add(destino);
            pendientes.push(destino);
          }
        }
      }

      expect([...visitados].sort()).toEqual([...ESTADOS[maquina]].sort());
    },
  );
});

describe("estados terminales", () => {
  it.each([
    ["convocatoria", ["CONCLUIDA"]],
    ["vehiculo", ["VENDIDO", "RETIRADO"]],
    ["lote", ["VENDIDO", "NO_VENDIDO", "RETIRADO"]],
    [
      "solicitud",
      [
        "VENDIDA",
        "CANCELADA_POR_VENCIMIENTO",
        "RECHAZADA_POR_TESORERIA",
        "CANCELADA_POR_PARTICIPANTE",
        "NO_ADJUDICADA",
      ],
    ],
  ] as const)("en %s son exactamente %s", (maquina, esperados) => {
    const terminales = ESTADOS[maquina].filter((estado) =>
      esEstadoTerminal(maquina as any, estado as any),
    );
    expect(terminales.sort()).toEqual([...esperados].sort());
  });

  it("VENDIDO es terminal para el vehiculo (proyecto.md 5.2)", () => {
    expect(eventosDisponibles("vehiculo", "VENDIDO")).toEqual([]);
  });

  it("NO_VENDIDO es terminal para el lote pero no para el vehiculo", () => {
    // Es lo que compra separar lote de vehiculo (D-3): el lote se cierra y el
    // vehiculo vuelve a DISPONIBLE para reofertarse con una fila nueva (R-11).
    expect(esEstadoTerminal("lote", "NO_VENDIDO")).toBe(true);
    expect(esEstadoTerminal("vehiculo", "DISPONIBLE")).toBe(false);
    expect(
      transicion("vehiculo", "EN_CONVOCATORIA", "CONCLUIR_SIN_VENTA"),
    ).toBe("DISPONIBLE");
  });
});

describe("reglas de negocio expresadas en el grafo", () => {
  it("EN_VERIFICACION no admite cancelar ni vencer: el reloj se detuvo", () => {
    // proyecto.md 5.4: una vez en verificacion el plazo deja de correr, y la
    // demora de tesoreria nunca perjudica al participante.
    expect(transicion("solicitud", "EN_VERIFICACION", "CANCELAR")).toBe(
      undefined,
    );
    expect(transicion("solicitud", "EN_VERIFICACION", "VENCER_PLAZO")).toBe(
      undefined,
    );
  });

  it("CONGELADA se puede cancelar (R-09)", () => {
    // "Sus CONGELADA permanecen congeladas hasta que las cancele o el lote se
    // resuelva". La tabla de proyecto.md 5.4 no traia esta fila; R-09 y
    // permission-matrix.md si la exigen.
    expect(transicion("solicitud", "CONGELADA", "CANCELAR")).toBe(
      "CANCELADA_POR_PARTICIPANTE",
    );
  });

  it("descongelar devuelve a EN_FILA y no a otro estado", () => {
    // El turno original queda intacto porque la clave `SOL#<turno:010d>` no se
    // reescribe nunca (R-09).
    expect(transicion("solicitud", "CONGELADA", "DESCONGELAR")).toBe("EN_FILA");
  });

  it("el lote vuelve a EN_OFERTA tras un vencimiento o un rechazo (R-15, R-16)", () => {
    expect(transicion("lote", "ADJUDICADO", "LIBERAR")).toBe("EN_OFERTA");
  });

  it("una convocatoria concluida no se reactiva", () => {
    expect(esEstadoTerminal("convocatoria", "CONCLUIDA")).toBe(true);
  });

  it("una convocatoria oculta vuelve a BORRADOR y no a donde estaba", () => {
    // Volver al estatus anterior exigiria recordarlo; regresar a BORRADOR
    // obliga a repetir la aprobacion, que es lo prudente.
    expect(transicion("convocatoria", "OCULTA", "REACTIVAR")).toBe("BORRADOR");
  });

  it("esTransicionValida coincide con transicion", () => {
    for (const maquina of NOMBRES) {
      for (const estado of ESTADOS[maquina]) {
        for (const evento of [
          "ADJUDICAR",
          "CANCELAR",
          "OCULTAR",
          "NO_EXISTE",
        ]) {
          expect(
            esTransicionValida(maquina as any, estado as any, evento as any),
          ).toBe(transicionSuelta(maquina, estado, evento) !== undefined);
        }
      }
    }
  });
});
