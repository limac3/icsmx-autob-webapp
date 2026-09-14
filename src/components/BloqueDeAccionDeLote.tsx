"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Error as AlertaError,
  Info,
  Success,
  Warn,
} from "@churchofjesuschrist/eden-alert";
import { Primary, Secondary } from "@churchofjesuschrist/eden-buttons";
import { Card } from "@churchofjesuschrist/eden-card";
import { DialogModal } from "@churchofjesuschrist/eden-dialog-modal";
import {
  FileInput,
  Form,
  FormField,
} from "@churchofjesuschrist/eden-form-parts";
import { H4 } from "@churchofjesuschrist/eden-headings";
import { Row } from "@churchofjesuschrist/eden-row";
import { Text2 } from "@churchofjesuschrist/eden-text";
import { ToolModal } from "@churchofjesuschrist/eden-tool-modal";
import { cancelarSolicitud, solicitarCompra } from "@/app/actions/fila";
import { subirComprobante } from "@/app/actions/tesoreria";
import CuentaRegresiva from "@/components/CuentaRegresiva";
import type { Diccionario } from "@/dictionaries";
import type { MiLugarDTO } from "@/types/fila";
import type { EstatusLote } from "@/types/lote";
import type { CodigoError } from "@/types/resultado";
import "./BloqueDeAccionDeLote.css";

/**
 * Bloque de accion del detalle de lote — pantalla 3.4.
 *
 * **Toda la pantalla se reduce a una tabla de estados**, y este componente la
 * implementa literalmente: que se muestra depende de la fase de venta, del
 * estatus del lote y —sobre todo— de si quien mira tiene una solicitud viva.
 *
 * **Lo que se ve aqui es cortesia; lo que decide es el servidor.** Ocultar el
 * boton no impide nada: `solicitarCompra` vuelve a comprobar el gating triple,
 * la ventana de venta y R-07 en cada llamada, y la fila la ordena un contador
 * atomico que este archivo no puede tocar.
 *
 * `EN_VERIFICACION` **no lleva cuenta regresiva**, y es un requisito, no un
 * olvido: al subir el comprobante el reloj se detiene (`proyecto.md` 5.4), y
 * dejarlo corriendo haria creer que se puede perder el vehiculo por la demora
 * de tesoreria.
 */

export type FaseDeVentaEnLote =
  | { fase: "SIN_ABRIR"; segundosParaAbrir: number }
  | { fase: "ABIERTA" }
  | { fase: "CERRADA" };

export type BloqueDeAccionDeLoteProps = {
  convocatoriaId: string;
  loteId: string;
  /** `null` si no tiene solicitud viva en este lote. */
  miLugar: MiLugarDTO | null;
  estatusLote: EstatusLote;
  venta: FaseDeVentaEnLote;
  /** `venceEn` ya formateado en hora de negocio, si esta adjudicada. */
  venceEnFormateado?: string;
  /** Segundos que faltan para el vencimiento, calculados por el servidor. */
  segundosParaVencer?: number;
  /**
   * Vista previa administrativa: se ve todo, no se puede pulsar nada.
   *
   * Deshabilitar y **no ocultar** es la misma decision que ya toma la fase
   * `SIN_ABRIR`: un boton que existe y no responde explica de quien es la
   * accion, y esconderlo dejaria la vista previa mostrando una pantalla que
   * nadie va a ver. **No sustituye a ninguna guarda**: quien administra
   * normalmente no tiene el permiso de venta, y si lo tuviera,
   * `solicitarCompra` vuelve a comprobar el gating triple en el servidor.
   */
  soloLectura?: boolean;
  diccionario: Diccionario;
  idioma: string;
};

/** El lote sigue admitiendo fila mientras no se haya resuelto (R-17). */
const ADMITE_FILA: readonly EstatusLote[] = ["EN_OFERTA", "ADJUDICADO"];

