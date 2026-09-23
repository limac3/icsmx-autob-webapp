import { tieneCapacidad, type Accion } from "./auth/permisos";
import type { Permiso } from "@/types/identidad";

/**
 * Catalogo de la guia de inicio: que se le explica a cada quien en el home.
 *
 * Gemelo de `src/lib/navegacion.ts` y por la misma razon: **cada bloque
 * declara una `Accion`, no una lista de permisos**, para que la guia siga a
 * `permission-matrix.md` sin una segunda fuente de verdad (regla 17).
 *
 * **Pero la accion que declara no es la misma clase de accion que declara el
 * menu, y esa es la diferencia que hace que esto funcione.** El menu declara
 * la puerta (`ver-*`); la guia declara **la operacion que describe**. Importa
 * porque `Autob_Auditar` concede capacidad sobre `vehiculo:ver-catalogo`,
 * `convocatoria:ver-administracion`, `tesoreria:ver-bandeja` y
 * `adjudicacion:ver-bandeja` —el auditor ve esas secciones en lectura, y eso
 * es correcto—: colgada de esas mismas acciones, la guia le explicaria a quien
 * audita como publicar una convocatoria y como avalar un pago, dos cosas que
 * no puede hacer. Colgada de `convocatoria:publicar` y `pago:avalar`, que
 * exigen el permiso de quien si decide, cada quien lee solo lo suyo.
 *
 * `tieneCapacidad` sirve igual para una accion con guarda: solo mira permisos
 * y no evalua el recurso, asi que no cae en la regla 18 — no hay contexto que
 * omitir. Aqui se pregunta "¿esta persona publica convocatorias?", no "¿puede
 * publicar **esta**?", que es lo que decide la pantalla.
 *
 * El texto de cada bloque vive en `src/dictionaries/` bajo `inicio.bloques`,
 * nunca aqui (regla 11).
 */
export type IdDeBloqueDeGuia =
  | "comprar"
  | "pagar"
  | "vehiculos"
  | "publicar"
  | "dictaminar"
  | "adjudicar"
  | "verificarPagos"
  | "auditar";

export type BloqueDeGuia = {
  readonly id: IdDeBloqueDeGuia;
  /** La operacion que el bloque explica. */
  readonly accion: Accion;
  /** A donde se va a hacerlo. Debe ser una ruta que exista. */
  readonly href: string;
};

export const BLOQUES_DE_GUIA: readonly BloqueDeGuia[] = [
  // Participante. Los dos exigen los mismos permisos de venta, asi que se ven
  // juntos o no se ve ninguno, y estan separados a proposito: formarse y pagar
  // son dos momentos distintos, con plazos distintos, y el segundo es el que
  // tiene reloj.
  { id: "comprar", accion: "solicitud:crear", href: "/convocatorias" },
  { id: "pagar", accion: "comprobante:subir", href: "/mis-solicitudes" },

  // Administracion. `vehiculo:crear` y no `vehiculo:ver-catalogo`: quien
  // administra convocatorias ve el catalogo de vehiculos —lo necesita para
  // armar una— pero no da de alta ninguno, asi que no tiene por que leer como.
  { id: "vehiculos", accion: "vehiculo:crear", href: "/admin/vehiculos" },
  {
    id: "publicar",
    accion: "convocatoria:publicar",
    href: "/admin/convocatorias",
  },
  { id: "dictaminar", accion: "convocatoria:aprobar", href: "/aprobaciones" },

  // Adjudicacion manual (R-23) y tesoreria.
  { id: "adjudicar", accion: "adjudicacion:adjudicar", href: "/adjudicacion" },
  {
    id: "verificarPagos",
    accion: "pago:avalar",
    href: "/tesoreria/verificacion",
  },

  // Auditoria. Es la unica cuya accion es un `ver-*`, y no por descuido:
  // auditar **es** mirar. No hay una operacion que describir por debajo.
  { id: "auditar", accion: "auditoria:ver-bitacora", href: "/auditoria" },
];

/** Los bloques que le tocan a estos permisos, en el orden declarado. */
export const bloquesVisibles = (
  permisos: ReadonlySet<Permiso>,
): readonly BloqueDeGuia[] =>
  BLOQUES_DE_GUIA.filter((bloque) =>
    tieneCapacidad({ accion: bloque.accion, permisos }),
  );
