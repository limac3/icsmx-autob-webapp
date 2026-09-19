import { tieneCapacidad, type Accion } from "./auth/permisos";
import type { Permiso } from "@/types/identidad";

/**
 * Catalogo del menu de navegacion.
 *
 * **Cada entrada declara la `Accion` que abre su puerta, no una lista de
 * permisos.** Es la diferencia entre un menu que sigue a la matriz y uno que
 * se le despega: si `permission-matrix.md` cambia que permisos habilitan
 * `tesoreria:ver-bandeja`, el menu lo hereda sin tocarse. Una lista de permisos
 * copiada aqui seria una segunda fuente de verdad, y la que se olvida de
 * actualizar (regla 17: el codigo declara *que permiso* exige cada accion, en
 * un solo lugar).
 *
 * Se comprueba la **capacidad**, no la aplicabilidad — ver `tieneCapacidad`.
 * Por eso todas las acciones de abajo son `ver-*` sin guarda contextual: una
 * accion guardada evaluada sin recurso denegaria siempre.
 *
 * Ocultar un enlace es **cortesia, no autorizacion**. Cada pantalla vuelve a
 * decidir con `puedeEjecutar` completo; escribir la URL a mano no abre nada
 * (principio P-1).
 */
export type IdDeNavegacion =
  | "convocatorias"
  | "misSolicitudes"
  | "vehiculos"
  | "convocatoriasAdmin"
  | "aprobaciones"
  | "tesoreria"
  | "adjudicacion"
  | "auditoria";

export type EntradaDeNavegacion = {
  readonly id: IdDeNavegacion;
  readonly href: string;
  readonly accion: Accion;
};

export const ENTRADAS_DE_NAVEGACION: readonly EntradaDeNavegacion[] = [
  // Participante.
  //
  // **`solicitud:ver-mis-solicitudes` y no `convocatoria:ver-publicada`**,
  // aunque el enlace lleve al catalogo. Las dos exigen exactamente los mismos
  // permisos de venta, asi que el enlace se ve igual; la diferencia es que
  // `ver-publicada` arrastra el gating triple, que necesita una convocatoria
  // concreta. Declararla aqui seria pedir una decision sobre un recurso que el
  // menu no tiene, y por regla 18 saldria denegada siempre.
  //
  // Lo que el menu pregunta de verdad es "¿esta persona compra?", y eso es lo
  // que expresa `ver-mis-solicitudes`. El gating de cada convocatoria lo aplica
  // la pantalla.
  {
    id: "convocatorias",
    href: "/convocatorias",
    accion: "solicitud:ver-mis-solicitudes",
  },
  // La pantalla 3.5, que **si** es lo que su accion nombra. Comparte accion con
  // la entrada de arriba y eso es correcto: las dos preguntan "¿esta persona
  // compra?", que es una sola capacidad. Quien compra ve las dos entradas —el
  // catalogo para entrar a una fila, esta para ver en cuales esta.
  {
    id: "misSolicitudes",
    href: "/mis-solicitudes",
    accion: "solicitud:ver-mis-solicitudes",
  },

  // Administracion.
  {
    id: "vehiculos",
    href: "/admin/vehiculos",
    accion: "vehiculo:ver-catalogo",
  },
  {
    id: "convocatoriasAdmin",
    href: "/admin/convocatorias",
    accion: "convocatoria:ver-administracion",
  },
  {
    id: "aprobaciones",
    href: "/aprobaciones",
    accion: "convocatoria:ver-aprobaciones",
  },

  // Tesoreria.
  {
    id: "tesoreria",
    href: "/tesoreria/verificacion",
    accion: "tesoreria:ver-bandeja",
  },

  // Adjudicacion manual (R-23).
  {
    id: "adjudicacion",
    href: "/adjudicacion",
    accion: "adjudicacion:ver-bandeja",
  },

  // Auditoria.
  {
    id: "auditoria",
    href: "/auditoria",
    accion: "auditoria:ver-bitacora",
  },
];

/** Las entradas cuya capacidad concede alguno de estos permisos, en orden. */
export const entradasVisibles = (
  permisos: ReadonlySet<Permiso>,
): readonly EntradaDeNavegacion[] =>
  ENTRADAS_DE_NAVEGACION.filter((entrada) =>
    tieneCapacidad({ accion: entrada.accion, permisos }),
  );
