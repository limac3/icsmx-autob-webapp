// @vitest-environment node
import { describe, expect, it } from "vitest";
import { puedeEjecutar } from "@/lib/auth/permisos";
import { TIPOS_CONVOCATORIA } from "@/types/convocatoria";
import { PERMISOS, type Permiso } from "@/types/identidad";
import { desdeIso } from "./fechas";
import { ESTATUS_LOTE } from "@/types/lote";
import {
  contextoDeConvocatoria,
  esLoteOfrecido,
  esVisible,
  evaluarVisibilidad,
  puedeSolicitarse,
  tieneAccesoAlTipo,
  type ConvocatoriaParaGating,
} from "./gating";

const instante = (iso: string): Date => {
  const valor = desdeIso(iso);
  if (!valor) throw new Error(`literal de prueba invalido: ${iso}`);
  return valor;
};

const PUBLICADA_EN = "2026-09-10T14:00:00Z";
const INICIO_VENTA = "2026-09-15T15:00:00Z";
const FIN_VENTA = "2026-09-20T23:00:00Z";

const DURANTE_LA_VENTA = instante("2026-09-16T12:00:00Z");
const ANTES_DE_PUBLICAR = instante("2026-09-01T00:00:00Z");
const ENTRE_PUBLICAR_Y_ABRIR = instante("2026-09-12T00:00:00Z");
const DESPUES_DEL_CIERRE = instante("2026-09-25T00:00:00Z");

const convocatoria = (
  ajustes: Partial<ConvocatoriaParaGating> = {},
): ConvocatoriaParaGating => ({
  estatus: "PUBLICADA",
  tipo: "EMPLEADOS",
  publicadaEn: instante(PUBLICADA_EN),
  inicioVenta: instante(INICIO_VENTA),
  finVenta: instante(FIN_VENTA),
  ...ajustes,
});

const conPermisos = (...permisos: Permiso[]) => new Set(permisos);

const EMPLEADO = conPermisos(
  "Autob_Venta_a_empleados",
  "Autob_Venta_en_general",
);
const PUBLICO = conPermisos("Autob_Venta_en_general");
const SIN_VENTA = conPermisos("Autob_Administrar_Convocatorias");

describe("tieneAccesoAlTipo — R-02", () => {
  it("Autob_Venta_a_empleados abre las convocatorias de empleados", () => {
    expect(tieneAccesoAlTipo("EMPLEADOS", EMPLEADO)).toBe(true);
  });

  it("Autob_Venta_en_general no abre las de empleados", () => {
    expect(tieneAccesoAlTipo("EMPLEADOS", PUBLICO)).toBe(false);
    expect(tieneAccesoAlTipo("PUBLICO_GENERAL", PUBLICO)).toBe(true);
  });

  it("quien tiene ambos permisos alcanza ambos tipos", () => {
    // La relacion de superconjunto del empleado es configuracion de EAS, no un
    // caso especial del codigo (proyecto.md 3.2).
    for (const tipo of TIPOS_CONVOCATORIA) {
      expect(tieneAccesoAlTipo(tipo, EMPLEADO)).toBe(true);
    }
  });

  it("ningun permiso administrativo da acceso a comprar", () => {
    // Que un administrador no compre es configuracion de EAS y puede cambiar
    // manana; lo que el codigo afirma es que solo los permisos de venta
    // conceden acceso, sea quien sea que los tenga (D-9).
    const administrativos = PERMISOS.filter(
      (permiso) => !permiso.startsWith("Autob_Venta_"),
    );
    for (const tipo of TIPOS_CONVOCATORIA) {
      expect(tieneAccesoAlTipo(tipo, conPermisos(...administrativos))).toBe(
        false,
      );
    }
  });
});

