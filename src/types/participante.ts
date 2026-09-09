// Fuente: modelo-datos-dynamodb.md seccion 2, entidad Participante
// (`PART#<participanteId>` / `PERFIL`).

/**
 * Datos de contacto de un participante, tal como los deja su ultimo acceso.
 *
 * **Existe para que la bitacora se pueda leer.** Todo evento guarda `actorId`
 * y nada mas (`types/auditoria.ts`), asi que sin este item el auditor solo ve
 * identificadores opacos y no puede buscar la actividad de una persona
 * concreta. No participa en ninguna decision de autorizacion: los permisos los
 * responde EAS en cada peticion (regla 17), nunca este perfil.
 *
 * `actualizadoEn` no es historia: el perfil se sobrescribe en cada acceso y
 * conserva un solo estado, el ultimo. Lo que necesita conservar el dato **del
 * momento** —el correo con el que se pago, los permisos con los que se actuo—
 * ya se copia al item que lo necesita (`correoTitular` en la solicitud,
 * `actorPermisos` en el evento).
 */
export type PerfilDeParticipante = {
  participanteId: string;
  nombre: string;
  correo: string;
  /** ISO-8601 UTC del ultimo acceso que actualizo el perfil. */
  actualizadoEn: string;
};
