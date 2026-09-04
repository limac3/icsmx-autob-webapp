// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ROLES, type Rol } from "@/types/identidad";
import { puedeEjecutar, type Accion, type Contexto } from "./permisos";

const contextoBase: Contexto = {
  participanteId: "participante-1",
  tipoParticipante: "OTRO_USUARIO",
};

const decidir = (
  accion: Accion,
  roles: Rol[],
  contexto: Partial<Contexto> = {},
) =>
  puedeEjecutar({ accion, roles, contexto: { ...contextoBase, ...contexto } });

// Re-derivado a mano de agent_files/permission-matrix.md, no leido desde
// CATALOGO_ACCIONES: el objetivo de esta tabla es detectar cuando el codigo y
// el documento se separan (invariante 6 de la seccion 7 de la matriz), asi
// que no puede compartir la fuente con lo que prueba. `contexto` es el minimo
// que satisface la guarda para los roles permitidos.
type CasoAccion = {
  accion: Accion;
  rolesPermitidos: Rol[];
  contexto?: Partial<Contexto>;
};

const TODOS_LOS_ROLES = [...ROLES];

const CATALOGO_ESPERADO: CasoAccion[] = [
  // 1. Vehiculos
  { accion: "vehiculo:crear", rolesPermitidos: ["ADMINISTRADOR"] },
  {
    accion: "vehiculo:editar",
    rolesPermitidos: ["ADMINISTRADOR"],
    contexto: { estatusVehiculo: "DISPONIBLE" },
  },
  {
    accion: "vehiculo:ver-catalogo",
    rolesPermitidos: [
      "ADMINISTRADOR",
      "APROBADOR_CONVOCATORIA",
      "AUDITOR_CUMPLIMIENTO",
    ],
  },
  {
    accion: "vehiculo:retirar",
    rolesPermitidos: ["ADMINISTRADOR"],
    contexto: { estatusVehiculo: "DISPONIBLE" },
  },
  {
    accion: "vehiculo:subir-fotografia",
    rolesPermitidos: ["ADMINISTRADOR"],
    contexto: { estatusVehiculo: "DISPONIBLE" },
  },
  {
    accion: "vehiculo:eliminar-fotografia",
    rolesPermitidos: ["ADMINISTRADOR"],
    contexto: { estatusVehiculo: "DISPONIBLE" },
  },

  // 2. Convocatorias — administracion
  { accion: "convocatoria:crear", rolesPermitidos: ["ADMINISTRADOR"] },
  {
    accion: "convocatoria:editar",
    rolesPermitidos: ["ADMINISTRADOR"],
    contexto: { estatusConvocatoria: "BORRADOR", fechasCoherentes: true },
  },
  {
    accion: "convocatoria:ver-administracion",
    rolesPermitidos: [
      "ADMINISTRADOR",
      "APROBADOR_CONVOCATORIA",
      "AUDITOR_CUMPLIMIENTO",
    ],
  },
  {
    accion: "convocatoria:incluir-vehiculo",
    rolesPermitidos: ["ADMINISTRADOR"],
    contexto: {
      estatusConvocatoria: "BORRADOR",
      estatusVehiculo: "DISPONIBLE",
    },
  },
  {
    accion: "convocatoria:retirar-vehiculo",
    rolesPermitidos: ["ADMINISTRADOR"],
    contexto: {
      estatusConvocatoria: "BORRADOR",
      loteSinSolicitudesVivas: true,
    },
  },
  {
    accion: "convocatoria:enviar-a-aprobacion",
    rolesPermitidos: ["ADMINISTRADOR"],
    contexto: {
      estatusConvocatoria: "BORRADOR",
      tieneAlMenosUnLote: true,
      fechasCoherentes: true,
    },
  },
  {
    accion: "convocatoria:aprobar",
    rolesPermitidos: ["APROBADOR_CONVOCATORIA"],
    contexto: {
      estatusConvocatoria: "EN_APROBACION",
      creadoPor: "alguien-mas",
    },
  },
  {
    accion: "convocatoria:rechazar",
    rolesPermitidos: ["APROBADOR_CONVOCATORIA"],
    contexto: {
      estatusConvocatoria: "EN_APROBACION",
      creadoPor: "alguien-mas",
      motivoProvisto: true,
    },
  },
  {
    accion: "convocatoria:publicar",
    rolesPermitidos: ["ADMINISTRADOR"],
    contexto: { estatusConvocatoria: "APROBADA" },
  },
  {
    accion: "convocatoria:ocultar",
    rolesPermitidos: ["ADMINISTRADOR"],
    contexto: { estatusConvocatoria: "BORRADOR" },
  },
  {
    accion: "convocatoria:reactivar",
    rolesPermitidos: ["ADMINISTRADOR"],
    contexto: { estatusConvocatoria: "OCULTA" },
  },
  {
    accion: "convocatoria:concluir",
    rolesPermitidos: ["ADMINISTRADOR"],
    contexto: { estatusConvocatoria: "PUBLICADA", ventaFinalizada: true },
  },

  // 3. Convocatorias — participacion (gating triple; PUBLICO_GENERAL para
  // que EMPLEADO y OTRO_USUARIO pasen por igual la compatibilidad de tipo)
  {
    accion: "convocatoria:ver-publicada",
    rolesPermitidos: TODOS_LOS_ROLES,
    contexto: {
      estatusConvocatoria: "PUBLICADA",
      yaPublicada: true,
      tipoConvocatoria: "PUBLICO_GENERAL",
    },
  },
  {
    accion: "lote:ver-detalle",
    rolesPermitidos: TODOS_LOS_ROLES,
    contexto: {
      estatusConvocatoria: "PUBLICADA",
      yaPublicada: true,
      tipoConvocatoria: "PUBLICO_GENERAL",
    },
  },

  // 4. Fila y solicitudes
  {
    accion: "solicitud:crear",
    rolesPermitidos: ["EMPLEADO", "OTRO_USUARIO"],
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
    rolesPermitidos: ["EMPLEADO", "OTRO_USUARIO"],
    contexto: { titularId: "participante-1" },
  },
  {
    accion: "solicitud:ver-mis-solicitudes",
    rolesPermitidos: ["EMPLEADO", "OTRO_USUARIO"],
  },
  {
    accion: "solicitud:cancelar",
    rolesPermitidos: ["EMPLEADO", "OTRO_USUARIO"],
    contexto: { titularId: "participante-1", estatusSolicitud: "EN_FILA" },
  },
  { accion: "fila:ver-completa", rolesPermitidos: ["AUDITOR_CUMPLIMIENTO"] },

  // 5. Pago y tesoreria
  {
    accion: "comprobante:subir",
    rolesPermitidos: ["EMPLEADO", "OTRO_USUARIO"],
    contexto: {
      titularId: "participante-1",
      estatusSolicitud: "ADJUDICADA",
      dentroDePlazo: true,
    },
  },
  {
    accion: "comprobante:descargar",
    rolesPermitidos: [
      "EMPLEADO",
      "OTRO_USUARIO",
      "OPERADOR_TESORERIA",
      "AUDITOR_CUMPLIMIENTO",
    ],
    contexto: { titularId: "participante-1" },
  },
  {
    accion: "tesoreria:ver-bandeja",
    rolesPermitidos: ["OPERADOR_TESORERIA", "AUDITOR_CUMPLIMIENTO"],
  },
  {
    accion: "pago:avalar",
    rolesPermitidos: ["OPERADOR_TESORERIA"],
    contexto: { estatusSolicitud: "EN_VERIFICACION" },
  },
  {
    accion: "pago:rechazar",
    rolesPermitidos: ["OPERADOR_TESORERIA"],
    contexto: { estatusSolicitud: "EN_VERIFICACION", motivoProvisto: true },
  },

  // 6. Auditoria
  {
    accion: "auditoria:ver-bitacora",
    rolesPermitidos: ["AUDITOR_CUMPLIMIENTO"],
  },
  {
    accion: "auditoria:ver-fila-historica",
    rolesPermitidos: ["AUDITOR_CUMPLIMIENTO"],
  },
  { accion: "auditoria:exportar", rolesPermitidos: ["AUDITOR_CUMPLIMIENTO"] },
];

