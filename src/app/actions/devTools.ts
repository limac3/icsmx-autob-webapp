"use server";

// Server Action del conmutador de identidad simulada — contrato en
// `api-contracts.md` seccion 7.
//
// **No es una action de negocio y no pasa por `puedeEjecutar`.** No existe
// permiso que la cubra, y no debe existir: elegir con quien se recorre la
// aplicacion es una herramienta de desarrollo, no una capacidad que la
// organizacion conceda en EAS (regla 17). Su compuerta es otra, y son tres
// condiciones que se exigen las tres:
//
//   1. `ENABLE_DEV_TOOLS=FULL` — el unico modo que admite impersonacion.
//   2. `NODE_ENV` distinto de `production` — lo exige `exigirModoSeguro()`.
//   3. Una sesion real de Okta — la impersonacion sustituye permisos e
//      identidad, nunca la autenticacion (`identidad-autorizacion.md` 4.1).
//
// Lanza si algo de eso no se cumple, en vez de no hacer nada: un conmutador que
// falla en silencio manda a depurar la pantalla equivocada.

import { updateTag } from "next/cache";

import {
  fijarPersonaSimulada,
  impersonacionHabilitada,
} from "@/lib/auth/impersonacion";
import { getSession } from "@/lib/auth/session";
import { etiqueta } from "@/lib/cache";

/**
 * Cambia la persona simulada de este navegador.
 *
 * Recibe `FormData` porque la barra es un unico formulario con un boton de
 * envio por persona: el `value` del boton pulsado es lo que llega. Sin `value`
 * —el boton "sin simular"— borra la cookie.
 */
export const cambiarPersonaSimulada = async (
  formData: FormData,
): Promise<void> => {
  if (!impersonacionHabilitada()) {
    throw new Error("cambiarPersonaSimulada exige ENABLE_DEV_TOOLS=FULL.");
  }

  const sesion = await getSession();
  if (!sesion) {
    throw new Error(
      "La impersonacion exige una sesion real de Okta; no hay ninguna.",
    );
  }

  const crudo = formData.get("persona");
  const id = typeof crudo === "string" && crudo !== "" ? crudo : null;

  await fijarPersonaSimulada(id);

  // Los tres listados dependen de los permisos de quien mira: el catalogo del
  // participante filtra por tipo de convocatoria, y las bandejas
  // administrativas solo existen para quien administra o aprueba. Sin esto,
  // cambiar de persona podria dejar a la vista el listado del actor anterior.
  updateTag(etiqueta.convocatoriasVisibles);
  updateTag(etiqueta.catalogoConvocatorias);
  updateTag(etiqueta.catalogoVehiculos);
};
