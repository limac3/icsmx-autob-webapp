// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PERMISOS, type Permiso } from "@/types/identidad";
import {
  puedeEjecutar,
  __test__,
  type Accion,
  type Contexto,
} from "./permisos";

const contextoBase: Contexto = {
  participanteId: "participante-1",
};

const decidir = (
  accion: Accion,
  permisos: Permiso[],
  contexto: Partial<Contexto> = {},
) =>
  puedeEjecutar({
    accion,
    permisos: new Set(permisos),
    contexto: { ...contextoBase, ...contexto },
  });

const TODOS_LOS_PERMISOS = [...PERMISOS];

const ADMIN_VEH = "Autob_Administrar_Vehiculos" as const;
const ADMIN_CONV = "Autob_Administrar_Convocatorias" as const;
const APROBAR = "Autob_Aprobar_Convocatorias" as const;
const VENTA_EMP = "Autob_Venta_a_empleados" as const;
const VENTA_GEN = "Autob_Venta_en_general" as const;
const TESORERIA = "Autob_Operar_Tesoreria" as const;
const AUDITAR = "Autob_Auditar" as const;

// Re-derivado a mano de agent_files/permission-matrix.md, no leido desde
// CATALOGO_ACCIONES: el objetivo de esta tabla es detectar cuando el codigo y
// el documento se separan (invariante 6 de la seccion 9 de la matriz), asi
// que no puede compartir la fuente con lo que prueba. `contexto` es el minimo
// que satisface la guarda para los permisos que permiten.
type CasoAccion = {
  accion: Accion;
  permisosQuePermiten: Permiso[];
  contexto?: Partial<Contexto>;
};

