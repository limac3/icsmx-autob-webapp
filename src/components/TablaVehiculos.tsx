"use client";

import Link from "next/link";
import { Badge } from "@churchofjesuschrist/eden-badge";
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
import { Text2 } from "@churchofjesuschrist/eden-text";
import type { Diccionario, Idioma } from "@/dictionaries";
import { enlaceDeBitacora } from "@/lib/auditoria/enlace";
import type { EstatusVehiculo, Vehiculo } from "@/types/vehiculo";
import "./TablaVehiculos.css";

/**
 * Catalogo administrativo — pantalla 4.1 de `ui-ux-requerimientos.md`.
 *
 * **Una sola tabla, no dos vistas.** `CardView` de `eden-table` apila la misma
 * `<Table>` en tarjetas por debajo de 480 px, tomando los encabezados de las
 * columnas. El documento de UI preveia tener que escribir un `CardView` propio
 * porque no aparecia en el inventario verificado; si existe, y usarlo tal cual
 * (regla 10) evita mantener dos arboles que se desincronizan.
 *
 * **Es un componente cliente aunque no tenga estado ni eventos**, y no por
 * gusto: `Table` arma la lista de columnas comparando `child.type === ColGroup`
 * y `=== THead`, y esa identidad no sobrevive la frontera de RSC. Con los hijos
 * creados en un Server Component la lista sale vacia, y `CardView` toma de ahi
 * la etiqueta de cada celda (`columns[index]?.header`): las tarjetas del
 * telefono quedarian sin etiquetas, sin error y sin aviso. Justo la vista movil
 * que exige la regla 12. Ver desafios-implementacion.md seccion 23.
 *
 * No cambia como se renderiza: sigue siendo HTML servido desde el servidor. Los
 * filtros son un formulario `GET` aparte, asi que la pantalla funciona sin
 * JavaScript.
 */

const COLOR_POR_ESTATUS: Record<
  EstatusVehiculo,
  "success" | "info" | "warn" | "greySoft" | "default"
> = {
  DISPONIBLE: "success",
  EN_CONVOCATORIA: "info",
  RESERVADO: "warn",
  VENDIDO: "default",
  RETIRADO: "greySoft",
};

export type TablaVehiculosProps = {
  vehiculos: readonly Vehiculo[];
  diccionario: Diccionario;
  idioma: Idioma;
  /** Puede editarse; si no, la fila no ofrece el enlace. */
  puedeEditar: boolean;
  /** `Autob_Auditar`: agrega la columna con el atajo a la bitacora. */
  puedeAuditar?: boolean;
};

const TablaVehiculos = ({
  vehiculos,
  diccionario,
  idioma,
  puedeEditar,
  puedeAuditar = false,
}: TablaVehiculosProps) => {
  const { vehiculos: etiquetas, estatusVehiculo } = diccionario;

  if (vehiculos.length === 0) {
    return (
      <Text2 renderAs="p" className="tabla-vehiculos__vacio">
        {etiquetas.catalogoVacio}
      </Text2>
    );
  }

  return (
    <CardView>
      <Table className="tabla-vehiculos">
        <ColGroup>
          <Col id="col-vehiculo" />
          <Col id="col-modelo" />
          <Col id="col-kilometraje" />
          <Col id="col-estatus" />
          {puedeAuditar ? <Col id="col-bitacora" /> : null}
        </ColGroup>
        <THead>
          <TR>
            <TH scope="col">{etiquetas.campos.marca}</TH>
            <TH scope="col">{etiquetas.campos.modelo}</TH>
            <TH scope="col">{etiquetas.campos.kilometraje}</TH>
            <TH scope="col">{etiquetas.campos.estatus}</TH>
            {puedeAuditar ? (
              <TH scope="col">{diccionario.auditoria.titulo}</TH>
            ) : null}
          </TR>
        </THead>
        <TBody>
          {vehiculos.map((vehiculo) => (
            <TR key={vehiculo.vehiculoId}>
              <TD>
                {puedeEditar ? (
                  <Link href={`/admin/vehiculos/${vehiculo.vehiculoId}/editar`}>
                    {`${vehiculo.marca} ${vehiculo.version}`}
                  </Link>
                ) : (
                  `${vehiculo.marca} ${vehiculo.version}`
                )}
              </TD>
              <TD>{vehiculo.modelo}</TD>
              <TD>
                {/* Agrupacion de miles segun el idioma; el numero crudo se lee
                    mal a partir de seis digitos. */}
                {new Intl.NumberFormat(idioma).format(vehiculo.kilometraje)}
              </TD>
              <TD>
                {/* Nunca el ENUM crudo (regla 11). */}
                <Badge color={COLOR_POR_ESTATUS[vehiculo.estatus]}>
                  {estatusVehiculo[vehiculo.estatus]}
                </Badge>
              </TD>
              {puedeAuditar ? (
                <TD>
                  {/* Con el tipo y el identificador ya puestos: es lo que
                      evita tener que copiar un ULID a mano. */}
                  <Link
                    href={enlaceDeBitacora("VEHICULO", vehiculo.vehiculoId)}
                  >
                    {diccionario.auditoria.verEnBitacora}
                  </Link>
                </TD>
              ) : null}
            </TR>
          ))}
        </TBody>
      </Table>
    </CardView>
  );
};

export default TablaVehiculos;
