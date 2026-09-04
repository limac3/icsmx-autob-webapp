// Fuente: agent_files/proyecto.md seccion 3 y agent_files/identidad-autorizacion.md.

export const ROLES = [
  "ADMINISTRADOR",
  "APROBADOR_CONVOCATORIA",
  "EMPLEADO",
  "OTRO_USUARIO",
  "OPERADOR_TESORERIA",
  "AUDITOR_CUMPLIMIENTO",
] as const;

export type Rol = (typeof ROLES)[number];

export type TipoParticipante = "EMPLEADO" | "OTRO_USUARIO";

export type Sesion = {
  /** Identificador interno estable. Hasta la Etapa 4 (upsert en DynamoDB) es
   * el propio `oktaSub` — ver la nota en src/lib/auth/session.ts. */
  participanteId: string;
  oktaSub: string;
  correo: string;
  nombre: string;
  roles: Rol[];
  tipoParticipante: TipoParticipante;
};
