"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@churchofjesuschrist/eden-badge";
import { Ghost } from "@churchofjesuschrist/eden-buttons";
import { ContextualMenu } from "@churchofjesuschrist/eden-contextual-menu";
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
 * **Es un componente cliente aunque la tabla no tenga estado**, y por dos
 * razones ahora: `Table` arma la lista de columnas comparando
 * `child.type === ColGroup` y `=== THead`, y esa identidad no sobrevive la
 * frontera de RSC —con los hijos creados en un Server Component las tarjetas
 * del telefono quedan sin etiquetas, sin error y sin aviso
 * (`desafios-implementacion.md` 23)—; y el menu de acciones abre y cierra con
 * estado.
 *
 * Los filtros siguen siendo un formulario `GET` aparte, asi que la pantalla se
 * puede leer y filtrar sin JavaScript. Lo que si necesita JavaScript es el menu
 * de acciones, y por eso **ninguna accion vive solo ahi**: editar es tambien el
 * enlace del nombre.
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

/** Como se llama cada convocatoria activa, resuelto por el servidor. */
export type NombreDeConvocatoria = { nombre: string; folio: string };

export type TablaVehiculosProps = {
  vehiculos: readonly Vehiculo[];
  diccionario: Diccionario;
  idioma: Idioma;
  /** Puede editarse; si no, la fila no ofrece el enlace. */
  puedeEditar: boolean;
  /** `Autob_Auditar`: agrega el atajo a la bitacora en el menu de la fila. */
  puedeAuditar?: boolean;
  /**
   * `convocatoriaId` -> nombre y folio, para las que estan activas.
   *
   * Lo arma la pagina con **una** lectura del listado de convocatorias, no una
   * por vehiculo: el catalogo llega a 500 items por estatus y una lectura por
   * fila lo volveria impagable. Un identificador sin nombre no se muestra
   * crudo — no le dice nada a nadie (regla 11 en espiritu).
   */
  convocatorias?: Readonly<Record<string, NombreDeConvocatoria>>;
  /**
   * `vehiculoId` -> URL firmada de su miniatura, o ausente si no tiene
   * fotografia principal.
   *
   * La firma la hace la pagina en cada peticion (regla 13). Sale de
   * `fotografiaPrincipalClave`, desnormalizada en el item del vehiculo: sin
   * ella esta columna costaba una lectura de galeria por fila.
   */
  miniaturas?: Readonly<Record<string, string>>;
};

/**
 * Acciones de una fila, en el `ContextualMenu` que pide la seccion 4.1.
 *
 * Es un componente propio y no un bloque dentro del `map` porque cada menu
 * necesita su `useState` y su `useRef`, y los hooks no pueden vivir en un
 * bucle.
 */
const AccionesDeVehiculo = ({
  vehiculo,
  diccionario,
  puedeEditar,
  puedeAuditar,
}: {
  vehiculo: Vehiculo;
  diccionario: Diccionario;
  puedeEditar: boolean;
  puedeAuditar: boolean;
}) => {
  const [abierto, setAbierto] = useState(false);
  const ancla = useRef<HTMLSpanElement>(null);
  const cerrar = () => setAbierto(false);

  const opciones = [
    ...(puedeEditar
      ? [
          {
            href: `/admin/vehiculos/${vehiculo.vehiculoId}/editar`,
            etiqueta: diccionario.vehiculos.editar,
          },
        ]
      : []),
    ...(puedeAuditar
      ? [
          {
            href: enlaceDeBitacora("VEHICULO", vehiculo.vehiculoId),
            etiqueta: diccionario.auditoria.verEnBitacora,
          },
        ]
      : []),
  ];

  if (opciones.length === 0) return null;

  return (
    <>
      <span ref={ancla}>
        <Ghost
          type="button"
          small
          aria-expanded={abierto}
          // El numero economico y no marca/version: con veinte vehiculos
          // iguales, "Acciones: Nissan NP300" nombra veinte filas distintas y
          // quien usa lector de pantalla no puede saber en cual esta.
          aria-label={`${diccionario.vehiculos.acciones}: ${vehiculo.numeroEconomico}`}
          onClick={() => setAbierto((valor) => !valor)}
          onKeyDown={(evento) => {
            if (evento.key === "Escape") cerrar();
          }}
        >
          <span aria-hidden="true">⋯</span>
        </Ghost>
      </span>

      <ContextualMenu open={abierto} forRef={ancla} onClickOutside={cerrar}>
        <ul className="tabla-vehiculos__acciones">
          {opciones.map((opcion) => (
            <li key={opcion.href}>
              <Link href={opcion.href} onClick={cerrar}>
                {opcion.etiqueta}
              </Link>
            </li>
          ))}
        </ul>
      </ContextualMenu>
    </>
  );
};