describe("evaluarVisibilidad — las tres patas de R-01", () => {
  it("es visible cuando se cumplen las tres", () => {
    expect(
      evaluarVisibilidad(convocatoria(), EMPLEADO, DURANTE_LA_VENTA),
    ).toEqual({ visible: true });
  });

  it.each([
    "BORRADOR",
    "EN_APROBACION",
    "APROBADA",
    "CONCLUIDA",
    "OCULTA",
  ] as const)("no es visible con estatus %s", (estatus) => {
    expect(
      evaluarVisibilidad(convocatoria({ estatus }), EMPLEADO, DURANTE_LA_VENTA),
    ).toEqual({ visible: false, razon: "no_publicada" });
  });

  it("no es visible antes de publicadaEn aunque el estatus sea PUBLICADA", () => {
    // Estatus PUBLICADA no significa visible: esta es la distincion que
    // sostiene toda la programacion de convocatorias.
    expect(
      evaluarVisibilidad(convocatoria(), EMPLEADO, ANTES_DE_PUBLICAR),
    ).toEqual({ visible: false, razon: "aun_no_visible" });
  });

  it("se vuelve visible en el instante exacto de publicadaEn", () => {
    const unMsAntes = new Date(instante(PUBLICADA_EN).getTime() - 1);
    expect(esVisible(convocatoria(), EMPLEADO, unMsAntes)).toBe(false);
    expect(esVisible(convocatoria(), EMPLEADO, instante(PUBLICADA_EN))).toBe(
      true,
    );
  });

  it("no es visible sin el permiso de venta del tipo", () => {
    expect(
      evaluarVisibilidad(convocatoria(), PUBLICO, DURANTE_LA_VENTA),
    ).toEqual({ visible: false, razon: "sin_permiso_de_tipo" });
  });

  it("no es visible sin ningun permiso de venta", () => {
    expect(esVisible(convocatoria(), SIN_VENTA, DURANTE_LA_VENTA)).toBe(false);
    expect(esVisible(convocatoria(), new Set(), DURANTE_LA_VENTA)).toBe(false);
  });

  it("sigue visible despues de cerrar la venta", () => {
    // Cerrar la venta no oculta la convocatoria: el participante debe poder
    // consultar el resultado de la fila en la que estuvo.
    expect(esVisible(convocatoria(), EMPLEADO, DESPUES_DEL_CIERRE)).toBe(true);
  });

  it("cada pata basta por si sola para negar", () => {
    // Las tres son necesarias; ninguna es redundante. Si alguna se pudiera
    // omitir, el gating no seria triple.
    expect(
      esVisible(
        convocatoria({ estatus: "BORRADOR" }),
        EMPLEADO,
        DURANTE_LA_VENTA,
      ),
    ).toBe(false);
    expect(esVisible(convocatoria(), EMPLEADO, ANTES_DE_PUBLICAR)).toBe(false);
    expect(esVisible(convocatoria(), PUBLICO, DURANTE_LA_VENTA)).toBe(false);
  });

  it("informa el estado del recurso antes que la falta de permiso", () => {
    // La razon alimenta la bitacora, y para diagnosticar importa mas "aun no
    // se publica" que "esta persona no podria verla de todos modos".
    expect(
      evaluarVisibilidad(convocatoria(), PUBLICO, ANTES_DE_PUBLICAR),
    ).toEqual({ visible: false, razon: "aun_no_visible" });
  });
});

describe("puedeSolicitarse — visible mas venta abierta (R-03)", () => {
  it("no se puede solicitar entre la publicacion y la apertura", () => {
    // El participante ya ve la convocatoria y sabe cuando abre, pero no puede
    // formarse. Es lo que da a todos la misma oportunidad de prepararse.
    expect(esVisible(convocatoria(), EMPLEADO, ENTRE_PUBLICAR_Y_ABRIR)).toBe(
      true,
    );
    expect(
      puedeSolicitarse(convocatoria(), EMPLEADO, ENTRE_PUBLICAR_Y_ABRIR),
    ).toBe(false);
  });

  it("se puede solicitar desde el instante exacto de apertura", () => {
    const unMsAntes = new Date(instante(INICIO_VENTA).getTime() - 1);
    expect(puedeSolicitarse(convocatoria(), EMPLEADO, unMsAntes)).toBe(false);
    expect(
      puedeSolicitarse(convocatoria(), EMPLEADO, instante(INICIO_VENTA)),
    ).toBe(true);
  });

  it("no se puede solicitar desde el instante exacto de cierre", () => {
    const unMsAntes = new Date(instante(FIN_VENTA).getTime() - 1);
    expect(puedeSolicitarse(convocatoria(), EMPLEADO, unMsAntes)).toBe(true);
    expect(
      puedeSolicitarse(convocatoria(), EMPLEADO, instante(FIN_VENTA)),
    ).toBe(false);
  });

  it("la venta abierta no sustituye a la visibilidad", () => {
    // Un lote de una convocatoria sin publicar puede tener la ventana abierta
    // en sus atributos desnormalizados; la convocatoria manda (T8).
    expect(
      puedeSolicitarse(
        convocatoria({ estatus: "BORRADOR" }),
        EMPLEADO,
        DURANTE_LA_VENTA,
      ),
    ).toBe(false);
  });
});

