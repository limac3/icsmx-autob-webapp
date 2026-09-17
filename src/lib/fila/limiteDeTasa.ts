import "server-only";

// Limitacion de tasa por participante — Etapa 16, riesgos R25 y R26.
//
// **Que acota, y que no puede acotar.** La medicion de la apertura
// (`equidadDeApertura.integracion.test.ts`) dejo el reparto sin ambiguedad: un
// cliente que dispara en el milisegundo exacto de `inicioVenta` obtiene el
// turno 1 y ninguna persona que reacciona en 200-400 ms queda nunca por
// delante — cero excepciones en 5 lotes y 100 pares comparados. Contra ese
// cliente **este modulo no puede nada**: le basta un disparo, y ningun umbral
// de tasa limita al que solo necesita uno.
//
// Lo que si acota es el otro perfil, que resulto ser el interesante: el que
// **no sabe la hora** y cubre el instante a base de intentos en paralelo. Ese
// llego a 12-15 ms de la apertura —practicamente lo mismo que el reloj exacto—
// sosteniendo 17 intentos por segundo contra la ventana cerrada, y de paso
// quemo 32 turnos que nadie ocupo. Acotarlo no le quita la ventaja al primero;
// le quita la ventaja al que la conseguia sin merecerla, y detiene el desgaste
// que produce.
//
// **La aplicacion registra, las personas deciden** (regla 17). Aqui no se
// sanciona a nadie ni se cancela ninguna participacion: se rechaza un intento
// concreto con un codigo reintentable y queda constancia. Quien tenga que
// decidir si eso fue trampa lo decidira con la evidencia delante.

import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { clave } from "@/lib/data/claves";
import { nombreDeTabla } from "@/lib/data/cliente";
import { clienteDe, resolver, type DepsDeServicio } from "@/lib/data/deps";

/**
 * Duracion de la ventana.
 *
 * Diez segundos, que es el orden de magnitud del instante que se protege: la
 * apertura se decide en el primer segundo y el bucle medido se prepara en el
 * anterior. Una ventana mas larga castigaria a quien reintenta con razon mucho
 * despues; una mas corta daria al que dispara en rafaga tantas oportunidades
 * como ventanas quiera esperar.
 */
export const VENTANA_DE_TASA_MS = 10_000;

/**
 * Intentos por ventana y por convocatoria. **Calibrado, no supuesto.**
 *
 * Los tres numeros que lo fijan, todos medidos:
 *
 *   - **Lo que hace una persona: uno.** La interfaz deshabilita el boton antes
 *     de la apertura y mientras hay una peticion en vuelo
 *     (`BloqueDeAccionDeLote.tsx`), asi que por la pantalla no se puede emitir
 *     mas de un intento por viaje de red, y cada uno pasa por un modal de
 *     confirmacion. El techo legitimo de exitos lo pone ademas R-22:
 *     `limiteSolicitudes`, **tres** por convocatoria en el valor por omision
 *     del formulario. Diez deja mas del triple de holgura para cancelar y
 *     volver a formarse, y para los reintentos de `conflicto_concurrencia`.
 *   - **Lo que hace un bucle secuencial: cinco por segundo**, o cincuenta por
 *     ventana. No es su intencion sino su limite fisico — espera cada
 *     respuesta, asi que la latencia le fija la tasa. Queda cortado al 20 %.
 *   - **Lo que hace una rafaga en paralelo: diecisiete por segundo**, ciento
 *     setenta por ventana. Queda cortada al 6 %.
 *
 * El umbral vive **entre** el maximo legitimo y el minimo automatizado, con un
 * orden de magnitud de separacion a cada lado. Ese hueco es lo que permite
 * apretarlo sin tocar a nadie: lo que un umbral asi compra no es equidad —esa
 * la perdio el sistema en el primer milisegundo— sino cota de desgaste y una
 * senal limpia para quien audita.
 */
export const INTENTOS_POR_VENTANA = 10;

