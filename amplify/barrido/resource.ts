import { defineFunction } from "@aws-amplify/backend";

/**
 * Barrido de vencimientos y despacho del outbox (`arquitectura-tecnica-aws.md`, 2.6).
 *
 * Cada 5 minutos hace dos cosas: aplicar T5 a las adjudicaciones vencidas (GSI4
 * `VENCE#<dia>`) y enviar los correos pendientes (GSI4 `OUTBOX_PENDIENTE`).
 *
 * **Andamio.** La logica se implementa en la Etapa 10; aqui solo existe la infraestructura
 * para que el rol, el horario y los permisos esten en su sitio y probados antes.
 */
export const barrido = defineFunction({
  name: "barrido",
  entry: "./handler.ts",
  schedule: "every 5m",
  // El barrido recorre lotes vencidos uno por uno con transacciones condicionales; 5
  // minutos de holgura evitan que un lote grande lo corte a la mitad. Es idempotente, asi
  // que un corte no rompe nada, pero reintentarlo entero cuesta.
  timeoutSeconds: 300,
  memoryMB: 512,
  logging: { format: "json", level: "info" },
});