const CATALOGO_ESPERADO: CasoAccion[] = [
  // 1. Vehiculos
  { accion: "vehiculo:crear", permisosQuePermiten: [ADMIN_VEH] },
  {
    accion: "vehiculo:editar",
    permisosQuePermiten: [ADMIN_VEH],
    contexto: { estatusVehiculo: "DISPONIBLE" },
  },
  {
    accion: "vehiculo:ver-catalogo",
    permisosQuePermiten: [ADMIN_VEH, ADMIN_CONV, APROBAR, AUDITAR],
  },
  {
    accion: "vehiculo:retirar",
    permisosQuePermiten: [ADMIN_VEH],
    contexto: { estatusVehiculo: "DISPONIBLE" },
  },
  {
    accion: "vehiculo:subir-fotografia",
    permisosQuePermiten: [ADMIN_VEH],
    contexto: { estatusVehiculo: "DISPONIBLE" },
  },
  {
    accion: "vehiculo:eliminar-fotografia",
    permisosQuePermiten: [ADMIN_VEH],
    contexto: { estatusVehiculo: "DISPONIBLE" },
  },

  // 2. Convocatorias — administracion
  { accion: "convocatoria:crear", permisosQuePermiten: [ADMIN_CONV] },
  {
    accion: "convocatoria:editar",
    permisosQuePermiten: [ADMIN_CONV],
    contexto: { estatusConvocatoria: "BORRADOR", fechasCoherentes: true },
  },
  {
    accion: "convocatoria:ver-administracion",
    permisosQuePermiten: [ADMIN_CONV, APROBAR, AUDITAR],
  },
  {
    accion: "convocatoria:incluir-vehiculo",
    permisosQuePermiten: [ADMIN_CONV],
    contexto: {
      estatusConvocatoria: "BORRADOR",
      estatusVehiculo: "DISPONIBLE",
    },
  },
  {
    accion: "convocatoria:retirar-vehiculo",
    permisosQuePermiten: [ADMIN_CONV],
    contexto: {
      estatusConvocatoria: "BORRADOR",
      loteSinSolicitudesVivas: true,
    },
  },
  {
    accion: "convocatoria:enviar-a-aprobacion",
    permisosQuePermiten: [ADMIN_CONV],
    contexto: {
      estatusConvocatoria: "BORRADOR",
      tieneAlMenosUnLote: true,
      fechasCoherentes: true,
    },
  },
  {
    accion: "convocatoria:aprobar",
    permisosQuePermiten: [APROBAR],
    contexto: {
      estatusConvocatoria: "EN_APROBACION",
      creadoPor: "otra-persona",
    },
  },
  {
    accion: "convocatoria:rechazar",
    permisosQuePermiten: [APROBAR],
    contexto: {
      estatusConvocatoria: "EN_APROBACION",
      creadoPor: "otra-persona",
      motivoProvisto: true,
    },
  },
  {
    accion: "convocatoria:publicar",
    permisosQuePermiten: [ADMIN_CONV],
    contexto: { estatusConvocatoria: "APROBADA" },
  },
  {
    accion: "convocatoria:ocultar",
    permisosQuePermiten: [ADMIN_CONV],
    contexto: { estatusConvocatoria: "BORRADOR" },
  },
  {
    accion: "convocatoria:reactivar",
    permisosQuePermiten: [ADMIN_CONV],
    contexto: { estatusConvocatoria: "OCULTA" },
  },
  {
    accion: "convocatoria:concluir",
    permisosQuePermiten: [ADMIN_CONV],
    contexto: { estatusConvocatoria: "PUBLICADA", ventaFinalizada: true },
  },

  // 3. Convocatorias — participacion
  {
    accion: "convocatoria:ver-publicada",
    permisosQuePermiten: [VENTA_GEN],
    contexto: {
      estatusConvocatoria: "PUBLICADA",
      yaPublicada: true,
      tipoConvocatoria: "PUBLICO_GENERAL",
    },
  },
  {
    accion: "lote:ver-detalle",
    permisosQuePermiten: [VENTA_GEN],
    contexto: {
      estatusConvocatoria: "PUBLICADA",
      yaPublicada: true,
      tipoConvocatoria: "PUBLICO_GENERAL",
    },
  },

  // 4. Fila y solicitudes
  {
    accion: "solicitud:crear",
    permisosQuePermiten: [VENTA_GEN],
    contexto: {
      estatusConvocatoria: "PUBLICADA",
      yaPublicada: true,
      tipoConvocatoria: "PUBLICO_GENERAL",
      ventaAbierta: true,
      tieneSolicitudViva: false,
    },
  },
  {
    accion: "solicitud:ver-mi-lugar",
    permisosQuePermiten: [VENTA_EMP, VENTA_GEN],
    contexto: { titularId: contextoBase.participanteId },
  },
  {
    accion: "solicitud:ver-mis-solicitudes",
    permisosQuePermiten: [VENTA_EMP, VENTA_GEN],
  },
  {
    accion: "solicitud:cancelar",
    permisosQuePermiten: [VENTA_EMP, VENTA_GEN],
    contexto: {
      titularId: contextoBase.participanteId,
      estatusSolicitud: "EN_FILA",
    },
  },
  { accion: "fila:ver-completa", permisosQuePermiten: [AUDITAR] },

  // 5. Pago y tesoreria
  {
    accion: "comprobante:subir",
    permisosQuePermiten: [VENTA_EMP, VENTA_GEN],
    contexto: {
      titularId: contextoBase.participanteId,
      estatusSolicitud: "ADJUDICADA",
      dentroDePlazo: true,
    },
  },
  {
    accion: "comprobante:descargar",
    permisosQuePermiten: [VENTA_EMP, VENTA_GEN, TESORERIA, AUDITAR],
    contexto: { titularId: contextoBase.participanteId },
  },
  {
    accion: "tesoreria:ver-bandeja",
    permisosQuePermiten: [TESORERIA, AUDITAR],
  },
  {
    accion: "pago:avalar",
    permisosQuePermiten: [TESORERIA],
    contexto: { estatusSolicitud: "EN_VERIFICACION" },
  },
  {
    accion: "pago:rechazar",
    permisosQuePermiten: [TESORERIA],
    contexto: { estatusSolicitud: "EN_VERIFICACION", motivoProvisto: true },
  },

  // 6. Auditoria
  { accion: "auditoria:ver-bitacora", permisosQuePermiten: [AUDITAR] },
  { accion: "auditoria:ver-fila-historica", permisosQuePermiten: [AUDITAR] },
  { accion: "auditoria:exportar", permisosQuePermiten: [AUDITAR] },
];