describe("puedeEjecutar — cobertura cartesiana rol x accion", () => {
  for (const caso of CATALOGO_ESPERADO) {
    describe(caso.accion, () => {
      for (const rol of TODOS_LOS_ROLES) {
        const permitido = caso.rolesPermitidos.includes(rol);
        it(`${permitido ? "permite" : "deniega"} a ${rol}`, () => {
          const decision = decidir(caso.accion, [rol], caso.contexto);
          expect(decision.permitido).toBe(permitido);
          if (!permitido) {
            expect(decision).toMatchObject({ razon: "forbidden" });
          }
        });
      }
    });
  }

  it("cubre las 33 acciones del catalogo (ninguna quedo fuera de esta tabla)", () => {
    expect(CATALOGO_ESPERADO).toHaveLength(33);
  });
});

describe("puedeEjecutar — invariantes de la seccion 7 de permission-matrix.md", () => {
  const ACCIONES_DE_MUTACION: Accion[] = [
    "vehiculo:crear",
    "convocatoria:crear",
    "convocatoria:aprobar",
    "solicitud:crear",
    "pago:avalar",
  ];

  it("1. AUDITOR_CUMPLIMIENTO no puede mutar nada", () => {
    for (const accion of ACCIONES_DE_MUTACION) {
      expect(decidir(accion, ["AUDITOR_CUMPLIMIENTO"]).permitido).toBe(false);
    }
  });

  it("2. ningun rol administrativo puede solicitar compra", () => {
    for (const rol of [
      "ADMINISTRADOR",
      "APROBADOR_CONVOCATORIA",
      "OPERADOR_TESORERIA",
      "AUDITOR_CUMPLIMIENTO",
    ] as const) {
      expect(decidir("solicitud:crear", [rol]).permitido).toBe(false);
    }
  });

  it("3. auto-aprobacion denegada aunque el usuario tenga ambos roles", () => {
    const decision = decidir(
      "convocatoria:aprobar",
      ["ADMINISTRADOR", "APROBADOR_CONVOCATORIA"],
      {
        estatusConvocatoria: "EN_APROBACION",
        creadoPor: contextoBase.participanteId,
      },
    );
    expect(decision).toEqual({ permitido: false, razon: "self_approval" });
  });

  it("4. OTRO_USUARIO no ve ni solicita en convocatorias de EMPLEADOS", () => {
    const contexto = {
      estatusConvocatoria: "BORRADOR" as const,
      tipoConvocatoria: "EMPLEADOS" as const,
    };
    expect(
      decidir("convocatoria:ver-publicada", ["OTRO_USUARIO"], {
        ...contexto,
        estatusConvocatoria: "PUBLICADA",
        yaPublicada: true,
      }),
    ).toEqual({ permitido: false, razon: "wrong_participant_type" });
    expect(
      decidir("solicitud:crear", ["OTRO_USUARIO"], {
        ...contexto,
        estatusConvocatoria: "PUBLICADA",
        yaPublicada: true,
        ventaAbierta: true,
      }),
    ).toEqual({ permitido: false, razon: "wrong_participant_type" });
  });

  it("5. propiedad del comprobante: no se sube ni se descarga el de otro", () => {
    const contexto = {
      titularId: "otro-participante",
      estatusSolicitud: "ADJUDICADA" as const,
      dentroDePlazo: true,
    };
    expect(decidir("comprobante:subir", ["EMPLEADO"], contexto)).toEqual({
      permitido: false,
      razon: "not_owner",
    });
    expect(
      decidir("comprobante:descargar", ["EMPLEADO"], {
        titularId: "otro-participante",
      }),
    ).toEqual({
      permitido: false,
      razon: "not_owner",
    });
  });

  it("7. cerrado por omision: una accion desconocida nunca se permite", () => {
    const decision = decidir("accion-que-no-existe" as Accion, [
      ...TODOS_LOS_ROLES,
    ]);
    expect(decision).toEqual({ permitido: false, razon: "forbidden" });
  });
});