/**
 * Instante en que empieza la ventana que contiene a `ahora`.
 *
 * Ventana **fija** y no deslizante, y la holgura que eso concede esta medida y
 * aceptada: quien alinee su rafaga al borde puede juntar dos ventanas y sacar
 * veinte intentos en unos milisegundos. Una ventana deslizante costaria leer
 * el historial antes de decidir —un viaje mas en el camino que R26 senala como
 * el mas caro— para quitarle a un adversario competente un factor de dos que
 * no le cambia el resultado: con diez intentos o con veinte, el que sabe la
 * hora ya iba a ganar con uno.
 */
export const ventanaDe = (ahora: Date): number =>
  Math.floor(ahora.getTime() / VENTANA_DE_TASA_MS) * VENTANA_DE_TASA_MS;

export type VeredictoDeTasa = {
  /** `false` si este intento excedio el umbral. */
  permitido: boolean;
  /** El n-esimo intento del participante dentro de la ventana. */
  intentos: number;
  /** Inicio de la ventana, epoch en milisegundos. */
  ventana: number;
};

/**
 * Cuenta este intento y dice si se admite.
 *
 * **Cuenta siempre, tambien cuando deniega.** Un limitador que dejara de
 * contar al pasarse premiaria al que insiste: bastaria seguir disparando para
 * que la ventana pareciera vacia. Contar el intento denegado es lo que hace
 * que la evidencia diga cuanto se insistio, no solo que se insistio.
 *
 * **Una sola escritura, sin condicion y sin lectura previa.** Mismo patron que
 * `pedirTurno` y `pedirOrdenEnConvocatoria`: el `ADD` es atomico y
 * `UPDATED_NEW` devuelve el valor nuevo, asi que el veredicto sale de la
 * escritura y no de un "leer y despues decidir" que seria una carrera
 * (regla 6). El item no participa en ninguna transaccion, asi que no puede
 * cancelar ninguna.
 *
 * **Va antes de todo lo demas**, y esa fue la unica decision de diseno que la
 * medicion resolvio sola. El perfil que hay que acotar es rechazado **antes de
 * la apertura**, y ese rechazo lo dicta la guarda de `solicitud:crear`: no
 * llega al motor de fila. Un contador montado dentro de `solicitarCompra`
 * —sobre el item de cupo, que era la opcion barata— no habria visto ni uno de
 * los 85 intentos anticipados que la rafaga hizo en la medicion. El viaje
 * adicional se paga, y se paga al principio.
 */
export const registrarIntento = async (
  entrada: { participanteId: string; convocatoriaId: string },
  deps: DepsDeServicio = {},
): Promise<VeredictoDeTasa> => {
  const { ahora } = resolver(deps);
  const ventana = ventanaDe(ahora);

  const salida = await clienteDe(deps).send(
    new UpdateCommand({
      TableName: nombreDeTabla(),
      Key: clave.tasaDeParticipante(
        entrada.participanteId,
        entrada.convocatoriaId,
        ventana,
      ),
      // `convocatoriaId` y `ventanaIniciadaEn` no los necesita el mecanismo:
      // los dos estan en la clave. Se escriben para que quien audite pueda leer
      // el item suelto y entenderlo sin descomponer una `SK`.
      UpdateExpression:
        "SET convocatoriaId = :convocatoria, ventanaIniciadaEn = :inicio" +
        " ADD intentos :uno",
      ExpressionAttributeValues: {
        ":convocatoria": entrada.convocatoriaId,
        ":inicio": new Date(ventana).toISOString(),
        ":uno": 1,
      },
      ReturnValues: "UPDATED_NEW",
    }),
  );

  const intentos = salida.Attributes?.intentos;
  if (typeof intentos !== "number") {
    // Mismo criterio que el turno y que el ordinal: `UPDATED_NEW` sobre un
    // `ADD` siempre devuelve el contador. Seguir sin el significaria dejar
    // pasar el intento sin haberlo contado, que es justo la clase de fallo
    // silencioso que prohibe la regla 15.
    throw new Error(
      `El contador de tasa no devolvio los intentos de ${entrada.participanteId}` +
        ` en ${entrada.convocatoriaId}`,
    );
  }

  return {
    permitido: intentos <= INTENTOS_POR_VENTANA,
    intentos,
    ventana,
  };
};
