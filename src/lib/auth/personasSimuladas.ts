import "server-only";
import type { Permiso } from "@/types/identidad";
import { permisosDeRoles, type Rol } from "./rolesSimulados";

/**
 * **Roster de personas simuladas. Solo desarrollo.**
 *
 * `rolesSimulados.ts` resuelve *que puede* un actor de prueba;
 * este archivo resuelve *quien es*. La distincion no es cosmetica: hay guardas
 * que no dependen de ningun permiso, sino de la identidad, y con una sola
 * identidad de Okta son inalcanzables en local.
 *
 * Dos casos concretos, y son la razon de que este archivo exista:
 *
 * 1. `convocatoria:aprobar` deniega `self_approval` cuando
 *    `creadoPor === participanteId` (`permisos.ts`). Quien crea una
 *    convocatoria **nunca** puede aprobarla, asi que el dictamen no se puede
 *    recorrer sin dos identidades distintas — por muchos permisos que se
 *    simulen.
 * 2. La fila FIFO necesita varios participantes para tener orden. Con uno solo
 *    no hay turno 2, ni congelamiento, ni reasignacion por vencimiento.
 *
 * **La cookie de impersonacion solo lleva el `id`.** Se valida contra este
 * roster y un valor desconocido se ignora (`impersonacion.ts`), asi que la
 * cookie no puede inyectar una identidad ni un permiso arbitrarios: como maximo
 * elige entre estas filas. Es la razon por la que el roster esta cerrado en
 * codigo y no se captura desde la interfaz.
 */
export type PersonaSimulada = {
  /** Lo unico que viaja en la cookie. Estable: las pruebas lo referencian. */
  readonly id: string;
  /**
   * Sustituye al `participanteId` de la sesion, y por lo tanto es lo que queda
   * escrito en las solicitudes y en la bitacora del sandbox. El prefijo `dev-`
   * es deliberado: hace evidente, leyendo un evento, que el actor era
   * simulado. Sin `#`, que es el separador de claves de DynamoDB
   * (`src/lib/data/claves.ts`).
   */
  readonly participanteId: string;
  readonly nombre: string;
  /**
   * Dominio `.invalid`, reservado por el RFC 2606 para nombres que **no pueden
   * existir**. Estos correos llegan a la solicitud y de ahi al outbox de la
   * Etapa 10; con un dominio inexistente, un despacho accidental no puede
   * alcanzar a nadie real.
   */
  readonly correo: string;
  readonly roles: readonly Rol[];
};

export const PERSONAS_SIMULADAS: readonly PersonaSimulada[] = [
  {
    id: "admin",
    participanteId: "dev-admin",
    nombre: "Ana Alcantara",
    correo: "ana.alcantara@autob.invalid",
    roles: ["ADMINISTRADOR"],
  },
  {
    id: "aprobador",
    participanteId: "dev-aprobador",
    nombre: "Beto Berrones",
    correo: "beto.berrones@autob.invalid",
    roles: ["APROBADOR_CONVOCATORIA"],
  },
  {
    id: "empleado-1",
    participanteId: "dev-empleado-1",
    nombre: "Carla Cordero",
    correo: "carla.cordero@autob.invalid",
    roles: ["EMPLEADO"],
  },
  {
    id: "empleado-2",
    participanteId: "dev-empleado-2",
    nombre: "Dario Duarte",
    correo: "dario.duarte@autob.invalid",
    roles: ["EMPLEADO"],
  },
  {
    // Sin `Autob_Venta_a_empleados`: es con quien se comprueba que la tercera
    // pata del gating triple deniega de verdad (R-01).
    id: "publico",
    participanteId: "dev-publico",
    nombre: "Elena Estrada",
    correo: "elena.estrada@autob.invalid",
    roles: ["OTRO_USUARIO"],
  },
  {
    id: "tesoreria",
    participanteId: "dev-tesoreria",
    nombre: "Fabio Fuentes",
    correo: "fabio.fuentes@autob.invalid",
    roles: ["OPERADOR_TESORERIA"],
  },
  {
    id: "auditor",
    participanteId: "dev-auditor",
    nombre: "Gina Gaytan",
    correo: "gina.gaytan@autob.invalid",
    roles: ["AUDITOR_CUMPLIMIENTO"],
  },
];

const POR_ID = new Map(
  PERSONAS_SIMULADAS.map((persona) => [persona.id, persona]),
);

/** `undefined` si el id no esta en el roster. Quien llama decide que hacer. */
export const buscarPersonaSimulada = (
  id: string,
): PersonaSimulada | undefined => POR_ID.get(id);

/**
 * Permisos de la persona, traducidos con la misma tabla que usa el simulador
 * de `eas.ts`. Es la traduccion que en produccion hace EAS.
 */
export const permisosDePersona = (persona: PersonaSimulada): Set<Permiso> =>
  permisosDeRoles(persona.roles);