const BloqueDeAccionDeLote = ({
  convocatoriaId,
  loteId,
  miLugar,
  estatusLote,
  venta,
  venceEnFormateado,
  segundosParaVencer,
  soloLectura = false,
  diccionario,
  idioma,
}: BloqueDeAccionDeLoteProps) => {
  const router = useRouter();
  const [enProceso, iniciar] = useTransition();
  const [error, setError] = useState<CodigoError | undefined>(undefined);
  const [confirmando, setConfirmando] = useState(false);
  const [subiendoComprobante, setSubiendoComprobante] = useState(false);
  const formIdComprobante = useId();
  const etiquetas = diccionario.fila;

  const ejecutar = (accion: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(undefined);
    iniciar(async () => {
      const resultado = await accion();
      if (!resultado.ok) {
        setError(resultado.error as CodigoError);
        return;
      }
      // Se relee del servidor en vez de componer el nuevo estado aqui: el lugar
      // en la fila y la adjudicacion los decide DynamoDB, y adivinarlos en el
      // cliente mostraria un lugar que quiza no es el que se obtuvo.
      router.refresh();
    });
  };

  const solicitar = () => {
    ejecutar(() => solicitarCompra({ convocatoriaId, loteId }));
  };

  const cancelar = () => {
    setConfirmando(false);
    ejecutar(() => cancelarSolicitud({ convocatoriaId, loteId }));
  };

  /**
   * Subir el comprobante — pantalla 3.6. El archivo no se valida mas que por
   * cortesia en el cliente (`accept`); la validacion real de tipo y tamano
   * ocurre en el servidor (`api-contracts.md` seccion 5).
   */
  const subirArchivo = (formData: FormData) => {
    const archivo = formData.get("archivo");
    if (!(archivo instanceof File) || archivo.size === 0 || !miLugar) return;

    ejecutar(async () => {
      const resultado = await subirComprobante({
        solicitudId: miLugar.solicitudId,
        archivo,
      });
      if (resultado.ok) setSubiendoComprobante(false);
      return resultado;
    });
  };

  const lugar = miLugar ? (
    <Text2 renderAs="p" className="bloque-lote__lugar">
      {`${etiquetas.tuLugar}: ${String(miLugar.miPosicion)} ${etiquetas.deTotal} ${String(miLugar.tamanoFila)} · ${etiquetas.tuTurno} ${String(miLugar.miTurno)}`}
    </Text2>
  ) : null;

  const botonCancelar = (
    <Secondary
      type="button"
      disabled={enProceso || soloLectura}
      onClick={() => {
        setConfirmando(true);
      }}
    >
      {enProceso ? etiquetas.cancelando : etiquetas.cancelar}
    </Secondary>
  );

  return (
    <Card renderAs="section" className="bloque-lote">
      <H4 renderAs="h2">{etiquetas.titulo}</H4>

      {soloLectura ? (
        <Info>
          <Text2 renderAs="p">{etiquetas.vistaPreviaSinAccion}</Text2>
        </Info>
      ) : null}

      {error ? (
        <AlertaError>
          <Text2 renderAs="p">{diccionario.errores[error]}</Text2>
        </AlertaError>
      ) : null}

      {miLugar === null ? (
        <SinSolicitud
          venta={venta}
          estatusLote={estatusLote}
          enProceso={enProceso}
          soloLectura={soloLectura}
          etiquetas={etiquetas}
          idioma={idioma}
          onSolicitar={solicitar}
        />
      ) : null}

      {miLugar?.estatus === "EN_FILA" ? (
        <>
          {lugar}
          {botonCancelar}
        </>
      ) : null}

      {miLugar?.estatus === "CONGELADA" ? (
        <>
          {lugar}
          <Info>
            <Text2 renderAs="p">{etiquetas.congelada}</Text2>
          </Info>
          {botonCancelar}
        </>
      ) : null}

      {miLugar?.estatus === "ADJUDICADA" ? (
        <>
          <Success>
            <Text2 renderAs="p">{etiquetas.adjudicada}</Text2>
          </Success>
          {venceEnFormateado ? (
            <Text2 renderAs="p">
              {`${etiquetas.plazoParaPagar} — ${etiquetas.venceEl} ${venceEnFormateado}`}
            </Text2>
          ) : null}
          {segundosParaVencer === undefined ? null : (
            <Text2 renderAs="p">
              {`${etiquetas.restante}: `}
              <CuentaRegresiva
                segundosIniciales={segundosParaVencer}
                idioma={idioma}
              />
            </Text2>
          )}
          <Primary
            type="button"
            disabled={enProceso || soloLectura}
            onClick={() => {
              setSubiendoComprobante(true);
            }}
          >
            {etiquetas.subirComprobante}
          </Primary>
          {botonCancelar}
        </>
      ) : null}

      {/* El reloj ya esta detenido (proyecto.md 5.4): sin cuenta regresiva,
          para no sugerir que la demora de tesoreria puede costar el vehiculo. */}
      {miLugar?.estatus === "EN_VERIFICACION" ? (
        <Info>
          <Text2 renderAs="p">{etiquetas.enVerificacion}</Text2>
        </Info>
      ) : null}

      {miLugar?.estatus === "VENDIDA" ? (
        <Success>
          <Text2 renderAs="p">{etiquetas.comprada}</Text2>
        </Success>
      ) : null}

      {miLugar?.estatus === "CANCELADA_POR_VENCIMIENTO" ? (
        <Warn>
          <Text2 renderAs="p">{etiquetas.canceladaPorVencimiento}</Text2>
          {venceEnFormateado ? (
            <Text2 renderAs="p">{`${etiquetas.venceEl} ${venceEnFormateado}`}</Text2>
          ) : null}
        </Warn>
      ) : null}

      {miLugar?.estatus === "RECHAZADA_POR_TESORERIA" ? (
        <AlertaError>
          <Text2 renderAs="p">{etiquetas.rechazadaPorTesoreria}</Text2>
          {miLugar.motivoRechazo ? (
            <Text2 renderAs="p">{miLugar.motivoRechazo}</Text2>
          ) : null}
        </AlertaError>
      ) : null}

      {miLugar?.estatus === "NO_ADJUDICADA" ? (
        <Text2 renderAs="p">{etiquetas.noAdjudicada}</Text2>
      ) : null}

      <ToolModal
        open={subiendoComprobante}
        onClose={() => {
          setSubiendoComprobante(false);
        }}
        header={etiquetas.subirComprobante}
        closeLabel={etiquetas.volver}
        footer={
          <Row gapSize="8">
            <Primary
              form={formIdComprobante}
              type="submit"
              disabled={enProceso}
            >
              {enProceso
                ? etiquetas.subiendoComprobante
                : etiquetas.enviarComprobante}
            </Primary>
            <Secondary
              type="button"
              onClick={() => {
                setSubiendoComprobante(false);
              }}
            >
              {etiquetas.volver}
            </Secondary>
          </Row>
        }
      >
        <Form id={formIdComprobante} action={subirArchivo}>
          <FormField
            label={etiquetas.campoComprobante}
            description={etiquetas.formatosComprobante}
          >
            <FileInput
              name="archivo"
              accept="image/jpeg,image/png,application/pdf"
              isDroppable
              required
            />
          </FormField>
          <Info>
            <Text2 renderAs="p">{etiquetas.avisoRevisionComprobante}</Text2>
          </Info>
        </Form>
      </ToolModal>

      <DialogModal
        open={confirmando}
        header={etiquetas.cancelar}
        onClose={() => {
          setConfirmando(false);
        }}
        closeLabel={etiquetas.volver}
      >
        <Text2 renderAs="p">
          {miLugar?.estatus === "ADJUDICADA"
            ? etiquetas.confirmarCancelacionAdjudicada
            : etiquetas.confirmarCancelacion}
        </Text2>
        <div className="bloque-lote__acciones">
          <Secondary type="button" onClick={cancelar} disabled={enProceso}>
            {etiquetas.continuar}
          </Secondary>
          <Primary
            type="button"
            onClick={() => {
              setConfirmando(false);
            }}
          >
            {etiquetas.volver}
          </Primary>
        </div>
      </DialogModal>
    </Card>
  );
};

