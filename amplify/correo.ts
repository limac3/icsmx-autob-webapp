import { CfnTemplate, EmailIdentity, Identity } from "aws-cdk-lib/aws-ses";
import { Construct } from "constructs";

/** Nombre de la plantilla de adjudicacion, referenciado por el procesador del outbox. */
export const PLANTILLA_ADJUDICACION = "autob-adjudicacion";

/**
 * Correo transaccional. Se consume **solo desde el procesador del outbox**, nunca desde el
 * flujo de adjudicacion (D-6): un fallo de SES no puede tumbar una transaccion critica.
 */
export class CorreoAutob extends Construct {
  readonly identidad: EmailIdentity;

  constructor(
    scope: Construct,
    id: string,
    opciones: { readonly identidad: string },
  ) {
    super(scope, id);

    // Un correo concreto se verifica solo (llega un mensaje de confirmacion) y sirve para un
    // sandbox personal; un dominio habilita DKIM y es lo que corresponde en entornos
    // compartidos. La forma del valor decide cual es, sin una segunda variable.
    const esCorreo = opciones.identidad.includes("@");

    this.identidad = new EmailIdentity(this, "Identidad", {
      identity: esCorreo
        ? Identity.email(opciones.identidad)
        : Identity.domain(opciones.identidad),
      // DKIM viene activo por omision en identidades de dominio.
    });

    new CfnTemplate(this, "PlantillaAdjudicacion", {
      template: {
        templateName: PLANTILLA_ADJUDICACION,
        subjectPart: "Te fue adjudicado un vehiculo: {{vehiculo}}",
        textPart: [
          "Hola {{nombre}}:",
          "",
          "Te fue adjudicado el vehiculo {{vehiculo}} de la convocatoria {{convocatoria}}.",
          "",
          "Precio: {{precio}}",
          "Tienes hasta el {{venceEn}} para completar el pago y registrar tu comprobante.",
          "Si el plazo vence, la adjudicacion pasa automaticamente al siguiente en la fila.",
          "",
          "Registra tu comprobante aqui: {{urlSolicitud}}",
        ].join("\n"),
        htmlPart: [
          "<p>Hola {{nombre}}:</p>",
          "<p>Te fue adjudicado el vehiculo <strong>{{vehiculo}}</strong> de la convocatoria {{convocatoria}}.</p>",
          "<p>Precio: <strong>{{precio}}</strong><br>",
          "Tienes hasta el <strong>{{venceEn}}</strong> para completar el pago y registrar tu comprobante.</p>",
          "<p>Si el plazo vence, la adjudicacion pasa automaticamente al siguiente en la fila.</p>",
          '<p><a href="{{urlSolicitud}}">Registrar mi comprobante</a></p>',
        ].join("\n"),
      },
    });
  }
}
