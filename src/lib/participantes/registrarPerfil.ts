import "server-only";

// Perfil de contacto del participante — la mitad del *upsert* que la Etapa 2
// dejo pendiente (`desafios-implementacion.md` 8 y 31).
//
// **Solo la mitad, y a proposito.** Aquel diseno preveia que el *upsert*
// tambien acunara un `participanteId` propio, un ULID distinto del `sub` de
// Okta. Eso ya no se puede hacer: `actorId` de cada evento de la bitacora
// guarda el identificador vigente cuando se escribio, y la bitacora es
// append-only. Cambiar la identidad ahora partiria en dos la historia de cada
// persona —lo anterior con su `sub`, lo nuevo con su ULID— y sin forma de
// unirlas. Asi que `participanteId` sigue siendo el `sub` y lo unico que este
// modulo agrega es el nombre y el correo.

import { PutCommand } from "@aws-sdk/lib-dynamodb";

import { clave, gsi1 } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, resolver, type DepsDeServicio } from "@/lib/data/deps";
import { aIso } from "@/lib/domain/fechas";
import type { PerfilDeParticipante } from "@/types/participante";
import { exito, type Resultado } from "@/types/resultado";

export type EntradaDePerfil = {
  participanteId: string;
  /** Se conserva para PA-01 aunque hoy coincida con `participanteId`. */
  oktaSub: string;
  nombre: string;
  correo: string;
};

/**
 * Escribe el perfil sin condicion: el ultimo acceso gana.
 *
 * **No lleva evento de auditoria.** La regla 4 ata el evento a las mutaciones
 * de una solicitud de compra; refrescar un nombre no es un acto de negocio, y
 * un evento por acceso ahogaria la bitacora en ruido que nadie va a auditar
 * — justo lo contrario de lo que este perfil viene a resolver.
 *
 * Tampoco es un item `AUDIT#`, asi que sobrescribirlo no choca con la regla 5:
 * el `Deny` de IAM cubre esa particion y ninguna otra.
 */
export const registrarPerfil = async (
  entrada: EntradaDePerfil,
  deps: DepsDeServicio = {},
): Promise<Resultado<PerfilDeParticipante>> => {
  const { ahora } = resolver(deps);
  const perfil: PerfilDeParticipante = {
    participanteId: entrada.participanteId,
    nombre: entrada.nombre,
    correo: entrada.correo,
    actualizadoEn: aIso(ahora),
  };

  await clienteDe(deps).send(
    new PutCommand({
      TableName: nombreDeTabla(),
      Item: {
        ...clave.participante(entrada.participanteId),
        ...gsi1.participantePorOkta(entrada.oktaSub),
        ...perfil,
      },
    }),
  );

  return exito(perfil);
};
