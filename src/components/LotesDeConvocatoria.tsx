"use client";

import { useActionState, useState } from "react";
import { Error as AlertaError, Success } from "@churchofjesuschrist/eden-alert";
import { Badge } from "@churchofjesuschrist/eden-badge";
import { Danger, Primary, Secondary } from "@churchofjesuschrist/eden-buttons";
import { Card } from "@churchofjesuschrist/eden-card";
import { DialogModal } from "@churchofjesuschrist/eden-dialog-modal";
import {
  Form,
  FormField,
  Input,
  Select,
  TextArea,
} from "@churchofjesuschrist/eden-form-parts";
import { H4 } from "@churchofjesuschrist/eden-headings";
import {
  CardView,
  Col,
  ColGroup,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@churchofjesuschrist/eden-table";
import { Text2, Text4 } from "@churchofjesuschrist/eden-text";
import {
  incluirVehiculoDesdeFormulario,
  retirarLoteDesdeFormulario,
} from "@/app/actions/convocatorias";
import type { Diccionario, Idioma } from "@/dictionaries";
import { PRECIO_MAXIMO_LOTE } from "@/lib/domain/convocatorias";
import { formatearPrecio } from "@/lib/domain/dinero";
import {
  ESTADO_LOTE_INICIAL,
  type EstadoFormularioLote,
} from "@/types/formularioLote";
import type { EstatusLote } from "@/types/lote";
import "./LotesDeConvocatoria.css";

/**
 * Los vehiculos incluidos en la convocatoria y el alta de uno nuevo — parte de
 * la pantalla 4.4.
 *
 * **Un lote es un vehiculo dentro de esta convocatoria concreta**, con su precio
 * y —desde la Etapa 8— su propia fila. Por eso el precio se muestra junto al
 * vehiculo y no en la ficha del vehiculo: el mismo coche puede reofertarse mas
 * adelante a otro precio sin arrastrar el anterior.
 *
 * **Retirar no borra**: el lote pasa a `RETIRADO` y se queda a la vista. Un lote
 * desaparecido dejaria al auditor sin rastro de que ese vehiculo llego a estar
 * incluido y a que precio.
 *
 * Componente cliente por dos motivos independientes: el dialogo del retiro
 * necesita estado, y `Table` compara la identidad de `ColGroup` y `THead` para
 * armar las etiquetas de la vista movil —identidad que no sobrevive la frontera
 * de RSC (desafios-implementacion.md 23)—. Los dos formularios van con
 * `useActionState` sobre `FormData`, asi que siguen enviando sin JavaScript.
 */

const COLOR_POR_ESTATUS: Record<
  EstatusLote,
  "success" | "info" | "warn" | "greySoft" | "default"
> = {
  EN_OFERTA: "success",
  ADJUDICADO: "warn",
  VENDIDO: "info",
  NO_VENDIDO: "default",
  RETIRADO: "greySoft",
};

/** Un lote con lo que la pantalla necesita, ya resuelto en el servidor. */
export type LoteEnPantalla = {
  loteId: string;
  vehiculoId: string;
  /** Marca, version y modelo, armados en el servidor. */
  vehiculo: string;
  precio: number;
  estatus: EstatusLote;
  /**
   * `false` si alguien ya se formo por este lote. La guarda del servidor manda;
   * esto solo evita ofrecer un boton que responderia `invalid_state`.
   */
  puedeRetirarse: boolean;
  motivoRetiro?: string;
};

export type VehiculoDisponible = {
  vehiculoId: string;
  etiqueta: string;
};

export type LotesDeConvocatoriaProps = {
  convocatoriaId: string;
  lotes: readonly LoteEnPantalla[];
  /** Vehiculos `DISPONIBLE`. Vacio cuando la convocatoria no es editable. */
  disponibles: readonly VehiculoDisponible[];
  /** Solo en `BORRADOR` y con permiso de administracion. */
  editable: boolean;
  diccionario: Diccionario;
  idioma: Idioma;
};

const LotesDeConvocatoria = ({
  convocatoriaId,
  lotes,
  disponibles,
  editable,
  diccionario,
  idioma,
}: LotesDeConvocatoriaProps) => {
  const [estadoInclusion, enviarInclusion, incluyendo] = useActionState<
    EstadoFormularioLote,
    FormData
  >(incluirVehiculoDesdeFormulario, ESTADO_LOTE_INICIAL);

  const [estadoRetiro, enviarRetiro, retirando] = useActionState<
    EstadoFormularioLote,
    FormData
  >(retirarLoteDesdeFormulario, ESTADO_LOTE_INICIAL);

  // Lote a la espera del motivo. `undefined` = el dialogo esta cerrado.
  const [porRetirar, setPorRetirar] = useState<LoteEnPantalla | undefined>(
    undefined,
  );

  /**
   * Si el dialogo esta abierto. **Se deduce, no se guarda.**
   *
   * Se cierra al terminar y no al pulsar: mientras el servidor responde, un
   * dialogo ya cerrado dejaria la pantalla sin decir que esta pasando, y si el
   * retiro falla no habria donde mostrar el motivo. La tentacion es cerrarlo
   * desde un efecto al ver el exito, pero eso es un `setState` en cascada — y
   * ademas cerraria el dialogo que se acaba de abrir para **otro** lote,
   * porque el estado de exito sigue ahi. Comparar el lote retirado con el que
   * el dialogo tiene en la mano resuelve las dos cosas.
   */
  const abierto =
    porRetirar !== undefined &&
    !(
      estadoRetiro.estado === "retirado" &&
      estadoRetiro.loteId === porRetirar.loteId
    );

  const etiquetas = diccionario.convocatorias;
  const validacion = diccionario.validacionConvocatoria;

  /**
   * Traduce el fallo de cualquiera de las dos operaciones.
   *
   * El caso que justifica el detalle es `en_otra_convocatoria`: el servidor lo
   * distingue por la posicion del item que cancelo la transaccion, y sin el
   * quien captura recibiria el mismo `invalid_state` que produce una
   * convocatoria que dejo de ser editable — dos causas que se corrigen distinto.
   */
  const mensajeDeError = (estado: EstadoFormularioLote): string | undefined => {
    if (estado.estado !== "error") return undefined;

    if (estado.detalles?.vehiculo === "en_otra_convocatoria") {
      return etiquetas.enOtraConvocatoria;
    }

    const porCampo = estado.detalles?.precio ?? estado.detalles?.motivo;
    if (porCampo) {
      return validacion[porCampo as keyof typeof validacion] ?? porCampo;
    }

    return diccionario.errores[estado.error];
  };

  const errorDeInclusion = mensajeDeError(estadoInclusion);
  const errorDeRetiro = mensajeDeError(estadoRetiro);

  return (
    <Card renderAs="section" className="lotes">
      <H4 renderAs="h2">{etiquetas.seccionLotes}</H4>

      {errorDeInclusion ? (
        <AlertaError>
          <Text2 renderAs="p">{errorDeInclusion}</Text2>
        </AlertaError>
      ) : null}

      {estadoInclusion.estado === "incluido" ? (
        <Success>
          <Text2 renderAs="p">{etiquetas.incluido}</Text2>
        </Success>
      ) : null}

      {estadoRetiro.estado === "retirado" ? (
        <Success>
          <Text2 renderAs="p">{etiquetas.retiradoDeConvocatoria}</Text2>
        </Success>
      ) : null}

      {lotes.length === 0 ? (
        <Text2 renderAs="p">{etiquetas.sinLotes}</Text2>
      ) : (
        <CardView>
          <Table className="lotes__tabla">
            <ColGroup>
              <Col id="col-lote-vehiculo" />
              <Col id="col-lote-precio" />
              <Col id="col-lote-estatus" />
              <Col id="col-lote-acciones" />
            </ColGroup>
            <THead>
              <TR>
                <TH scope="col">{etiquetas.columnaVehiculo}</TH>
                <TH scope="col">{etiquetas.columnaPrecio}</TH>
                <TH scope="col">{etiquetas.columnaEstatus}</TH>
                <TH scope="col">{etiquetas.columnaAcciones}</TH>
              </TR>
            </THead>
            <TBody>
              {lotes.map((lote) => (
                <TR key={lote.loteId}>
                  <TD>
                    {lote.vehiculo}
                    {lote.motivoRetiro ? (
                      <Text4 renderAs="p">
                        {`${etiquetas.motivoRetiroLote}: ${lote.motivoRetiro}`}
                      </Text4>
                    ) : null}
                  </TD>
                  <TD>{formatearPrecio(lote.precio, idioma)}</TD>
                  <TD>
                    {/* Nunca el ENUM crudo (regla 11). */}
                    <Badge color={COLOR_POR_ESTATUS[lote.estatus]}>
                      {diccionario.estatusLote[lote.estatus]}
                    </Badge>
                  </TD>
                  <TD>
                    {!editable ||
                    lote.estatus === "RETIRADO" ? null : lote.puedeRetirarse ? (
                      <Danger
                        type="button"
                        onClick={() => {
                          setPorRetirar(lote);
                        }}
                      >
                        {etiquetas.retirarDeConvocatoria}
                      </Danger>
                    ) : (
                      <Text4 renderAs="p">{etiquetas.loteConFila}</Text4>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardView>
      )}

      {editable ? (
        disponibles.length === 0 ? (
          <Text2 renderAs="p">{etiquetas.sinDisponibles}</Text2>
        ) : (
          <Form action={enviarInclusion} className="lotes__inclusion">
            <input type="hidden" name="convocatoriaId" value={convocatoriaId} />

            <FormField label={etiquetas.campoVehiculo}>
              {/* `<option>` nativo y no el `Option` de Eden. Eden lo admite
                  —su API dice "elements or Option components"— y aqui es la
                  unica opcion correcta: `Option` deduce su valor con
                  `value || children`, asi que una opcion vacia de marcador
                  acabaria enviando su propia etiqueta como identificador de
                  vehiculo. Ver desafios-implementacion.md seccion 28.

                  Esa opcion vacia mas `required` es lo que obliga a elegir: sin
                  ella el navegador da por valida la primera de la lista, que es
                  justo el vehiculo que nadie escogio. */}
              <Select name="vehiculoId" required defaultValue="">
                <option value="">{etiquetas.elegirVehiculo}</option>
                {disponibles.map((vehiculo) => (
                  <option key={vehiculo.vehiculoId} value={vehiculo.vehiculoId}>
                    {vehiculo.etiqueta}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              label={etiquetas.campoPrecio}
              description={etiquetas.precioAyuda}
            >
              <Input
                name="precio"
                type="number"
                required
                min="1"
                max={String(PRECIO_MAXIMO_LOTE)}
                step="1"
              />
            </FormField>

            <Primary type="submit" disabled={incluyendo}>
              {etiquetas.incluirVehiculo}
            </Primary>
          </Form>
        )
      ) : null}

      <DialogModal
        open={abierto}
        header={etiquetas.retirarDeConvocatoria}
        onClose={() => {
          setPorRetirar(undefined);
        }}
        closeLabel={diccionario.acciones.cancelar}
      >
        {errorDeRetiro ? (
          <AlertaError>
            <Text2 renderAs="p">{errorDeRetiro}</Text2>
          </AlertaError>
        ) : null}

        <Form action={enviarRetiro} className="lotes__retiro">
          <input type="hidden" name="convocatoriaId" value={convocatoriaId} />
          <input type="hidden" name="loteId" value={porRetirar?.loteId ?? ""} />

          <Text2 renderAs="p">{porRetirar?.vehiculo ?? ""}</Text2>

          <FormField
            label={etiquetas.motivoRetiroLote}
            description={etiquetas.motivoRetiroLoteAyuda}
          >
            <TextArea name="motivo" required />
          </FormField>

          <div className="lotes__acciones">
            <Danger type="submit" disabled={retirando}>
              {etiquetas.retirarDeConvocatoria}
            </Danger>
            <Secondary
              type="button"
              onClick={() => {
                setPorRetirar(undefined);
              }}
            >
              {diccionario.acciones.cancelar}
            </Secondary>
          </div>
        </Form>
      </DialogModal>
    </Card>
  );
};

export default LotesDeConvocatoria;
