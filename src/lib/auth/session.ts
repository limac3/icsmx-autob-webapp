import "server-only";
import { cache } from "react";
import { registrar } from "@/lib/observabilidad/registro";
import { registrarPerfil } from "@/lib/participantes/registrarPerfil";
import {
  tiposDeConvocatoriaPermitidos,
  type Permiso,
  type Sesion,
} from "@/types/identidad";
import { auth } from "./auth0";
import { obtenerPermisos } from "./eas";
import { leerPersonaSimulada } from "./impersonacion";
import { permisosDePersona } from "./personasSimuladas";

// `participanteId` es el `sub` de Okta, y **se queda asi**. El diseno de la
// Etapa 0 preveia acunar un ULID propio en el upsert; hacerlo hoy partiria en
// dos la historia de cada persona en la bitacora, que es append-only y guarda
// el identificador con el que se escribio cada evento. Ver
// `src/lib/participantes/registrarPerfil.ts`.
const resolverParticipanteId = async (oktaSub: string): Promise<string> =>
  oktaSub;

/**
 * Participantes cuyo perfil ya se escribio en este proceso.
 *
 * El perfil solo cambia cuando Okta cambia un nombre o un correo, asi que
 * escribirlo en cada peticion seria pagar una escritura por pantalla para
 * reponer el mismo dato. Una vez por proceso y por persona lo mantiene fresco
 * —cada despliegue y cada instancia nueva lo repone— sin convertir la lectura
 * de sesion en una escritura constante.
 *
 * Solo se marca **despues** de escribir con exito: un fallo pasajero se
 * reintenta en la siguiente peticion.
 */
const perfilesEscritos = new Set<string>();

/**
 * Deja el nombre y el correo alcanzables para el auditor, sin poder romper la
 * peticion que los trajo.
 *
 * De mejor esfuerzo, e igual que `liberarReserva` o `incrementarIntento`: si
 * falla, se registra y la pantalla sigue. No contradice la regla 15 —nada de
 * negocio depende de este item— y lo contrario si seria grave: que no se pueda
 * escribir una etiqueta de auditoria no es razon para negarle el catalogo a un
 * participante.
 */
const asegurarPerfil = async (sesion: Sesion): Promise<void> => {
  if (perfilesEscritos.has(sesion.participanteId)) return;

  try {
    const resultado = await registrarPerfil({
      participanteId: sesion.participanteId,
      oktaSub: sesion.oktaSub,
      nombre: sesion.nombre,
      correo: sesion.correo,
    });
    if (resultado.ok) perfilesEscritos.add(sesion.participanteId);
  } catch (error) {
    // Sin identidad en la linea: `registro.ts` redacta nombre y correo, y el
    // participanteId no aporta nada para diagnosticar una escritura fallida.
    registrar("warn", "registrarPerfil", {
      causa: error instanceof Error ? error.name : "desconocida",
    });
  }
};

// Memoizado por peticion con `cache()` de React: una pagina que llama a
// getSession() desde el layout y desde tres componentes consulta EAS **una
// sola vez** (identidad-autorizacion.md 4.3). El cache dura lo que la
// peticion y nada mas: un permiso revocado surte efecto en la siguiente
// navegacion, sin esperar una expiracion.
const permisosDeLaPeticion = cache(
  async (oktaSub: string): Promise<Set<Permiso>> => obtenerPermisos(oktaSub),
);

/**
 * Sesion consolidada del participante autenticado, o `null` si no hay
 * sesion de Okta. Nunca lanza por ausencia de sesion; si lanza es porque EAS
 * fallo (sin fallback silencioso, regla 15 de CLAUDE.md) y el error se
 * propaga tal cual a quien llama.
 */
export const getSession = cache(async (): Promise<Sesion | null> => {
  const sesionOkta = await auth.getSession();
  const usuario = sesionOkta?.user;
  if (!usuario?.sub) return null;

  // Impersonacion de desarrollo (`impersonacion.ts`), y **despues** de exigir
  // la sesion de Okta, no antes: sustituye la identidad de negocio y los
  // permisos, jamas la autenticacion. Devuelve `null` sin tocar la peticion en
  // cualquier modo que no sea FULL, asi que en produccion esta rama no existe.
  //
  // `oktaSub` se conserva real a proposito: es el unico dato que sigue
  // respondiendo "quien esta conduciendo esta sesion".
  const persona = await leerPersonaSimulada();
  if (persona) {
    const permisos = permisosDePersona(persona);
    const sesion: Sesion = {
      participanteId: persona.participanteId,
      oktaSub: usuario.sub,
      correo: persona.correo,
      nombre: persona.nombre,
      permisos,
      tiposDeConvocatoriaPermitidos: tiposDeConvocatoriaPermitidos(permisos),
    };
    // Tambien para las personas simuladas: sin esto, la bitacora de un
    // recorrido de desarrollo queda llena de identificadores del roster que
    // nadie reconoce, y la pantalla de auditoria no se podria probar.
    await asegurarPerfil(sesion);
    return sesion;
  }

  const [participanteId, permisos] = await Promise.all([
    resolverParticipanteId(usuario.sub),
    permisosDeLaPeticion(usuario.sub),
  ]);

  const sesion: Sesion = {
    participanteId,
    oktaSub: usuario.sub,
    correo: usuario.email ?? "",
    nombre: usuario.name ?? usuario.email ?? usuario.sub,
    permisos,
    tiposDeConvocatoriaPermitidos: tiposDeConvocatoriaPermitidos(permisos),
  };
  await asegurarPerfil(sesion);
  return sesion;
});