/**
 * Lo que ve quien no esta en la fila. Es el unico caso con boton de accion, y
 * el boton solo aparece cuando la venta esta abierta **y** el lote todavia
 * admite fila: un lote `ADJUDICADO` si la admite (R-17), uno `VENDIDO` no.
 */
const SinSolicitud = ({
  venta,
  estatusLote,
  enProceso,
  soloLectura,
  etiquetas,
  idioma,
  onSolicitar,
}: {
  venta: FaseDeVentaEnLote;
  estatusLote: EstatusLote;
  enProceso: boolean;
  soloLectura: boolean;
  etiquetas: Diccionario["fila"];
  idioma: string;
  onSolicitar: () => void;
}) => {
  if (!ADMITE_FILA.includes(estatusLote)) {
    return (
      <Warn>
        <Text2 renderAs="p">
          {estatusLote === "VENDIDO"
            ? etiquetas.vendidoAOtro
            : etiquetas.noDisponible}
        </Text2>
      </Warn>
    );
  }

  if (venta.fase === "CERRADA") {
    return <Text2 renderAs="p">{etiquetas.ventaCerrada}</Text2>;
  }

  if (venta.fase === "SIN_ABRIR") {
    return (
      <>
        <Text2 renderAs="p">
          {`${etiquetas.abreEn} `}
          <CuentaRegresiva
            segundosIniciales={venta.segundosParaAbrir}
            idioma={idioma}
          />
        </Text2>
        {/* Deshabilitado y no oculto: que exista y no se pueda pulsar explica
            que la accion llegara, y la cuenta regresiva dice cuando. Al llegar
            a cero, `CuentaRegresiva` revalida contra el servidor — nada se
            habilita con el reloj del navegador (R-04). */}
        <Primary type="button" disabled>
          {etiquetas.solicitar}
        </Primary>
      </>
    );
  }

  return (
    <Primary
      type="button"
      disabled={enProceso || soloLectura}
      onClick={onSolicitar}
    >
      {enProceso ? etiquetas.solicitando : etiquetas.solicitar}
    </Primary>
  );
};

export default BloqueDeAccionDeLote;