describe("puedeEjecutar — cobertura cartesiana permiso x accion", () => {
  for (const caso of CATALOGO_ESPERADO) {
    describe(caso.accion, () => {
      for (const permiso of TODOS_LOS_PERMISOS) {
        const permitido = caso.permisosQuePermiten.includes(permiso);
        it(`${permitido ? "permite" : "deniega"} con solo ${permiso}`, () => {
          const decision = decidir(caso.accion, [permiso], caso.contexto);
          expect(decision.permitido).toBe(permitido);
          if (!decision.permitido) {
            // Con el contexto que satisface la guarda, la unica razon posible
            // de denegacion es no tener la capacidad. Una razon contextual
            // aqui significaria que el contexto del caso esta mal armado.
            expect(["forbidden", "sin_permiso_de_tipo"]).toContain(
              decision.razon,
            );
          }
        });
      }
    });
  }

  // Invariante 6 de la matriz. Compara contra las claves **reales** del
  // catalogo, no contra un numero: antes se afirmaba `toHaveLength(33)`, que
  // no miraba el catalogo y por tanto no detectaba una accion nueva sin
  // entrada en la matriz — justo lo que la invariante existe para impedir.
  it("cubre exactamente las acciones del catalogo, sin faltantes ni sobrantes", () => {
    const enElCodigo = Object.keys(__test__.CATALOGO_ACCIONES).sort();
    const enLaMatriz = CATALOGO_ESPERADO.map((caso) => caso.accion).sort();
    expect(enLaMatriz).toEqual(enElCodigo);
  });
});

describe("puedeEjecutar — invariantes de la seccion 9 de permission-matrix.md", () => {
  // Derivadas del catalogo esperado, no escritas a mano: una accion nueva de
  // mutacion entra automaticamente a la invariante 1.
  const ACCIONES_DE_LECTURA = new Set<Accion>([
    "vehiculo:ver-catalogo",
    "convocatoria:ver-administracion",
    "convocatoria:ver-publicada",
    "lote:ver-detalle",
    "solicitud:ver-mi-lugar",
    "solicitud:ver-mis-solicitudes",
    "fila:ver-completa",
    "comprobante:descargar",
    "tesoreria:ver-bandeja",
    "auditoria:ver-bitacora",
    "auditoria:ver-fila-historica",
    "auditoria:exportar",
  ]);

  const ACCIONES_DE_MUTACION = CATALOGO_ESPERADO.filter(
    (caso) => !ACCIONES_DE_LECTURA.has(caso.accion),
  );

  it("1. Autob_Auditar no habilita ninguna mutacion — catalogo completo", () => {
    expect(ACCIONES_DE_MUTACION.length).toBeGreaterThan(15);
    for (const caso of ACCIONES_DE_MUTACION) {
      const decision = decidir(caso.accion, [AUDITAR], caso.contexto);
      expect(
        decision.permitido,
        `${caso.accion} deberia estar denegada para Autob_Auditar`,
      ).toBe(false);
    }
  });

  it("2. ningun permiso administrativo habilita solicitar compra, ni combinados", () => {
    const administrativos = [
      ADMIN_VEH,
      ADMIN_CONV,
      APROBAR,
      TESORERIA,
      AUDITAR,
    ];
    const contexto = {
      estatusConvocatoria: "PUBLICADA" as const,
      yaPublicada: true,
      tipoConvocatoria: "PUBLICO_GENERAL" as const,
      ventaAbierta: true,
      tieneSolicitudViva: false,
    };
    for (const permiso of administrativos) {
      expect(decidir("solicitud:crear", [permiso], contexto).permitido).toBe(
        false,
      );
    }
    // Todos juntos tampoco: la union de capacidades administrativas no
    // sintetiza una capacidad de compra.
    expect(decidir("solicitud:crear", administrativos, contexto)).toEqual({
      permitido: false,
      razon: "forbidden",
    });
  });

  it("3. auto-aprobacion denegada aunque tenga administrar y aprobar", () => {
    const decision = decidir("convocatoria:aprobar", [ADMIN_CONV, APROBAR], {
      estatusConvocatoria: "EN_APROBACION",
      creadoPor: contextoBase.participanteId,
    });
    expect(decision).toEqual({ permitido: false, razon: "self_approval" });
  });

  it("4. sin Autob_Venta_a_empleados no se ve ni se solicita en convocatorias EMPLEADOS", () => {
    const contexto = {
      estatusConvocatoria: "PUBLICADA" as const,
      yaPublicada: true,
      tipoConvocatoria: "EMPLEADOS" as const,
    };
    expect(
      decidir("convocatoria:ver-publicada", [VENTA_GEN], contexto),
    ).toEqual({ permitido: false, razon: "sin_permiso_de_tipo" });
    expect(
      decidir("solicitud:crear", [VENTA_GEN], {
        ...contexto,
        ventaAbierta: true,
        tieneSolicitudViva: false,
      }),
    ).toEqual({ permitido: false, razon: "sin_permiso_de_tipo" });
    // Con el permiso del tipo, la misma convocatoria si se ve.
    expect(
      decidir("convocatoria:ver-publicada", [VENTA_EMP], contexto).permitido,
    ).toBe(true);
  });

  it("5. propiedad del comprobante: no se sube ni se descarga el de otro", () => {
    expect(
      decidir("comprobante:subir", [VENTA_EMP], {
        titularId: "otro-participante",
        estatusSolicitud: "ADJUDICADA",
        dentroDePlazo: true,
      }),
    ).toEqual({ permitido: false, razon: "not_owner" });
    expect(
      decidir("comprobante:descargar", [VENTA_EMP], {
        titularId: "otro-participante",
      }),
    ).toEqual({ permitido: false, razon: "not_owner" });
  });

  it("7. cerrado por omision de accion: una accion desconocida nunca se permite", () => {
    const decision = decidir("accion-que-no-existe" as Accion, [
      ...TODOS_LOS_PERMISOS,
    ]);
    expect(decision).toEqual({ permitido: false, razon: "forbidden" });
  });

  // Invariante 8. Es la prueba que captura de una vez los siete fallos
  // abiertos que encontro la revision de la Etapa 2.1, y cualquiera futuro:
  // una guarda no puede permitir cuando el dato que necesita no llego. Un dato
  // ausente no es un dato que se cumple.
  //
  // Se recorre cada accion con guarda contra **cada permiso que la habilita**,
  // por separado y con contexto vacio.
  //
  // Excepciones declaradas: pares (accion, permiso) cuya guarda concede por
  // capacidad sola, sin mirar el recurso. Estan aqui —y no como una version
  // debil de la invariante— para que agregar una nueva obligue a justificarla.
  const CONCEDEN_SIN_CONTEXTO = new Set([
    // La matriz (seccion 6) da a tesoreria y auditoria el comprobante de
    // cualquiera: no hay condicion de propiedad que verificar.
    `comprobante:descargar|${TESORERIA}`,
    `comprobante:descargar|${AUDITAR}`,
  ]);

  it("8. cerrado por omision de contexto: todo campo del contexto minimo es indispensable", () => {
    const conGuarda = new Set(
      Object.entries(__test__.CATALOGO_ACCIONES)
        .filter(([, definicion]) => "guarda" in definicion)
        .map(([accion]) => accion),
    );

    expect(conGuarda.size).toBeGreaterThan(15);
    let comprobados = 0;

    for (const caso of CATALOGO_ESPERADO) {
      if (!conGuarda.has(caso.accion)) continue;
      const campos = Object.keys(caso.contexto ?? {});

      for (const permiso of caso.permisosQuePermiten) {
        if (CONCEDEN_SIN_CONTEXTO.has(`${caso.accion}|${permiso}`)) continue;

        // Sin nada de contexto, nunca.
        comprobados += 1;
        expect(
          decidir(caso.accion, [permiso]).permitido,
          `${caso.accion} con ${permiso} se permitio sin contexto alguno`,
        ).toBe(false);

        // Y quitando **un** campo a la vez del contexto que si la satisface:
        // si al retirarlo sigue permitiendo, ese campo no se estaba exigiendo
        // de verdad. Es lo que detecta una precondicion que solo rechaza
        // `=== false` y deja pasar `undefined`.
        for (const campo of campos) {
          const incompleto = { ...caso.contexto } as Record<string, unknown>;
          delete incompleto[campo];
          comprobados += 1;
          expect(
            decidir(caso.accion, [permiso], incompleto as Partial<Contexto>)
              .permitido,
            `${caso.accion} con ${permiso} se permitio sin "${campo}": la guarda falla abierta`,
          ).toBe(false);
        }
      }
    }

    expect(comprobados).toBeGreaterThan(40);
  });
});

