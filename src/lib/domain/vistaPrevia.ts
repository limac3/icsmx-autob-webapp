import type { EstatusConvocatoria } from "@/types/convocatoria";

/**
 * Desde que instante se mira una convocatoria en la vista previa
 * administrativa.
 *
 * **La trampa que esto evita.** `calcularEstadoDeVentaUi` traduce `NO_VISIBLE`
 * a `VENTA_CERRADA` —lo mas conservador que puede mostrar sin inventar un
 * dato—, y su comentario dice que ese caso "no deberia llegar aqui" porque las
 * dos pantallas que la llamaban ya habian pasado el gating triple. La vista
 * previa rompe esa premisa a proposito: es justo la pantalla que mira lo que
 * **todavia no** es visible. Con `ahora` a secas, un borrador aparecia como
 * "venta cerrada", que es falso.
 *
 * Se mira entonces desde `publicadaEn`: **como se vera al publicarse**. El
 * aviso de la pantalla dice desde cuando, para que el dato no se confunda con
 * el presente.
 *
 * Vive aqui y no en cada pagina porque lo usan dos —la convocatoria y el lote—
 * y son dos vistas del mismo momento: si una mirara desde otro instante, la
 * fase de venta del vehiculo contradiria la de su convocatoria.
 */
export type MomentoDeVistaPrevia = {
  /** El instante desde el que se renderiza. */
  momento: Date;
  /** Si hoy la convocatoria no la ve ningun participante. */
  aunNoVisible: boolean;
};

export const momentoDeVistaPrevia = (
  convocatoria: { estatus: EstatusConvocatoria; publicadaEn: Date },
  ahora: Date,
): MomentoDeVistaPrevia => {
  const futura = convocatoria.publicadaEn > ahora;
  return {
    // Solo se adelanta el reloj si la publicacion esta en el futuro. Una
    // convocatoria `OCULTA` con `publicadaEn` pasada se mira en el presente:
    // adelantarse al pasado no significa nada.
    momento: futura ? convocatoria.publicadaEn : ahora,
    aunNoVisible: convocatoria.estatus !== "PUBLICADA" || futura,
  };
};
