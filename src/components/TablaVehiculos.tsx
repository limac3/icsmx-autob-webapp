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
 * Es un Server Component: no tiene estado ni eventos. Los filtros son un
 * formulario `GET` aparte, de modo que la pantalla funciona sin JavaScript.
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
};

const TablaVehiculos = ({
  vehiculos,
  diccionario,
  idioma,
  puedeEditar,
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
        </ColGroup>
        <THead>
          <TR>
            <TH scope="col">{etiquetas.campos.marca}</TH>
            <TH scope="col">{etiquetas.campos.modelo}</TH>
            <TH scope="col">{etiquetas.campos.kilometraje}</TH>
            <TH scope="col">{etiquetas.campos.estatus}</TH>
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
            </TR>
          ))}
        </TBody>
      </Table>
    </CardView>
  );
};

export default TablaVehiculos;