describe("puedeEjecutar — guardas contextuales (casos allow y deny)", () => {
  it("vehiculo:editar deniega si esta RESERVADO o VENDIDO", () => {
    for (const estatusVehiculo of ["RESERVADO", "VENDIDO"] as const) {
      expect(
        decidir("vehiculo:editar", [ADMIN_VEH], { estatusVehiculo }).permitido,
      ).toBe(false);
    }
    expect(
      decidir("vehiculo:editar", [ADMIN_VEH], {
        estatusVehiculo: "DISPONIBLE",
      }).permitido,
    ).toBe(true);
  });

  it("convocatoria:ocultar permite sin guarda extra desde BORRADOR/EN_APROBACION/APROBADA", () => {
    for (const estatusConvocatoria of [
      "BORRADOR",
      "EN_APROBACION",
      "APROBADA",
    ] as const) {
      expect(
        decidir("convocatoria:ocultar", [ADMIN_CONV], { estatusConvocatoria })
          .permitido,
      ).toBe(true);
    }
  });

  it("convocatoria:ocultar desde PUBLICADA exige saber que no hay solicitudes (R-06)", () => {
    const publicada = { estatusConvocatoria: "PUBLICADA" as const };
    expect(
      decidir("convocatoria:ocultar", [ADMIN_CONV], {
        ...publicada,
        existeAlgunaSolicitud: true,
      }).permitido,
    ).toBe(false);
    // No saberlo no equivale a que no las haya: ocultar aqui dejaria una fila
    // viva invisible.
    expect(
      decidir("convocatoria:ocultar", [ADMIN_CONV], publicada).permitido,
    ).toBe(false);
    expect(
      decidir("convocatoria:ocultar", [ADMIN_CONV], {
        ...publicada,
        existeAlgunaSolicitud: false,
      }).permitido,
    ).toBe(true);
  });

  it("convocatoria:ocultar deniega desde CONCLUIDA (terminal)", () => {
    expect(
      decidir("convocatoria:ocultar", [ADMIN_CONV], {
        estatusConvocatoria: "CONCLUIDA",
      }).permitido,
    ).toBe(false);
  });

  it("solicitud:crear exige saber que no hay solicitud viva propia (R-07)", () => {
    const base = {
      estatusConvocatoria: "PUBLICADA" as const,
      yaPublicada: true,
      tipoConvocatoria: "PUBLICO_GENERAL" as const,
      ventaAbierta: true,
    };
    expect(
      decidir("solicitud:crear", [VENTA_GEN], {
        ...base,
        tieneSolicitudViva: true,
      }).permitido,
    ).toBe(false);
    expect(decidir("solicitud:crear", [VENTA_GEN], base).permitido).toBe(false);
    expect(
      decidir("solicitud:crear", [VENTA_GEN], {
        ...base,
        tieneSolicitudViva: false,
      }).permitido,
    ).toBe(true);
  });

  it("el gating triple deniega una convocatoria aun no visible (publicadaEn futuro)", () => {
    const base = {
      estatusConvocatoria: "PUBLICADA" as const,
      tipoConvocatoria: "PUBLICO_GENERAL" as const,
    };
    expect(
      decidir("convocatoria:ver-publicada", [VENTA_GEN], {
        ...base,
        yaPublicada: false,
      }).permitido,
    ).toBe(false);
    expect(
      decidir("convocatoria:ver-publicada", [VENTA_GEN], {
        ...base,
        yaPublicada: true,
      }).permitido,
    ).toBe(true);
  });

  it("comprobante:descargar: tesoreria y auditoria descargan el de cualquiera", () => {
    const ajeno = { titularId: "otro-participante" };
    for (const permiso of [TESORERIA, AUDITAR]) {
      expect(decidir("comprobante:descargar", [permiso], ajeno).permitido).toBe(
        true,
      );
    }
  });

  it("convocatoria:aprobar deniega si no se sabe quien la creo", () => {
    expect(
      decidir("convocatoria:aprobar", [APROBAR], {
        estatusConvocatoria: "EN_APROBACION",
      }).permitido,
    ).toBe(false);
  });

  it("pago:rechazar y convocatoria:rechazar exigen motivo (R-16)", () => {
    expect(
      decidir("pago:rechazar", [TESORERIA], {
        estatusSolicitud: "EN_VERIFICACION",
      }).permitido,
    ).toBe(false);
    expect(
      decidir("convocatoria:rechazar", [APROBAR], {
        estatusConvocatoria: "EN_APROBACION",
        creadoPor: "otra-persona",
      }).permitido,
    ).toBe(false);
  });

  it("solicitud:cancelar solo desde un estado vivo y solo la propia", () => {
    const propia = { titularId: contextoBase.participanteId };
    for (const estatusSolicitud of [
      "EN_FILA",
      "CONGELADA",
      "ADJUDICADA",
    ] as const) {
      expect(
        decidir("solicitud:cancelar", [VENTA_GEN], {
          ...propia,
          estatusSolicitud,
        }).permitido,
      ).toBe(true);
    }
    expect(
      decidir("solicitud:cancelar", [VENTA_GEN], {
        ...propia,
        estatusSolicitud: "VENDIDA",
      }).permitido,
    ).toBe(false);
    expect(
      decidir("solicitud:cancelar", [VENTA_GEN], {
        titularId: "otro",
        estatusSolicitud: "EN_FILA",
      }),
    ).toEqual({ permitido: false, razon: "not_owner" });
  });
});
