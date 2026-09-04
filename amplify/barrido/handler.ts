/**
 * Andamio del barrido. La logica llega en la Etapa 10.
 *
 * Se deja funcional y sin efectos a proposito: permite verificar en la Etapa 3 que el
 * horario dispara, que el rol tiene los permisos correctos y que el registro estructurado
 * sale como se espera, sin arriesgar escrituras antes de que existan las transacciones.
 */
export const handler = async (): Promise<void> => {
  const nombreTabla = process.env.AUTOB_TABLE_NAME;

  // Sin fallback silencioso (regla 15): si la variable no llego, el despliegue esta mal y
  // hay que verlo ahora, no cuando el barrido tenga que vencer una adjudicacion real.
  if (!nombreTabla) {
    throw new Error(
      "Falta AUTOB_TABLE_NAME en el entorno de la funcion de barrido.",
    );
  }

  console.info(
    JSON.stringify({
      mensaje: "barrido ejecutado (andamio, sin efectos)",
      tabla: nombreTabla,
      pendiente: [
        "vencimientos T5 (Etapa 10)",
        "despacho de outbox (Etapa 10)",
      ],
    }),
  );
};
