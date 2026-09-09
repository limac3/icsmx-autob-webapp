import "server-only";

// Resuelve identificadores de participante a nombre y correo, para la bitacora.
//
// Sin este paso la pantalla de auditoria solo puede mostrar `actorId`, que es
// el `sub` de Okta: unico y estable, pero ilegible. El troceado y los
// reintentos viven en `lecturaPorLotes`.

import { clave } from "@/lib/data/claves";
import { leerPorClaves } from "@/lib/data/lecturaPorLotes";
import type { DepsDeServicio } from "@/lib/data/deps";
import type { PerfilDeParticipante } from "@/types/participante";
import { exito, type Resultado } from "@/types/resultado";

const texto = (valor: unknown): string | undefined =>
  typeof valor === "string" && valor.length > 0 ? valor : undefined;

const aPerfil = (
  item: Record<string, unknown>,
): PerfilDeParticipante | undefined => {
  const participanteId = texto(item.participanteId);
  const actualizadoEn = texto(item.actualizadoEn);
  if (!participanteId || !actualizadoEn) return undefined;

  return {
    participanteId,
    // Nombre y correo pueden faltar: los `claims` de Okta son opcionales y
    // `getSession` ya cae al correo o al `sub` cuando no viene el nombre.
    nombre: texto(item.nombre) ?? "",
    correo: texto(item.correo) ?? "",
    actualizadoEn,
  };
};

/**
 * Identificadores que pueden convertirse en clave.
 *
 * `clave.participante` **lanza** ante un identificador vacio o con `#`, y con
 * razon: un `#` desplazaria el resto de la clave. Pero aqui la entrada son
 * `actorId` leidos de la bitacora —incluido el centinela `SISTEMA`—, y un valor
 * mal formado entre cientos no puede tumbar la pantalla del auditor: se
 * descarta y su evento se queda con el identificador a la vista. Es el mismo
 * criterio que `aVehiculo` aplica a un item corrupto.
 */
const utilizables = (participanteIds: readonly string[]): string[] => [
  ...new Set(
    participanteIds.filter((id) => id.length > 0 && !id.includes("#")),
  ),
];

/**
 * Perfiles indexados por `participanteId`. Los que no existen simplemente no
 * estan en el mapa: quien pregunta decide como presentar la ausencia — y la
 * ausencia es normal, porque el perfil se escribe al iniciar sesion y la
 * bitacora tiene eventos anteriores a que eso existiera.
 */
export const leerPerfiles = async (
  participanteIds: readonly string[],
  deps: DepsDeServicio = {},
): Promise<Resultado<ReadonlyMap<string, PerfilDeParticipante>>> => {
  const perfiles = new Map<string, PerfilDeParticipante>();
  const ids = utilizables(participanteIds);
  if (ids.length === 0) return exito(perfiles);

  const items = await leerPorClaves(
    ids.map((id) => clave.participante(id)),
    deps,
  );

  for (const item of items) {
    const perfil = aPerfil(item);
    if (perfil) perfiles.set(perfil.participanteId, perfil);
  }

  return exito(perfiles);
};