describe("contextoDeConvocatoria — puente hacia puedeEjecutar", () => {
  it("produce los cinco campos ya resueltos", () => {
    expect(contextoDeConvocatoria(convocatoria(), DURANTE_LA_VENTA)).toEqual({
      estatusConvocatoria: "PUBLICADA",
      tipoConvocatoria: "EMPLEADOS",
      yaPublicada: true,
      ventaAbierta: true,
      ventaFinalizada: false,
    });
  });

  it("ningun campo queda en undefined, que la regla 18 traduciria a denegar", () => {
    for (const ahora of [
      ANTES_DE_PUBLICAR,
      ENTRE_PUBLICAR_Y_ABRIR,
      DURANTE_LA_VENTA,
      DESPUES_DEL_CIERRE,
    ]) {
      const contexto = contextoDeConvocatoria(convocatoria(), ahora);
      for (const [campo, valor] of Object.entries(contexto)) {
        expect(valor, `${campo} quedo en undefined`).toBeDefined();
      }
    }
  });

  it("alimenta convocatoria:ver-publicada sin que el llamador componga nada", () => {
    // La prueba que impide que gating.ts y permisos.ts se separen: lo que este
    // modulo produce tiene que bastarle a la guarda del gating triple.
    const decision = puedeEjecutar({
      accion: "convocatoria:ver-publicada",
      permisos: EMPLEADO,
      contexto: {
        participanteId: "participante-1",
        ...contextoDeConvocatoria(convocatoria(), DURANTE_LA_VENTA),
      },
    });
    expect(decision).toEqual({ permitido: true });
  });

  it("deniega por el mismo motivo por el que el gating dice que no es visible", () => {
    const casos = [
      { ahora: ANTES_DE_PUBLICAR, permisos: EMPLEADO },
      { ahora: DURANTE_LA_VENTA, permisos: PUBLICO },
      { ahora: DURANTE_LA_VENTA, permisos: SIN_VENTA },
    ];

    for (const { ahora, permisos } of casos) {
      const visible = esVisible(convocatoria(), permisos, ahora);
      const decision = puedeEjecutar({
        accion: "convocatoria:ver-publicada",
        permisos,
        contexto: {
          participanteId: "participante-1",
          ...contextoDeConvocatoria(convocatoria(), ahora),
        },
      });
      expect(decision.permitido).toBe(visible);
    }
  });

  it("alimenta solicitud:crear con la venta abierta", () => {
    const decision = puedeEjecutar({
      accion: "solicitud:crear",
      permisos: EMPLEADO,
      contexto: {
        participanteId: "participante-1",
        ...contextoDeConvocatoria(convocatoria(), DURANTE_LA_VENTA),
        // Lo que exige I/O no sale del dominio puro: lo agrega el servicio que
        // ya hizo la lectura del centinela de fila.
        tieneSolicitudViva: false,
      },
    });
    expect(decision).toEqual({ permitido: true });
  });

  it("solicitud:crear se deniega entre la publicacion y la apertura", () => {
    const decision = puedeEjecutar({
      accion: "solicitud:crear",
      permisos: EMPLEADO,
      contexto: {
        participanteId: "participante-1",
        ...contextoDeConvocatoria(convocatoria(), ENTRE_PUBLICAR_Y_ABRIR),
        tieneSolicitudViva: false,
      },
    });
    expect(decision).toEqual({ permitido: false, razon: "invalid_state" });
  });
});

describe("esLoteOfrecido", () => {
  it("excluye RETIRADO y admite todo lo demas", () => {
    // Recorre el ENUM entero en vez de listar los cuatro estatus a mano: el dia
    // que la maquina de lotes gane uno nuevo, esta prueba obliga a decidir si se
    // publica en lugar de dejar que se cuele por omision.
    const ofrecidos = ESTATUS_LOTE.filter((estatus) =>
      esLoteOfrecido({ estatus }),
    );
    expect(ofrecidos).toEqual(
      ESTATUS_LOTE.filter((estatus) => estatus !== "RETIRADO"),
    );
  });

  it("un lote vendido o no vendido si se publica", () => {
    // La convocatoria concluida sigue mostrando que se ofrecio y como termino.
    // Solo el retiro borra el lote de la oferta, porque solo el retiro devuelve
    // el vehiculo al catalogo.
    expect(esLoteOfrecido({ estatus: "VENDIDO" })).toBe(true);
    expect(esLoteOfrecido({ estatus: "NO_VENDIDO" })).toBe(true);
    expect(esLoteOfrecido({ estatus: "RETIRADO" })).toBe(false);
  });
});