describe("puedeEjecutar — guardas contextuales (casos allow y deny)", () => {
  it("vehiculo:editar deniega si esta RESERVADO o VENDIDO", () => {
    expect(
      decidir("vehiculo:editar", ["ADMINISTRADOR"], {
        estatusVehiculo: "RESERVADO",
      }).permitido,
    ).toBe(false);
    expect(
      decidir("vehiculo:editar", ["ADMINISTRADOR"], {
        estatusVehiculo: "VENDIDO",
      }).permitido,
    ).toBe(false);
    expect(
      decidir("vehiculo:editar", ["ADMINISTRADOR"], {
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
        decidir("convocatoria:ocultar", ["ADMINISTRADOR"], {
          estatusConvocatoria,
        }).permitido,
      ).toBe(true);
    }
  });

  it("convocatoria:ocultar desde PUBLICADA exige que no exista ninguna solicitud (R-06)", () => {
    expect(
      decidir("convocatoria:ocultar", ["ADMINISTRADOR"], {
        estatusConvocatoria: "PUBLICADA",
        existeAlgunaSolicitud: true,
      }).permitido,
    ).toBe(false);
    expect(
      decidir("convocatoria:ocultar", ["ADMINISTRADOR"], {
        estatusConvocatoria: "PUBLICADA",
        existeAlgunaSolicitud: false,
      }).permitido,
    ).toBe(true);
  });

  it("convocatoria:ocultar deniega desde CONCLUIDA (terminal)", () => {
    expect(
      decidir("convocatoria:ocultar", ["ADMINISTRADOR"], {
        estatusConvocatoria: "CONCLUIDA",
      }).permitido,
    ).toBe(false);
  });

  it("solicitud:crear deniega si la venta no esta abierta o ya tiene solicitud viva", () => {
    const base = {
      estatusConvocatoria: "PUBLICADA" as const,
      yaPublicada: true,
      tipoConvocatoria: "PUBLICO_GENERAL" as const,
    };
    expect(
      decidir("solicitud:crear", ["EMPLEADO"], { ...base, ventaAbierta: false })
        .permitido,
    ).toBe(false);
    expect(
      decidir("solicitud:crear", ["EMPLEADO"], {
        ...base,
        ventaAbierta: true,
        tieneSolicitudViva: true,
      }).permitido,
    ).toBe(false);
  });

  it("solicitud:cancelar solo en estados vivos", () => {
    expect(
      decidir("solicitud:cancelar", ["EMPLEADO"], {
        titularId: contextoBase.participanteId,
        estatusSolicitud: "VENDIDA",
      }).permitido,
    ).toBe(false);
    expect(
      decidir("solicitud:cancelar", ["EMPLEADO"], {
        titularId: contextoBase.participanteId,
        estatusSolicitud: "CONGELADA",
      }).permitido,
    ).toBe(true);
  });

  it("comprobante:descargar deja pasar a OPERADOR_TESORERIA y AUDITOR_CUMPLIMIENTO sin ser el titular", () => {
    expect(
      decidir("comprobante:descargar", ["OPERADOR_TESORERIA"], {
        titularId: "otro-participante",
      }).permitido,
    ).toBe(true);
    expect(
      decidir("comprobante:descargar", ["AUDITOR_CUMPLIMIENTO"], {
        titularId: "otro-participante",
      }).permitido,
    ).toBe(true);
  });

  it("pago:rechazar exige motivo", () => {
    expect(
      decidir("pago:rechazar", ["OPERADOR_TESORERIA"], {
        estatusSolicitud: "EN_VERIFICACION",
        motivoProvisto: false,
      }).permitido,
    ).toBe(false);
  });
});