const TablaVehiculos = ({
  vehiculos,
  diccionario,
  idioma,
  puedeEditar,
  puedeAuditar = false,
  convocatorias = {},
  miniaturas = {},
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
          <Col id="col-fotografia" />
          <Col id="col-vehiculo" />
          <Col id="col-kilometraje" />
          <Col id="col-estatus" />
          <Col id="col-convocatoria" />
          <Col id="col-acciones" />
        </ColGroup>
        <THead>
          <TR>
            <TH scope="col">{etiquetas.campos.fotografia}</TH>
            <TH scope="col">{etiquetas.campos.vehiculo}</TH>
            <TH scope="col">{etiquetas.campos.kilometraje}</TH>
            <TH scope="col">{etiquetas.campos.estatus}</TH>
            <TH scope="col">{etiquetas.campos.convocatoria}</TH>
            <TH scope="col">{etiquetas.acciones}</TH>
          </TR>
        </THead>
        <TBody>
          {vehiculos.map((vehiculo) => {
            const convocatoria = vehiculo.convocatoriaId
              ? convocatorias[vehiculo.convocatoriaId]
              : undefined;

            const miniatura = miniaturas[vehiculo.vehiculoId];

            return (
              <TR key={vehiculo.vehiculoId}>
                <TD>
                  {miniatura === undefined ? (
                    // Sin fotografia no se dibuja un marco vacio: la celda se
                    // queda en blanco y el nombre de al lado sigue
                    // identificando la fila.
                    <Text4 renderAs="span">{etiquetas.sinFotografia}</Text4>
                  ) : (
                    // `alt` vacio y `aria-hidden`: la miniatura **repite** lo
                    // que ya dice la celda de al lado, asi que describirla
                    // haria al lector de pantalla leer cada vehiculo dos
                    // veces. Es decorativa en el sentido estricto de WCAG.
                    <img
                      className="tabla-vehiculos__miniatura"
                      src={miniatura}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                      decoding="async"
                      width={80}
                      height={60}
                    />
                  )}
                </TD>
                {/* **El numero economico encabeza la celda y es el enlace**:
                    es con lo que la organizacion nombra el vehiculo y lo unico
                    que lo distingue de otro igual. Marca, version y modelo
                    bajan a una linea de apoyo — veinte NP300 2019 se ven
                    identicas, y el enlace tiene que ser el indice, no la
                    descripcion. Mismo reparto que el nombre y el folio en el
                    catalogo de convocatorias. */}
                <TD>
                  {puedeEditar ? (
                    <Link
                      href={`/admin/vehiculos/${vehiculo.vehiculoId}/editar`}
                    >
                      {vehiculo.numeroEconomico}
                    </Link>
                  ) : (
                    vehiculo.numeroEconomico
                  )}
                  <Text4 renderAs="p">
                    {`${vehiculo.marca} ${vehiculo.version} ${String(vehiculo.modelo)}`}
                  </Text4>
                </TD>
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
                <TD>
                  {/* Un vehiculo no puede estar en dos convocatorias activas
                      (R-10), asi que la columna es de un solo valor. Si el
                      identificador no resuelve a nombre, no se muestra crudo:
                      un ULID no le dice nada a nadie. */}
                  {convocatoria ? (
                    <>
                      <Link
                        href={`/admin/convocatorias/${vehiculo.convocatoriaId ?? ""}`}
                      >
                        {convocatoria.nombre}
                      </Link>
                      <Text4 renderAs="p">
                        {`${diccionario.convocatorias.campoFolio}: ${convocatoria.folio}`}
                      </Text4>
                    </>
                  ) : (
                    <Text4 renderAs="span">{etiquetas.sinConvocatoria}</Text4>
                  )}
                </TD>
                <TD>
                  <AccionesDeVehiculo
                    vehiculo={vehiculo}
                    diccionario={diccionario}
                    puedeEditar={puedeEditar}
                    puedeAuditar={puedeAuditar}
                  />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </CardView>
  );
};

export default TablaVehiculos;
